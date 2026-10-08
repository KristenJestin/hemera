/**
 * The setup agent's runs (#44): Hemera starts a Project's setup session when the Project is added
 * and again when the user asks for a new proposal; one at a time per Project. It is a fixed Hemera
 * phase for the cap: it waits for a slot when the cap is full, and its state says so. Its turn is
 * its proposal: once it has settled, the session ends and its slot is freed, whichever session of
 * its lineage made it. A proposal a restart interrupted ends, failed, and is not taken up again. A model or an agent that
 * cannot be had, or a lineage that keeps failing, is the Project's need (#41).
 */

import type { SetupState } from '@hemera/core/domain'
import type { UnknownProject } from '@hemera/ipc'
import { and, eq, isNull } from 'drizzle-orm'
import { Context, Effect, Layer, Schema, Stream } from 'effect'

import { DomainEvents } from '../domain-events.ts'
import { expireNeedIn } from '../needs.ts'
import { expireSessionRequestsIn } from '../permissions/requests.ts'
import { getProject } from '../projects.ts'
import { Cap } from '../sessions/cap.ts'
import { type SessionRefused, Sessions } from '../sessions/service.ts'
import { type RoleSession, endSession, getSession, sessionsIn } from '../sessions/store.ts'
import type { Secrets } from '../secrets.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import { permissionRequests, sessionNeeds } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'

/** A setup proposal asked for while one is being made. */
export class SetupBusy extends Schema.TaggedError<SetupBusy>()('SetupBusy', {}) {
  override get message(): string {
    return 'A setup proposal is already being made for this Project.'
  }
}

export interface SetupStanding {
  readonly state: SetupState
  /** What the state says in words: the cap's wait, or why it failed; null otherwise. */
  readonly sentence: string | null
}

export class Setup extends Context.Service<
  Setup,
  {
    /** Starts a setup proposal for a Project, refused while one is being made. */
    readonly start: (
      projectId: string,
    ) => Effect.Effect<RoleSession, SetupBusy | SessionRefused | DatabaseError | UnknownProject>
    /** Where the Project's setup session stands, for the new-Project screen. */
    readonly standing: (projectId: string) => Effect.Effect<SetupStanding, DatabaseError>
    /**
     * Before the sessions are rebuilt: the proposals a stopped engine left end, failed, since a
     * successor would have nobody to end it once it proposed. The user asks for a new one.
     */
    readonly endInterrupted: Effect.Effect<void, DatabaseError>
  }
>()('Setup') {}

const LIVE = ['starting', 'working', 'idle', 'stuck'] as const

/** How often a setup session waiting on the user is looked at again. */
const WAITING_LOOK = '1 second'

/** How soon a setup session whose end is being written is looked at again. */
const ENDING_LOOK = '10 millis'

/** Whether a call of the session waits on the user, or its result is still on its way to it. */
export const waitsOnUser = (sessionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const waiting = yield* database
      .select({ id: permissionRequests.id })
      .from(permissionRequests)
      .where(
        and(eq(permissionRequests.sessionId, sessionId), isNull(permissionRequests.handedOverAt)),
      )
      .limit(1)
      .pipe(Effect.mapError(refusedWhile('reading the session’s requests')))
    return waiting.length > 0
  })

/** The Project's setup sessions, the newest first. */
const setupSessionsOf = (projectId: string) =>
  Effect.map(
    sessionsIn(['starting', 'working', 'idle', 'stuck', 'ended', 'replaced', 'failed'], {
      kind: 'project',
      projectId,
    }),
    (sessions) =>
      sessions
        .filter((one) => one.role === 'setup')
        .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)),
  )

/** Why a setup a stopped engine left is not taken up again. */
export const SETUP_INTERRUPTED = 'interrupted by a restart'

export const setupLayer = Layer.effect(
  Setup,
  Effect.gen(function* () {
    const context = yield* Effect.context<Database | DomainEvents | Secrets | Sessions | Cap>()
    const sessions = yield* Sessions
    const scope = yield* Effect.scope

    /** When this engine started: a setup opened before is one a stopped engine left. */
    const startedAt = new Date().toISOString()

    /**
     * Its turns are its proposal: once it has settled and no call of its waits on the user (a
     * held read, whose result comes back as one more turn), the session ends and frees its slot.
     * A session that failed (its model, its agent) is already gone, with its need.
     */
    const proposalMade = (first: RoleSession) =>
      Effect.gen(function* () {
        let session = first
        for (;;) {
          yield* sessions.settled(session.id)
          const now = yield* getSession(session.id)
          // Replaced on the way: its successor goes on with the proposal, and is watched instead.
          if (now.state === 'replaced') {
            const next = (yield* sessionsIn([...LIVE], now.owner)).find(
              (one) => one.lineage === now.lineage,
            )
            if (next === undefined) return
            session = next
            continue
          }
          // Let go of but not yet replaced or ended: its end is being written, look again.
          if (now.state === 'starting' || now.state === 'working' || now.state === 'stuck') {
            yield* Effect.sleep(ENDING_LOOK)
            continue
          }
          if (now.state !== 'idle') return
          if (!(yield* waitsOnUser(session.id))) {
            yield* sessions.end(now.lineage, 'its proposal is made')
            return
          }
          yield* Effect.sleep(WAITING_LOOK)
        }
      })

    const watch = (session: RoleSession) =>
      proposalMade(session).pipe(
        Effect.provide(context),
        Effect.catchCause(() => Effect.void),
        Effect.forkIn(scope),
      )

    // A lineage started again after it stopped (a Retry, a setting changed, the answer to its
    // failing need) runs on a new session, which nobody watches yet: it is watched like the first.
    const committed = yield* DomainEvents.use((events) => events.subscribe)
    yield* committed.pipe(
      Stream.runForEach((event) =>
        event.type === 'session.resumed' && event.payload['role'] === 'setup'
          ? getSession(event.entityId).pipe(
              Effect.flatMap(watch),
              Effect.provide(context),
              Effect.catchCause(() => Effect.void),
            )
          : Effect.void,
      ),
      Effect.forkIn(scope),
    )

    return {
      start: (projectId) =>
        Effect.gen(function* () {
          const project = yield* getProject(projectId)
          const running = (yield* setupSessionsOf(projectId)).some((one) =>
            LIVE.some((state) => state === one.state),
          )
          if (running) return yield* new SetupBusy()
          const session = yield* sessions.open({
            owner: { kind: 'project', projectId },
            role: 'setup',
            folder: project.mainCheckout,
          })
          yield* watch(session)
          return session
        }).pipe(Effect.provide(context)),
      standing: (projectId) =>
        Effect.gen(function* () {
          const [last] = yield* setupSessionsOf(projectId)
          if (last === undefined) return { state: 'none', sentence: null } as const
          switch (last.state) {
            case 'starting': {
              const waits = yield* Cap.use((cap) => cap.waiting(last.lineage))
              return waits === null
                ? ({ state: 'working', sentence: null } as const)
                : ({ state: 'waiting', sentence: waits } as const)
            }
            case 'working':
            case 'idle':
            case 'stuck':
              return { state: 'working', sentence: null } as const
            case 'failed':
              return { state: 'failed', sentence: last.stateReason } as const
            default:
              return { state: 'done', sentence: null } as const
          }
        }).pipe(Effect.provide(context)),
      endInterrupted: Effect.gen(function* () {
        const left = (yield* sessionsIn([...LIVE])).filter(
          (one) => one.role === 'setup' && one.createdAt < startedAt,
        )
        for (const one of left) {
          // What waited on the user for it goes with it: nothing will take its answer up.
          yield* mutate('ending an interrupted setup', (transaction) =>
            Effect.gen(function* () {
              const ended = yield* endSession(transaction, one, 'failed', SETUP_INTERRUPTED)
              const requests = yield* expireSessionRequestsIn(
                transaction,
                one.id,
                SETUP_INTERRUPTED,
              )
              const held = yield* transaction
                .select({ needId: sessionNeeds.needId })
                .from(sessionNeeds)
                .where(eq(sessionNeeds.sessionId, one.id))
                .pipe(Effect.mapError(refusedWhile('reading the session’s needs')))
              const needs = yield* Effect.forEach(held, (row) =>
                expireNeedIn(transaction, row.needId, SETUP_INTERRUPTED),
              )
              return { result: undefined, events: [ended, ...requests, ...needs.flat()] }
            }),
          )
        }
      }).pipe(Effect.provide(context)),
    }
  }),
)
