/**
 * The Workspaces of a Project: made, read, observed and removed.
 *
 * A Workspace is the isolated folder where a mission's code is built: one Git worktree per
 * repository the caller chose, at `<Workspaces root>/<name>/<repository path>`, either on a new
 * branch `<branch prefix>/<name>` made from each repository's up-to-date base, or on a detached
 * HEAD at a commit given for each repository, in a folder of the caller's. The main checkout is
 * a Workspace-like place too, read-only: its repositories as they are.
 *
 * A creation checks everything first (the name, the folder, the repositories, the bases, Git) and
 * then writes the record and its preparation's steps (its worktrees, then the Project's recipe as
 * it is now) in one transaction, and nothing on disk: the preparation makes the worktrees
 * (`preparation.ts`). What Git says of a worktree is read when asked and never stored, but the
 * commit each one was made from, and the ref and freshness it was read at, are recorded.
 *
 * A removal never loses work: it refuses a worktree with uncommitted or untracked files, naming
 * one, and a folder a program holds, and only then asks Git to remove each worktree.
 */

import { existsSync, lstatSync, renameSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

import {
  MAIN_CHECKOUT_NAME,
  ROOT_REPOSITORY,
  type StepKind,
  type StepState,
  STEP_KINDS,
  STEP_STATES,
  type TemplateValues,
  defaultBranchPrefix,
  preparationStateOf,
  workspaceBranch,
  workspaceName,
} from '@hemera/core/domain'
import {
  BaseFreshness,
  type GitMissing,
  type NewWorkspace,
  type PreparationStep,
  type Project,
  RemovalRefused,
  type Repository,
  UnknownRepository,
  UnknownWorkspace,
  type Workspace,
  type WorkspaceBase,
  type WorkspaceChange,
  type WorkspaceRepositoryStatus,
  WorkspaceRefused,
  type WorktreeState,
  WorktreeNotMade,
  WorktreeRead,
  WorktreeUnreadable,
} from '@hemera/ipc'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Context, Effect, Layer, Match, Option, Result, Schema, Stream } from 'effect'
import type { Scope } from 'effect'

import type { Log } from '../main/diagnostic.ts'
import { type Secrets, unregisterWorkspace } from './secrets.ts'
import { DomainEvents } from './domain-events.ts'
import { Git, type GitRefusal } from './git.ts'
import type { DomainEvent, EventPayload, NewEvent } from './journal.ts'
import { ProfileHome } from './profile-home.ts'
import { canonical, getProject, within } from './projects.ts'
import { type ProjectServices, upToDateBase } from './repositories.ts'
import type { RecipeRunner } from './recipe-runner.ts'
import { Database, type DatabaseError, refusedWhile } from './storage/database.ts'
import {
  projectPreparationSteps,
  workspaceRepositories,
  workspaceSteps,
  workspaces,
} from './storage/schema.ts'
import { mutate } from './transaction.ts'

/**
 * The Workspaces whose preparation, or removal, runs in this engine now, and the engine's scope a
 * preparation runs on in once a call has started it. In memory, which is enough: one engine holds
 * a data folder, so a step a later start finds `running` is one a stopped engine left.
 */
export class Preparations extends Context.Service<
  Preparations,
  {
    /** Takes a Workspace for this engine, and answers false when it is already taken. */
    readonly hold: (id: string) => Effect.Effect<boolean>
    readonly release: (id: string) => Effect.Effect<void>
    readonly held: (id: string) => boolean
    readonly scope: Scope.Scope
    /** Where a preparation run on in the background says what refused it. */
    readonly log: Log
  }
>()('Preparations') {}

export const preparationsLayer = (log: Log) =>
  Layer.effect(
    Preparations,
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const taken = new Set<string>()
      return {
        hold: (id) =>
          Effect.sync(() => {
            if (taken.has(id)) return false
            taken.add(id)
            return true
          }),
        release: (id) =>
          Effect.sync(() => {
            taken.delete(id)
          }),
        held: (id) => taken.has(id),
        scope,
        log,
      }
    }),
  )

/** What the calls on Workspaces, their recipe and their variables stand on. */
export type WorkspaceServices =
  | ProjectServices
  | ProfileHome
  | Preparations
  | RecipeRunner
  | Secrets

/** The folder Hemera keeps Workspaces in when a Project chose none, under its data folder. */
export const WORKSPACES_FOLDER = 'workspaces'

/** Where a Project's Workspaces are made: its own root, or Hemera's folder for it. */
export const workspacesRootOf = (dataFolder: string, project: Project): string =>
  project.workspacesRoot ?? join(dataFolder, WORKSPACES_FOLDER, project.id)

/** A repository's worktree in a Workspace: at the same relative place as in the main checkout. */
export const worktreeOf = (folder: string, path: string): string =>
  path === ROOT_REPOSITORY ? folder : join(folder, path)

type WorkspaceRow = typeof workspaces.$inferSelect
type WorktreeRow = typeof workspaceRepositories.$inferSelect
type StepRow = typeof workspaceSteps.$inferSelect

const readFreshness = Schema.decodeUnknownOption(Schema.fromJsonString(BaseFreshness))
const writeFreshness = Schema.encodeSync(Schema.fromJsonString(BaseFreshness))

const baseOf = (row: WorktreeRow): WorkspaceBase => ({
  commit: row.baseCommit,
  ref: row.baseRef,
  freshness: row.baseFreshness === null ? null : Option.getOrNull(readFreshness(row.baseFreshness)),
})

const stepKind = (kind: string): StepKind => STEP_KINDS.find((one) => one === kind) ?? 'run'
const stepState = (state: string): StepState => STEP_STATES.find((one) => one === state) ?? 'failed'

export const stepOf = (row: StepRow): PreparationStep => ({
  id: row.id,
  position: row.position,
  kind: stepKind(row.kind),
  base: row.base,
  path: row.path,
  commandId: row.commandId,
  line: row.line,
  state: stepState(row.state),
  failure:
    row.failedDoing === null || row.failedOutput === null
      ? null
      : { doing: row.failedDoing, output: row.failedOutput },
})

/** The Workspaces asked for, each with its worktrees and its steps in order. */
const readWorkspaces = (rows: ReadonlyArray<WorkspaceRow>) =>
  Effect.gen(function* () {
    if (rows.length === 0) return []
    const database = yield* Database
    const preparations = yield* Preparations
    const ids = rows.map((row) => row.id)
    const worktrees = yield* database
      .select()
      .from(workspaceRepositories)
      .where(inArray(workspaceRepositories.workspaceId, ids))
      .orderBy(asc(workspaceRepositories.position))
      .pipe(Effect.mapError(refusedWhile('reading the worktrees')))
    const steps = yield* database
      .select()
      .from(workspaceSteps)
      .where(inArray(workspaceSteps.workspaceId, ids))
      .orderBy(asc(workspaceSteps.position))
      .pipe(Effect.mapError(refusedWhile('reading the preparation')))
    return rows.map((row): Workspace => {
      const own = steps.filter((step) => step.workspaceId === row.id).map(stepOf)
      return {
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        folder: row.folder,
        branch: row.branch,
        createdAt: row.createdAt,
        preparation: preparationStateOf(own),
        preparing: preparations.held(row.id),
        repositories: worktrees
          .filter((worktree) => worktree.workspaceId === row.id)
          .map((worktree) => ({
            repositoryId: worktree.repositoryId,
            path: worktree.path,
            worktree: worktree.worktree,
            base: baseOf(worktree),
          })),
        steps: own,
      }
    })
  })

export const getWorkspace = (
  id: string,
): Effect.Effect<Workspace, DatabaseError | UnknownWorkspace, Database | Preparations> =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, id))
      .pipe(Effect.mapError(refusedWhile('reading the Workspace')))
    const [workspace] = yield* readWorkspaces(rows)
    if (workspace === undefined) return yield* new UnknownWorkspace({ id })
    return workspace
  })

/** Every Workspace of every Project, in the order they were made. */
export const readAllWorkspaces = Effect.gen(function* () {
  const database = yield* Database
  const rows = yield* database
    .select()
    .from(workspaces)
    .orderBy(asc(workspaces.createdAt), asc(workspaces.id))
    .pipe(Effect.mapError(refusedWhile('reading the Workspaces')))
  return yield* readWorkspaces(rows)
})

/** A Project's Workspaces, in the order they were made. */
export const listWorkspaces = (projectId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(workspaces)
      .where(eq(workspaces.projectId, projectId))
      .orderBy(asc(workspaces.createdAt), asc(workspaces.id))
      .pipe(Effect.mapError(refusedWhile('reading the Workspaces')))
    return yield* readWorkspaces(rows)
  })

/** Where a Workspace, or the main checkout, runs: what its templates and commands are given. */
export interface Place {
  readonly project: Project
  /** Null for the main checkout. */
  readonly workspace: Workspace | null
  readonly name: string
  readonly folder: string
  readonly branch: string | null
}

/** The main checkout as a place: read-only, its repositories as they are. */
export const mainCheckoutPlace = (project: Project): Place => ({
  project,
  workspace: null,
  name: MAIN_CHECKOUT_NAME,
  folder: project.mainCheckout,
  branch: null,
})

/** The Workspace asked for, or the main checkout for null, as a place things run in. */
export const placeOf = (projectId: string, workspaceId: string | null) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    if (workspaceId === null) return mainCheckoutPlace(project)
    const workspace = yield* getWorkspace(workspaceId)
    if (workspace.projectId !== projectId) return yield* new UnknownWorkspace({ id: workspaceId })
    return {
      project,
      workspace,
      name: workspace.name,
      folder: workspace.folder,
      branch: workspace.branch,
    } satisfies Place
  })

/** What `{workspace}`, `{workspace.path}`, `{project}` and `{branch}` are in a place. */
export const templateValuesOf = (place: Place): TemplateValues => ({
  workspace: place.name,
  'workspace.path': place.folder,
  project: defaultBranchPrefix(place.project.name),
  branch: place.branch ?? '',
})

const refused = (reason: string) => Effect.fail(new WorkspaceRefused({ reason }))

/** Git's refusal as the reason a creation gives; a missing Git is refused as itself. */
const saidByGit = <A>(asked: Effect.Effect<A, GitRefusal>) =>
  asked.pipe(
    Effect.catchTags({
      GitFailed: (refusal) => refused(refusal.message),
      GitCut: (cut) => refused(cut.message),
    }),
  )

/** A worktree about to be recorded. */
interface PlannedWorktree {
  readonly repository: Repository
  readonly worktree: string
  readonly base: WorkspaceBase
}

/** The repositories asked for, in the Project's order, the main checkout's own one first. */
const chosen = (project: Project, asked: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (asked.length === 0) return yield* refused('no repository was chosen')
    for (const id of asked) {
      if (!project.repositories.some((one) => one.id === id)) {
        return yield* new UnknownRepository({ id })
      }
    }
    const picked = project.repositories.filter((one) => asked.includes(one.id))
    // A worktree of the root holds the others' folders: it is made first, removed last.
    return [
      ...picked.filter((one) => one.path === ROOT_REPOSITORY),
      ...picked.filter((one) => one.path !== ROOT_REPOSITORY),
    ]
  })

/** Refuses a name another Workspace of the Project has. */
const nameFree = (projectId: string, name: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const found = yield* database
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.projectId, projectId), eq(workspaces.name, name)))
      .pipe(Effect.mapError(refusedWhile('reading the Workspaces')))
    if (found.length > 0) return yield* refused(`a Workspace named ${name} already exists`)
  })

/** The recipe as it is now, as the steps a Workspace's preparation copies of it. */
const recipeSnapshot = (project: Project) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(projectPreparationSteps)
      .where(eq(projectPreparationSteps.projectId, project.id))
      .orderBy(asc(projectPreparationSteps.position))
      .pipe(Effect.mapError(refusedWhile('reading the recipe')))
    return rows.map((row) => ({
      kind: row.kind,
      base:
        row.repositoryId === null
          ? null
          : (project.repositories.find((one) => one.id === row.repositoryId)?.path ?? null),
      path: row.path,
      commandId: row.commandId,
      line: row.line,
    }))
  })

const workspaceEvent = (
  type: string,
  row: { readonly id: string; readonly projectId: string },
  payload: EventPayload,
  by: 'human' | 'hemera',
): NewEvent => ({
  type,
  entityKind: 'workspace',
  entityId: row.id,
  source: by === 'human' ? 'ui' : 'system',
  author: by,
  payload: { projectId: row.projectId, ...payload },
})

export { workspaceEvent }

/**
 * A Workspace made over the repositories chosen: checked, then recorded with its preparation's
 * steps, and nothing made on disk yet.
 */
/** Where a Workspace is made, on which branch, and from which commit each worktree starts. */
interface Plan {
  readonly folder: string
  readonly branch: string | null
  readonly worktrees: ReadonlyArray<PlannedWorktree>
}

/** Worktrees on `<branch prefix>/<name>`, each from its repository's up-to-date base. */
const onNewBranch = (project: Project, name: string, repositories: ReadonlyArray<Repository>) =>
  Effect.gen(function* () {
    const git = yield* Git
    const { dataFolder } = yield* ProfileHome
    const folder = join(workspacesRootOf(dataFolder, project), name)
    const branch = yield* Effect.fromResult(
      workspaceBranch(project.branchPrefix ?? defaultBranchPrefix(project.name), name),
    )
    if (existsSync(folder)) return yield* refused(`the folder ${folder} already exists`)
    const worktrees: PlannedWorktree[] = []
    for (const repository of repositories) {
      const source = join(project.mainCheckout, repository.path)
      const there = yield* saidByGit(git.commitOf(source, `refs/heads/${branch}`))
      if (Option.isSome(there)) {
        return yield* refused(`the branch ${branch} already exists in ${repository.path}`)
      }
      const base = yield* upToDateBase(repository.id)
      worktrees.push({
        repository,
        worktree: worktreeOf(folder, repository.path),
        base: { commit: base.commit, ref: base.ref, freshness: base.freshness },
      })
    }
    return { folder, branch, worktrees } satisfies Plan
  })

/** Worktrees on a detached HEAD in the caller's folder, each at the commit given for it. */
const detachedAt = (
  project: Project,
  repositories: ReadonlyArray<Repository>,
  asked: { readonly folder: string; readonly commits: Readonly<Record<string, string>> },
) =>
  Effect.gen(function* () {
    const git = yield* Git
    if (!isAbsolute(asked.folder)) {
      return yield* refused(`the folder ${asked.folder} is not an absolute path`)
    }
    const folder = resolve(asked.folder)
    if (existsSync(folder)) return yield* refused(`the folder ${folder} already exists`)
    if (within(canonical(project.mainCheckout), canonical(folder))) {
      return yield* refused(`the folder ${folder} is inside the main checkout`)
    }
    const worktrees: PlannedWorktree[] = []
    for (const repository of repositories) {
      const given = asked.commits[repository.id]
      if (given === undefined) return yield* refused(`no commit was given for ${repository.path}`)
      const source = join(project.mainCheckout, repository.path)
      const commit = yield* saidByGit(git.commitOf(source, given))
      if (Option.isNone(commit)) {
        return yield* refused(`${given} is not a commit of ${repository.path}`)
      }
      worktrees.push({
        repository,
        worktree: worktreeOf(folder, repository.path),
        base: { commit: commit.value, ref: null, freshness: null },
      })
    }
    return { folder, branch: null, worktrees } satisfies Plan
  })

/**
 * A Workspace made over the repositories chosen: checked, then recorded with its preparation's
 * steps, and nothing made on disk yet.
 */
export const createWorkspace = (asked: NewWorkspace) =>
  Effect.gen(function* () {
    const project = yield* getProject(asked.projectId)
    const name = yield* Effect.fromResult(workspaceName(asked.name))
    const repositories = yield* chosen(project, asked.repositories)
    yield* nameFree(project.id, name)
    const {
      folder,
      branch,
      worktrees: planned,
    } = yield* Match.value(asked.mode).pipe(
      Match.tagsExhaustive({
        NewBranch: () => onNewBranch(project, name, repositories),
        DetachedAt: (mode) => detachedAt(project, repositories, mode),
      }),
    )

    const recipe = yield* recipeSnapshot(project)
    const id = crypto.randomUUID()
    const at = new Date().toISOString()
    yield* mutate('making a Workspace', (transaction) =>
      Effect.gen(function* () {
        yield* transaction
          .insert(workspaces)
          .values({ id, projectId: project.id, name, folder, branch, createdAt: at })
          .pipe(Effect.mapError(refusedWhile('writing the Workspace')))
        yield* transaction
          .insert(workspaceRepositories)
          .values(
            planned.map((one, rank) => ({
              id: crypto.randomUUID(),
              workspaceId: id,
              repositoryId: one.repository.id,
              path: one.repository.path,
              worktree: one.worktree,
              position: rank + 1,
              baseCommit: one.base.commit,
              baseRef: one.base.ref,
              baseFreshness:
                one.base.freshness === null ? null : writeFreshness(one.base.freshness),
            })),
          )
          .pipe(Effect.mapError(refusedWhile('writing the worktrees')))
        const steps = [
          ...planned.map((one) => ({
            kind: 'worktree',
            base: one.repository.path,
            path: null,
            commandId: null,
            line: null,
          })),
          ...recipe,
        ].map((step, rank) => Object.assign(step, { position: rank + 1 }))
        yield* transaction
          .insert(workspaceSteps)
          .values(
            steps.map((step) => ({
              id: crypto.randomUUID(),
              workspaceId: id,
              position: step.position,
              kind: step.kind,
              base: step.base,
              path: step.path,
              commandId: step.commandId,
              line: step.line,
              state: 'pending',
              failedDoing: null,
              failedOutput: null,
            })),
          )
          .pipe(Effect.mapError(refusedWhile('writing the preparation')))
        return {
          result: undefined,
          events: [
            workspaceEvent(
              'workspace.created',
              { id, projectId: project.id },
              {
                name,
                folder,
                branch,
                repositories: planned.map((one) => one.repository.path),
                bases: planned.map((one) => one.base.commit),
              },
              'human',
            ),
          ],
        }
      }),
    )
    return yield* getWorkspace(id).pipe(Effect.catchTag('UnknownWorkspace', Effect.die))
  })

/** A worktree's state as Git reads it now, or Git's reason; a missing Git is refused as itself. */
const readWorktree = (folder: string, base: string | null) =>
  Effect.gen(function* () {
    const git = yield* Git
    const status = yield* git.status(folder)
    const changed = yield* git.changedFiles(folder)
    const distance =
      base === null || status.commit === null ? null : yield* git.aheadBehind(folder, base)
    return WorktreeRead.make({
      branch: status.branch,
      commit: status.commit,
      changed: [...changed],
      ahead: distance?.ahead ?? null,
      behind: distance?.behind ?? null,
    })
  }).pipe(
    Effect.catchTags({
      GitFailed: (refusal) => Effect.succeed(WorktreeUnreadable.make({ reason: refusal.message })),
      GitCut: (cut) => Effect.succeed(WorktreeUnreadable.make({ reason: cut.message })),
    }),
  )

/** The commit the main checkout's repository is measured against: its base as last fetched. */
const mainBase = (folder: string, repository: Repository) =>
  Effect.gen(function* () {
    const ref =
      repository.remote === null
        ? `refs/heads/${repository.baseBranch}`
        : `refs/remotes/${repository.remote}/${repository.baseBranch}`
    const commit = yield* (yield* Git).commitOf(folder, ref)
    return Option.getOrNull(commit)
  }).pipe(
    Effect.catchTags({ GitFailed: () => Effect.succeed(null), GitCut: () => Effect.succeed(null) }),
  )

/**
 * Each repository of a Workspace, or of the main checkout for null, as Git reads it now: its
 * branch, the files a removal would lose, how far it is from its base. A worktree whose step has
 * not made it yet shows that step, and Git is not asked about it.
 */
export const workspaceStatus = (projectId: string, workspaceId: string | null) =>
  Effect.gen(function* () {
    const place = yield* placeOf(projectId, workspaceId)
    if (place.workspace === null) {
      return yield* Effect.forEach(
        place.project.repositories,
        (repository): Effect.Effect<WorkspaceRepositoryStatus, GitMissing, Git> =>
          Effect.gen(function* () {
            const folder = join(place.folder, repository.path)
            const base = yield* mainBase(folder, repository)
            return {
              repositoryId: repository.id,
              path: repository.path,
              state: yield* readWorktree(folder, base),
            }
          }),
      )
    }
    const { workspace } = place
    return yield* Effect.forEach(
      workspace.repositories,
      (repository): Effect.Effect<WorkspaceRepositoryStatus, GitMissing, Git> =>
        Effect.gen(function* () {
          const step = workspace.steps.find(
            (one) => one.kind === 'worktree' && one.base === repository.path,
          )
          const state: WorktreeState =
            step !== undefined && step.state !== 'done'
              ? WorktreeNotMade.make({ step: step.state })
              : yield* readWorktree(repository.worktree, repository.base.commit)
          return { repositoryId: repository.repositoryId, path: repository.path, state }
        }),
    )
  })

/** Whether anything is at a path, a link that leads nowhere included. */
export const occupied = (path: string): boolean =>
  lstatSync(path, { throwIfNoEntry: false }) !== undefined

/** A folder as Git and the disk both spell it, to compare one with the other. */
const comparable = (path: string): string => {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

const said = <E>(cause: E): string =>
  cause instanceof Error && cause.message !== '' ? cause.message : String(cause)

/**
 * Whether a program holds the folder: on Windows a folder in which a file is open, or a process
 * stands, cannot be renamed. Renamed and named back at once, before anything is removed, so a
 * removal is refused whole rather than stopped half way. Elsewhere it always moves.
 */
const heldByAProgram = (folder: string): string | null => {
  const aside = `${folder}.removing`
  try {
    renameSync(folder, aside)
  } catch (cause) {
    return said(cause)
  }
  renameSync(aside, folder)
  return null
}

const refuseRemoval = (reason: string, file: string | null = null) =>
  Effect.fail(new RemovalRefused({ reason, file }))

/**
 * Removes a Workspace: every worktree checked first, then removed by Git (never with `--force`)
 * and its registration pruned, then the folder; then checked gone from the disk and from Git's
 * list before the record goes. Refused, with nothing removed, while it is prepared, when a
 * worktree holds work that would be lost (one file is named), or when a program holds its folder.
 */
export const removeWorkspace = (id: string) =>
  Effect.gen(function* () {
    const workspace = yield* getWorkspace(id)
    const project = yield* getProject(workspace.projectId)
    const preparations = yield* Preparations
    if (!(yield* preparations.hold(id))) return yield* refuseRemoval('it is being prepared')
    yield* removal(workspace, project).pipe(Effect.ensuring(preparations.release(id)))
    yield* unregisterWorkspace(project.id, id)
  })

const removal = (workspace: Workspace, project: Project) =>
  Effect.gen(function* () {
    const git = yield* Git
    const made = workspace.repositories.filter((one) => existsSync(one.worktree))

    for (const repository of made) {
      const changed = yield* git.changedFiles(repository.worktree).pipe(
        Effect.catchTags({
          GitFailed: (refusal) => refuseRemoval(refusal.message),
          GitCut: (cut) => refuseRemoval(cut.message),
        }),
      )
      const [first] = changed
      if (first !== undefined) {
        const file = repository.path === ROOT_REPOSITORY ? first : `${repository.path}/${first}`
        return yield* refuseRemoval(`${file} holds work that is not committed`, file)
      }
    }
    if (existsSync(workspace.folder)) {
      const held = heldByAProgram(workspace.folder)
      if (held !== null) {
        return yield* refuseRemoval(`a program holds a file in ${workspace.folder} (${held})`)
      }
    }

    // The deepest first: the root's worktree holds the others' folders.
    const removed: string[] = []
    for (const repository of workspace.repositories.toReversed()) {
      const source = join(project.mainCheckout, repository.path)
      const gone = existsSync(repository.worktree)
        ? git.worktreeRemove(source, repository.worktree)
        : Effect.void
      yield* gone.pipe(
        Effect.andThen(git.worktreePrune(source)),
        Effect.catchTags({
          GitFailed: (refusal) =>
            refuseRemoval(
              removed.length === 0
                ? refusal.message
                : `${refusal.message} (already removed: ${removed.join(', ')})`,
            ),
          GitCut: (cut) => refuseRemoval(cut.message),
        }),
      )
      removed.push(repository.path)
    }
    // What the recipe placed beside the worktrees goes with the folder. A link is removed as a
    // link: what it leads to in the main checkout is never followed.
    yield* Effect.tryPromise({
      try: () => rm(workspace.folder, { recursive: true, force: true }),
      catch: (cause) => new RemovalRefused({ reason: said(cause), file: null }),
    })

    if (existsSync(workspace.folder)) {
      return yield* refuseRemoval(`${workspace.folder} is still on the disk`)
    }
    for (const repository of workspace.repositories) {
      const listed = yield* git.worktrees(join(project.mainCheckout, repository.path)).pipe(
        Effect.catchTags({
          GitFailed: (refusal) => refuseRemoval(refusal.message),
          GitCut: (cut) => refuseRemoval(cut.message),
        }),
      )
      if (listed.some((path) => comparable(path) === comparable(repository.worktree))) {
        return yield* refuseRemoval(`Git still lists the worktree ${repository.worktree}`)
      }
    }

    yield* mutate('removing a Workspace', (transaction) =>
      transaction
        .delete(workspaces)
        .where(eq(workspaces.id, workspace.id))
        .pipe(
          Effect.mapError(refusedWhile('removing the Workspace')),
          Effect.as({
            result: undefined,
            events: [
              workspaceEvent(
                'workspace.removed',
                workspace,
                { name: workspace.name, folder: workspace.folder },
                'human',
              ),
            ],
          }),
        ),
    )
  })

/** The Workspace an event is about, when it is about one. */
const workspaceChanged = (
  event: DomainEvent,
): Result.Result<{ id: string; projectId: string }, DomainEvent> => {
  const projectId = event.payload['projectId']
  return event.entityKind === 'workspace' && projectId !== undefined
    ? Result.succeed({ id: event.entityId, projectId: String(projectId) })
    : Result.fail(event)
}

/**
 * Each Workspace as a committed change left it, its steps included, or null once it was removed,
 * for as long as the caller listens.
 */
export const workspaceChanges: Stream.Stream<
  WorkspaceChange,
  DatabaseError,
  Database | DomainEvents | Preparations
> = Stream.unwrap(
  Effect.map(
    DomainEvents.use((events) => events.subscribe),
    (committed) =>
      committed.pipe(
        Stream.filterMap(workspaceChanged),
        Stream.mapEffect(({ id, projectId }) =>
          getWorkspace(id).pipe(
            Effect.map((workspace): WorkspaceChange => ({ id, projectId, workspace })),
            Effect.catchTag('UnknownWorkspace', () =>
              Effect.succeed<WorkspaceChange>({ id, projectId, workspace: null }),
            ),
          ),
        ),
      ),
  ),
)

/** The main checkout's repositories, as a place a step reads its sources from. */
export const sourceOf = (project: Project, base: string | null, path: string): string =>
  join(project.mainCheckout, base ?? '', path)
