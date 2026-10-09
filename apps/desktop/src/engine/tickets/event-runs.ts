/**
 * The `ticket-event` sessions (#97, open question 19, CT-13): after the Freeze, the changes of a
 * check that matter to analyse go to one short session per mission and per check, a fixed phase of
 * Hemera, never an agent's launch.
 *
 * - **Launch.** A run is recorded with the events of its check, in their transaction
 *   (`events.ts`). It waits for a slot of the Project's cap (it waits, is never refused, and spends
 *   nothing of the mission's budget), then opens a session of the role `ticket-event` in the main
 *   checkout, read-only. The runs of one mission go one after the other, in the order they were
 *   asked, so the events of a ticket are analysed in detection order.
 * - **End.** Once every event of the run has its report, the run is done, its session ends and its
 *   slot is freed. A turn that ends without every report is told once; a second silent end fails
 *   the run. A session that stops for good fails it too; its events stay, unanalysed.
 * - **The mission's life.** A mission that ends (Done, cancelled) fails its runs waiting or running,
 *   and so does a return to Planning: there its changes are the Planner's inputs (`events.ts`).
 * - **Start.** Once automations may run, a run a stop left waiting waits again, and one left running
 *   starts again with the same events, unless the sessions' rebuild took its session over.
 *
 * Nothing here waits on a timer.
 */

import { STAGES, isLive } from '@hemera/core/domain'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { Cause, Effect, Fiber, Layer, Option, Schema, Semaphore, Stream } from 'effect'

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
import { missions, ticketEventRuns, ticketEvents } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { type TicketEventRunRow, runOfLineage } from './event-role.ts'
import { runEvent } from './event-report.ts'
import { projectOfIn } from './versions.ts'

export interface TicketEventRunsSettings {
  readonly log: Log
}

/** What a session that ended a turn without every report is told, once. */
export const END_WITH_TICKET_EVENT_REPORTS =
  'End with ticket_event_report, once per event of your brief: your reports are the only thing you return.'

/** Why a run that ended two turns without its reports failed. */
export const NO_TICKET_EVENT_REPORT = 'ended without a report for every event'

/** Why a run fails with its mission. */
export const MISSION_ENDED = 'the mission ended'

/** Why a run fails when its mission goes back to Planning, where the Planner integrates. */
export const BACK_TO_PLANNING = 'the mission went back to Planning'

const LIVE_SESSION = ['starting', 'working', 'idle', 'stuck'] as const

const readText = Schema.decodeUnknownOption(Schema.String)

const now = (): string => new Date().toISOString()

/** The runs in these states, the oldest first. */
const runsIn = (states: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(ticketEventRuns)
      .where(inArray(ticketEventRuns.state, [...states]))
      .orderBy(asc(ticketEventRuns.askedAt), asc(ticketEventRuns.id))
      .pipe(Effect.mapError(refusedWhile('reading the ticket-event runs')))
  })

/** A run's row now, or null. */
const runRow = (runId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(ticketEventRuns)
      .where(eq(ticketEventRuns.id, runId))
      .pipe(Effect.mapError(refusedWhile('reading a ticket-event run')))
    return row ?? null
  })

/** A run waiting or running, failed with why; null when it was neither. */
const failRun = (runId: string, why: string) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    return yield* mutate('failing a ticket-event run', (transaction) =>
      Effect.gen(function* () {
        const [fresh] = yield* transaction
          .update(ticketEventRuns)
          .set({ state: 'failed', failure: secrets.mask(why), endedAt: now() })
          .where(
            and(
              eq(ticketEventRuns.id, runId),
              inArray(ticketEventRuns.state, ['waiting_for_slot', 'running']),
            ),
          )
          .returning()
          .pipe(Effect.mapError(refusedWhile('failing a ticket-event run')))
        return {
          result: fresh ?? null,
          events:
            fresh === undefined
              ? []
              : [
                  runEvent(
                    'tickets.analysis_failed',
                    fresh,
                    yield* projectOfIn(transaction, fresh.missionId),
                    why,
                  ),
                ],
        }
      }),
    )
  })

type Needs =
  | Database
  | DomainEvents
  | Secrets
  | Sessions
  | Cap
  | SessionPost
  | AutomationGate
  | Memory

export const ticketEventRunsLayer = (settings: TicketEventRunsSettings) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs>()
      const run = <A, E>(effect: Effect.Effect<A, E, Needs>) => Effect.provide(effect, context)
      const scope = yield* Effect.scope
      const log = (line: string) => Effect.sync(() => settings.log(`ticket events: ${line}`))
      const sessions = yield* Sessions
      const cap = yield* Cap

      /** One mission's runs are started and failed one after the other. */
      const locks = new Map<string, Semaphore.Semaphore>()
      const locked = <A, E, R>(missionId: string, effect: Effect.Effect<A, E, R>) => {
        const found = locks.get(missionId)
        const lock = found ?? Semaphore.makeUnsafe(1)
        if (found === undefined) locks.set(missionId, lock)
        return Semaphore.withPermits(lock, 1)(effect)
      }
      /** The background work of each run: its wait for a slot, then its session's opening. */
      const starting = new Map<string, Fiber.Fiber<void>>()

      const liveIn = (lineage: string) =>
        Effect.map(sessionsOfLineage(lineage), (rows) =>
          rows.some((one) => LIVE_SESSION.some((state) => state === one.state)),
        )

      /** What runs for a run stops: its sessions, and the slot it holds. */
      const stop = (row: TicketEventRunRow, reason: string) =>
        Effect.gen(function* () {
          yield* sessions.end(row.lineage, reason)
          yield* cap.release(row.lineage)
        })

      /** Running from now on, its events delivered; null when it no longer waits or runs. */
      const running = (row: TicketEventRunRow) =>
        mutate('starting a ticket-event run', (transaction) =>
          Effect.gen(function* () {
            const [fresh] = yield* transaction
              .update(ticketEventRuns)
              .set({ state: 'running', startedAt: row.startedAt ?? now() })
              .where(
                and(
                  eq(ticketEventRuns.id, row.id),
                  inArray(ticketEventRuns.state, ['waiting_for_slot', 'running']),
                ),
              )
              .returning()
              .pipe(Effect.mapError(refusedWhile('starting a ticket-event run')))
            if (fresh === undefined) return { result: null, events: [] }
            yield* transaction
              .update(ticketEvents)
              .set({ state: 'delivered' })
              .where(
                and(
                  eq(ticketEvents.runId, row.id),
                  eq(ticketEvents.state, 'new'),
                  isNull(ticketEvents.inputId),
                ),
              )
              .pipe(Effect.mapError(refusedWhile('delivering the ticket events')))
            const events =
              row.state === 'waiting_for_slot'
                ? [
                    runEvent(
                      'tickets.analysis_running',
                      fresh,
                      yield* projectOfIn(transaction, fresh.missionId),
                    ),
                  ]
                : []
            return { result: fresh, events }
          }),
        )

      /** A run's slot, then its session, unless a session of its lineage already lives. */
      const slotThenSession = (row: TicketEventRunRow) =>
        Effect.gen(function* () {
          const database = yield* Database
          const [mission] = yield* database
            .select({ projectId: missions.projectId })
            .from(missions)
            .where(eq(missions.id, row.missionId))
            .pipe(Effect.mapError(refusedWhile('reading the mission')))
          if (mission === undefined) return
          const project = yield* getProject(mission.projectId)
          yield* cap.acquire({
            projectId: project.id,
            lineage: row.lineage,
            missionId: row.missionId,
            requestedBy: 'hemera',
          })
          const fresh = yield* running(row)
          if (fresh === null) {
            yield* cap.release(row.lineage)
            return
          }
          if (yield* liveIn(row.lineage)) return
          yield* sessions.reopen(
            row.lineage,
            {
              owner: { kind: 'mission', missionId: row.missionId },
              role: 'ticket-event',
              folder: project.mainCheckout,
              requestedBy: 'hemera',
            },
            'the analysis of the ticket events starts again',
          )
        }).pipe(
          run,
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) return Effect.void
            const error = Cause.squash(cause)
            const why = error instanceof Error ? error.message : String(error)
            return Effect.andThen(
              log(`run ${row.id} did not start: ${String(cause)}`),
              ending(row, `its session did not open: ${why}`, true),
            ).pipe(
              Effect.catchCause((again) => log(`run ${row.id} was not failed: ${String(again)}`)),
            )
          }),
        )

      /**
       * The next run of a mission, once none of its runs goes: the oldest waiting or running, its
       * background work started once.
       */
      const next = (missionId: string): Effect.Effect<void> =>
        locked(
          missionId,
          Effect.gen(function* () {
            const going = (yield* runsIn(['waiting_for_slot', 'running'])).filter(
              (one) => one.missionId === missionId,
            )
            const [first] = going
            if (first === undefined || starting.has(first.id)) return
            if (first.state === 'running' && (yield* cap.holds(first.lineage))) {
              if (yield* liveIn(first.lineage)) return
            }
            const fiber = yield* slotThenSession(first).pipe(
              Effect.ensuring(Effect.sync(() => starting.delete(first.id))),
              Effect.forkIn(scope),
            )
            starting.set(first.id, fiber)
          }).pipe(run),
        ).pipe(Effect.catchCause((cause) => log(`the next run was not started: ${String(cause)}`)))

      /**
       * Fails a run waiting or running: its wait interrupted, what it runs stopped, then the next
       * run of its mission. From within its own background work, that work is not interrupted.
       */
      const ending = (row: Pick<TicketEventRunRow, 'id'>, why: string, fromWithin: boolean) =>
        Effect.gen(function* () {
          const background = starting.get(row.id)
          if (background !== undefined && !fromWithin) yield* Fiber.interrupt(background)
          const failed = yield* failRun(row.id, why)
          if (failed === null) return
          yield* stop(failed, `the analysis failed: ${why}`)
          yield* next(failed.missionId).pipe(Effect.forkIn(scope))
        }).pipe(run)

      /** After the last report: the session ended, the slot freed, the mission's next run. */
      const afterReports = (runId: string) =>
        Effect.gen(function* () {
          const row = yield* runRow(runId)
          if (row === null) return
          yield* stop(row, 'every event has its report')
          yield* next(row.missionId)
        }).pipe(
          run,
          Effect.catchCause((cause) =>
            log(`the end of run ${runId} was not finished: ${String(cause)}`),
          ),
        )

      /** The runs of a mission that ended, or went back to Planning, failed. */
      const missionEnded = (missionId: string, why: string) =>
        Effect.gen(function* () {
          const going = (yield* runsIn(['waiting_for_slot', 'running'])).filter(
            (one) => one.missionId === missionId,
          )
          yield* Effect.forEach(going, (row) => ending(row, why, false), {
            discard: true,
          })
        })

      /** A session of a run stopped for good, with no live session left in its lineage: it fails. */
      const stoppedSession = (lineage: string, state: string, why: string) =>
        Effect.gen(function* () {
          if (state === 'replaced') return
          const row = yield* runOfLineage(lineage)
          if (row?.state !== 'running') return
          if (yield* liveIn(lineage)) return
          yield* ending(row, `its session stopped: ${why}`, false)
        })

      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      const textOf = (value: Schema.Json | undefined): string | null =>
        Option.getOrNull(readText(value))
      const gate = yield* AutomationGate
      const memory = yield* Memory
      const follow = events.pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (event.type === 'tickets.analysis_asked') yield* next(event.entityId)
            if (event.type === 'tickets.analysis_ended') {
              const runId = textOf(event.payload['run'])
              if (runId !== null) yield* afterReports(runId).pipe(Effect.forkIn(scope))
            }
            const ended =
              (event.type === 'mission.moved' && event.payload['to'] === 'done') ||
              event.type === 'mission.cancelled'
            if (ended) yield* missionEnded(event.entityId, MISSION_ENDED)
            const back =
              event.type === 'mission.moved' &&
              event.payload['to'] === 'planning' &&
              event.payload['from'] !== 'planning'
            if (back) yield* missionEnded(event.entityId, BACK_TO_PLANNING)
            if (event.type === 'session.stopped' && event.payload['role'] === 'ticket-event') {
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

      // A turn that ended without every report: told once, then failed.
      const post = yield* SessionPost
      const silentEnd = (sessionId: string) =>
        Effect.gen(function* () {
          const session = yield* getSession(sessionId)
          if (session.role !== 'ticket-event') return
          const found = yield* runOfLineage(session.lineage)
          if (found?.state !== 'running') return
          yield* sessions.settled(sessionId)
          if ((yield* getSession(sessionId)).state !== 'idle') return
          const row = yield* runRow(found.id)
          if (row?.state !== 'running') return
          if (row.reminded) return yield* ending(row, NO_TICKET_EVENT_REPORT, false)
          const reminded = yield* mutate('reminding a ticket-event run', (transaction) =>
            Effect.map(
              transaction
                .update(ticketEventRuns)
                .set({ reminded: true })
                .where(and(eq(ticketEventRuns.id, row.id), eq(ticketEventRuns.reminded, false)))
                .returning({ id: ticketEventRuns.id })
                .pipe(Effect.mapError(refusedWhile('reminding a ticket-event run'))),
              (rows) => ({ result: rows.length > 0, events: [] }),
            ),
          )
          if (!reminded) return
          yield* sessions.deliver({
            owner: session.owner,
            target: { lineage: row.lineage },
            kind: 'reminder',
            body: END_WITH_TICKET_EVENT_REPORTS,
          })
        }).pipe(
          run,
          Effect.catchCause((cause) => log(`a turn's end was not followed: ${String(cause)}`)),
        )

      // At every start, once automations may run: what a stop left waiting or running goes on.
      const reconcile = Effect.gen(function* () {
        const database = yield* Database
        const going = yield* runsIn(['waiting_for_slot', 'running'])
        for (const row of going) {
          const [mission] = yield* database
            .select({ stage: missions.stage })
            .from(missions)
            .where(eq(missions.id, row.missionId))
            .pipe(Effect.mapError(refusedWhile('reading the mission')))
          const stage = mission?.stage ?? 'cancelled'
          if (mission === undefined || !isLiveStage(stage)) yield* ending(row, MISSION_ENDED, false)
          else if (stage === 'planning') yield* ending(row, BACK_TO_PLANNING, false)
        }
        for (const missionId of new Set(going.map((one) => one.missionId))) yield* next(missionId)
        // A last report kept just before a stop: its session ends now, and holds no slot.
        for (const row of yield* runsIn(['done', 'failed'])) {
          if (yield* liveIn(row.lineage)) yield* stop(row, 'it ended before a stop')
        }
      })

      yield* gate.pass.pipe(
        Effect.andThen(memory.ready),
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
                  log(`the ticket-event runs were not reconciled: ${String(cause)}`),
                ),
              ),
            ],
            { concurrency: 'unbounded', discard: true },
          ),
        ),
        Effect.catchCause((cause) => log(`the ticket-event runs stopped: ${String(cause)}`)),
        Effect.forkScoped,
      )
    }),
  )

const isLiveStage = (stage: string): boolean => {
  const known = STAGES.find((one) => one === stage)
  return known !== undefined && isLive(known)
}
