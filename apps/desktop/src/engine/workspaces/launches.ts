/**
 * Starting a build: the Spec asked for, the Workspace waited for, the Session that runs it
 * (design D8-13 of #20, and the button of D8-12 that asks for it).
 *
 * A launch is a row of its own, written before anything runs: `waiting`, on the revision the Spec
 * stood on when it was asked for and on the Workspace the user chose. Nothing else is made to
 * wait — a build Session does not wait for an environment (D8-13) — and the Journal says when it
 * was asked for.
 *
 * The Workspace becomes ready when its preparation writes its last step, and that is what starts
 * a launch waiting on it: the build Session is created on the launch's revision, in that
 * Workspace, with the Spec of that revision rendered as its brief in its thread, and the agent
 * the Spec's writer Session runs is started in the Workspace's folder (D8-09: started is what the
 * agent's own handshake answered). A start that fails says `failed` with what the agent answered
 * and stays on screen, and `retry` starts that same Session's agent again without touching the
 * Workspace or its steps.
 *
 * The window asks for none of it yet: this lot names no channel — no ipc — so what answers a
 * `request` today is the preparation's last step alone.
 */

import {
  AGENT_PROVIDERS,
  type EmptyTitleError,
  type NoAgentError,
  LAUNCH_STATES,
  type LaunchState,
  NEW_SESSION_TITLE,
  type Spec,
  WORKSPACE_STATES,
  focusOf,
  renderSpecMarkdown,
} from '@hemera/core'
import { type SQL, and, eq } from 'drizzle-orm'
import { Context, Data, Effect, Layer, Result } from 'effect'

import { AgentRuntime } from '../agents/runtime.ts'
import { type InvalidCursorError, type NewEvent } from '../journal.ts'
import { Preferences } from '../preferences.ts'
import { Sessions, type UnknownSessionError, WorkspaceNotReadyError } from '../sessions.ts'
import {
  UnknownRevisionError,
  type UnknownSpecError,
  failed,
  now,
  readSnapshot,
  reading,
} from '../specs/snapshot.ts'
import { Database, type DatabaseError } from '../storage/database.ts'
import {
  buildLaunches,
  sessions as sessionRows,
  specRevisions,
  specs,
  workspaces,
} from '../storage/schema.ts'
import { type Mutation, type StaleVersionError, mutate } from '../transaction.ts'
import { UnknownWorkspaceError } from './described.ts'

/** One launch as the interface reads it: the Spec, the revision, the Workspace, the build. */
export interface LaunchView {
  readonly id: string
  readonly specId: string
  readonly revisionId: string
  readonly workspaceId: string | null
  readonly state: LaunchState
  readonly sessionId: string | null
  /** What refused it, as it was said; null while nothing did (D8-13). */
  readonly detail: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/** A launch nothing answers to. */
export class UnknownLaunchError extends Data.TaggedError('UnknownLaunchError')<{
  readonly id: string
}> {
  override get message(): string {
    return `no launch has the identifier "${this.id}"`
  }
}

/** What a launch is refused with: a Spec that is not ready, or one that did not fail. */
export class LaunchRefusedError extends Data.TaggedError('LaunchRefusedError')<{
  readonly reason: string
}> {
  override get message(): string {
    return this.reason
  }
}

/** Everything reading, asking for or retrying a launch can be answered with. */
export type LaunchRefusal =
  | DatabaseError
  | StaleVersionError
  | UnknownSessionError
  | UnknownSpecError
  | UnknownRevisionError
  | UnknownWorkspaceError
  | WorkspaceNotReadyError
  | EmptyTitleError
  | InvalidCursorError
  | NoAgentError
  | UnknownLaunchError
  | LaunchRefusedError

export interface LaunchesService {
  readonly one: (id: string) => Effect.Effect<LaunchView, LaunchRefusal>
  /** Asks for a build of a ready Spec in a Workspace: `waiting`, or started at once if it is ready. */
  readonly request: (
    specId: string,
    workspaceId: string,
  ) => Effect.Effect<LaunchView, LaunchRefusal>
  /** A Workspace that just became ready: what was waiting on it starts there (D8-13). */
  readonly workspaceReady: (workspaceId: string) => Effect.Effect<void, LaunchRefusal>
  /** Starts a build that failed, again: its Session, its revision and its Workspace stand. */
  readonly retry: (id: string) => Effect.Effect<LaunchView, LaunchRefusal>
}

export class Launches extends Context.Service<Launches, LaunchesService>()('Launches') {}

/** What the Journal says of a launch: the entity is the launch itself (D8-16). */
function launchEvent(
  launch: { readonly id: string; readonly specId: string; readonly revisionId: string },
  projectId: string,
  type: string,
  payload: Record<string, string | null>,
  author: 'human' | 'hemera',
): NewEvent {
  return {
    type,
    entityKind: 'launch',
    entityId: launch.id,
    source: author === 'human' ? 'ui' : 'system',
    author,
    projectId,
    payload: { specId: launch.specId, revisionId: launch.revisionId, ...payload },
  }
}

export const launchesLayer = Layer.effect(
  Launches,
  Effect.gen(function* () {
    const database = yield* Database
    const sessions = yield* Sessions
    const preferences = yield* Preferences
    const runtime = yield* AgentRuntime

    const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provideService(Database, database))

    /** A row of the table as the interface reads it: what the column holds, and no more. */
    const viewOf = (row: typeof buildLaunches.$inferSelect): LaunchView => ({
      id: row.id,
      specId: row.specId,
      revisionId: row.revisionId,
      workspaceId: row.workspaceId,
      // The column is checked against `LAUNCH_STATES`; this is only the narrowing a reader needs.
      state: LAUNCH_STATES.find((known) => known === row.state) ?? 'waiting',
      sessionId: row.sessionId,
      detail: row.detail,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })

    const read = (doing: string, where: SQL<unknown> | undefined) =>
      withDatabase(
        reading(doing, (transaction) =>
          transaction
            .select()
            .from(buildLaunches)
            .where(where)
            .pipe(Effect.mapError(failed(doing))),
        ),
      )

    const one = (id: string) =>
      Effect.gen(function* () {
        const rows = yield* read('reading the launch', eq(buildLaunches.id, id))
        const row = rows[0]
        if (row === undefined) return yield* Effect.fail(new UnknownLaunchError({ id }))
        return viewOf(row)
      })

    /** The Spec as it stands now, read through the one reader of a revision (D7-05). */
    const readSpec = (specId: string) =>
      withDatabase(reading('reading the Spec', (transaction) => readSnapshot(transaction, specId)))

    /**
     * The Spec as it stood on the revision a launch names: a build gets what it was launched on,
     * even when the Spec has moved on since (D8-13).
     */
    const readLaunched = (specId: string, revisionId: string) =>
      withDatabase(
        reading('reading the revision the launch names', (transaction) =>
          Effect.gen(function* () {
            const found = yield* transaction
              .select({ key: specs.key, number: specRevisions.number })
              .from(specRevisions)
              .innerJoin(specs, eq(specs.id, specRevisions.specId))
              .where(eq(specRevisions.id, revisionId))
              .pipe(Effect.mapError(failed('reading the revision the launch names')))
            const revision = found[0]
            if (revision === undefined) {
              return yield* Effect.fail(new UnknownRevisionError({ key: specId, number: 0 }))
            }
            return yield* readSnapshot(transaction, specId, revision.number)
          }),
        ),
      )

    /**
     * The agent of a build: the one the Spec's writer Session runs, or the one the Project was
     * left on when nothing is writing yet (D8-13). Never a third place to look, and a Project
     * left on nothing is refused rather than guessed at.
     */
    const agentOf = (spec: Spec) =>
      Effect.gen(function* () {
        if (spec.writerSessionId !== null) {
          const writer = yield* sessions.one(spec.writerSessionId)
          if (writer.session.provider !== null) {
            return { provider: writer.session.provider, model: writer.session.model }
          }
        }
        const remembered = (yield* preferences.read).composers[spec.projectId]
        const provider = AGENT_PROVIDERS.find((known) => known === remembered?.provider)
        if (provider === undefined) {
          return yield* Effect.fail(
            new LaunchRefusedError({
              reason:
                'no agent has been chosen for this Project: choose one in the composer, then start the build.',
            }),
          )
        }
        return { provider, model: null }
      })

    /**
     * What the agent answered, and what the launch says of it (D8-09): `started`, or `failed`
     * with what it said. The Session and the Workspace it was given stay either way, which is
     * what `retry` starts again.
     */
    const settled = (launch: LaunchView, sessionId: string, projectId: string) =>
      Effect.gen(function* () {
        const handshake = yield* Effect.result(runtime.start(sessionId))
        const at = now()
        const answered: LaunchView = Result.isSuccess(handshake)
          ? { ...launch, state: 'started', sessionId, detail: null, updatedAt: at }
          : {
              ...launch,
              state: 'failed',
              sessionId,
              detail: handshake.failure.message,
              updatedAt: at,
            }
        const type = Result.isSuccess(handshake) ? 'launch.started' : 'launch.failed'
        const said = Result.isSuccess(handshake)
          ? { sessionId }
          : { sessionId, reason: handshake.failure.message }
        return yield* withDatabase(
          mutate('saying how the build started', (transaction) =>
            Effect.gen(function* () {
              yield* transaction
                .update(buildLaunches)
                .set({ state: answered.state, detail: answered.detail, updatedAt: at })
                .where(eq(buildLaunches.id, launch.id))
                .pipe(Effect.mapError(failed('writing the launch')))
              return {
                result: answered,
                events: [
                  launchEvent(
                    { id: launch.id, specId: launch.specId, revisionId: launch.revisionId },
                    projectId,
                    type,
                    said,
                    'hemera',
                  ),
                ],
              } satisfies Mutation<LaunchView>
            }),
          ),
        )
      })

    /**
     * The build itself: the Session on the launch's revision, its brief, then the agent.
     *
     * The Session is written in the transaction that says `starting`, before the agent is asked:
     * a start that fails is started again on that same Session, so it has to be there first, and
     * its row carries the revision and the Workspace for good (D8-13).
     */
    const start = (asked: LaunchView) =>
      Effect.gen(function* () {
        const snapshot = yield* readLaunched(asked.specId, asked.revisionId)
        const projectId = snapshot.spec.projectId
        const agent = yield* agentOf(snapshot.spec)
        const sessionId = crypto.randomUUID()
        const starting = yield* withDatabase(
          mutate('starting the build', (transaction) =>
            Effect.gen(function* () {
              // The launch is claimed here, in the very transaction that writes the Session: the
              // request and the Workspace becoming ready can both arrive, and a build is started
              // once — whoever reads it `waiting` is the one that starts it (D8-13).
              const rows = yield* transaction
                .select()
                .from(buildLaunches)
                .where(eq(buildLaunches.id, asked.id))
                .pipe(Effect.mapError(failed('reading the launch')))
              const row = rows[0]
              if (row === undefined) {
                return yield* Effect.fail(new UnknownLaunchError({ id: asked.id }))
              }
              if (row.state !== 'waiting') {
                return { result: viewOf(row), events: [] } satisfies Mutation<LaunchView>
              }
              const at = now()
              yield* transaction
                .insert(sessionRows)
                .values({
                  id: sessionId,
                  projectId,
                  title: NEW_SESSION_TITLE,
                  titleSource: 'derived',
                  provider: agent.provider,
                  model: agent.model,
                  mission: 'build',
                  specId: row.specId,
                  revisionId: row.revisionId,
                  workspaceId: row.workspaceId,
                  createdAt: at,
                  lastWrittenAt: at,
                })
                .pipe(Effect.mapError(failed('writing the build Session')))
              yield* transaction
                .update(buildLaunches)
                .set({ state: 'starting', sessionId, detail: null, updatedAt: at })
                .where(eq(buildLaunches.id, row.id))
                .pipe(Effect.mapError(failed('writing the launch')))
              return {
                result: {
                  ...viewOf(row),
                  state: 'starting' as const,
                  sessionId,
                  detail: null,
                  updatedAt: at,
                },
                events: [
                  {
                    type: 'session.created',
                    entityKind: 'session',
                    entityId: sessionId,
                    source: 'system',
                    author: 'hemera',
                    projectId,
                    sessionId,
                    payload: {
                      title: NEW_SESSION_TITLE,
                      mission: 'build',
                      specId: row.specId,
                      revisionId: row.revisionId,
                      workspaceId: row.workspaceId,
                    },
                  },
                ],
              } satisfies Mutation<LaunchView>
            }),
          ),
        )
        // Another starter — a request and the Workspace becoming ready at once — took the launch
        // between the two reads: what it said of the build is not this caller's to say again.
        if (starting.state !== 'starting') return starting
        // What the build is given: the Spec as it stood on the revision the launch names, folded
        // in its thread as the brief the window reads (3a's renderer, D7-09).
        yield* sessions
          .write(sessionId, {
            role: 'hemera',
            kind: 'mission_brief',
            body: renderSpecMarkdown(snapshot),
            payload: JSON.stringify({ phase: focusOf(snapshot.phases) }),
          })
          .pipe(Effect.asVoid)
        return yield* settled(starting, sessionId, projectId)
      })

    /** A Workspace that just became ready: every launch that waited on it starts, oldest first. */
    const workspaceReady = (workspaceId: string) =>
      Effect.gen(function* () {
        const waiting = yield* read(
          'reading the launches that wait',
          and(eq(buildLaunches.workspaceId, workspaceId), eq(buildLaunches.state, 'waiting')),
        )
        yield* Effect.forEach(waiting, (row) => start(viewOf(row)).pipe(Effect.asVoid), {
          discard: true,
        })
      })

    return {
      one,
      request: (specId, workspaceId) =>
        Effect.gen(function* () {
          const snapshot = yield* readSpec(specId)
          if (snapshot.spec.status !== 'ready') {
            return yield* Effect.fail(
              new LaunchRefusedError({
                reason: `"${snapshot.spec.key}" is ${snapshot.spec.status}: only a ready Spec is built.`,
              }),
            )
          }
          // The Workspace is read as its row stands, as a Session's own check reads it (D8-08):
          // what this lot decides on is existence and state, and a Workspace being prepared is
          // exactly what a launch waits for.
          const found = yield* withDatabase(
            reading('reading the Workspace', (transaction) =>
              transaction
                .select({ name: workspaces.name, state: workspaces.state })
                .from(workspaces)
                .where(
                  and(
                    eq(workspaces.id, workspaceId),
                    eq(workspaces.projectId, snapshot.spec.projectId),
                  ),
                )
                .pipe(Effect.mapError(failed('reading the Workspace'))),
            ),
          )
          const chosen = found[0]
          if (chosen === undefined) {
            return yield* Effect.fail(new UnknownWorkspaceError(workspaceId))
          }
          const state = WORKSPACE_STATES.find((known) => known === chosen.state)
          // Nothing will make a cleaned up or failed Workspace ready: a launch on one would wait
          // for nothing, so it is refused as a Session's own check refuses it.
          if (state === undefined || state === 'cleaned' || state === 'failed') {
            return yield* Effect.fail(new WorkspaceNotReadyError(chosen.name, chosen.state))
          }
          const launch = yield* withDatabase(
            mutate('asking for a build', (transaction) =>
              Effect.gen(function* () {
                const id = crypto.randomUUID()
                const at = now()
                yield* transaction
                  .insert(buildLaunches)
                  .values({
                    id,
                    specId,
                    revisionId: snapshot.revision.id,
                    workspaceId,
                    state: 'waiting',
                    createdAt: at,
                    updatedAt: at,
                  })
                  .pipe(Effect.mapError(failed('writing the launch')))
                // The Spec is given this Workspace: what the interface shows of a Spec's build,
                // and the Workspace the next launch proposes, read it from the Spec (D8-12).
                yield* transaction
                  .update(specs)
                  .set({ workspaceId, updatedAt: at })
                  .where(eq(specs.id, specId))
                  .pipe(Effect.mapError(failed('writing the Workspace of the Spec')))
                return {
                  result: {
                    id,
                    specId,
                    revisionId: snapshot.revision.id,
                    workspaceId,
                    state: 'waiting' as const,
                    sessionId: null,
                    detail: null,
                    createdAt: at,
                    updatedAt: at,
                  },
                  events: [
                    launchEvent(
                      { id, specId, revisionId: snapshot.revision.id },
                      snapshot.spec.projectId,
                      'launch.requested',
                      { workspaceId },
                      'human',
                    ),
                  ],
                } satisfies Mutation<LaunchView>
              }),
            ),
          )
          // A Workspace already ready has nothing to wait for: the build starts now.
          if (state !== 'ready') return launch
          return yield* start(launch)
        }),

      retry: (id) =>
        Effect.gen(function* () {
          const launch = yield* one(id)
          if (launch.state !== 'failed' || launch.sessionId === null) {
            return yield* Effect.fail(
              new LaunchRefusedError({
                reason: 'only a build whose agent failed is started again.',
              }),
            )
          }
          const snapshot = yield* readLaunched(launch.specId, launch.revisionId)
          const starting = yield* withDatabase(
            mutate('starting the build again', (transaction) =>
              Effect.gen(function* () {
                const at = now()
                yield* transaction
                  .update(buildLaunches)
                  .set({ state: 'starting', detail: null, updatedAt: at })
                  .where(eq(buildLaunches.id, launch.id))
                  .pipe(Effect.mapError(failed('writing the launch')))
                return {
                  result: { ...launch, state: 'starting' as const, detail: null, updatedAt: at },
                  events: [],
                } satisfies Mutation<LaunchView>
              }),
            ),
          )
          return yield* settled(starting, launch.sessionId, snapshot.spec.projectId)
        }),

      workspaceReady,
    } satisfies LaunchesService
  }),
)
