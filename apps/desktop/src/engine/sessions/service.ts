/**
 * The role sessions: opening one, driving its turns, handing it its deliveries on the three
 * channels, watching its health, replacing it, rebuilding the tree after a restart, and stopping
 * an owner's whole tree.
 *
 * - **Turns.** A session's first turn is its brief, with whatever was queued for it; each later
 *   turn starts when it is idle and a delivery waits. Deliveries queued while it is in a turn go
 *   as one message at the end of the turn, each block under its own marker.
 * - **Channels.** Between turns (the default); urgent, as a note in the result of its next Hemera
 *   tool call, falling back to cancel-then-message when no call takes it within `NOTE_PICKUP`, or
 *   at once for an agent that does not obey notes; redirect, by cancelling the turn and sending.
 * - **Health (CT-12, CT-15).** A session in a turn with no update, no tool call, no command of its
 *   own running and no provider wait for 5 minutes is stuck: its parent is told, then it is
 *   replaced. A dead agent is replaced. A compaction the agent signals sends the instructions and
 *   the brief again; past 80 % of its window, an agent with no such signal is replaced.
 * - **Replacement.** The old session is stopped and kept, a fresh one of the same role, lineage
 *   and owner starts with the resume block and what was queued; one Journal line says why. The
 *   `ReplacementGuard` is asked first.
 * - **At start (CT-11).** Only this supervisor creates sessions: once the automation gate opens
 *   and the Memory is ready, orphan agent processes are killed, then every owner's live sessions
 *   are rebuilt top-down with fresh ones and the resume block. It counts in no counter.
 * - **Stop.** `stopTree` stops an owner's sessions children first, their processes with them.
 *
 * Nobody chats with a mission's sessions: nothing here takes text from the user.
 */

import {
  type AgentProvider,
  LIVE_RUN_STATES,
  NOTE_PICKUP_SECONDS,
  STUCK_AFTER_MINUTES,
  type NeedFields,
  deliveryBlock,
  hemeraNote,
  saturates,
} from '@hemera/core/domain'
import { and, eq, inArray } from 'drizzle-orm'
import {
  Cause,
  Clock,
  Context,
  Duration,
  Effect,
  Fiber,
  Layer,
  Predicate,
  Result,
  Schedule,
  Schema,
  Semaphore,
  Stream,
} from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { ADAPTERS } from '../agents/adapters/index.ts'
import { type AgentEvent, type ImageNotAccepted, TextBlock } from '../agents/client.ts'
import { Discovery } from '../agents/discovery.ts'
import { type AgentFailure, AgentRuntime } from '../agents/runtime.ts'
import type { DomainEvents } from '../domain-events.ts'
import { AutomationGate } from '../gate.ts'
import { Memory } from '../memory/index.ts'
import type { MissionActivity } from '../missions.ts'
import type { Need } from '@hemera/ipc'
import type { Secrets } from '../secrets.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import { commandRuns, missions, runnerLeases } from '../storage/schema.ts'
import { ProcessSupervisor } from '../supervisor.ts'
import type { ToolAccess } from '../tools/access.ts'
import { mutate } from '../transaction.ts'
import { type BriefSources, type Predecessor, briefOf } from './brief.ts'
import {
  type DeliveryAsked,
  type DeliveryKindRefused,
  type StoredDelivery,
  giveBack,
  markSent,
  queuedFor,
  storeDelivery,
  supersedeAll,
} from './deliveries.ts'
import { spendBudget } from '../budget.ts'
import { Cap, type RequestedBy } from './cap.ts'
import { assignWork } from './leases.ts'
import {
  CHANGE_THE_MODEL,
  agentUnavailable,
  limitReached,
  modelToChange,
  modelUnavailable,
  sessionNeedIn,
  sessionOfNeed,
  stopWithNeed,
} from './needs.ts'
import { RESTARTED } from './guard.ts'
import { ModelChoice, ReplacementGuard } from './ports.ts'
import { SessionPost } from './post.ts'
import { RoleRegistry, type RoleEntry, type SessionOwner, roleNamed } from './roles.ts'
import {
  type RoleSession,
  type SessionAsked,
  applySetting,
  endSession,
  getSession,
  insertSession,
  openSession,
  sessionEvent,
  sessionsIn,
  sessionsOfLineage,
  setState,
} from './store.ts'
import { addToThread, instructionsKept } from './thread.ts'
import { addUsage, estimatedTokens, setCost } from './usage.ts'

/** A session refused before it opens: a role no ticket registered, or not its owner's kind. */
export class SessionRefused extends Schema.TaggedError<SessionRefused>()('SessionRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return `This session cannot be opened: ${this.reason}.`
  }
}

/** What opening a session asks. */
export interface OpenAsked {
  readonly owner: SessionOwner
  readonly role: string
  /** The agent; the role's setting from `ModelChoice` otherwise, with its model and effort. */
  readonly provider?: AgentProvider | undefined
  /** The folder of its place, which the role's place kind names. */
  readonly folder: string
  /** The session that starts it, for a child: a helper, a Probe. */
  readonly parent?: RoleSession | undefined
  readonly chosen?: RoleSession['chosen']
  /**
   * Who asks for it: an agent's call, which the Project's cap refuses above it and which spends
   * the mission's launches; or Hemera, whose phases wait for a slot. Hemera unless said.
   */
  readonly requestedBy?: RequestedBy | undefined
}

export class Sessions extends Context.Service<
  Sessions,
  {
    /** Opens a session of a role and starts it: its brief is its first turn. */
    readonly open: (asked: OpenAsked) => Effect.Effect<RoleSession, SessionRefused | DatabaseError>
    /**
     * Opens the next session of a lineage, under the lock: every session of it still live or
     * starting is ended first, and the new one takes the highest epoch + 1 as the rows say it now,
     * with what was queued for the lineage (a Chat's fresh session after its model changed).
     */
    readonly reopen: (
      lineage: string,
      asked: OpenAsked,
      reason: string,
    ) => Effect.Effect<RoleSession, SessionRefused | DatabaseError>
    /** Stores a delivery, then hands it over on its channel when its session lives. */
    readonly deliver: (
      asked: DeliveryAsked,
    ) => Effect.Effect<string, DeliveryKindRefused | DatabaseError>
    /**
     * Stores a delivery to a role, and opens a session of that role with it when none lives: what
     * wakes which role is the role's ticket's to decide, never a timer.
     */
    readonly deliverOrStart: (
      asked: DeliveryAsked & { readonly target: { readonly role: string } },
      start: OpenAsked,
    ) => Effect.Effect<string, DeliveryKindRefused | SessionRefused | DatabaseError>
    /** Replaces a session by a fresh one of its lineage; null when it was not replaced. */
    readonly replace: (
      sessionId: string,
      reason: string,
    ) => Effect.Effect<RoleSession | null, DatabaseError>
    /** Stops every session of an owner, children first, their processes with them. */
    readonly stopTree: (owner: SessionOwner, reason?: string) => Effect.Effect<void, DatabaseError>
    /** The start's rebuild of the sessions a stopped engine left (CT-11). */
    readonly rebuild: Effect.Effect<ReadonlyArray<RoleSession>, DatabaseError>
    /** Waits until a session is between turns with nothing queued for it. */
    readonly settled: (sessionId: string) => Effect.Effect<void, DatabaseError>
    /** Cancels the turn a lineage's live session is in; its conversation stays. */
    readonly cancelTurn: (lineage: string) => Effect.Effect<void>
    /** Ends a lineage's live sessions, a starting one too, their processes with them. */
    readonly end: (lineage: string, reason: string) => Effect.Effect<void, DatabaseError>
  }
>()('Sessions') {}

/** The bounds of the rules that watch a session; the constants of the ticket otherwise. */
export interface SessionTimings {
  /** How long an urgent note waits for a Hemera tool call (`NOTE_PICKUP`, 30 s). */
  readonly notePickup: Duration.Duration
  /** How long a session in a turn may be silent before it is stuck (CT-12, 5 minutes). */
  readonly stuckAfter: Duration.Duration
  /** How often the sessions are looked at for silence. */
  readonly sweepEvery: Duration.Duration
}

export const SESSION_TIMINGS: SessionTimings = {
  notePickup: Duration.seconds(NOTE_PICKUP_SECONDS),
  stuckAfter: Duration.minutes(STUCK_AFTER_MINUTES),
  sweepEvery: Duration.seconds(30),
}

export interface SessionsSettings {
  readonly log: Log
  /** Shorter bounds, for the suites; the ticket's otherwise. */
  readonly timings?: Partial<SessionTimings> | undefined
}

/** One live session, as its driver holds it. */
interface Driver {
  session: RoleSession
  readonly entry: RoleEntry
  /** Its brief, until its first turn sends it. */
  brief: string | null
  turn: Fiber.Fiber<void> | null
  /** When it last gave a sign of life, on Effect's clock. */
  lastSign: number
  /** What it said in the turn running. */
  said: string[]
  /** Whether its agent took the turn running: it spoke, thought, called or waited on its provider. */
  took: boolean
  /** The urgent deliveries pinned as notes, each with the fiber that falls back at its pickup. */
  readonly pinned: Map<string, Fiber.Fiber<void>>
  /** Set once it is replaced, ended or failed: nothing is driven on it any more. */
  gone: boolean
  /** The provider limit its agent reported, in the provider's words: its turn is its last. */
  limit: string | null
}

const LIVE_OR_STUCK = ['starting', 'working', 'idle', 'stuck'] as const

/** What an agent reports only once it took a turn's message. */
const TOOK_THE_TURN = ['MessageChunk', 'ThoughtChunk', 'ToolCall', 'Plan', 'ProviderWait'] as const

/** The mission a session belongs to, or null for a Project's. */
const missionOf = (session: RoleSession): string | null =>
  session.owner.kind === 'mission' ? session.owner.missionId : null

/** The next session of a lineage: same role, owner, place and parent, at the next epoch. */
const successorOf = (session: RoleSession): SessionAsked => ({
  provider: session.provider,
  owner: session.owner,
  role: session.role,
  folder: session.folder,
  parent: session.parent === null ? null : { lineage: session.parent, depth: session.depth - 1 },
  lineage: session.lineage,
  epoch: session.epoch + 1,
  chosen: session.chosen,
  modelLevel: session.modelLevel,
})

/** The failures that say the agent itself cannot be had here. */
const UNUSABLE_AGENT = [
  'AgentNotInstalled',
  'AgentNotSignedIn',
  'AgentAdapterMissing',
  'BareModeNotQualified',
] as const

/**
 * Whether a role's sessions take a slot of the cap: the registry says so, and the main session of
 * a stage never does.
 */
const counts = (entry: RoleEntry): boolean => entry.countsInCap && entry.mainOf === null

/** The Project an owner belongs to. */
const projectOf = (owner: SessionOwner) =>
  Effect.gen(function* () {
    if (owner.kind === 'project') return owner.projectId
    const database = yield* Database
    const [mission] = yield* database
      .select({ projectId: missions.projectId })
      .from(missions)
      .where(eq(missions.id, owner.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    return mission?.projectId ?? ''
  })

/** What a replacement says in the Journal, from the role's own name. */
const capitalized = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

type Needs =
  | Database
  | DomainEvents
  | Secrets
  | AgentRuntime
  | RoleRegistry
  | BriefSources
  | AutomationGate
  | Memory
  | SessionPost
  | ProcessSupervisor
  | ReplacementGuard
  | ModelChoice
  | ToolAccess
  | Discovery
  | Cap
  | MissionActivity

export const sessionsLayer = (settings: SessionsSettings) =>
  Layer.effect(
    Sessions,
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs>()
      const runtime = yield* AgentRuntime
      const registry = yield* RoleRegistry
      const post = yield* SessionPost
      const cap = yield* Cap
      const scope = yield* Effect.scope
      const lock = yield* Semaphore.make(1)
      const timings = { ...SESSION_TIMINGS, ...settings.timings }
      const drivers = new Map<string, Driver>()
      /** When this engine started: a session opened since is this engine's, never rebuilt. */
      const startedAt = new Date().toISOString()
      const run = <A, E>(effect: Effect.Effect<A, E, Needs>) => Effect.provide(effect, context)
      const said = (line: string) => Effect.sync(() => settings.log(`sessions: ${line}`))

      /** The driver of a lineage's live session, if one runs. */
      const liveOfLineage = (lineage: string): Driver | undefined =>
        [...drivers.values()].find((driver) => !driver.gone && driver.session.lineage === lineage)

      const liveDriver = (sessionId: string): Driver | undefined => {
        const driver = drivers.get(sessionId)
        return driver === undefined || driver.gone ? undefined : driver
      }

      // --- turns ---------------------------------------------------------------------------

      /** One turn of a session: the message sent, its end written, then what waits is sent. */
      const runTurn = (
        driver: Driver,
        text: string,
        deliveries: ReadonlyArray<string>,
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          const outcome = yield* runtime
            .prompt(driver.session.id, [TextBlock.make({ text })])
            .pipe(Effect.result)
          driver.turn = null
          yield* post.turning(driver.session.id, null, false)
          const spoken = driver.said.join('')
          driver.said = []
          if (spoken.trim() !== '') yield* addToThread(driver.session.id, 'said', spoken)
          if (Result.isSuccess(outcome)) {
            const usage = outcome.success.usage
            yield* addUsage(
              driver.session,
              usage === null
                ? { input: estimatedTokens(text), output: estimatedTokens(spoken) }
                : { input: usage.inputTokens, output: usage.outputTokens },
              usage !== null,
            )
          }
          if (driver.gone) return
          if (driver.limit !== null) {
            yield* stopAtLimit(driver, driver.limit)
            return
          }
          if (Result.isFailure(outcome)) {
            const unavailable = unavailableOf(driver, outcome.failure)
            // Never another agent or model: the owner is asked, the session stops before it works.
            if (unavailable !== null) yield* stopUnavailable(driver, unavailable)
            // The agent could not be started or spoken to: the session fails, in words.
            else yield* fail(driver, outcome.failure.message)
            // What its agent never took is queued again, for the next session that may take it.
            if (!driver.took && deliveries.length > 0) {
              yield* mutate('giving deliveries back', (transaction) =>
                Effect.as(giveBack(transaction, deliveries, driver.session.id), {
                  result: undefined,
                  events: [],
                }),
              )
              yield* post.ring
            }
            return
          }
          // A death closes the turn as interrupted: its replacement is the deaths' to start.
          if (outcome.success.stopReason === 'interrupted') return
          yield* setState(driver.session.id, 'idle')
          yield* pump(driver)
        }).pipe(
          run,
          Effect.catchCause((cause) =>
            said(`a turn of ${driver.session.id} ended badly: ${String(cause)}`),
          ),
        )

      /** Sends what waits for an idle session: its brief first, then its deliveries in order. */
      const pump = (driver: Driver): Effect.Effect<void, DatabaseError> =>
        Semaphore.withPermits(
          lock,
          1,
        )(
          Effect.gen(function* () {
            if (driver.gone || driver.turn !== null) return
            const queued = yield* queuedFor(driver.session)
            const brief = driver.brief
            if (queued.length === 0 && brief === null) return
            const sent = yield* mutate('handing deliveries over', (transaction) =>
              Effect.map(
                markSent(
                  transaction,
                  queued.map((one) => one.id),
                  driver.session.id,
                ),
                (ids) => ({ result: ids, events: [] }),
              ),
            )
            const taken = queued.filter((one) => sent.includes(one.id))
            for (const one of taken) yield* unpin(driver, one.id)
            // The instructions sent again come before the brief, which comes before the rest.
            const instructions = taken.filter((one) => one.kind === 'instructions')
            const blocks = [
              ...instructions.map((one) => deliveryBlock(one.kind, one.body)),
              ...(brief === null ? [] : [brief]),
              ...taken
                .filter((one) => one.kind !== 'instructions')
                .map((one) => deliveryBlock(one.kind, one.body)),
            ]
            if (blocks.length === 0) return
            driver.brief = null
            const text = blocks.join('\n\n')
            yield* setState(driver.session.id, 'working')
            yield* post.turning(driver.session.id, missionOf(driver.session), true)
            yield* addToThread(driver.session.id, 'sent', text)
            driver.lastSign = yield* Clock.currentTimeMillis
            driver.took = false
            driver.turn = yield* runTurn(driver, text, sent).pipe(Effect.forkIn(scope))
          }),
        ).pipe(run)

      /** Takes back a pinned note: the end of the turn sends it with the rest. */
      const unpin = (driver: Driver, deliveryId: string) =>
        Effect.gen(function* () {
          const pickup = driver.pinned.get(deliveryId)
          if (pickup === undefined) return
          driver.pinned.delete(deliveryId)
          yield* post.unpin(deliveryId)
          yield* Fiber.interrupt(pickup)
        })

      /** Cancels the turn running; its end sends what waits. */
      const redirect = (driver: Driver) =>
        Effect.gen(function* () {
          if (driver.turn === null) return
          yield* addToThread(driver.session.id, 'state', 'turn cancelled for a delivery')
          yield* runtime.cancel(driver.session.id)
        }).pipe(run)

      /** Hands the urgent and redirecting deliveries of a session in a turn over their channel. */
      const hurry = (driver: Driver) =>
        Effect.gen(function* () {
          const queued = yield* queuedFor(driver.session)
          const adapter = ADAPTERS[driver.session.provider]
          for (const one of queued) {
            if (one.urgency === 'redirect') {
              yield* redirect(driver)
              return
            }
            if (one.urgency !== 'urgent' || driver.pinned.has(one.id)) continue
            if (!adapter.obeysNotes) {
              yield* redirect(driver)
              return
            }
            yield* pin(driver, one)
          }
        }).pipe(run)

      /** Pins a note for the session's next Hemera tool result, with its fallback at pickup. */
      const pin = (driver: Driver, one: StoredDelivery) =>
        Effect.gen(function* () {
          yield* post.pin({
            deliveryId: one.id,
            sessionId: driver.session.id,
            text: hemeraNote(one.id, one.body),
          })
          const pickup = yield* Effect.sleep(timings.notePickup).pipe(
            Effect.andThen(
              Effect.gen(function* () {
                driver.pinned.delete(one.id)
                // Not picked up in time while the turn went on: cancel, then send it.
                if (yield* post.unpin(one.id)) yield* redirect(driver)
              }),
            ),
            Effect.ignore,
            Effect.forkIn(scope),
          )
          driver.pinned.set(one.id, pickup)
        })

      /** Looks at every live session: an idle one takes what waits, a busy one its urgent mail. */
      const dispatch = Effect.suspend(() =>
        Effect.forEach(
          [...drivers.values()].filter((driver) => !driver.gone),
          (driver) => (driver.turn === null ? pump(driver) : hurry(driver)),
          { discard: true },
        ),
      ).pipe(Effect.catchCause((cause) => said(`dispatch failed: ${String(cause)}`)))

      // --- starting, ending, replacing -------------------------------------------------------

      /** Starts a session's driver once automations may run and the Memory is ready. */
      const start = (session: RoleSession, predecessor: Predecessor | null) =>
        Effect.gen(function* () {
          yield* AutomationGate.use((gate) => gate.pass)
          yield* Memory.use((memory) => memory.ready)
          const entry = roleNamed(registry, session.role)
          if (entry === undefined) {
            yield* endQuietly(session, 'failed', `no role ${session.role} is registered`)
            return
          }
          if (counts(entry)) {
            const projectId = yield* projectOf(session.owner)
            yield* cap.acquire({
              projectId,
              lineage: session.lineage,
              missionId: missionOf(session),
              requestedBy: 'hemera',
            })
          }
          const brief = yield* briefOf(entry, session.owner, session, predecessor)
          const lastSign = yield* Clock.currentTimeMillis
          // Stopped or replaced while it waited: nothing of it starts.
          const driver = yield* Semaphore.withPermits(
            lock,
            1,
          )(
            Effect.gen(function* () {
              const now = yield* getSession(session.id).pipe(
                Effect.catchTag('UnknownSession', () => Effect.succeed(null)),
              )
              if (now?.state !== 'starting') return null
              const one: Driver = {
                session: yield* takeSetting(session),
                entry,
                brief,
                turn: null,
                lastSign,
                said: [],
                took: false,
                pinned: new Map(),
                gone: false,
                limit: null,
              }
              drivers.set(session.id, one)
              return one
            }),
          )
          if (driver !== null) yield* pump(driver)
          // Stopped while it waited for its slot: the slot goes to the next one.
          else if (counts(entry)) yield* cap.release(session.lineage)
        }).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.void : startFailed(session, cause),
          ),
          run,
        )

      /** A start that failed: the session fails in words, its parent is told. */
      const startFailed = (session: RoleSession, cause: Cause.Cause<unknown>) =>
        Effect.gen(function* () {
          const error = Cause.squash(cause)
          const reason = error instanceof Error ? error.message : String(error)
          const driver = liveDriver(session.id)
          if (driver !== undefined) return yield* fail(driver, reason)
          const now = yield* getSession(session.id).pipe(Effect.orElseSucceed(() => null))
          if (now?.state !== 'starting') return
          const roleName = roleNamed(registry, session.role)?.displayName ?? session.role
          yield* endQuietly(session, 'failed', reason)
          yield* addToThread(session.id, 'state', `failed: ${reason}`)
          yield* tellParent(session, `Your ${roleName} session failed: ${reason}`)
        }).pipe(
          run,
          Effect.catchCause((again) =>
            said(`the failed start of ${session.id} was not recorded: ${String(again)}`),
          ),
        )

      /**
       * A session whose agent and model came from the cascade takes the setting as it stands when
       * its agent is about to start: a successor gets a change made since its predecessor opened.
       */
      const takeSetting = (session: RoleSession) =>
        Effect.gen(function* () {
          if (session.modelLevel === null) return session
          const setting = yield* ModelChoice.use((choice) => choice.of(session.owner, session.role))
          const same =
            setting.agent === session.provider &&
            setting.model === session.chosen.model &&
            setting.effort === session.chosen.effort &&
            setting.level === session.modelLevel
          return same ? session : yield* applySetting(session.id, setting)
        })

      /** Ends a session that has no driver, with its event; its lineage's slot is freed. */
      const endQuietly = (session: RoleSession, state: 'ended' | 'failed', reason: string) =>
        mutate('ending a session', (transaction) =>
          Effect.map(endSession(transaction, session, state, reason), (event) => ({
            result: undefined,
            events: [event],
          })),
        ).pipe(Effect.andThen(cap.release(session.lineage)), run)

      /**
       * Ends every session of a lineage still live or starting, with or without a driver: one
       * still starting has none yet, and its start's check of `starting` then stops it.
       */
      const endLive = (rows: ReadonlyArray<RoleSession>, reason: string) =>
        Effect.forEach(
          rows.filter((one) => LIVE_OR_STUCK.some((state) => state === one.state)),
          (session) =>
            Effect.gen(function* () {
              const driver = drivers.get(session.id)
              if (driver !== undefined) yield* letGo(driver)
              else yield* runtime.release(session.id)
              yield* endQuietly(session, 'ended', reason)
              yield* addToThread(session.id, 'state', `ended: ${reason}`)
            }),
          { discard: true },
        ).pipe(run)

      /** Stops a session with a need about it; its lineage's slot is freed. */
      const stopNeeding = (...stopped: Parameters<typeof stopWithNeed>) =>
        stopWithNeed(...stopped).pipe(Effect.andThen(cap.release(stopped[0].lineage)), run)

      /** Lets a driver go: no turn, even one whose agent still starts, no pending note, no process. */
      const letGo = (driver: Driver) =>
        Effect.gen(function* () {
          driver.gone = true
          drivers.delete(driver.session.id)
          const turn = driver.turn
          driver.turn = null
          for (const deliveryId of [...driver.pinned.keys()]) yield* unpin(driver, deliveryId)
          yield* runtime.cancel(driver.session.id)
          yield* runtime.release(driver.session.id)
          if (turn === null) return
          yield* Fiber.interrupt(turn)
          yield* post.turning(driver.session.id, null, false)
        })

      /** Tells a session's parent, between its turns, what happened to its child. */
      const tellParent = (session: RoleSession, text: string) =>
        session.parent === null
          ? Effect.void
          : storeDelivery({
              owner: session.owner,
              target: { lineage: session.parent },
              kind: 'child',
              body: text,
            }).pipe(Effect.andThen(post.ring), run, Effect.ignore)

      /** A session whose agent could not be started or spoken to: it fails, its parent is told. */
      const fail = (driver: Driver, reason: string) =>
        Effect.gen(function* () {
          yield* letGo(driver)
          yield* endQuietly(driver.session, 'failed', reason)
          yield* addToThread(driver.session.id, 'state', `failed: ${reason}`)
          yield* tellParent(
            driver.session,
            `Your ${driver.entry.displayName} session failed: ${reason}`,
          )
        }).pipe(run)

      /** The need an agent or a model that cannot be had gives, or null for another failure. */
      const unavailableOf = (driver: Driver, failure: AgentFailure | ImageNotAccepted) => {
        const roleName = driver.entry.displayName
        if (Predicate.isTagged(failure, 'ModelUnavailable')) {
          return modelUnavailable(driver.session, roleName, failure.reason)
        }
        return UNUSABLE_AGENT.some((tag) => Predicate.isTagged(failure, tag))
          ? agentUnavailable(driver.session, roleName, failure.message)
          : null
      }

      /** Its agent or its model cannot be had: it fails, its owner gets an environment need. */
      const stopUnavailable = (driver: Driver, fields: NeedFields) =>
        Effect.gen(function* () {
          yield* letGo(driver)
          const why = Predicate.isTagged(fields, 'Environment') ? fields.missing : 'unavailable'
          yield* stopNeeding(
            driver.session,
            { state: 'failed', reason: why },
            { reason: 'start', fields },
          )
          yield* addToThread(driver.session.id, 'state', `failed: ${why}`)
          yield* tellParent(driver.session, `${why}. The user is asked.`)
        }).pipe(run)

      /**
       * Its provider holds a limit: the session ends where it stands, its work and its leases kept,
       * and its owner gets an environment need. Retry starts its lineage again.
       */
      const stopAtLimit = (driver: Driver, title: string) =>
        Effect.gen(function* () {
          // Its turn's end and the agent's report may both get here: the first one stops it.
          if (driver.gone) return
          yield* letGo(driver)
          const reason = `provider limit: ${title}`
          yield* stopNeeding(
            driver.session,
            { state: 'ended', reason },
            {
              reason: 'limit',
              fields: limitReached(driver.session, driver.entry.displayName, title),
            },
          )
          yield* addToThread(driver.session.id, 'state', `ended: ${reason}`)
          yield* tellParent(
            driver.session,
            `Your ${driver.entry.displayName} session stopped at a provider limit: ${title}. The user is asked.`,
          )
        }).pipe(run)

      /** The leases a session held, now its successor's. */
      const passLeases = (from: RoleSession, to: RoleSession) =>
        Effect.gen(function* () {
          const database = yield* Database
          const held = yield* database
            .select({ workItem: runnerLeases.workItem })
            .from(runnerLeases)
            .where(eq(runnerLeases.sessionId, from.id))
            .pipe(Effect.mapError(refusedWhile('reading the leases')))
          yield* Effect.forEach(held, (lease) => assignWork(lease.workItem, to), { discard: true })
        })

      /**
       * Stops a session and opens its successor in one transaction: the old one kept, replaced,
       * the new one of the same role, lineage and owner at the next epoch, and the Journal's line.
       */
      const succeed = (session: RoleSession, reason: string) =>
        mutate('replacing a session', (transaction) =>
          Effect.gen(function* () {
            const stopped = yield* endSession(transaction, session, 'replaced', reason)
            const successor = yield* insertSession(transaction, successorOf(session))
            const roleName = roleNamed(registry, session.role)?.displayName ?? session.role
            return {
              result: successor,
              events: [
                stopped,
                sessionEvent('session.replaced', session, {
                  replacement: successor.id,
                  reason,
                  roleName,
                }),
              ],
            }
          }),
        )

      const replace = (sessionId: string, reason: string) =>
        Semaphore.withPermits(
          lock,
          1,
        )(
          Effect.gen(function* () {
            const session = yield* getSession(sessionId).pipe(
              Effect.catchTag('UnknownSession', () => Effect.succeed(null)),
            )
            if (session === null || !LIVE_OR_STUCK.some((state) => state === session.state)) {
              return null
            }
            const driver = drivers.get(sessionId)
            const verdict = yield* ReplacementGuard.use((guard) => guard.allows(session, reason))
            if (!verdict.allowed) {
              if (driver !== undefined) yield* letGo(driver)
              else yield* runtime.release(sessionId)
              yield* stopNeeding(
                session,
                { state: 'failed', reason: verdict.why },
                { reason: 'failing', fields: verdict.need },
              )
              yield* addToThread(session.id, 'state', `failed: ${verdict.why}`)
              yield* tellParent(
                session,
                `Your session of ${session.role} stopped: ${verdict.why}. The user is asked.`,
              )
              return null
            }
            if (driver !== undefined) yield* letGo(driver)
            else yield* runtime.release(sessionId)
            const successor = yield* succeed(session, reason)
            yield* passLeases(session, successor)
            yield* addToThread(session.id, 'state', `replaced: ${reason}`)
            yield* said(`replaced ${session.id} by ${successor.id}: ${reason}`)
            const roleName = roleNamed(registry, session.role)?.displayName ?? session.role
            yield* tellParent(
              session,
              `${capitalized(roleName)}’s session was replaced: ${reason}.`,
            )
            yield* start(successor, {
              lineage: session.lineage,
              stoppedAt: new Date().toISOString(),
            }).pipe(Effect.forkIn(scope))
            return successor
          }),
        ).pipe(run)

      // --- health ---------------------------------------------------------------------------

      /** What an agent reported, read for the session's health. */
      const heard = (sessionId: string, event: AgentEvent) =>
        Effect.gen(function* () {
          const driver = liveDriver(sessionId)
          if (driver === undefined) return
          driver.lastSign = yield* Clock.currentTimeMillis
          if (!event.replay && TOOK_THE_TURN.some((tag) => Predicate.isTagged(event, tag))) {
            driver.took = true
          }
          const adapter = ADAPTERS[driver.session.provider]
          if (Predicate.isTagged(event, 'Usage') && event.cost !== null && !event.replay) {
            yield* setCost(driver.session, event.cost)
          }
          if (Predicate.isTagged(event, 'MessageChunk') && !event.replay) {
            driver.said.push(event.text)
          } else if (Predicate.isTagged(event, 'ToolCall') && event.call.status === 'completed') {
            yield* addToThread(sessionId, 'tool', event.call.title ?? event.call.id)
          } else if (
            Predicate.isTagged(event, 'Usage') &&
            !adapter.signalsCompaction &&
            saturates(event.used, event.size)
          ) {
            yield* replace(sessionId, 'its conversation filled most of its window').pipe(
              Effect.forkIn(scope),
            )
          } else if (Predicate.isTagged(event, 'Compacted') && adapter.signalsCompaction) {
            yield* instructAgain(driver)
          } else if (Predicate.isTagged(event, 'ProviderLimit') && !event.replay) {
            // The turn ends here; its end stops the session with the need. A report that comes
            // after the end of its turn stops it at once.
            driver.limit = event.title
            if (driver.turn === null) yield* stopAtLimit(driver, event.title)
            else yield* runtime.cancel(sessionId)
          }
        }).pipe(
          run,
          Effect.catchCause((cause) => said(`an agent's report was not read: ${String(cause)}`)),
        )

      /** After a compaction: the three layers and the brief again, at the next safe point. */
      const instructAgain = (driver: Driver) =>
        Effect.gen(function* () {
          const instructions = (yield* instructionsKept(driver.session.id)) ?? ''
          driver.brief = yield* briefOf(driver.entry, driver.session.owner, driver.session, null)
          yield* storeDelivery({
            owner: driver.session.owner,
            target: { lineage: driver.session.lineage },
            kind: 'instructions',
            body: instructions,
          })
          yield* post.ring
        })

      /** Whether a command the session started still runs: its own time limit bounds it. */
      const commandRunning = (sessionId: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const rows = yield* database
            .select({ id: commandRuns.id })
            .from(commandRuns)
            .where(
              and(
                eq(commandRuns.sessionId, sessionId),
                inArray(commandRuns.state, [...LIVE_RUN_STATES]),
              ),
            )
            .limit(1)
            .pipe(Effect.mapError(refusedWhile('reading the runs')))
          return rows.length > 0
        })

      /** CT-12: a session silent too long in a turn is stuck, its parent told, then replaced. */
      const sweep = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const limit = Duration.toMillis(timings.stuckAfter)
        for (const driver of [...drivers.values()]) {
          if (driver.gone || driver.turn === null || now - driver.lastSign < limit) continue
          if (yield* commandRunning(driver.session.id)) continue
          const reason = `no activity for ${Duration.format(timings.stuckAfter)}`
          yield* setState(driver.session.id, 'stuck', reason)
          yield* addToThread(driver.session.id, 'state', `stuck: ${reason}`)
          yield* tellParent(
            driver.session,
            `Your ${driver.entry.displayName} session is stuck: ${reason}.`,
          )
          yield* replace(driver.session.id, reason)
        }
      }).pipe(
        run,
        Effect.catchCause((cause) => said(`the health sweep failed: ${String(cause)}`)),
      )

      // --- the whole tree --------------------------------------------------------------------

      const stopTree = (owner: SessionOwner, reason = 'stopped') =>
        Semaphore.withPermits(
          lock,
          1,
        )(
          Effect.gen(function* () {
            const live = yield* sessionsIn([...LIVE_OR_STUCK], owner)
            // Children first: the deepest go before their parents.
            const ordered = live.toSorted((a, b) => b.depth - a.depth)
            for (const session of ordered) {
              const driver = drivers.get(session.id)
              if (driver !== undefined) yield* letGo(driver)
              else yield* runtime.release(session.id)
              yield* endQuietly(session, 'ended', reason)
              yield* addToThread(session.id, 'state', `ended: ${reason}`)
            }
            yield* mutate('setting an owner’s deliveries aside', (transaction) =>
              Effect.as(supersedeAll(transaction, owner), { result: undefined, events: [] }),
            )
          }),
        ).pipe(run)

      /** Whether an owner may still have sessions: a live mission, or a Project. */
      const active = (owner: SessionOwner) =>
        Effect.gen(function* () {
          if (owner.kind === 'project') return true
          const database = yield* Database
          const [mission] = yield* database
            .select({ stage: missions.stage })
            .from(missions)
            .where(eq(missions.id, owner.missionId))
            .pipe(Effect.mapError(refusedWhile('reading a mission')))
          return mission !== undefined && mission.stage !== 'done' && mission.stage !== 'cancelled'
        })

      const rebuild = Effect.gen(function* () {
        yield* AutomationGate.use((gate) => gate.pass)
        yield* Memory.use((memory) => memory.ready)
        // Orphan agent processes a stopped engine left are ended before anything starts.
        const orphans = yield* ProcessSupervisor.use((supervisor) =>
          supervisor.endOrphans('session'),
        )
        if (orphans.length > 0)
          yield* said(`ended ${String(orphans.length)} orphan agent process(es)`)
        // What a stopped engine left: sessions opened before this one started.
        const left = (yield* sessionsIn([...LIVE_OR_STUCK])).filter(
          (session) => session.createdAt < startedAt,
        )
        const rebuilt: RoleSession[] = []
        const starts: Array<() => Effect.Effect<void>> = []
        // Top-down: parents before their children, which find them by lineage.
        for (const session of left) {
          // A role this version does not register: nothing can drive its session any more.
          const entry = roleNamed(registry, session.role)
          if (entry === undefined) {
            yield* endQuietly(session, 'ended', `no role ${session.role} is registered`)
            continue
          }
          // The user leads it: nothing starts it again on its own; their next message will.
          if (entry.ledByUser) {
            yield* endQuietly(session, 'ended', RESTARTED)
            continue
          }
          if (!(yield* active(session.owner))) {
            yield* endQuietly(session, 'ended', 'its owner no longer runs')
            continue
          }
          const successor = yield* succeed(session, RESTARTED)
          yield* passLeases(session, successor)
          rebuilt.push(successor)
          starts.push(() =>
            start(successor, { lineage: session.lineage, stoppedAt: session.updatedAt }),
          )
        }
        // Every successor is written first, then each starts on its own, as a replacement does:
        // one waiting for its slot of the cap holds back none of the others.
        for (const one of starts) yield* one().pipe(Effect.forkIn(scope))
        return rebuilt
      }).pipe(run)

      /**
       * Starts a stopped lineage again: a session that failed or ended with a need, and has no
       * live successor. Its successor takes its leases and the resume block; the cascade gives
       * it the setting as it stands now. It counts in no counter.
       */
      const resume = (sessionId: string) =>
        Semaphore.withPermits(
          lock,
          1,
        )(
          Effect.gen(function* () {
            const session = yield* getSession(sessionId).pipe(
              Effect.catchTag('UnknownSession', () => Effect.succeed(null)),
            )
            if (session === null || (session.state !== 'failed' && session.state !== 'ended')) {
              return null
            }
            const live = yield* sessionsIn([...LIVE_OR_STUCK], session.owner)
            if (live.some((one) => one.lineage === session.lineage)) return null
            if (!(yield* active(session.owner))) return null
            const successor = yield* mutate('starting a lineage again', (transaction) =>
              Effect.map(insertSession(transaction, successorOf(session)), (next) => ({
                result: next,
                events: [sessionEvent('session.resumed', next, { predecessor: session.id })],
              })),
            )
            yield* passLeases(session, successor)
            yield* said(`started ${session.lineage} again with ${successor.id}`)
            yield* start(successor, {
              lineage: session.lineage,
              stoppedAt: session.endedAt ?? session.updatedAt,
            }).pipe(Effect.forkIn(scope))
            return successor
          }),
        ).pipe(run)

      /**
       * Whether what a start need said is missing still is. The user's Retry always starts the
       * lineage again; by itself, Hemera starts it again once the setting the cascade gives now
       * is another, or the agent can now be started; never for a provider limit.
       */
      const stillMissing = (need: Need, retried: boolean) =>
        Effect.gen(function* () {
          const row = yield* sessionOfNeed(need.id)
          if (row === null) return true
          const session = yield* getSession(row.sessionId)
          if (row.reason !== 'start' && row.reason !== 'limit') return true
          if (retried) {
            yield* resume(session.id)
            return false
          }
          // A provider limit is lifted when the provider says so: only the user tries again.
          if (row.reason === 'limit') return true
          const setting =
            session.modelLevel === null
              ? null
              : yield* ModelChoice.use((choice) => choice.of(session.owner, session.role))
          const changed =
            setting !== null && (setting.agent !== row.agent || setting.model !== row.model)
          const agentNeed =
            Predicate.isTagged(need.fields, 'Environment') &&
            need.fields.settingsSection === 'agents'
          const agentBack =
            agentNeed &&
            (yield* Discovery.use((discovery) =>
              discovery.resolve(session.provider).pipe(Effect.isSuccess),
            ))
          if (!changed && !agentBack) return true
          yield* resume(session.id)
          return false
        }).pipe(
          run,
          Effect.catchCause((cause) =>
            Effect.as(said(`a session need was not checked again: ${String(cause)}`), true),
          ),
        )

      // --- the service ----------------------------------------------------------------------

      const open = (asked: OpenAsked) => openAt(asked, null)

      /** Opens a session, on a lineage at an epoch when it follows earlier ones. */
      const openAt = (
        asked: OpenAsked,
        at: { readonly lineage: string; readonly epoch: number } | null,
      ) =>
        Effect.gen(function* () {
          const entry = roleNamed(registry, asked.role)
          if (entry === undefined) {
            return yield* new SessionRefused({ reason: `no role ${asked.role} is registered` })
          }
          if (entry.ownerKind !== asked.owner.kind) {
            return yield* new SessionRefused({
              reason: `${entry.displayName} belongs to a ${entry.ownerKind}`,
            })
          }
          const id = crypto.randomUUID()
          if (asked.requestedBy === 'agent') yield* launchAllowed(asked, entry, id)
          const setting =
            asked.provider === undefined
              ? yield* ModelChoice.use((choice) => choice.of(asked.owner, asked.role))
              : null
          const session = yield* openSession({
            id,
            lineage: at?.lineage,
            epoch: at?.epoch,
            provider: asked.provider ?? setting?.agent ?? 'claude',
            owner: asked.owner,
            role: asked.role,
            folder: asked.folder,
            parent:
              asked.parent === undefined
                ? null
                : { lineage: asked.parent.lineage, depth: asked.parent.depth },
            chosen: asked.chosen ?? {
              model: setting?.model ?? null,
              effort: setting?.effort ?? null,
              mode: null,
            },
            modelLevel: setting?.level ?? null,
          })
          yield* start(session, null).pipe(Effect.forkIn(scope))
          return session
        }).pipe(run)

      /**
       * A launch an agent asks for: a slot of the cap at once, or refused with the sentence it
       * reads; then one of its mission's launches, or refused the same way. Each refusal is a
       * line of the Journal.
       */
      const launchAllowed = (asked: OpenAsked, entry: RoleEntry, lineage: string) =>
        Effect.gen(function* () {
          const missionId = asked.owner.kind === 'mission' ? asked.owner.missionId : null
          if (counts(entry)) {
            const slot = yield* cap.acquire({
              projectId: yield* projectOf(asked.owner),
              lineage,
              missionId,
              requestedBy: 'agent',
            })
            if (!slot.held) {
              yield* refused(
                missionId,
                `A launch of ${entry.displayName} was refused`,
                slot.sentence,
              )
              return yield* new SessionRefused({ reason: slot.sentence })
            }
          }
          if (missionId === null) return
          const verdict = yield* spendBudget(missionId, 'launches').pipe(
            Effect.catchTags({
              NeedRefused: (refusal) => Effect.fail(new SessionRefused({ reason: refusal.reason })),
              UnknownMission: () => Effect.fail(new SessionRefused({ reason: 'no such mission' })),
              UnknownProject: () => Effect.fail(new SessionRefused({ reason: 'no such Project' })),
            }),
          )
          if (verdict.spent) return
          yield* cap.release(lineage)
          return yield* new SessionRefused({ reason: verdict.sentence })
        })

      /** A launch refused above the cap, as the mission's Journal says it. */
      const refused = (missionId: string | null, what: string, sentence: string) =>
        missionId === null
          ? Effect.void
          : mutate('refusing a launch', () =>
              Effect.succeed({
                result: undefined,
                events: [
                  {
                    type: 'session.refused',
                    entityKind: 'mission',
                    entityId: missionId,
                    source: 'system' as const,
                    author: 'hemera' as const,
                    payload: { missionId, what, sentence },
                  },
                ],
              }),
            )

      const deliver = (asked: DeliveryAsked) =>
        Effect.gen(function* () {
          const id = yield* storeDelivery(asked)
          yield* dispatch
          return id
        }).pipe(run)

      const settled = (sessionId: string): Effect.Effect<void, DatabaseError> =>
        Effect.gen(function* () {
          for (;;) {
            const driver = liveDriver(sessionId)
            if (driver === undefined) {
              // Not started yet: give its start a chance; one that is gone is settled.
              const session = yield* getSession(sessionId).pipe(Effect.orElseSucceed(() => null))
              if (session === null || session.state !== 'starting') return
              // Its start waits for the gate and the Memory: look again in a moment.
              yield* Effect.sleep('10 millis')
              continue
            }
            if (driver.turn !== null) {
              yield* Fiber.await(driver.turn)
              continue
            }
            if ((yield* queuedFor(driver.session)).length === 0) return
            yield* pump(driver)
            if (driver.turn === null) return
          }
        }).pipe(run)

      // The needs a session gives come back here: an answer or a Retry starts its lineage again.
      yield* post.needsWith({
        deliver: (need, transaction) =>
          Effect.gen(function* () {
            const row = yield* sessionOfNeed(need.id)
            if (row === null || row.reason !== 'failing') return []
            const answer = need.answer
            if (Predicate.isTagged(answer, 'Chosen') && answer.option === CHANGE_THE_MODEL) {
              // It waits for another model: a need of its own, which starts it once that changed.
              const session = yield* getSession(row.sessionId)
              const roleName = roleNamed(registry, session.role)?.displayName ?? session.role
              const write = yield* sessionNeedIn(session, {
                reason: 'start',
                fields: modelToChange(session, roleName),
              })
              const written = yield* write(transaction).pipe(
                Effect.catchTags({
                  NeedRefused: () => Effect.succeed(null),
                  UnknownMission: () => Effect.succeed(null),
                  UnknownProject: () => Effect.succeed(null),
                }),
              )
              return written?.events ?? []
            }
            // Started once the answer's transaction is written: its own waits for it.
            yield* resume(row.sessionId).pipe(Effect.ignore, Effect.forkIn(scope))
            return []
          }).pipe(
            run,
            Effect.catchTag('UnknownSession', () => Effect.succeed([])),
          ),
        recheck: stillMissing,
      })

      // Who listens: the rings of stored deliveries, the agents' reports and deaths, the sweep.
      yield* post.rings.pipe(
        Stream.runForEach(() => dispatch),
        Effect.forkIn(scope),
      )
      yield* runtime.activity.pipe(
        Stream.runForEach((one) => heard(one.sessionId, one.event)),
        Effect.forkIn(scope),
      )
      yield* runtime.deaths.pipe(
        Stream.runForEach((death) =>
          liveDriver(death.sessionId) === undefined
            ? Effect.void
            : replace(death.sessionId, 'its agent stopped').pipe(Effect.ignore),
        ),
        Effect.forkIn(scope),
      )
      yield* sweep.pipe(Effect.repeat(Schedule.spaced(timings.sweepEvery)), Effect.forkIn(scope))
      // A mission's cancel stops its tree through the post, which the missions reach.
      yield* post.stopWith((owner) =>
        stopTree(owner, 'the mission was cancelled').pipe(Effect.ignore),
      )

      return {
        open,
        deliver,
        deliverOrStart: (asked, startAsked) =>
          Effect.gen(function* () {
            // Under the lock, from the rows: a session of the role still starting counts too.
            const [id, live] = yield* Semaphore.withPermits(
              lock,
              1,
            )(
              Effect.gen(function* () {
                const stored = yield* storeDelivery(asked)
                const sessions = yield* sessionsIn([...LIVE_OR_STUCK], asked.owner)
                const found = sessions.some((session) => session.role === asked.target.role)
                if (!found) yield* open(startAsked)
                return [stored, found] as const
              }),
            )
            if (live) yield* dispatch
            return id
          }).pipe(run),
        reopen: (lineage, asked, reason) =>
          Semaphore.withPermits(
            lock,
            1,
          )(
            Effect.gen(function* () {
              // Read again under the lock: a replacement may have moved the lineage on since.
              const rows = yield* sessionsOfLineage(lineage)
              yield* endLive(rows, reason)
              const epoch = Math.max(-1, ...rows.map((one) => one.epoch)) + 1
              return yield* openAt(asked, { lineage, epoch })
            }),
          ).pipe(run),
        replace,
        stopTree,
        rebuild,
        settled,
        cancelTurn: (lineage) =>
          Effect.suspend(() => {
            const driver = liveOfLineage(lineage)
            return driver === undefined || driver.turn === null
              ? Effect.void
              : runtime.cancel(driver.session.id)
          }),
        end: (lineage, reason) =>
          Semaphore.withPermits(
            lock,
            1,
          )(sessionsOfLineage(lineage).pipe(Effect.flatMap((rows) => endLive(rows, reason)))).pipe(
            run,
          ),
      }
    }),
  )
