/**
 * How Hemera wakes the Planner (#85, CT-28): never by a timer, always with a delivery.
 *
 * - `PlannerWake.deliver` is what every Planning ticket calls with its delivery
 *   (`[hemera:<kind>]`): a live Planner in a turn receives it at its next safe point, an idle one
 *   is woken with it, and with no live Planner a fresh one starts with its brief and the delivery.
 * - `PlannerWake.start` starts a mission's first Planner: on `mission.started` (#84), and at the
 *   engine's start for every mission in Planning that never had one (the event is not written
 *   down). A mission that had a Planner is never started again here: the sessions' own rebuild
 *   (CT-11) takes its live session over, and an ended one waits for a delivery.
 * - At the end of each Planner turn that wrote, one `spec.drafted` says what it wrote.
 * - While a `spec_write_section` call runs, its section is being written (from the agent's live
 *   tool-call events).
 * - When a Planner's turn begins, the inputs its deliveries carried are delivered (#86, CT-26); at
 *   the engine's start, the inputs a stopped engine never handed over are delivered again.
 *
 * Every start and wake of one mission's Planner runs under one lock: two at once open one session.
 */

import { SESSION_STATES, SPEC_SECTIONS, hemeraToolNamed } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Context, Effect, Layer, Option, Predicate, Schema, Semaphore, Stream } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { AgentRuntime } from '../agents/runtime.ts'
import { DomainEvents } from '../domain-events.ts'
import { AutomationGate } from '../gate.ts'
import { Memory } from '../memory/index.ts'
import { getProject } from '../projects.ts'
import type { Secrets } from '../secrets.ts'
import { SessionPost } from '../sessions/post.ts'
import { Sessions } from '../sessions/service.ts'
import { type RoleSession, getSession, sessionsIn } from '../sessions/store.ts'
import { MissionStarts } from '../start/started.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import { missions } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { SpecBoard, draftedSaid } from './board.ts'
import { prepareDeliveries, queuedForPlanner } from './handover.ts'
import { markDelivered } from './inputs.ts'
import { hemeraNext } from './store.ts'

/** What Now's next step says once the Planner started, and once a turn wrote the draft. */
export const READING_THE_CODE = 'Reading the code'
export const DRAFT_WRITTEN = 'Draft written'

export class PlannerWake extends Context.Service<
  PlannerWake,
  {
    /**
     * Hands the mission's Planner a delivery, starting a fresh one when none lives; nothing for a
     * mission that is not in Planning (false).
     */
    readonly deliver: (
      missionId: string,
      kind: string,
      body: string,
      /** The delivery's id, when the caller stored it already (the inputs of CT-26). */
      id?: string,
    ) => Effect.Effect<boolean, DatabaseError>
    /** Starts the mission's first Planner; nothing when it had one, or is not in Planning. */
    readonly start: (missionId: string) => Effect.Effect<RoleSession | null, DatabaseError>
  }
>()('PlannerWake') {}

export interface PlannerSettings {
  readonly log: Log
  /** Whether a new mission starts its Planner on its own; a suite that does not plan says no. */
  readonly starts: boolean
}

const OPEN_STATES = SESSION_STATES

const SectionInput = Schema.Struct({ section: Schema.String })
const readSection = Schema.decodeUnknownOption(Schema.fromJsonString(SectionInput))

type Needs = Database | DomainEvents | Secrets | Sessions | SpecBoard

export const plannerLayer = (settings: PlannerSettings) =>
  Layer.effect(
    PlannerWake,
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs>()
      const lock = yield* Semaphore.make(1)
      const run = <A, E>(effect: Effect.Effect<A, E, Needs>) => Effect.provide(effect, context)
      const said = (line: string) => Effect.sync(() => settings.log(`planner: ${line}`))

      /** The mission's stage and Project, or null when it is gone. */
      const missionOf = (missionId: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const [row] = yield* database
            .select({ stage: missions.stage, projectId: missions.projectId })
            .from(missions)
            .where(eq(missions.id, missionId))
            .pipe(Effect.mapError(refusedWhile('reading the mission')))
          return row ?? null
        })

      /** Whether the mission ever had a Planner session, whatever became of it. */
      const hadPlanner = (missionId: string) =>
        Effect.map(sessionsIn(OPEN_STATES, { kind: 'mission', missionId }), (rows) =>
          rows.some((row) => row.role === 'planner'),
        )

      /** What a Planner opens with: its mission, its role, the main checkout read-only. */
      const openAsked = (missionId: string, projectId: string) =>
        Effect.gen(function* () {
          const project = yield* getProject(projectId).pipe(
            Effect.catchTag('UnknownProject', () => Effect.succeed(null)),
          )
          if (project === null) return null
          return {
            owner: { kind: 'mission', missionId } as const,
            role: 'planner',
            folder: project.mainCheckout,
          }
        })

      /** `planning.started`, with the agent and model of the Planner opened, and Now's next step. */
      const started = (session: RoleSession) =>
        session.owner.kind !== 'mission'
          ? Effect.void
          : mutate('starting Planning', (transaction) =>
              Effect.gen(function* () {
                const missionId = session.owner.kind === 'mission' ? session.owner.missionId : ''
                const next = yield* hemeraNext(transaction, missionId, READING_THE_CODE)
                return {
                  result: undefined,
                  events: [
                    {
                      type: 'planning.started',
                      entityKind: 'mission',
                      entityId: missionId,
                      source: 'system',
                      author: 'hemera',
                      payload: {
                        sessionId: session.id,
                        agent: session.provider,
                        model: session.chosen.model,
                      },
                    } as const,
                    next,
                  ],
                }
              }),
            )

      /** The Planner session of a mission just opened by a delivery, for its start's event. */
      const plannerOf = (missionId: string) =>
        Effect.map(sessionsIn(OPEN_STATES, { kind: 'mission', missionId }), (rows) =>
          rows.find((row) => row.role === 'planner'),
        )

      const start = (missionId: string) =>
        Semaphore.withPermits(
          lock,
          1,
        )(
          Effect.gen(function* () {
            const mission = yield* missionOf(missionId)
            if (mission?.stage !== 'planning') return null
            if (yield* hadPlanner(missionId)) return null
            const asked = yield* openAsked(missionId, mission.projectId)
            if (asked === null) return null
            const session = yield* Sessions.use((sessions) => sessions.open(asked)).pipe(
              Effect.catchTag('SessionRefused', (refused) =>
                Effect.as(said(`no Planner for ${missionId}: ${refused.message}`), null),
              ),
            )
            if (session === null) return null
            // Cancelled while it was opened: nothing of it may keep running.
            const after = yield* missionOf(missionId)
            if (after?.stage !== 'planning') {
              yield* Sessions.use((sessions) =>
                sessions.stopTree(asked.owner, 'the mission left Planning'),
              )
              return null
            }
            yield* started(session)
            return session
          }),
        ).pipe(run)

      const deliver = (missionId: string, kind: string, body: string, id?: string) =>
        Semaphore.withPermits(
          lock,
          1,
        )(
          Effect.gen(function* () {
            const mission = yield* missionOf(missionId)
            if (mission?.stage !== 'planning') return false
            const asked = yield* openAsked(missionId, mission.projectId)
            if (asked === null) return false
            const first = !(yield* hadPlanner(missionId))
            const owner = { kind: 'mission', missionId } as const
            const delivered = yield* Sessions.use((sessions) =>
              sessions.deliverOrStart(
                { id: id ?? crypto.randomUUID(), owner, target: { role: 'planner' }, kind, body },
                asked,
              ),
            ).pipe(
              Effect.as(true),
              Effect.catchTags({
                SessionRefused: (refused) =>
                  Effect.as(said(`no Planner for ${missionId}: ${refused.message}`), false),
                DeliveryKindRefused: (refused) =>
                  Effect.as(said(`a delivery was refused: ${refused.message}`), false),
              }),
            )
            if (delivered && first) {
              const session = yield* plannerOf(missionId)
              if (session !== undefined) yield* started(session)
            }
            // Cancelled meanwhile: nothing of it may keep running.
            const after = yield* missionOf(missionId)
            if (after?.stage !== 'planning') {
              yield* Sessions.use((sessions) =>
                sessions.stopTree(owner, 'the mission left Planning'),
              )
            }
            return delivered
          }),
        ).pipe(run)

      // One `spec.drafted` per Planner turn that wrote, when the turn ends.
      const drafted = (sessionId: string) =>
        Effect.gen(function* () {
          const wrote = yield* SpecBoard.use((board) => board.takeWrites(sessionId))
          if (wrote === null) return
          yield* mutate('saying what the draft became', (transaction) =>
            Effect.gen(function* () {
              const next = yield* hemeraNext(transaction, wrote.missionId, DRAFT_WRITTEN)
              return {
                result: undefined,
                events: [
                  {
                    type: 'spec.drafted',
                    entityKind: 'mission',
                    entityId: wrote.missionId,
                    source: 'system',
                    author: 'agent',
                    payload: { sessionId, role: 'planner', what: draftedSaid(wrote.items) },
                  } as const,
                  next,
                ],
              }
            }),
          )
        }).pipe(
          run,
          Effect.catchCause((cause) =>
            said(`a turn's draft line was not written: ${String(cause)}`),
          ),
        )

      // A section is being written while a `spec_write_section` call of its mission runs, and no
      // longer once its turn or its session ended, whether the call said it completed or not.
      const writes = new Set<string>()
      const board = yield* SpecBoard
      const callsEnded = (sessionId: string) =>
        Effect.forEach(
          [...writes].filter((key) => key.startsWith(`${sessionId}:`)),
          (key) =>
            Effect.andThen(
              Effect.sync(() => writes.delete(key)),
              board.writing(key, null),
            ),
          { discard: true },
        )

      const post = yield* SessionPost
      yield* post.turns.pipe(
        Stream.filter((turn) => !turn.on),
        Stream.runForEach((turn) =>
          Effect.andThen(callsEnded(turn.sessionId), drafted(turn.sessionId)),
        ),
        Effect.forkScoped,
      )
      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      yield* events.pipe(
        Stream.filter((event) => event.type === 'session.stopped'),
        Stream.runForEach((event) => callsEnded(event.entityId)),
        Effect.forkScoped,
      )

      const owners = new Map<string, string | null>()
      const missionOfSession = (sessionId: string) =>
        Effect.gen(function* () {
          const known = owners.get(sessionId)
          if (known !== undefined) return known
          const session = yield* getSession(sessionId).pipe(Effect.option)
          const missionId = Option.match(session, {
            onNone: () => null,
            onSome: (one) => (one.owner.kind === 'mission' ? one.owner.missionId : null),
          })
          owners.set(sessionId, missionId)
          return missionId
        })
      // A turn that begins took its deliveries: the inputs they carry are delivered (CT-26).
      yield* post.turns.pipe(
        Stream.filter((turn) => turn.on),
        Stream.runForEach((turn) =>
          Effect.gen(function* () {
            const missionId = yield* missionOfSession(turn.sessionId)
            if (missionId !== null) yield* markDelivered(missionId)
          }).pipe(
            run,
            Effect.catchCause((cause) =>
              said(`the inputs of a turn were not marked delivered: ${String(cause)}`),
            ),
          ),
        ),
        Effect.forkScoped,
      )

      const runtime = yield* AgentRuntime
      yield* runtime.activity.pipe(
        Stream.runForEach(({ sessionId, event }) =>
          Effect.gen(function* () {
            if (!Predicate.isTagged(event, 'ToolCall') || event.replay) return
            const { call } = event
            const key = `${sessionId}:${call.id}`
            if (call.status === 'completed' || call.status === 'failed') {
              writes.delete(key)
              return yield* board.writing(key, null)
            }
            // Its title may come first and its arguments in a later update of the same call.
            if (call.title !== null && hemeraToolNamed(call.title) === 'spec_write_section') {
              writes.add(key)
            }
            if (!writes.has(key)) return
            const section = Option.flatMap(readSection(call.rawInput ?? ''), (input) =>
              Option.fromNullishOr(SPEC_SECTIONS.find((name) => name === input.section)),
            )
            if (Option.isNone(section)) return
            const missionId = yield* missionOfSession(sessionId)
            if (missionId === null) return
            yield* board.writing(key, { missionId, section: section.value })
          }).pipe(
            run,
            Effect.catchCause((cause) => said(`a tool call was not followed: ${String(cause)}`)),
          ),
        ),
        Effect.forkScoped,
      )

      if (settings.starts) {
        // Subscribed before anything else, so no mission created from now on is missed.
        const starts = yield* MissionStarts.use((one) => one.subscribe)
        yield* starts.pipe(
          Stream.runForEach(({ missionId }) =>
            start(missionId).pipe(
              Effect.catchCause((cause) =>
                said(`the Planner of ${missionId} did not start: ${String(cause)}`),
              ),
            ),
          ),
          Effect.forkScoped,
        )
        // `mission.started` is not written down: what a stopped engine left in Planning is picked
        // up once automations may run and the Memory is ready.
        const gate = yield* AutomationGate
        const memory = yield* Memory
        yield* gate.pass.pipe(
          Effect.andThen(memory.ready),
          Effect.andThen(
            Effect.gen(function* () {
              const database = yield* Database
              const planning = yield* database
                .select({ id: missions.id })
                .from(missions)
                .where(eq(missions.stage, 'planning'))
                .pipe(Effect.mapError(refusedWhile('reading the missions in Planning')))
              for (const mission of planning) {
                yield* start(mission.id)
                // What a stopped engine received and never handed over goes now (CT-26), and
                // what it stored for the Planner beside the inputs (a discussion closed, #87).
                const prepared = yield* prepareDeliveries(mission.id)
                const left = (yield* queuedForPlanner(mission.id)).filter(
                  (one) => !prepared.some((ready) => ready.id === one.id),
                )
                for (const one of [...left, ...prepared]) {
                  yield* deliver(mission.id, one.kind, one.body, one.id)
                }
              }
            }).pipe(run),
          ),
          Effect.catchCause((cause) =>
            said(`the missions in Planning were not picked up: ${String(cause)}`),
          ),
          Effect.forkScoped,
        )
      }

      return { deliver, start }
    }),
  )
