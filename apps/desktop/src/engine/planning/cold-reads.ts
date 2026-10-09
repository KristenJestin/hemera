/**
 * The cold read's passes (#91, CT-29, CT-13): a fixed phase of Hemera, never an agent's launch.
 *
 * - **Launch.** A pass is recorded with the declaration of completeness that is the first of its
 *   Planning cycle, in its transaction, or by the user's "another pass" (`cold-read-pass.ts`).
 *   Each recorded pass then waits for a slot of the Project's cap (#41: it waits, is never refused, and spends no launch
 *   of the mission's budget), runs, and opens a fresh session of the role `cold-read`: a session
 *   of the mission, not a child of the Planner, in the main checkout, read-only.
 * - **End.** Once its report is kept (`cold-read-store.ts`), its session ends, its slot is freed,
 *   and its findings are handed to the Planner as `[hemera:cold-read]` (CT-28). A turn that ends
 *   without the report is told once; a second silent end fails the pass.
 * - **Health.** #40's rules hold: a session silent in a turn is stuck (the pass's chip says so
 *   until its lineage speaks again), a dead one is replaced with the same brief and "start again
 *   from the beginning" (CT-06).
 * - **The mission's life.** A mission that leaves Planning fails its pass waiting or running.
 * - **Start.** Once automations may run, a pass a stop left waiting waits again; one left running
 *   is taken over by the sessions' rebuild, or opened again when its session never opened.
 *
 * Nothing here waits on a timer.
 */

import { and, eq, inArray } from 'drizzle-orm'
import { Cause, Effect, Fiber, Layer, Option, Schema, Semaphore, Stream } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { AgentRuntime } from '../agents/runtime.ts'
import { DomainEvents } from '../domain-events.ts'
import { AutomationGate } from '../gate.ts'
import { Memory } from '../memory/index.ts'
import { getProject } from '../projects.ts'
import type { Secrets } from '../secrets.ts'
import { Cap } from '../sessions/cap.ts'
import { SessionPost } from '../sessions/post.ts'
import { Sessions } from '../sessions/service.ts'
import { getSession, sessionsOfLineage } from '../sessions/store.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { coldReads, missions, sessionDeliveries, sessionNeeds } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { COLD_READ_RUNS, coldReadEvent } from './cold-read-pass.ts'
import {
  LEFT_PLANNING,
  SESSION_STOPPED,
  coldReadRow,
  coldReadsIn,
  failPass,
  movePass,
} from './cold-read-store.ts'
import { type ColdReadRow, coldReadOfLineage } from './cold-read-rows.ts'
import { hemeraNext } from './store.ts'
import { PlannerWake } from './wake.ts'

export interface ColdReadsSettings {
  readonly log: Log
}

/** What a pass that ended a turn without its report is told, once. */
export const END_WITH_COLD_READ_REPORT =
  'End with cold_read_report: your report is the only thing you return. An empty report is valid.'

/** Why a pass that ended two turns without its report failed. */
export const NO_COLD_READ_REPORT = 'ended without a report'

const LIVE_SESSION = ['starting', 'working', 'idle', 'stuck'] as const

const readText = Schema.decodeUnknownOption(Schema.String)

type Needs =
  | Database
  | DomainEvents
  | Secrets
  | Sessions
  | Cap
  | PlannerWake
  | SessionPost
  | AgentRuntime
  | AutomationGate
  | Memory

export const coldReadsLayer = (settings: ColdReadsSettings) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs>()
      const run = <A, E>(effect: Effect.Effect<A, E, Needs>) => Effect.provide(effect, context)
      const scope = yield* Effect.scope
      const log = (line: string) => Effect.sync(() => settings.log(`cold reads: ${line}`))
      const sessions = yield* Sessions
      const cap = yield* Cap
      const wake = yield* PlannerWake

      const locks = new Map<string, Semaphore.Semaphore>()
      /** One pass's start and failure, one after the other. */
      const locked = <A, E, R>(passId: string, effect: Effect.Effect<A, E, R>) => {
        const found = locks.get(passId)
        const lock = found ?? Semaphore.makeUnsafe(1)
        if (found === undefined) locks.set(passId, lock)
        return Semaphore.withPermits(lock, 1)(effect)
      }
      /** The background work of each pass: its wait for a slot, then its session's opening. */
      const starting = new Map<string, Fiber.Fiber<void>>()
      /** The lineages whose pass is stuck, until a session of theirs speaks again. */
      const stuck = new Set<string>()

      /** What runs for a pass stops: its sessions, and the slot it holds. */
      const stop = (row: ColdReadRow, reason: string) =>
        Effect.gen(function* () {
          yield* sessions.end(row.lineage, reason)
          yield* cap.release(row.lineage)
        })

      /**
       * Fails a pass waiting or running: its wait interrupted, what it runs stopped. From within
       * its own background work, that work is not interrupted: it ends with the failure.
       */
      const failing = (row: Pick<ColdReadRow, 'id'>, why: string, fromWithin: boolean) =>
        Effect.gen(function* () {
          const failed = yield* locked(
            row.id,
            Effect.gen(function* () {
              const background = starting.get(row.id)
              if (background !== undefined && !fromWithin) yield* Fiber.interrupt(background)
              return yield* failPass(row, why)
            }),
          )
          if (failed !== null) yield* stop(failed, `the cold read failed: ${why}`)
        }).pipe(run)
      const fail = (row: Pick<ColdReadRow, 'id'>, why: string) => failing(row, why, false)

      /** Running from now on, with Now's next step; null when it no longer waits or runs. */
      const running = (row: ColdReadRow) =>
        mutate('starting a cold read', (transaction) =>
          Effect.gen(function* () {
            const [fresh] = yield* transaction
              .update(coldReads)
              .set({ state: 'running', startedAt: row.startedAt ?? new Date().toISOString() })
              .where(
                and(
                  eq(coldReads.id, row.id),
                  inArray(coldReads.state, ['waiting_for_slot', 'running']),
                ),
              )
              .returning()
              .pipe(Effect.mapError(refusedWhile('starting a cold read')))
            if (fresh === undefined) return { result: null, events: [] }
            const events =
              row.state === 'waiting_for_slot'
                ? [
                    coldReadEvent('planning.cold_read_running', fresh),
                    yield* hemeraNext(transaction, fresh.missionId, COLD_READ_RUNS),
                  ]
                : []
            return { result: fresh, events }
          }),
        )

      /** A pass's slot, then its session, unless a session of its lineage already lives. */
      const slotThenSession = (passId: string) =>
        Effect.gen(function* () {
          const row = yield* coldReadRow(passId)
          if (row === null || (row.state !== 'waiting_for_slot' && row.state !== 'running')) return
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
          const live = (yield* sessionsOfLineage(row.lineage)).some((one) =>
            LIVE_SESSION.some((state) => state === one.state),
          )
          if (live) return
          yield* sessions.reopen(
            row.lineage,
            {
              owner: { kind: 'mission', missionId: row.missionId },
              role: 'cold-read',
              folder: project.mainCheckout,
              requestedBy: 'hemera',
            },
            'the cold read starts again',
          )
        }).pipe(
          run,
          // Its slot, its session or its row could not be had: it fails, its slot freed.
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) return Effect.void
            const error = Cause.squash(cause)
            const why = error instanceof Error ? error.message : String(error)
            return Effect.andThen(
              log(`cold read ${passId} did not start: ${String(cause)}`),
              failing({ id: passId }, `its session did not open: ${why}`, true),
            ).pipe(
              Effect.catchCause((again) =>
                log(`cold read ${passId} was not failed: ${String(again)}`),
              ),
            )
          }),
        )

      /** Starts a pass's background work once, under its lock, so a failure finds it. */
      const begin = (passId: string) =>
        locked(
          passId,
          Effect.gen(function* () {
            if (starting.has(passId)) return
            const fiber = yield* slotThenSession(passId).pipe(
              Effect.ensuring(Effect.sync(() => starting.delete(passId))),
              Effect.forkIn(scope),
            )
            starting.set(passId, fiber)
          }),
        )

      /** After a report: the session ended, the slot freed, the findings handed to the Planner. */
      const afterReport = (passId: string) =>
        Effect.gen(function* () {
          const row = yield* coldReadRow(passId)
          if (row === null) return
          yield* stop(row, 'it reported')
          if (row.deliveryId === null) return
          const database = yield* Database
          const [delivery] = yield* database
            .select({ body: sessionDeliveries.body })
            .from(sessionDeliveries)
            .where(eq(sessionDeliveries.id, row.deliveryId))
            .pipe(Effect.mapError(refusedWhile('reading a delivery')))
          if (delivery === undefined) return
          yield* wake.deliver(row.missionId, 'cold-read', delivery.body, row.deliveryId)
        }).pipe(
          run,
          Effect.catchCause((cause) =>
            log(`the end of cold read ${passId} was not finished: ${String(cause)}`),
          ),
        )

      /** The passes of a mission that left Planning, failed. */
      const leftPlanning = (missionId: string) =>
        Effect.gen(function* () {
          const live = (yield* coldReadsIn(['waiting_for_slot', 'running'])).filter(
            (one) => one.missionId === missionId,
          )
          yield* Effect.forEach(live, (row) => fail(row, LEFT_PLANNING), { discard: true })
        })

      /**
       * A session of a pass stopped (#40): replaced, its successor goes on; ended or failed with no
       * live session left in its lineage, the pass fails and its slot is freed. A provider limit
       * keeps it running: the user's Retry starts its lineage again.
       */
      const stoppedSession = (sessionId: string, lineage: string, state: string, why: string) =>
        Effect.gen(function* () {
          if (state === 'replaced') return
          const row = yield* coldReadOfLineage(lineage)
          if (row?.state !== 'running') return
          const live = (yield* sessionsOfLineage(lineage)).some((one) =>
            LIVE_SESSION.some((alive) => alive === one.state),
          )
          if (live) return
          const database = yield* Database
          const limited = yield* database
            .select({ id: sessionNeeds.needId })
            .from(sessionNeeds)
            .where(and(eq(sessionNeeds.sessionId, sessionId), eq(sessionNeeds.reason, 'limit')))
            .pipe(Effect.mapError(refusedWhile('reading the needs of a session')))
          if (limited.length > 0) return
          yield* fail(row, `${SESSION_STOPPED}: ${why}`)
        })

      /** A pass's session stuck (#40): its chip says so until its lineage speaks again. */
      const stuckSession = (lineage: string) =>
        Effect.gen(function* () {
          const row = yield* coldReadOfLineage(lineage)
          if (row?.state !== 'running') return
          stuck.add(lineage)
          yield* movePass(row, ['running'], { stuck: true }, (fresh) => [
            coldReadEvent('planning.cold_read_stuck', fresh),
          ])
        })
      const lineages = new Map<string, string>()
      const spoke = (sessionId: string) =>
        Effect.gen(function* () {
          if (stuck.size === 0) return
          const lineage = lineages.get(sessionId) ?? (yield* getSession(sessionId)).lineage
          lineages.set(sessionId, lineage)
          if (!stuck.delete(lineage)) return
          const row = yield* coldReadOfLineage(lineage)
          if (row === null) return
          yield* movePass(row, ['running'], { stuck: false }, (fresh) => [
            coldReadEvent('planning.cold_read_unstuck', fresh),
          ])
        })

      // What the cold reads follow: their own events, and the mission's.
      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      const textOf = (value: Schema.Json | undefined): string | null =>
        Option.getOrNull(readText(value))
      yield* events.pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const passId = textOf(event.payload['coldReadId'])
            if (event.type === 'planning.cold_read_started' && passId !== null) {
              yield* begin(passId)
            }
            if (event.type === 'planning.cold_read_ended' && passId !== null) {
              yield* afterReport(passId).pipe(Effect.forkIn(scope))
            }
            const leaves =
              (event.type === 'mission.moved' || event.type === 'mission.cancelled') &&
              event.payload['from'] === 'planning'
            if (leaves) yield* leftPlanning(event.entityId)
            if (event.type === 'session.stopped' && event.payload['role'] === 'cold-read') {
              const lineage = textOf(event.payload['lineage'])
              const state = textOf(event.payload['state']) ?? ''
              const why = textOf(event.payload['reason']) ?? 'no reason given'
              if (lineage !== null) yield* stoppedSession(event.entityId, lineage, state, why)
            }
            // A successor is told once again before a silent end fails its pass.
            if (event.type === 'session.replaced' && event.payload['role'] === 'cold-read') {
              const lineage = textOf(event.payload['lineage'])
              const row = lineage === null ? null : yield* coldReadOfLineage(lineage)
              if (row?.reminded === true) {
                yield* movePass(row, ['running'], { reminded: false }, () => [])
              }
            }
            if (event.type === 'session.stuck' && event.payload['role'] === 'cold-read') {
              const lineage = textOf(event.payload['lineage'])
              if (lineage !== null) yield* stuckSession(lineage)
            }
          }).pipe(
            run,
            Effect.catchCause((cause) => log(`an event was not followed: ${String(cause)}`)),
          ),
        ),
        Effect.forkScoped,
      )

      // A turn that ended without the report: told once, then failed.
      const post = yield* SessionPost
      const silentEnd = (sessionId: string) =>
        Effect.gen(function* () {
          const session = yield* getSession(sessionId)
          if (session.role !== 'cold-read') return
          const found = yield* coldReadOfLineage(session.lineage)
          if (found?.state !== 'running') return
          yield* sessions.settled(sessionId)
          if ((yield* getSession(sessionId)).state !== 'idle') return
          const row = yield* coldReadRow(found.id)
          if (row?.state !== 'running') return
          if (row.reminded) return yield* fail(row, NO_COLD_READ_REPORT)
          const reminded = yield* movePass(row, ['running'], { reminded: true }, () => [])
          if (reminded === null) return
          yield* sessions.deliver({
            owner: session.owner,
            target: { lineage: row.lineage },
            kind: 'reminder',
            body: END_WITH_COLD_READ_REPORT,
          })
        }).pipe(
          run,
          Effect.catchCause((cause) => log(`a turn's end was not followed: ${String(cause)}`)),
        )
      yield* post.turns.pipe(
        Stream.filter((turn) => !turn.on),
        Stream.runForEach((turn) => Effect.forkIn(silentEnd(turn.sessionId), scope)),
        Effect.forkScoped,
      )

      const runtime = yield* AgentRuntime
      yield* runtime.activity.pipe(
        Stream.filter(({ event }) => !event.replay),
        Stream.runForEach(({ sessionId }) =>
          spoke(sessionId).pipe(
            run,
            Effect.catchCause((cause) => log(`a sign of life was not read: ${String(cause)}`)),
          ),
        ),
        Effect.forkScoped,
      )

      // At every start, once automations may run: what a stop left waiting or running goes on.
      const reconcile = Effect.gen(function* () {
        const database = yield* Database
        for (const row of yield* coldReadsIn(['waiting_for_slot', 'running'])) {
          const [mission] = yield* database
            .select({ stage: missions.stage })
            .from(missions)
            .where(eq(missions.id, row.missionId))
            .pipe(Effect.mapError(refusedWhile('reading the mission')))
          if (mission?.stage === 'planning') yield* begin(row.id)
          else yield* fail(row, LEFT_PLANNING)
        }
        // A report kept just before a stop: its session ends now, and holds no slot.
        for (const row of yield* coldReadsIn(['done', 'failed'])) {
          const live = (yield* sessionsOfLineage(row.lineage)).some((one) =>
            LIVE_SESSION.some((state) => state === one.state),
          )
          if (live) yield* stop(row, 'it ended before a stop')
        }
      })
      const gate = yield* AutomationGate
      const memory = yield* Memory
      yield* gate.pass.pipe(
        Effect.andThen(memory.ready),
        Effect.andThen(reconcile.pipe(run)),
        Effect.catchCause((cause) => log(`the cold reads were not reconciled: ${String(cause)}`)),
        Effect.forkScoped,
      )
    }),
  )
