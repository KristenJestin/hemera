/**
 * The agent of a check (#139, open question 57): a short session of the role `prelaunch`, one per
 * check that handed it files, a fixed phase of Hemera, never an agent's launch.
 *
 * - **Start.** A check kept with files to read (`building.check_started`, `agent`) waits for a slot
 *   of the Project's cap (never refused, nothing spent of the mission's budget), then opens its
 *   session in the main checkout, read-only.
 * - **End.** Its `prelaunch_report` ends the check (`report.ts`): the session ends and the slot is
 *   freed. A turn that ends without the report is reminded once; a second silent end leaves the
 *   check done with its agent `unanswered` (open point 4: "The agent did not answer"). A session
 *   that stops for good leaves it `failed`, said. A newer check, a return to Planning and the end
 *   of the mission end it too.
 * - **Restart.** Once automations may run, a check a stop left with its agent waiting or running
 *   starts its agent again, unless the sessions' rebuild took its session over.
 *
 * Nothing here waits on a timer.
 */

import { and, eq, inArray } from 'drizzle-orm'
import { Cause, Effect, Fiber, Layer, Option, Schema, Stream } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { DomainEvents } from '../domain-events.ts'
import { AutomationGate } from '../gate.ts'
import { Memory } from '../memory/index.ts'
import { getProject } from '../projects.ts'
import { Secrets } from '../secrets.ts'
import { Cap } from '../sessions/cap.ts'
import { SessionPost } from '../sessions/post.ts'
import { Sessions } from '../sessions/service.ts'
import { getSession, sessionsOfLineage } from '../sessions/store.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { missions, prelaunchChecks } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { checkEvent } from './events.ts'
import { type CheckRow, checkOfLineage, checkRowIn, resultsOf, writeResults } from './store.ts'

export interface CheckRunsSettings {
  readonly log: Log
}

/** What the agent of a check that ended a turn without its report is told, once. */
export const END_WITH_PRELAUNCH_REPORT =
  'End with prelaunch_report, answering every file of your brief: your report is the only thing you return.'

/** Why a check's agent ends with its mission's return to Planning, or its end. */
export const BACK_TO_PLANNING = 'the mission went back to Planning'
export const MISSION_ENDED = 'the mission ended'

const LIVE_SESSION = ['starting', 'working', 'idle', 'stuck'] as const

const readText = Schema.decodeUnknownOption(Schema.String)

const now = (): string => new Date().toISOString()

/** The checks whose agent waits or runs. */
const agentsGoing = Effect.gen(function* () {
  const database = yield* Database
  return yield* database
    .select()
    .from(prelaunchChecks)
    .where(
      and(
        eq(prelaunchChecks.state, 'running'),
        inArray(prelaunchChecks.agentState, ['waiting_for_slot', 'running']),
      ),
    )
    .pipe(Effect.mapError(refusedWhile('reading the checks')))
})

const projectOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [mission] = yield* database
      .select({ projectId: missions.projectId, stage: missions.stage })
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    return mission ?? null
  })

/**
 * A check whose agent waits or runs, ended: the check done (its agent `unanswered`) or failed with
 * why, and `building.check_ended`. Null when its agent no longer waited or ran.
 */
const endAgent = (
  checkId: string,
  outcome: {
    readonly agent: 'unanswered' | 'failed'
    readonly state: 'done' | 'failed'
    readonly why: string
  },
) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    return yield* mutate('ending the agent of a check', (transaction) =>
      Effect.gen(function* () {
        const row = yield* checkRowIn(transaction, checkId)
        if (row === null || row.state !== 'running') return { result: null, events: [] }
        const [ended] = yield* transaction
          .update(prelaunchChecks)
          .set({
            state: outcome.state,
            agentState: outcome.agent,
            endedAt: now(),
            results: writeResults({ ...resultsOf(row), failure: secrets.mask(outcome.why) }),
          })
          .where(and(eq(prelaunchChecks.id, checkId), eq(prelaunchChecks.state, 'running')))
          .returning()
          .pipe(Effect.mapError(refusedWhile('ending the agent of a check')))
        if (ended === undefined) return { result: null, events: [] }
        const mission = yield* transaction
          .select({ projectId: missions.projectId })
          .from(missions)
          .where(eq(missions.id, ended.missionId))
          .pipe(Effect.mapError(refusedWhile('reading the mission')))
        const projectId = mission[0]?.projectId ?? ''
        return {
          result: ended,
          events: [
            checkEvent('building.check_result', ended, projectId, { agent: outcome.agent }),
            checkEvent('building.check_ended', ended, projectId, {
              lineage: ended.lineage,
              reason: secrets.mask(outcome.why),
            }),
          ],
        }
      }),
    )
  })

/** The agent of a check running from now on; null when it no longer waits. */
const agentRunning = (row: CheckRow) =>
  mutate('starting the agent of a check', (transaction) =>
    Effect.gen(function* () {
      const [fresh] = yield* transaction
        .update(prelaunchChecks)
        .set({ agentState: 'running' })
        .where(
          and(
            eq(prelaunchChecks.id, row.id),
            eq(prelaunchChecks.state, 'running'),
            inArray(prelaunchChecks.agentState, ['waiting_for_slot', 'running']),
          ),
        )
        .returning()
        .pipe(Effect.mapError(refusedWhile('starting the agent of a check')))
      if (fresh === undefined) return { result: null, events: [] }
      const mission = yield* transaction
        .select({ projectId: missions.projectId })
        .from(missions)
        .where(eq(missions.id, fresh.missionId))
        .pipe(Effect.mapError(refusedWhile('reading the mission')))
      return {
        result: fresh,
        events:
          row.agentState === 'waiting_for_slot'
            ? [checkEvent('building.check_agent_running', fresh, mission[0]?.projectId ?? '')]
            : [],
      }
    }),
  )

type Needs =
  | Database
  | DomainEvents
  | Secrets
  | Sessions
  | Cap
  | SessionPost
  | AutomationGate
  | Memory

export const checkRunsLayer = (settings: CheckRunsSettings) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs>()
      const run = <A, E>(effect: Effect.Effect<A, E, Needs>) => Effect.provide(effect, context)
      const scope = yield* Effect.scope
      const log = (line: string) => Effect.sync(() => settings.log(`pre-launch checks: ${line}`))
      const sessions = yield* Sessions
      const cap = yield* Cap
      /** The background work of each check's agent: its wait for a slot, then its session. */
      const starting = new Map<string, Fiber.Fiber<void>>()

      const liveIn = (lineage: string) =>
        Effect.map(sessionsOfLineage(lineage), (rows) =>
          rows.some((one) => LIVE_SESSION.some((state) => state === one.state)),
        )

      /** What runs for a check's agent stops: its session, and the slot it holds. */
      const stop = (checkId: string, lineage: string, reason: string) =>
        Effect.gen(function* () {
          const background = starting.get(checkId)
          if (background !== undefined) yield* Fiber.interrupt(background)
          yield* sessions.end(lineage, reason)
          yield* cap.release(lineage)
        })

      /** A check's agent: its slot, then its session, unless a session of its lineage lives. */
      const slotThenSession = (row: CheckRow, lineage: string) =>
        Effect.gen(function* () {
          const mission = yield* projectOf(row.missionId)
          if (mission === null) return
          const project = yield* getProject(mission.projectId)
          const slot = yield* cap.acquire({
            projectId: project.id,
            lineage,
            missionId: row.missionId,
            requestedBy: 'hemera',
          })
          if (!slot.held) {
            yield* cap.release(lineage)
            yield* endAgent(row.id, { agent: 'failed', state: 'done', why: slot.sentence })
            return
          }
          const fresh = yield* agentRunning(row)
          if (fresh === null) {
            yield* cap.release(lineage)
            return
          }
          if (yield* liveIn(lineage)) return
          yield* sessions.reopen(
            lineage,
            {
              owner: { kind: 'mission', missionId: row.missionId },
              role: 'prelaunch',
              folder: project.mainCheckout,
              requestedBy: 'hemera',
            },
            'the pre-launch check reads what else changed',
          )
        }).pipe(
          run,
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) return Effect.void
            const error = Cause.squash(cause)
            const why = error instanceof Error ? error.message : String(error)
            return log(`the agent of check ${row.id} did not start: ${String(cause)}`).pipe(
              Effect.andThen(
                endAgent(row.id, {
                  agent: 'failed',
                  state: 'done',
                  why: `The agent of the check did not start: ${why}`,
                }),
              ),
              run,
              Effect.catchCause((again) => log(`check ${row.id} was not ended: ${String(again)}`)),
            )
          }),
        )

      /** A check's agent started once: its background work forked, unless it already goes. */
      const start = (checkId: string) =>
        Effect.gen(function* () {
          if (starting.has(checkId)) return
          const database = yield* Database
          const row = yield* checkRowIn(database, checkId)
          if (row === null || row.state !== 'running' || row.lineage === null) return
          if (row.agentState === 'running' && (yield* cap.holds(row.lineage))) {
            if (yield* liveIn(row.lineage)) return
          }
          const fiber = yield* slotThenSession(row, row.lineage).pipe(
            Effect.ensuring(Effect.sync(() => starting.delete(checkId))),
            Effect.forkIn(scope),
          )
          starting.set(checkId, fiber)
        }).pipe(run)

      /** The checks of a mission whose agent waits or runs, ended with it. */
      const missionLeft = (missionId: string, why: string) =>
        Effect.gen(function* () {
          const going = (yield* agentsGoing).filter((one) => one.missionId === missionId)
          for (const row of going) {
            yield* endAgent(row.id, { agent: 'failed', state: 'failed', why })
          }
        })

      /** A check's session stopped for good, with no live session left in its lineage. */
      const stoppedSession = (lineage: string, state: string, why: string) =>
        Effect.gen(function* () {
          if (state === 'replaced') return
          const row = yield* checkOfLineage(lineage)
          if (row?.state !== 'running') return
          if (yield* liveIn(lineage)) return
          yield* endAgent(row.id, {
            agent: 'failed',
            state: 'done',
            why: `The agent of the check stopped: ${why}`,
          })
        })

      const textOf = (value: Schema.Json | undefined): string | null =>
        Option.getOrNull(readText(value))
      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      const follow = events.pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const checkId = textOf(event.payload['checkId'])
            if (event.type === 'building.check_started' && event.payload['agent'] === true) {
              if (checkId !== null) yield* start(checkId)
            }
            if (event.type === 'building.check_ended' && checkId !== null) {
              const lineage = textOf(event.payload['lineage'])
              if (lineage !== null) {
                yield* stop(checkId, lineage, 'the check ended').pipe(Effect.forkIn(scope))
              }
            }
            const ended =
              (event.type === 'mission.moved' && event.payload['to'] === 'done') ||
              event.type === 'mission.cancelled'
            if (ended) yield* missionLeft(event.entityId, MISSION_ENDED)
            if (event.type === 'mission.moved' && event.payload['to'] === 'planning') {
              yield* missionLeft(event.entityId, BACK_TO_PLANNING)
            }
            if (event.type === 'session.stopped' && event.payload['role'] === 'prelaunch') {
              const lineage = textOf(event.payload['lineage'])
              const state = textOf(event.payload['state']) ?? ''
              const why = textOf(event.payload['reason']) ?? 'no reason given'
              if (lineage !== null) yield* stoppedSession(lineage, state, why)
            }
          }).pipe(
            run,
            Effect.catchCause((cause) => log(`an event was not followed: ${String(cause)}`)),
          ),
        ),
      )

      // A turn that ended without the report: reminded once, then the agent did not answer.
      const post = yield* SessionPost
      const silentEnd = (sessionId: string) =>
        Effect.gen(function* () {
          const session = yield* getSession(sessionId)
          if (session.role !== 'prelaunch') return
          const found = yield* checkOfLineage(session.lineage)
          if (found?.state !== 'running' || found.agentState !== 'running') return
          yield* sessions.settled(sessionId)
          if ((yield* getSession(sessionId)).state !== 'idle') return
          const database = yield* Database
          const row = yield* checkRowIn(database, found.id)
          if (row?.state !== 'running' || row.lineage === null) return
          if (row.reminded) {
            yield* endAgent(row.id, {
              agent: 'unanswered',
              state: 'done',
              why: 'The agent of the check ended two turns without its report.',
            })
            return
          }
          const reminded = yield* mutate('reminding the agent of a check', (transaction) =>
            Effect.map(
              transaction
                .update(prelaunchChecks)
                .set({ reminded: true })
                .where(and(eq(prelaunchChecks.id, row.id), eq(prelaunchChecks.reminded, false)))
                .returning({ id: prelaunchChecks.id })
                .pipe(Effect.mapError(refusedWhile('reminding the agent of a check'))),
              (rows) => ({ result: rows.length > 0, events: [] }),
            ),
          )
          if (!reminded) return
          yield* sessions.deliver({
            owner: session.owner,
            target: { lineage: row.lineage },
            kind: 'reminder',
            body: END_WITH_PRELAUNCH_REPORT,
          })
        }).pipe(
          run,
          Effect.catchCause((cause) => log(`a turn's end was not followed: ${String(cause)}`)),
        )

      // At every start, once automations may run: an agent a stop left waiting or running goes on;
      // one whose mission left Ready ends.
      const reconcile = Effect.gen(function* () {
        for (const row of yield* agentsGoing) {
          const mission = yield* projectOf(row.missionId)
          if (mission?.stage !== 'ready') {
            yield* endAgent(row.id, {
              agent: 'failed',
              state: 'failed',
              why: mission?.stage === 'planning' ? BACK_TO_PLANNING : MISSION_ENDED,
            })
            continue
          }
          yield* start(row.id)
        }
      })

      yield* AutomationGate.use((gate) => gate.pass).pipe(
        Effect.andThen(Memory.use((memory) => memory.ready)),
        Effect.andThen(
          Effect.all(
            [
              follow,
              post.turns.pipe(
                Stream.filter((turn) => !turn.on),
                Stream.runForEach((turn) => Effect.forkIn(silentEnd(turn.sessionId), scope)),
              ),
              reconcile.pipe(
                run,
                Effect.catchCause((cause) =>
                  log(`the checks were not reconciled: ${String(cause)}`),
                ),
              ),
            ],
            { concurrency: 'unbounded', discard: true },
          ),
        ),
        Effect.provide(context),
        Effect.catchCause((cause) => log(`the pre-launch checks stopped: ${String(cause)}`)),
        Effect.forkScoped,
      )
    }),
  )
