/**
 * The reservations of the exclusive resources (#88, CT-40): one mission at a time holds a resource,
 * on the whole machine, the others wait in a queue per resource, in the order they asked. The whole
 * machine is one profile's: the reservations are rows of its data folder, and another profile on
 * the same machine keeps its own.
 *
 * A reservation is a row: held (at most one per resource, which the database enforces) or waiting.
 * Every change goes through one lock and ends with `settle`, which reads the rows and puts the
 * world in line with them: a reservation whose mission left Building (or ended) is released, the
 * head of a free resource's queue takes it, each waiting mission carries the mark "blocked" naming
 * the holder, the taking of a resource is started (its reset, or a need), and the runs waiting for
 * a reservation are told it is ready, or lost.
 *
 * Taking a resource runs its reset command through the runs, as Hemera's own action with its intent
 * written first; a failed reset is an error need (Retry or Release), a reset an engine stop cut
 * short a decision need (Run it again or It is already done), never run again on its own. Without a
 * reset command, the mission's user is asked to bring the resource back, and Retry says it is done.
 * The declared runs of the mission wait meanwhile; its other work goes on.
 *
 * A reservation taken in Building lasts until the mission leaves Building; one taken in another
 * stage lasts for the runs that took it. Whatever lets it go (the end of the Building, a Cancel, a
 * release), it is handed to the next mission only once the holder's runs on it and its reset have
 * ended: until then it lasts for those runs, as one taken outside Building does. Reservations
 * survive a restart; at the start, one whose mission is no longer in Building is released, with its
 * line in the Journal, and the queues keep their order. A run stopped while it waits leaves the
 * queue; an engine that stops does not.
 */

import {
  BlockedMark,
  EnvironmentFields,
  ErrorFields,
  DecisionFields,
  MissionOwner,
  Resource,
  STAGES,
  type Stage,
  isLive,
  missionKey,
} from '@hemera/core/domain'
import {
  type Command,
  HemeraAuthor,
  type Need,
  type RESOURCE_READINESS,
  type ResourceHolding,
  type Run,
} from '@hemera/ipc'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Predicate,
  PubSub,
  Schema,
  Semaphore,
  Stream,
} from 'effect'
import type { Scope } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { getCommand } from '../catalogue.ts'
import { DomainEvents } from '../domain-events.ts'
import type { DomainEvent, EventPayload, NewEvent } from '../journal.ts'
import type { JournalMapper } from '../memory/journal.ts'
import { type MissionServices, clearMark, clearMarkIn, setMark } from '../missions.ts'
import { type NeedHandler, createNeed, createNeedIn, needService, withdrawNeed } from '../needs.ts'
import {
  ReservationLost,
  type RunReservation,
  type RunServices,
  Runs,
  awaitRun,
  runOutput,
  startRun,
} from '../runs.ts'
import type { Secrets } from '../secrets.ts'
import {
  Database,
  type DatabaseError,
  type EngineTransaction,
  refusedWhile,
} from '../storage/database.ts'
import {
  effectfulActions,
  exclusiveResources,
  missions,
  resourceClaims,
} from '../storage/schema.ts'
import {
  ActionRules,
  type EffectfulAction,
  actionDone,
  actionFailed,
  beginAction,
  fileWritten,
} from '../tools/actions.ts'
import { mutate } from '../transaction.ts'
import { changedBy, resetCommandOf, resourceKey, resourcesOf } from './declarations.ts'

/** The engine service the needs of the reservations belong to. */
export const RESOURCE_NEEDS = needService('resources')

/** The answers of a failed reset, and of a change an engine stop cut short. */
export const RETRY = 'Retry'
export const RELEASE = 'Release'
export const RUN_AGAIN = 'Run it again'
export const ALREADY_DONE = 'It is already done'

export class ExclusiveResources extends Context.Service<
  ExclusiveResources,
  {
    /** Waits until the mission holds the resource and it is ready (a Probe's call, #89). */
    readonly acquire: (
      name: string,
      missionId: string,
    ) => Effect.Effect<void, ReservationLost | DatabaseError>
    /**
     * Releases the resource if the mission holds it, once its runs and its reset on it have ended;
     * answers whether it did (or will).
     */
    readonly release: (
      name: string,
      missionId: string,
      why: string,
    ) => Effect.Effect<boolean, DatabaseError>
    /** Every resource of the machine, declared or held, with its holder and its queue. */
    readonly holders: Effect.Effect<ReadonlyArray<ResourceHolding>, DatabaseError>
    /** The same now, then again each time a reservation or a declaration changes. */
    readonly changes: Stream.Stream<ReadonlyArray<ResourceHolding>, DatabaseError>
    /** At the start, before anything runs: the reservations a stop left are put in line. */
    readonly atStart: Effect.Effect<number, DatabaseError>
    /** Once automations may run: settles, then again at every change of a mission or a resource. */
    readonly watch: Effect.Effect<void, never, Scope.Scope>
  }
>()('ExclusiveResources') {}

/** What the reservations stand on: the runs, the missions, their marks and their needs. */
type ReservationServices = RunServices | MissionServices

type ClaimRow = typeof resourceClaims.$inferSelect

/** The order rows were written in: a queue's order. */
const INSERTED = sql`rowid`

const now = (): string => new Date().toISOString()

/** What is known of a mission a reservation names. */
interface MissionFacts {
  readonly projectId: string
  readonly stage: Stage
  readonly round: number
  readonly key: string
}

/**
 * Why a reservation no longer holds for its mission, or null: the mission ended, or the Building it
 * was taken for ended (a later round is another Building), or, at a start, its runs ended. It is
 * let go only once nothing runs on it any more (see `busy`).
 */
const goneWhy = (row: ClaimRow, mission: MissionFacts | undefined, atStart: boolean) => {
  if (mission === undefined || !isLive(mission.stage)) return 'the mission ended'
  if (row.lasts === 'building' && (mission.stage !== 'building' || mission.round !== row.round)) {
    return 'the mission left Building'
  }
  return atStart && row.lasts === 'run' ? 'its runs ended with the engine' : null
}

const missionFacts = (ids: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (ids.length === 0) return new Map<string, MissionFacts>()
    const database = yield* Database
    const rows = yield* database
      .select({
        id: missions.id,
        projectId: missions.projectId,
        stage: missions.stage,
        round: missions.round,
        keyPrefix: missions.keyPrefix,
        keyNumber: missions.keyNumber,
      })
      .from(missions)
      .where(inArray(missions.id, [...new Set(ids)]))
      .pipe(Effect.mapError(refusedWhile('reading the missions')))
    return new Map(
      rows.map((row) => [
        row.id,
        {
          projectId: row.projectId,
          stage: STAGES.find((one) => one === row.stage) ?? 'cancelled',
          round: row.round,
          key: missionKey(row.keyPrefix, row.keyNumber),
        },
      ]),
    )
  })

const allClaims = Effect.flatMap(Database, (database) =>
  database
    .select()
    .from(resourceClaims)
    .orderBy(asc(INSERTED))
    .pipe(Effect.mapError(refusedWhile('reading the reservations'))),
)

const claimEvent = (
  type: string,
  claim: Pick<ClaimRow, 'key' | 'name' | 'missionId'>,
  holder: string,
  payload: EventPayload = {},
): NewEvent => ({
  type,
  entityKind: 'resource',
  entityId: claim.key,
  source: 'system',
  author: 'hemera',
  payload: { resource: claim.name, missionId: claim.missionId, holder, ...payload },
})

const blockedMark = (name: string, heldBy: string) =>
  BlockedMark.make({ cause: Resource.make({ name, heldBy }) })

const readinessOf = (row: ClaimRow): (typeof RESOURCE_READINESS)[number] => {
  switch (row.readiness) {
    case 'ready':
      return 'ready'
    case 'resetting':
      return 'resetting'
    case 'failed':
    case 'unsure':
    case 'confirm':
      return 'needs-you'
    default:
      return 'taking'
  }
}

/** The decision a change cut short by a stop becomes: the user says what happened. */
const cutShort = (command: string, resource: string) =>
  DecisionFields.make({
    question: `${command} may have run on ${resource} when Hemera stopped: check its real state. What happened?`,
    options: [RUN_AGAIN, ALREADY_DONE],
    recommended: null,
  })

/** The key of the mission a reservation names, read in the transaction that answers its need. */
const keyIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.map(
    transaction
      .select({ keyPrefix: missions.keyPrefix, keyNumber: missions.keyNumber })
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission'))),
    ([row]) => (row === undefined ? '' : missionKey(row.keyPrefix, row.keyNumber)),
  )

/**
 * An answer to a need of the reservations, recorded in the reservation inside the transaction that
 * delivers it; what follows (a reset run again, the next mission taking it) is `settle`'s, woken by
 * the event written here.
 */
const deliverAnswer = (need: Need, transaction: EngineTransaction) =>
  Effect.gen(function* () {
    const [claim] = yield* transaction
      .select()
      .from(resourceClaims)
      .where(eq(resourceClaims.needId, need.id))
      .pipe(Effect.mapError(refusedWhile('reading a reservation')))
    if (claim === undefined) return []
    const option =
      need.answer !== null && Predicate.isTagged(need.answer, 'Chosen') ? need.answer.option : null
    const holder = yield* keyIn(transaction, claim.missionId)
    const which = eq(resourceClaims.id, claim.id)
    if (option === RELEASE) {
      yield* transaction
        .delete(resourceClaims)
        .where(which)
        .pipe(Effect.mapError(refusedWhile('releasing a reservation')))
      return [claimEvent('resource.released', claim, holder, { why: 'the user released it' })]
    }
    if (option !== RETRY && option !== RUN_AGAIN && option !== ALREADY_DONE) return []
    const done = option === ALREADY_DONE
    yield* transaction
      .update(resourceClaims)
      .set({ readiness: done ? 'ready' : 'retry', needId: null })
      .where(which)
      .pipe(Effect.mapError(refusedWhile('answering a reservation')))
    return [
      claimEvent('resource.reset', claim, holder, {
        command: null,
        outcome: done ? 'already done, the user said' : 'asked again by the user',
      }),
    ]
  })

/** Whether a committed event may change what the reservations hold. */
const wakes = (event: DomainEvent): boolean =>
  event.type.startsWith('resource.') ||
  event.type === 'mission.cancelled' ||
  (event.type === 'mission.moved' && event.payload['from'] === 'building')

/**
 * The reservations, and the handler their needs' answers reach. The layer stands on the runs and
 * the missions; once built, it is the port every run of a declared command waits through.
 */
export const exclusiveReservations = (log: Log) => {
  const lock = Semaphore.makeUnsafe(1)
  /** The runs waiting for a reservation to be ready, by reservation. */
  const signals = new Map<string, Deferred.Deferred<void, ReservationLost>>()
  /** Why a reservation went, for the runs that waited for it. */
  const lostWhy = new Map<string, string>()
  /** How many runs entered each reservation and have not left it yet. */
  const entered = new Map<string, number>()
  /** The reservations to let go once their runs and their reset have ended, and why. */
  const releasing = new Map<string, string>()
  /** The engine is stopping: its runs end, but the queues are kept for the next start. */
  let closing = false
  let confirm: ((need: Need, retried: boolean) => Effect.Effect<boolean>) | null = null

  const handler: NeedHandler = {
    deliver: deliverAnswer,
    recheck: (need, retried) => (confirm === null ? Effect.succeed(true) : confirm(need, retried)),
  }

  const layer = Layer.effect(
    ExclusiveResources,
    Effect.gen(function* () {
      const context = yield* Effect.context<ReservationServices>()
      const scope = yield* Effect.scope
      const changed = yield* PubSub.unbounded<void>()
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          closing = true
        }),
      )

      const locked = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Semaphore.withPermits(lock, 1)(Effect.uninterruptible(effect))

      const quietly = <A, E, R>(doing: string, effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.asVoid,
          Effect.catchCause((cause) =>
            Effect.sync(() => log(`resources: ${doing} failed: ${String(cause)}`)),
          ),
        )

      const signalOf = (id: string) => {
        const found = signals.get(id)
        if (found !== undefined) return found
        const made = Deferred.makeUnsafe<void, ReservationLost>()
        signals.set(id, made)
        return made
      }

      /**
       * Lets a reservation go: its mark and its row in one change, so neither stays without the
       * other, with its event when it was held; then its need.
       */
      const drop = (row: ClaimRow, why: string, type: string | null, holder: string) =>
        Effect.gen(function* () {
          yield* mutate('letting a reservation go', (transaction) =>
            Effect.gen(function* () {
              const cleared =
                row.blockedBy === null
                  ? []
                  : yield* clearMarkIn(
                      transaction,
                      row.missionId,
                      blockedMark(row.name, row.blockedBy),
                    )
              const gone = yield* transaction
                .delete(resourceClaims)
                .where(eq(resourceClaims.id, row.id))
                .returning({ id: resourceClaims.id })
                .pipe(Effect.mapError(refusedWhile('letting a reservation go')))
              return {
                result: undefined,
                events: [
                  ...cleared,
                  ...(gone.length === 0 || type === null || row.state !== 'held'
                    ? []
                    : [claimEvent(type, row, holder, { why })]),
                ],
              }
            }),
          )
          lostWhy.set(row.id, why)
          if (row.needId !== null) {
            yield* quietly(
              'withdrawing a need',
              withdrawNeed(row.needId, `${row.name} was released`),
            )
          }
        })

      /**
       * Whether a held reservation still has something going on the resource: its reset, or a run
       * that entered it once it was ready. Until they end, it is not handed over.
       */
      const busy = (row: ClaimRow) =>
        row.state === 'held' &&
        (row.readiness === 'resetting' ||
          (row.readiness === 'ready' && (entered.get(row.id) ?? 0) > 0))

      /** A reservation that must go while something still runs on it lasts for those runs. */
      const outlast = (row: ClaimRow, why: string) =>
        Effect.gen(function* () {
          releasing.set(row.id, why)
          if (row.lasts === 'run') return
          yield* mutate('keeping a reservation for its runs', (transaction) =>
            transaction
              .update(resourceClaims)
              .set({ lasts: 'run', round: null })
              .where(eq(resourceClaims.id, row.id))
              .pipe(
                Effect.mapError(refusedWhile('keeping a reservation for its runs')),
                Effect.as({ result: undefined, events: [] }),
              ),
          )
        })

      /** The head of a free resource's queue takes it. */
      const grant = (row: ClaimRow, holder: string) =>
        mutate('handing a resource over', (transaction) =>
          transaction
            .update(resourceClaims)
            .set({ state: 'held', readiness: 'take', acquiredAt: now() })
            .where(and(eq(resourceClaims.id, row.id), eq(resourceClaims.state, 'waiting')))
            .returning({ id: resourceClaims.id })
            .pipe(
              Effect.mapError(refusedWhile('handing a resource over')),
              Effect.map((given) => ({
                result: undefined,
                events:
                  given.length === 0
                    ? []
                    : [
                        claimEvent('resource.acquired', row, holder, {
                          waitedMs: Math.max(0, Date.now() - Date.parse(row.requestedAt)),
                        }),
                      ],
              })),
            ),
        )

      /** A waiting mission's mark names the holder; a holding one carries none. */
      const markAs = (row: ClaimRow, blockedBy: string | null) =>
        Effect.gen(function* () {
          if (row.blockedBy !== null) {
            yield* quietly(
              'clearing a mark',
              clearMark(row.missionId, blockedMark(row.name, row.blockedBy)),
            )
          }
          if (blockedBy !== null) {
            yield* quietly(
              'setting a mark',
              setMark(row.missionId, blockedMark(row.name, blockedBy)),
            )
          }
          yield* mutate('writing a reservation', (transaction) =>
            transaction
              .update(resourceClaims)
              .set({ blockedBy })
              .where(eq(resourceClaims.id, row.id))
              .pipe(
                Effect.mapError(refusedWhile('writing a reservation')),
                Effect.as({ result: undefined, events: [] }),
              ),
          )
        })

      /**
       * The reset a taking runs, as Hemera's own run, its intent written as it launches under the
       * id the reservation already names; its end is written under the lock.
       */
      const resetRun = (row: ClaimRow, reset: Command, actionId: string) =>
        Effect.gen(function* () {
          const intent = beginAction(
            'command.run',
            { kind: 'mission', missionId: row.missionId, taskId: null },
            { command: reset.id, line: reset.line, folder: null, sessionId: null, claim: row.id },
            actionId,
          ).pipe(Effect.asVoid, Effect.provide(context))
          const outcome = yield* Effect.gen(function* () {
            const started = yield* startRun({
              projectId: row.projectId,
              workspaceId: row.workspaceId,
              commandId: reset.id,
              line: null,
              folder: null,
              startedBy: 'hemera',
              sessionId: null,
              missionId: row.missionId,
              reserved: true,
              intent,
            })
            const ended = yield* awaitRun(started.id)
            const { output } = yield* runOutput(started.id)
            return { done: ended.state === 'done', line: ended.line, output: String(output) }
          }).pipe(
            Effect.catch((failure) =>
              Effect.succeed({ done: false, line: reset.line, output: failure.message }),
            ),
          )
          yield* locked(resetEnded(row, reset, actionId, outcome))
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => log(`resources: a reset did not end well: ${String(cause)}`)),
          ),
        )

      const resetEnded = (
        row: ClaimRow,
        reset: Command,
        actionId: string,
        outcome: { readonly done: boolean; readonly line: string; readonly output: string },
      ) =>
        Effect.gen(function* () {
          const database = yield* Database
          const [current] = yield* database
            .select()
            .from(resourceClaims)
            .where(eq(resourceClaims.id, row.id))
            .pipe(Effect.mapError(refusedWhile('reading a reservation')))
          const ours =
            current !== undefined &&
            current.actionId === actionId &&
            current.readiness === 'resetting'
          if (ours) {
            const mission = (yield* missionFacts([row.missionId])).get(row.missionId)
            const holder = mission?.key ?? ''
            const event = claimEvent('resource.reset', row, holder, {
              command: reset.name,
              outcome: outcome.done ? 'done' : 'failed',
            })
            const which = and(eq(resourceClaims.id, row.id), eq(resourceClaims.actionId, actionId))
            // A reservation already going (a Cancel, the end of the Building, a release) is let go
            // once its reset ends, however it ended: nobody is asked to retry it.
            const going = releasing.has(row.id) || goneWhy(current, mission, false) !== null
            if (outcome.done || going) {
              yield* mutate('recording a reset', (transaction) =>
                transaction
                  .update(resourceClaims)
                  .set({ readiness: outcome.done ? 'ready' : 'failed' })
                  .where(which)
                  .pipe(
                    Effect.mapError(refusedWhile('recording a reset')),
                    Effect.as({ result: undefined, events: [event] }),
                  ),
              )
            } else {
              const write = yield* createNeedIn(
                RESOURCE_NEEDS,
                MissionOwner.make({
                  projectId: row.projectId,
                  missionId: row.missionId,
                  taskId: null,
                }),
                ErrorFields.make({
                  failed: `The reset of ${row.name} failed: ${reset.name}`,
                  attempts: [{ what: outcome.line, output: outcome.output }],
                  proposals: [RETRY, RELEASE],
                }),
              )
              yield* mutate('recording a failed reset', (transaction) =>
                Effect.gen(function* () {
                  const need = yield* write(transaction)
                  yield* transaction
                    .update(resourceClaims)
                    .set({ readiness: 'failed', needId: need.id })
                    .where(which)
                    .pipe(Effect.mapError(refusedWhile('recording a failed reset')))
                  return { result: undefined, events: [...need.events, event] }
                }),
              )
            }
          }
          yield* outcome.done ? actionDone(actionId, 'done') : actionFailed(actionId, 'failed')
          if (ours) yield* settleNow
        })

      /** Taking a resource: its reset run, or the user asked to bring it back. */
      const take = (row: ClaimRow, holder: string) =>
        Effect.gen(function* () {
          const reset = yield* resetCommandOf(row.projectId, row.key)
          if (reset !== null) {
            // The reset's action is named now; its intent is written only as it launches.
            const actionId = crypto.randomUUID()
            yield* mutate('starting a reset', (transaction) =>
              transaction
                .update(resourceClaims)
                .set({ readiness: 'resetting', actionId, needId: null })
                .where(eq(resourceClaims.id, row.id))
                .pipe(
                  Effect.mapError(refusedWhile('starting a reset')),
                  Effect.as({ result: undefined, events: [] }),
                ),
            )
            yield* resetRun(row, reset, actionId).pipe(Effect.forkIn(scope))
            return
          }
          const write = yield* createNeedIn(
            RESOURCE_NEEDS,
            MissionOwner.make({ projectId: row.projectId, missionId: row.missionId, taskId: null }),
            EnvironmentFields.make({
              missing: `${holder} now holds ${row.name}`,
              action: 'Bring it to the state this mission expects, then confirm.',
              settingsSection: null,
            }),
          )
          yield* mutate('asking to bring a resource back', (transaction) =>
            Effect.gen(function* () {
              const need = yield* write(transaction)
              yield* transaction
                .update(resourceClaims)
                .set({ readiness: 'confirm', needId: need.id })
                .where(eq(resourceClaims.id, row.id))
                .pipe(Effect.mapError(refusedWhile('asking to bring a resource back')))
              return { result: undefined, events: need.events }
            }),
          )
        })

      /**
       * A reset a stop left, at the start, before anything else may act: one whose intent was
       * never written never launched, and is taken again once automations may run; one that
       * launched may have run, and the user is asked what happened (CT-09). Never left resetting.
       */
      const resetLeft = (row: ClaimRow, database: Context.Service.Shape<typeof Database>) =>
        Effect.gen(function* () {
          const [written] =
            row.actionId === null
              ? []
              : yield* database
                  .select({ id: effectfulActions.id })
                  .from(effectfulActions)
                  .where(eq(effectfulActions.id, row.actionId))
                  .pipe(Effect.mapError(refusedWhile('reading a reset')))
          if (written !== undefined) {
            const reset = yield* resetCommandOf(row.projectId, row.key)
            const write = yield* createNeedIn(
              RESOURCE_NEEDS,
              MissionOwner.make({
                projectId: row.projectId,
                missionId: row.missionId,
                taskId: null,
              }),
              cutShort(reset?.name ?? 'Its reset', row.name),
            )
            yield* mutate('asking what a reset did', (transaction) =>
              Effect.gen(function* () {
                const need = yield* write(transaction)
                yield* transaction
                  .update(resourceClaims)
                  .set({ readiness: 'unsure', needId: need.id })
                  .where(eq(resourceClaims.id, row.id))
                  .pipe(Effect.mapError(refusedWhile('asking what a reset did')))
                return { result: undefined, events: need.events }
              }),
            )
            return
          }
          yield* mutate('taking a resource again', (transaction) =>
            transaction
              .update(resourceClaims)
              .set({ readiness: 'take', actionId: null })
              .where(eq(resourceClaims.id, row.id))
              .pipe(
                Effect.mapError(refusedWhile('taking a resource again')),
                Effect.as({ result: undefined, events: [] }),
              ),
          )
        })

      /** Puts the world in line with the reservations' rows; run under the lock. */
      const settleNow: Effect.Effect<void, DatabaseError, ReservationServices> = Effect.gen(
        function* () {
          let rows = yield* allClaims
          const facts = yield* missionFacts(rows.map((row) => row.missionId))
          const keyOf = (missionId: string) => facts.get(missionId)?.key ?? ''
          for (const row of rows) {
            const why = goneWhy(row, facts.get(row.missionId), false) ?? releasing.get(row.id)
            if (why === undefined || why === null) continue
            if (busy(row)) {
              yield* outlast(row, why)
              continue
            }
            releasing.delete(row.id)
            yield* drop(row, why, 'resource.released', keyOf(row.missionId))
          }
          rows = yield* allClaims
          for (const key of new Set(rows.map((row) => row.key))) {
            const queue = rows.filter((row) => row.key === key)
            if (queue.some((row) => row.state === 'held')) continue
            const head = queue.find((row) => row.state === 'waiting')
            if (head !== undefined) yield* grant(head, keyOf(head.missionId))
          }
          rows = yield* allClaims
          for (const row of rows) {
            const holder = rows.find((one) => one.key === row.key && one.state === 'held')
            const blockedBy =
              row.state === 'waiting' && holder !== undefined ? keyOf(holder.missionId) : null
            if (blockedBy !== row.blockedBy) yield* markAs(row, blockedBy)
          }
          for (const row of rows) {
            if (row.state === 'held' && (row.readiness === 'take' || row.readiness === 'retry')) {
              yield* quietly('taking a resource', take(row, keyOf(row.missionId)))
            }
          }
          rows = yield* allClaims
          for (const [id, signal] of signals) {
            const row = rows.find((one) => one.id === id)
            if (row === undefined) {
              signals.delete(id)
              yield* Deferred.fail(
                signal,
                new ReservationLost({ reason: lostWhy.get(id) ?? 'the reservation was released' }),
              )
            } else if (row.state === 'held' && row.readiness === 'ready') {
              yield* Deferred.succeed(signal, undefined)
            }
          }
          lostWhy.clear()
          yield* PubSub.publish(changed, undefined)
        },
      )

      const settle = locked(settleNow).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => log(`resources: the reservations were not settled: ${String(cause)}`)),
        ),
        Effect.provide(context),
      )

      /** A run asks for a resource: it holds it if it is free, waits behind its queue otherwise. */
      const claim = (
        asked: {
          readonly key: string
          readonly name: string
          readonly missionId: string
          readonly workspaceId: string | null
        },
        counted: boolean,
      ) =>
        locked(
          Effect.gen(function* () {
            // What no longer holds goes first: a reservation of an earlier Building is not this one.
            yield* settleNow
            const mission = (yield* missionFacts([asked.missionId])).get(asked.missionId)
            if (mission === undefined || !isLive(mission.stage)) {
              return yield* new ReservationLost({ reason: 'its mission has ended' })
            }
            const lasts = mission.stage === 'building' ? 'building' : 'run'
            const round = lasts === 'building' ? mission.round : null
            const database = yield* Database
            const [existing] = yield* database
              .select()
              .from(resourceClaims)
              .where(
                and(
                  eq(resourceClaims.key, asked.key),
                  eq(resourceClaims.missionId, asked.missionId),
                ),
              )
              .pipe(Effect.mapError(refusedWhile('reading a reservation')))
            const id = existing?.id ?? crypto.randomUUID()
            yield* mutate('asking for a resource', (transaction) =>
              Effect.gen(function* () {
                if (existing !== undefined) {
                  if (lasts === 'building' && existing.lasts !== 'building') {
                    // A new Building of the mission: what was to go with its last runs stays.
                    releasing.delete(id)
                    yield* transaction
                      .update(resourceClaims)
                      .set({ lasts, round })
                      .where(eq(resourceClaims.id, id))
                      .pipe(Effect.mapError(refusedWhile('asking for a resource')))
                  }
                  return { result: undefined, events: [] }
                }
                const [holder] = yield* transaction
                  .select({ id: resourceClaims.id })
                  .from(resourceClaims)
                  .where(and(eq(resourceClaims.key, asked.key), eq(resourceClaims.state, 'held')))
                  .pipe(Effect.mapError(refusedWhile('asking for a resource')))
                const at = now()
                const free = holder === undefined
                const row = {
                  id,
                  key: asked.key,
                  name: asked.name,
                  missionId: asked.missionId,
                  projectId: mission.projectId,
                  workspaceId: asked.workspaceId,
                  lasts,
                  round,
                  state: free ? 'held' : 'waiting',
                  readiness: free ? 'take' : null,
                  actionId: null,
                  needId: null,
                  blockedBy: null,
                  requestedAt: at,
                  acquiredAt: free ? at : null,
                }
                yield* transaction
                  .insert(resourceClaims)
                  .values(row)
                  .pipe(Effect.mapError(refusedWhile('asking for a resource')))
                return {
                  result: undefined,
                  events: [
                    claimEvent('resource.requested', row, mission.key),
                    ...(free
                      ? [claimEvent('resource.acquired', row, mission.key, { waitedMs: 0 })]
                      : []),
                  ],
                }
              }),
            )
            if (counted) entered.set(id, (entered.get(id) ?? 0) + 1)
            const signal = signalOf(id)
            yield* settleNow
            return { id, signal }
          }),
        )

      /**
       * A run that entered a reservation leaves it (`counted`), or a caller that did not enter it
       * gives up waiting: the last one out of a queue leaves it too, and the last run out of a
       * reservation that lasts for its runs lets it go, once its reset has ended too.
       */
      const leave = (id: string, counted = true) =>
        locked(
          Effect.gen(function* () {
            if (closing) return
            const left = (entered.get(id) ?? (counted ? 1 : 0)) - (counted ? 1 : 0)
            if (left > 0) {
              entered.set(id, left)
              return
            }
            entered.delete(id)
            const database = yield* Database
            const [row] = yield* database
              .select()
              .from(resourceClaims)
              .where(eq(resourceClaims.id, id))
              .pipe(Effect.mapError(refusedWhile('reading a reservation')))
            if (row === undefined) return
            const holder = (yield* missionFacts([row.missionId])).get(row.missionId)?.key ?? ''
            if (row.state === 'waiting') yield* drop(row, 'its run stopped waiting', null, holder)
            else if (row.lasts === 'run') {
              releasing.set(id, releasing.get(id) ?? 'its runs ended')
            }
            yield* settleNow
          }),
        ).pipe(
          Effect.provide(context),
          Effect.catchCause((cause) =>
            Effect.sync(() =>
              log(`resources: a run did not leave its reservation: ${String(cause)}`),
            ),
          ),
        )

      /**
       * Asks for one resource and waits for it; a wait cut short or lost leaves it. A run's asking
       * hands its end: the run is inside the reservation from the asking, and the step that takes
       * the resource also promises to leave it when the run ends, so a stop landing as the wait
       * succeeds cannot keep it held.
       */
      const claimAndWait = (
        asked: Parameters<typeof claim>[0],
        ended: Effect.Effect<void> | null,
      ) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const counted = ended !== null
            const { id, signal } = yield* claim(asked, counted)
            yield* restore(Deferred.await(signal)).pipe(
              Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : leave(id, counted))),
            )
            if (ended !== null) yield* Effect.forkIn(Effect.andThen(ended, leave(id)), scope)
          }),
        ).pipe(Effect.provide(context))

      const enter = (run: Run) =>
        Effect.gen(function* () {
          const { commandId, missionId } = run
          if (commandId === null || missionId === null) return null
          const declared = yield* resourcesOf(run.projectId, commandId)
          if (declared.length === 0) return null
          // What was taken before a later resource is lost is left as the run ends, failed, at once.
          const wait = (ended: Effect.Effect<void>) =>
            Effect.forEach(
              declared,
              (one) =>
                claimAndWait(
                  { key: one.key, name: one.name, missionId, workspaceId: run.workspaceId },
                  ended,
                ),
              { discard: true },
            ).pipe(
              Effect.catchTag('DatabaseError', (failure) =>
                Effect.fail(new ReservationLost({ reason: failure.message })),
              ),
            )
          return { wait } satisfies RunReservation
        }).pipe(Effect.provide(context))

      const holders = Effect.gen(function* () {
        const database = yield* Database
        const declared = yield* database
          .select({ key: exclusiveResources.key, name: exclusiveResources.name })
          .from(exclusiveResources)
          .orderBy(asc(exclusiveResources.key), asc(exclusiveResources.name))
          .pipe(Effect.mapError(refusedWhile('reading the exclusive resources')))
        const rows = yield* allClaims
        const facts = yield* missionFacts(rows.map((row) => row.missionId))
        const claimant = (row: ClaimRow, since: string) => ({
          missionId: row.missionId,
          missionKey: facts.get(row.missionId)?.key ?? '',
          projectId: row.projectId,
          since,
        })
        const keys = [
          ...new Set([...declared.map((one) => one.key), ...rows.map((row) => row.key)]),
        ]
        return keys.sort().map((key): ResourceHolding => {
          const ofKey = rows.filter((row) => row.key === key)
          const names = declared.filter((one) => one.key === key).map((one) => one.name)
          const held = ofKey.find((row) => row.state === 'held')
          return {
            key,
            names: [...new Set(names.length > 0 ? names : ofKey.map((row) => row.name))],
            holder:
              held === undefined
                ? null
                : {
                    ...claimant(held, held.acquiredAt ?? held.requestedAt),
                    readiness: readinessOf(held),
                  },
            queue: ofKey
              .filter((row) => row.state === 'waiting')
              .map((row) => claimant(row, row.requestedAt)),
          }
        })
      }).pipe(Effect.provide(context))

      confirm = (need, retried) =>
        locked(
          Effect.gen(function* () {
            const database = yield* Database
            const [row] = yield* database
              .select()
              .from(resourceClaims)
              .where(eq(resourceClaims.needId, need.id))
              .pipe(Effect.mapError(refusedWhile('reading a reservation')))
            if (row === undefined) return false
            if (!retried || row.readiness !== 'confirm') return true
            yield* mutate('confirming a resource', (transaction) =>
              transaction
                .update(resourceClaims)
                .set({ readiness: 'ready', needId: null })
                .where(eq(resourceClaims.id, row.id))
                .pipe(
                  Effect.mapError(refusedWhile('confirming a resource')),
                  Effect.as({ result: undefined, events: [] }),
                ),
            )
            yield* settleNow
            return false
          }),
        ).pipe(
          Effect.provide(context),
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              log(`resources: a confirmation was not recorded: ${String(cause)}`)
              return true
            }),
          ),
        )

      const runs = Context.get(context, Runs)
      runs.reservations.current = { enter }

      return {
        acquire: (name, missionId) =>
          claimAndWait(
            { key: resourceKey(name), name: name.trim(), missionId, workspaceId: null },
            null,
          ),
        release: (name, missionId, why) =>
          locked(
            Effect.gen(function* () {
              const database = yield* Database
              const [row] = yield* database
                .select()
                .from(resourceClaims)
                .where(
                  and(
                    eq(resourceClaims.key, resourceKey(name)),
                    eq(resourceClaims.missionId, missionId),
                    eq(resourceClaims.state, 'held'),
                  ),
                )
                .pipe(Effect.mapError(refusedWhile('reading a reservation')))
              if (row === undefined || releasing.has(row.id)) return false
              // Let go now, or once its runs and its reset have ended.
              releasing.set(row.id, why)
              yield* settleNow
              return true
            }),
          ).pipe(Effect.provide(context)),
        holders,
        // Subscribed before the holders are read, so nothing that changes in between is missed.
        changes: Stream.unwrap(
          Effect.gen(function* () {
            const updates = yield* PubSub.subscribe(changed)
            const events = yield* DomainEvents.use((followed) => followed.subscribe)
            return Stream.concat(
              Stream.make(undefined),
              Stream.merge(
                Stream.fromSubscription(updates),
                events.pipe(
                  Stream.filter((event) => event.type === 'project.resources_saved'),
                  Stream.map(() => undefined),
                ),
              ),
            ).pipe(Stream.mapEffect(() => holders))
          }),
        ).pipe(Stream.provideContext(context)),
        atStart: locked(
          Effect.gen(function* () {
            const rows = yield* allClaims
            const facts = yield* missionFacts(rows.map((row) => row.missionId))
            const database = yield* Database
            let released = 0
            for (const row of rows) {
              const mission = facts.get(row.missionId)
              const why = goneWhy(row, mission, true)
              if (why === null) {
                if (row.readiness === 'resetting') {
                  yield* quietly('settling a reset a stop left', resetLeft(row, database))
                }
                continue
              }
              yield* drop(row, why, 'resource.released_at_start', mission?.key ?? '')
              released += 1
            }
            return released
          }),
        ).pipe(Effect.provide(context)),
        watch: Effect.gen(function* () {
          const events = yield* DomainEvents.use((followed) => followed.subscribe)
          yield* settle
          yield* events.pipe(
            Stream.filter(wakes),
            Stream.runForEach(() => settle),
          )
        }).pipe(Effect.provide(context)),
      }
    }),
  )
  return { layer, handler }
}

const RunDetails = Schema.Struct({
  command: Schema.NullOr(Schema.String),
  claim: Schema.optionalKey(Schema.String),
})
const readRunDetails = Schema.decodeUnknownOption(RunDetails)

/**
 * A run of a mission an engine stop left without an outcome (CT-09): when it is a command that
 * changes a resource, the user is asked what happened, Run it again or It is already done. It is
 * never run again on its own. A reset is asked about by the reservations' start (`atStart`).
 */
export const indeterminateRun = (action: EffectfulAction) =>
  Effect.gen(function* () {
    if (action.owner.kind !== 'mission') return
    const details = readRunDetails(action.details)
    if (Option.isNone(details) || details.value.command === null) return
    const commandId = details.value.command
    const missionId = action.owner.missionId
    const database = yield* Database
    const [mission] = yield* database
      .select({ projectId: missions.projectId })
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (mission === undefined) return
    const command = yield* getCommand(mission.projectId, commandId).pipe(Effect.option)
    const name = Option.match(command, { onNone: () => 'a command', onSome: (one) => one.name })
    const owner = MissionOwner.make({
      projectId: mission.projectId,
      missionId,
      taskId: action.owner.taskId,
    })
    // A reset of a reservation: the reservations asked about it at the start already.
    if (details.value.claim !== undefined) return
    const changed = yield* changedBy(mission.projectId, commandId)
    if (changed.length === 0) return
    yield* createNeed(RESOURCE_NEEDS, owner, cutShort(name, changed.join(', ')))
  })

/**
 * The rules of the actions with an effect outside the database: this version's, and a run cut
 * short on a shared resource handed to `indeterminateRun`.
 */
export const resourceActionRules = (log: Log) =>
  Layer.effect(
    ActionRules,
    Effect.map(Effect.context<Database | DomainEvents | Secrets>(), (context) => ({
      postConditions: new Map([['file.write', fileWritten]]),
      handlers: new Map([
        [
          'command.run',
          (action: EffectfulAction) =>
            indeterminateRun(action).pipe(
              Effect.provide(context),
              Effect.catchCause((cause) =>
                Effect.sync(() =>
                  log(`resources: a run cut short was not asked about: ${String(cause)}`),
                ),
              ),
            ),
        ],
      ]),
    })),
  )

const ResourcePayload = Schema.Struct({
  resource: Schema.String,
  missionId: Schema.String,
  holder: Schema.optionalKey(Schema.String),
  why: Schema.optionalKey(Schema.String),
  command: Schema.optionalKey(Schema.NullOr(Schema.String)),
  outcome: Schema.optionalKey(Schema.String),
  waitedMs: Schema.optionalKey(Schema.Number),
})
const readResourcePayload = Schema.decodeUnknownOption(ResourcePayload)

const waited = (millis: number): string =>
  millis < 60_000
    ? `${String(Math.round(millis / 1000))} s`
    : `${String(Math.round(millis / 60_000))} min`

/** A reservation's event, as the mission's Journal says it. */
export const resourceLine: JournalMapper = (event) =>
  Effect.succeed(
    Option.match(readResourcePayload(event.payload), {
      onNone: () => null,
      onSome: (payload) => {
        const { resource } = payload
        const text = ((): string => {
          switch (event.type) {
            case 'resource.requested':
              return `Asked for ${resource}`
            case 'resource.acquired':
              return (payload.waitedMs ?? 0) > 0
                ? `Took ${resource} after waiting ${waited(payload.waitedMs ?? 0)}`
                : `Took ${resource}`
            case 'resource.reset':
              return `Reset ${resource}${payload.command === undefined || payload.command === null ? '' : ` with ${payload.command}`}: ${payload.outcome ?? ''}`
            case 'resource.released_at_start':
              return `Released ${resource} at the start: ${payload.why ?? ''}`
            default:
              return `Released ${resource}: ${payload.why ?? ''}`
          }
        })()
        return {
          missionId: payload.missionId,
          kind: 'resource',
          author: HemeraAuthor.make({}),
          text,
          fields: {
            resource,
            holder: payload.holder ?? null,
            why: payload.why ?? null,
            command: payload.command ?? null,
            outcome: payload.outcome ?? null,
            waitedMs: payload.waitedMs ?? null,
          },
          refs: {},
        }
      },
    }),
  )

/** The reservations' events the Journal maps. */
export const RESOURCE_EVENTS = [
  'resource.requested',
  'resource.acquired',
  'resource.reset',
  'resource.released',
  'resource.released_at_start',
] as const
