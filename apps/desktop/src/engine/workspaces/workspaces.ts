/**
 * The Workspaces of a Project: planned, created, observed and cleaned up (design D8-01, D8-02,
 * D8-04, D8-14, D8-15, D8-16).
 *
 * One kind of Workspace (D8-01): `main`, one the user made on a folder of theirs, and one
 * dedicated to a Spec are rows of the same table. A dedicated one holds a worktree per included
 * repository under `<root>/<name>`, keeping the relative paths of `main`; it is created in two
 * acts that never overlap. `create` checks everything with Git first and then writes the row,
 * its worktrees' record and its steps — nothing on disk, and nothing at all when a check fails.
 * `Preparation` then makes the worktrees and runs the recipe, one step at a time.
 *
 * Git is asked outside every transaction (AGENTS.md, "Data and migrations"), and what it says of
 * a repository — its branch, its commit, its changes — is read when it is shown and never
 * stored (D8-15). A cleanup is a human's click, refused while anything still needs the
 * Workspace, and it never deletes a branch (D8-14).
 */

import { existsSync, realpathSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import {
  MAIN_WORKSPACE,
  ROOT_REPOSITORY,
  STEP_KINDS,
  STEP_STATES,
  RECIPE_SCOPES,
  WORKSPACE_STATES,
  type WorkspaceState,
  type WorkspaceStep,
  branchNameFor,
  defaultBranchPrefix,
  stepsFor,
  workspaceName,
} from '@hemera/core'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Context, Data, Effect, Layer } from 'effect'

import { Git, type GitStatus } from '../git.ts'
import type { NewEvent } from '../journal.ts'
import { UnknownProjectError } from '../projects.ts'
import { Database, DatabaseError, type EngineTransaction } from '../storage/database.ts'
import {
  commandRuns,
  projectCommands,
  projectRepositories,
  projects,
  workspaceRepositories,
  workspaceSteps,
  workspaces,
} from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { recipeOf } from './recipe.ts'

/** A Workspace was asked for by an identifier nothing answers to. */
export class UnknownWorkspaceError extends Error {
  constructor(readonly id: string) {
    super(`no Workspace has the identifier "${id}"`)
    this.name = 'UnknownWorkspaceError'
  }
}

/** What a creation checks before it writes anything (D8-04). */
export type CreationCheck = 'base' | 'branch' | 'folder' | 'name' | 'git'

/** One check failed, and the whole creation is refused, naming it (D8-04). */
export class CreationRefusedError extends Data.TaggedError('CreationRefusedError')<{
  readonly check: CreationCheck
  readonly detail: string
}> {
  override get message(): string {
    return this.detail
  }
}

/** A cleanup refused, with its reason, and nothing more removed (D8-14). */
export class CleanupRefusedError extends Data.TaggedError('CleanupRefusedError')<{
  readonly reason: string
}> {
  override get message(): string {
    return this.reason
  }
}

/** A worktree of a Workspace as it was created: what it was made on, not where it is now. */
export interface WorktreeRecord {
  readonly relativePath: string
  readonly branch: string
  readonly base: string
}

export interface WorkspaceView {
  readonly id: string
  readonly projectId: string
  readonly name: string
  readonly path: string
  /** The Spec it was made for, and null for `main` and for one made on a folder (D8-01). */
  readonly specId: string | null
  readonly state: WorkspaceState
  readonly main: boolean
  readonly createdAt: string
  readonly cleanedAt: string | null
  readonly repositories: readonly WorktreeRecord[]
}

/** One repository of the Project as the creation dialog proposes it (D8-04). */
export interface PlanRepository {
  readonly relativePath: string
  /** Whether the location holds a repository in `main`: one that does not gets no worktree. */
  readonly holdsRepository: boolean
  /** The local HEAD of that repository in `main`, and null when there is none to start from. */
  readonly base: string | null
  readonly branch: string
  readonly included: boolean
}

export interface WorkspacePlan {
  readonly name: string
  readonly root: string
  readonly path: string
  readonly branchPrefix: string
  readonly repositories: readonly PlanRepository[]
  /** False when `git` is not on the `PATH`: the plan answers, and the creation is refused. */
  readonly gitAvailable: boolean
}

/** What the creation dialog hands back once the user has edited the plan. */
export interface WorkspaceDraft {
  readonly specId: string | null
  readonly name: string
  readonly repositories: readonly WorktreeRecord[]
}

/** A repository of a Workspace as it is shown: Git's answer, or Git's own words (D8-15). */
export interface RepositoryState {
  readonly relativePath: string
  readonly git: ({ readonly ok: true } & GitStatus) | { readonly ok: false; readonly error: string }
}

export interface WorkspacesService {
  /** The Workspaces of a Project, `main` first, then in the order they were made. */
  readonly list: (projectId: string) => Effect.Effect<WorkspaceView[], DatabaseError>
  readonly one: (id: string) => Effect.Effect<WorkspaceView, DatabaseError | UnknownWorkspaceError>
  /** What a Workspace for Spec `key` named `slug` would be made of, proposed and editable. */
  readonly plan: (
    projectId: string,
    key: string,
    slug: string,
  ) => Effect.Effect<WorkspacePlan, DatabaseError | UnknownProjectError>
  /** Checks the draft with Git, then writes it `preparing` with its steps — and nothing else. */
  readonly create: (
    projectId: string,
    draft: WorkspaceDraft,
  ) => Effect.Effect<WorkspaceView, DatabaseError | CreationRefusedError | UnknownProjectError>
  /** A Workspace on a folder the user picked: `ready`, with no worktree and no step (D8-02). */
  readonly createOnFolder: (
    projectId: string,
    path: string,
    name?: string,
  ) => Effect.Effect<WorkspaceView, DatabaseError | CreationRefusedError | UnknownProjectError>
  /** Each repository's branch, commit and changes, read now and stored nowhere (D8-15). */
  readonly status: (
    id: string,
  ) => Effect.Effect<RepositoryState[], DatabaseError | UnknownWorkspaceError>
  /** Removes the worktrees and the folder, keeps the row `cleaned` and every branch (D8-14). */
  readonly cleanup: (
    id: string,
  ) => Effect.Effect<WorkspaceView, DatabaseError | UnknownWorkspaceError | CleanupRefusedError>
}

export class Workspaces extends Context.Service<Workspaces, WorkspacesService>()('Workspaces') {}

/** `<data folder>/workspaces`, under which a Project with no root of its own keeps them (D8-02). */
export class WorkspacesRoot extends Context.Service<WorkspacesRoot, string>()('WorkspacesRoot') {}

const failed = (doing: string) => (cause: unknown) => new DatabaseError({ doing, cause })

/** The state of a Workspace read from its row, which the table's check closed. */
export function workspaceStateIn(state: string): WorkspaceState {
  return WORKSPACE_STATES.find((known) => known === state) ?? 'failed'
}

/** A step of a Workspace read from its row, whose kind, scope and state the checks closed. */
export function stepOf(row: typeof workspaceSteps.$inferSelect): WorkspaceStep {
  return {
    id: row.id,
    position: row.position,
    kind: STEP_KINDS.find((kind) => kind === row.kind) ?? 'run',
    target: row.target,
    scope: RECIPE_SCOPES.find((scope) => scope === row.scope) ?? null,
    commandId: row.commandId,
    state: STEP_STATES.find((state) => state === row.state) ?? 'failed',
    message: row.message,
    runId: row.runId,
  }
}

/** The event a Workspace writes about itself, with the Project and the Spec it belongs to. */
export function workspaceEvent(
  row: { readonly id: string; readonly projectId: string; readonly specId: string | null },
  type: string,
  payload: NewEvent['payload'],
  by: 'human' | 'hemera',
): NewEvent {
  return {
    type,
    entityKind: 'workspace',
    entityId: row.id,
    source: by === 'human' ? 'ui' : 'system',
    author: by,
    projectId: row.projectId,
    specId: row.specId,
    payload: payload ?? {},
  }
}

/** A location as its label reads: `sources/api` for `./sources/api`, and `.` for the root. */
export function labelOf(relativePath: string): string {
  return relativePath.replace(/^\.\//, '')
}

export const workspacesLayer = Layer.effect(
  Workspaces,
  Effect.gen(function* () {
    const database = yield* Database
    const git = yield* Git
    const hemeraRoot = yield* WorkspacesRoot

    const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provideService(Database, database))

    const projectRow = (id: string) =>
      database
        .select()
        .from(projects)
        .where(eq(projects.id, id))
        .pipe(
          Effect.mapError(failed('reading the Project')),
          Effect.flatMap((rows) =>
            rows[0] === undefined
              ? Effect.fail(new UnknownProjectError(id))
              : Effect.succeed(rows[0]),
          ),
        )

    const workspaceRow = (id: string) =>
      database
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, id))
        .pipe(
          Effect.mapError(failed('reading the Workspace')),
          Effect.flatMap((rows) =>
            rows[0] === undefined
              ? Effect.fail(new UnknownWorkspaceError(id))
              : Effect.succeed(rows[0]),
          ),
        )

    /** The folder of `main`, which every repository of the Project is read from. */
    const mainPathOf = (projectId: string) =>
      database
        .select({ path: workspaces.path })
        .from(workspaces)
        .where(and(eq(workspaces.projectId, projectId), eq(workspaces.name, MAIN_WORKSPACE)))
        .pipe(
          Effect.mapError(failed('reading the Workspaces')),
          Effect.map((rows) => rows[0]?.path ?? ''),
        )

    /**
     * The repositories a Project declares, in their order, and whether each is included by
     * default; none declared is the root itself (D8-04), which a dedicated Workspace makes the
     * worktree of `main`.
     */
    const declaredOf = (projectId: string) =>
      database
        .select()
        .from(projectRepositories)
        .where(eq(projectRepositories.projectId, projectId))
        .orderBy(asc(projectRepositories.rank))
        .pipe(
          Effect.mapError(failed('reading the repositories')),
          Effect.map((rows) =>
            rows.length === 0
              ? [{ relativePath: ROOT_REPOSITORY, included: true }]
              : rows.map((row) => ({
                  relativePath: row.relativePath,
                  included: row.includedByDefault === 1,
                })),
          ),
        )

    const viewsOf = (rows: (typeof workspaces.$inferSelect)[]) =>
      Effect.gen(function* () {
        if (rows.length === 0) return []
        const records = yield* database
          .select()
          .from(workspaceRepositories)
          .where(
            inArray(
              workspaceRepositories.workspaceId,
              rows.map((row) => row.id),
            ),
          )
          .pipe(Effect.mapError(failed('reading the worktrees')))
        return rows.map((row): WorkspaceView => ({
          id: row.id,
          projectId: row.projectId,
          name: row.name,
          path: row.path,
          specId: row.specId,
          state: workspaceStateIn(row.state),
          main: row.name === MAIN_WORKSPACE,
          createdAt: row.createdAt,
          cleanedAt: row.cleanedAt,
          repositories: records
            .filter((record) => record.workspaceId === row.id)
            .map((record) => ({
              relativePath: record.relativePath,
              branch: record.branch,
              base: record.base,
            })),
        }))
      })

    const viewOf = (id: string) =>
      workspaceRow(id).pipe(
        Effect.flatMap((row) => viewsOf([row])),
        Effect.map((views) => views[0]!),
      )

    /** Where a Project's dedicated Workspaces are made (D8-02). */
    const rootOf = (project: typeof projects.$inferSelect) =>
      project.workspacesRoot ?? join(hemeraRoot, project.id)

    /** Whether a Workspace of this Project already has that name. */
    const nameTaken = (projectId: string, name: string) =>
      database
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(and(eq(workspaces.projectId, projectId), eq(workspaces.name, name)))
        .pipe(
          Effect.mapError(failed('reading the Workspaces')),
          Effect.map((rows) => rows.length > 0),
        )

    const refuse = (check: CreationCheck, detail: string) =>
      Effect.fail(new CreationRefusedError({ check, detail }))

    /** The name a Workspace is created with, or a refusal of the check `name`. */
    const checkedName = (projectId: string, candidate: string) =>
      Effect.gen(function* () {
        const name = yield* Effect.try({
          try: () => workspaceName(candidate),
          catch: (cause) =>
            new CreationRefusedError({
              check: 'name',
              detail: cause instanceof Error ? cause.message : String(cause),
            }),
        })
        if (yield* nameTaken(projectId, name)) {
          return yield* refuse('name', `a Workspace named ${name} already exists in this Project`)
        }
        return name
      })

    const insertWorkspace = (transaction: EngineTransaction, row: typeof workspaces.$inferInsert) =>
      transaction
        .insert(workspaces)
        .values(row)
        .pipe(Effect.mapError(failed('writing the Workspace')))

    /**
     * Refuses a cleanup, and says so in the Journal in a transaction of its own: nothing else of
     * the Workspace is written (D8-14, D8-16).
     */
    const refuseCleanup = (row: typeof workspaces.$inferSelect, reason: string) =>
      withDatabase(
        mutate('refusing a cleanup', () =>
          Effect.succeed({
            result: undefined,
            events: [workspaceEvent(row, 'workspace.cleanup_refused', { reason }, 'human')],
          }),
        ),
      ).pipe(Effect.andThen(Effect.fail(new CleanupRefusedError({ reason }))))

    return {
      list: (projectId) =>
        database
          .select()
          .from(workspaces)
          .where(eq(workspaces.projectId, projectId))
          .orderBy(asc(workspaces.createdAt))
          .pipe(
            Effect.mapError(failed('reading the Workspaces')),
            Effect.map((rows) => [
              ...rows.filter((row) => row.name === MAIN_WORKSPACE),
              ...rows.filter((row) => row.name !== MAIN_WORKSPACE),
            ]),
            Effect.flatMap(viewsOf),
          ),

      one: viewOf,

      plan: (projectId, key, slug) =>
        Effect.gen(function* () {
          const project = yield* projectRow(projectId)
          const main = yield* mainPathOf(projectId)
          const declared = yield* declaredOf(projectId)
          const branchPrefix = project.branchPrefix ?? defaultBranchPrefix(project.name)
          const branch = branchNameFor(branchPrefix, key, slug)
          // Asked once: without `git` the plan still answers, with nothing to start from, and the
          // creation is what refuses, by name (D8-03).
          const gitAvailable = yield* git.isRepository(main).pipe(
            Effect.as(true),
            Effect.catchTag('GitUnavailableError', () => Effect.succeed(false)),
          )
          const repositories = yield* Effect.forEach(declared, (location) =>
            Effect.gen(function* () {
              const folder = join(main, location.relativePath)
              const holdsRepository = gitAvailable
                ? yield* git.isRepository(folder).pipe(Effect.orElseSucceed(() => false))
                : false
              // The local HEAD and nothing fetched (D8-04); a repository with no commit yet has
              // nothing to start a branch from, and is left out.
              const base = holdsRepository
                ? yield* git.revParse(folder, 'HEAD').pipe(
                    Effect.map((commit): string | null => commit),
                    Effect.orElseSucceed(() => null),
                  )
                : null
              return {
                relativePath: location.relativePath,
                holdsRepository,
                base,
                branch,
                included: location.included && base !== null,
              } satisfies PlanRepository
            }),
          )
          const root = rootOf(project)
          return {
            name: slug,
            root,
            path: join(root, slug),
            branchPrefix,
            repositories,
            gitAvailable,
          } satisfies WorkspacePlan
        }),

      create: (projectId, draft) =>
        Effect.gen(function* () {
          const project = yield* projectRow(projectId)
          const main = yield* mainPathOf(projectId)
          const declared = yield* declaredOf(projectId)

          // Every check first, outside any transaction, and the first that fails refuses the
          // whole creation, naming it: nothing is written, on disk or in a row (D8-04).
          const holding = yield* Effect.forEach(declared, (location) =>
            git.isRepository(join(main, location.relativePath)),
          ).pipe(
            Effect.catchTag('GitUnavailableError', (missing) => refuse('git', missing.message)),
          )
          const name = yield* checkedName(projectId, draft.name)
          const path = join(rootOf(project), name)
          if (existsSync(path)) return yield* refuse('folder', `the folder ${path} already exists`)

          const worktrees: WorktreeRecord[] = []
          for (const asked of draft.repositories) {
            const index = declared.findIndex((one) => one.relativePath === asked.relativePath)
            if (index === -1 || holding[index] !== true) {
              return yield* refuse(
                'base',
                `${asked.relativePath} holds no repository of this Project in main`,
              )
            }
            const folder = join(main, asked.relativePath)
            const base = yield* git.revParse(folder, asked.base).pipe(
              Effect.catchTag('GitError', () =>
                refuse(
                  'base',
                  `the base ${asked.base} of ${asked.relativePath} does not resolve locally`,
                ),
              ),
              Effect.catchTag('GitUnavailableError', (missing) => refuse('git', missing.message)),
            )
            const taken = yield* git.branchExists(folder, asked.branch).pipe(
              Effect.catchTag('GitError', (said) => refuse('branch', said.message)),
              Effect.catchTag('GitUnavailableError', (missing) => refuse('git', missing.message)),
            )
            if (taken) {
              return yield* refuse(
                'branch',
                `a branch named ${asked.branch} already exists in ${asked.relativePath}`,
              )
            }
            // The commit it resolved to, so the record says what the worktree starts from even
            // after the reference moves.
            worktrees.push({ relativePath: asked.relativePath, branch: asked.branch, base })
          }

          // One worktree step per included repository, in the Project's order; a declared
          // location that holds no repository is a step too, skipped from the start and saying
          // why, so the user reads that nothing was made there (D8-04, D8-05).
          const bare = declared
            .filter((_, index) => holding[index] !== true)
            .map((one) => one.relativePath)
          const targets = declared
            .map((one) => one.relativePath)
            .filter(
              (location) =>
                bare.includes(location) || worktrees.some((one) => one.relativePath === location),
            )

          return yield* withDatabase(
            mutate('creating a Workspace', (transaction) =>
              Effect.gen(function* () {
                const recipe = yield* recipeOf(transaction, projectId)
                const commands = yield* transaction
                  .select({ id: projectCommands.id, name: projectCommands.name })
                  .from(projectCommands)
                  .where(eq(projectCommands.projectId, projectId))
                  .pipe(Effect.mapError(failed('reading the commands')))
                const steps = stepsFor(
                  targets,
                  recipe,
                  new Map(commands.map((command) => [command.id, command.name])),
                )

                const row = {
                  id: crypto.randomUUID(),
                  projectId,
                  name,
                  path,
                  createdAt: new Date().toISOString(),
                  specId: draft.specId,
                  state: 'preparing',
                  cleanedAt: null,
                }
                yield* insertWorkspace(transaction, row)
                if (worktrees.length > 0) {
                  yield* transaction
                    .insert(workspaceRepositories)
                    .values(
                      worktrees.map((worktree) => ({
                        id: crypto.randomUUID(),
                        workspaceId: row.id,
                        relativePath: worktree.relativePath,
                        branch: worktree.branch,
                        base: worktree.base,
                      })),
                    )
                    .pipe(Effect.mapError(failed('writing the worktrees')))
                }
                if (steps.length > 0) {
                  yield* transaction
                    .insert(workspaceSteps)
                    .values(
                      steps.map((step) => {
                        const bareLocation = step.kind === 'worktree' && bare.includes(step.target)
                        return {
                          id: crypto.randomUUID(),
                          workspaceId: row.id,
                          position: step.position,
                          kind: step.kind,
                          target: step.target,
                          scope: step.scope,
                          commandId: step.commandId,
                          state: bareLocation ? 'skipped' : step.state,
                          message: bareLocation
                            ? `${step.target} holds no repository in main`
                            : step.message,
                          runId: step.runId,
                        }
                      }),
                    )
                    .pipe(Effect.mapError(failed('writing the steps')))
                }
                return {
                  result: {
                    id: row.id,
                    projectId,
                    name,
                    path,
                    specId: draft.specId,
                    state: 'preparing',
                    main: false,
                    createdAt: row.createdAt,
                    cleanedAt: null,
                    repositories: worktrees,
                  } satisfies WorkspaceView,
                  events: [workspaceEvent(row, 'workspace.created', { name, path }, 'human')],
                }
              }),
            ),
          )
        }),

      createOnFolder: (projectId, asked, named) =>
        Effect.gen(function* () {
          yield* projectRow(projectId)
          if (!existsSync(asked) || !statSync(asked).isDirectory()) {
            return yield* refuse('folder', `the folder ${asked} does not exist`)
          }
          // As the filesystem spells it, as `main` is kept: the tools judge a path by where it
          // really is (D6-05).
          const path = realpathSync.native(asked)
          const name = yield* checkedName(projectId, named ?? basename(path))
          return yield* withDatabase(
            mutate('creating a Workspace', (transaction) =>
              Effect.gen(function* () {
                const row = {
                  id: crypto.randomUUID(),
                  projectId,
                  name,
                  path,
                  createdAt: new Date().toISOString(),
                  specId: null,
                  state: 'ready',
                  cleanedAt: null,
                }
                yield* insertWorkspace(transaction, row)
                return {
                  result: {
                    ...row,
                    state: 'ready',
                    main: false,
                    repositories: [],
                  } satisfies WorkspaceView,
                  events: [workspaceEvent(row, 'workspace.created', { name, path }, 'human')],
                }
              }),
            ),
          )
        }),

      status: (id) =>
        Effect.gen(function* () {
          const row = yield* workspaceRow(id)
          const records = yield* database
            .select()
            .from(workspaceRepositories)
            .where(eq(workspaceRepositories.workspaceId, id))
            .pipe(Effect.mapError(failed('reading the worktrees')))
          // A dedicated Workspace's worktrees; `main` and one made on a folder are read where
          // the Project declares its repositories.
          const locations =
            records.length > 0
              ? records.map((record) => record.relativePath)
              : (yield* declaredOf(row.projectId)).map((location) => location.relativePath)
          return yield* Effect.forEach(locations, (relativePath) =>
            git.status(join(row.path, relativePath)).pipe(
              Effect.map((status): RepositoryState => ({
                relativePath,
                git: { ok: true, ...status },
              })),
              // Git's own words, for this repository alone: the others show their state (D8-15).
              Effect.catch((refused) =>
                Effect.succeed({
                  relativePath,
                  git: { ok: false as const, error: refused.message },
                }),
              ),
            ),
          )
        }),

      cleanup: (id) =>
        Effect.gen(function* () {
          const row = yield* workspaceRow(id)
          if (row.name === MAIN_WORKSPACE) {
            return yield* refuseCleanup(row, `${MAIN_WORKSPACE} cannot be cleaned up`)
          }
          if (row.state === 'cleaned') {
            return yield* refuseCleanup(row, `${row.name} is already cleaned up`)
          }
          // A Workspace made on a folder of the user's has no step: that folder is theirs, and a
          // cleanup that deleted it would delete their work (D8-02, D8-14).
          const steps = yield* database
            .select({ id: workspaceSteps.id })
            .from(workspaceSteps)
            .where(eq(workspaceSteps.workspaceId, id))
            .limit(1)
            .pipe(Effect.mapError(failed('reading the steps')))
          if (steps.length === 0) {
            return yield* refuseCleanup(
              row,
              `${row.name} is a folder of yours: Hemera cleans up only the Workspaces it made`,
            )
          }
          const running = yield* database
            .select({ name: commandRuns.name })
            .from(commandRuns)
            .where(and(eq(commandRuns.workspaceId, id), eq(commandRuns.state, 'running')))
            .limit(1)
            .pipe(Effect.mapError(failed('reading the runs')))
          if (running[0] !== undefined) {
            return yield* refuseCleanup(
              row,
              `the service ${running[0].name} of ${row.name} is running`,
            )
          }
          // D8-14, D8-13: a Workspace whose build Session is not archived is refused too. No
          // Session has a mission yet — the build Session is the lot that launches builds — so
          // there is nothing to look for until then.

          const main = yield* mainPathOf(row.projectId)
          const records = yield* database
            .select()
            .from(workspaceRepositories)
            .where(eq(workspaceRepositories.workspaceId, id))
            .pipe(Effect.mapError(failed('reading the worktrees')))
          // Every worktree is checked before any is removed (D8-14): one that Git would refuse to
          // remove — changed or untracked files — refuses the whole cleanup, with nothing removed.
          // Git's words are asked of that worktree alone: `worktree remove` refuses a changed one
          // before it deletes anything, which is the very rule the check applies.
          for (const record of records) {
            const repository = join(main, record.relativePath)
            const worktree = join(row.path, record.relativePath)
            if (!existsSync(worktree)) continue
            const checked = yield* git.status(worktree).pipe(
              Effect.map((status) => ({
                dirty: status.staged + status.unstaged + status.untracked > 0,
                refused: null,
              })),
              Effect.catch((said) => Effect.succeed({ dirty: true, refused: said.message })),
            )
            if (!checked.dirty) continue
            const refused =
              checked.refused ??
              (yield* git.worktreeRemove(repository, worktree).pipe(
                Effect.as(null),
                Effect.catch((said) => Effect.succeed(said.message)),
              ))
            if (refused !== null) return yield* refuseCleanup(row, refused)
          }
          // Then one at a time, in order. Git may still refuse one for a reason of its own — a
          // locked worktree — and what it already removed stays removed, which the reason says.
          const removed: string[] = []
          for (const record of records) {
            const repository = join(main, record.relativePath)
            const worktree = join(row.path, record.relativePath)
            // A worktree never made, or removed by hand, is one Git still holds as registered:
            // forgetting it is all there is to do, and never `--force` (D8-14).
            const removal = existsSync(worktree)
              ? git.worktreeRemove(repository, worktree)
              : git.worktreePrune(repository)
            const refused = yield* removal.pipe(
              Effect.as(null),
              Effect.catch((said) => Effect.succeed(said.message)),
            )
            if (refused !== null) {
              const kept =
                removed.length === 0 ? '' : ` (already removed: ${removed.map(labelOf).join(', ')})`
              return yield* refuseCleanup(row, `${refused}${kept}`)
            }
            removed.push(record.relativePath)
          }
          const deleted = yield* Effect.try({
            try: () => rmSync(row.path, { recursive: true, force: true }),
            catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
          }).pipe(
            Effect.as(null),
            Effect.catch((reason) => Effect.succeed(reason)),
          )
          if (deleted !== null) return yield* refuseCleanup(row, deleted)

          const cleanedAt = new Date().toISOString()
          yield* withDatabase(
            mutate('cleaning up a Workspace', (transaction) =>
              transaction
                .update(workspaces)
                .set({ state: 'cleaned', cleanedAt })
                .where(eq(workspaces.id, id))
                .pipe(
                  Effect.mapError(failed('writing the Workspace')),
                  Effect.as({
                    result: undefined,
                    events: [workspaceEvent(row, 'workspace.cleaned', { path: row.path }, 'human')],
                  }),
                ),
            ),
          )
          return yield* viewOf(id)
        }),
    } satisfies WorkspacesService
  }),
)
