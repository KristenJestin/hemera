/**
 * The Projects and their repositories, as records: created, read, listed and edited.
 *
 * A Project is a set of Git repositories worked on together, with its main checkout: the folder
 * on disk where the user's own clones live. That folder is not always a repository itself, and a
 * repository Hemera did not detect can be added by hand. What Git says of a repository now (its
 * status, its remotes, its up-to-date base) is in `repositories.ts`.
 *
 * Every edit carries the version of the Project it was made from, and a repository is part of its
 * Project's record: an edit of either takes the Project to its next version, and an edit made from
 * an older one is refused. Every check that needs the disk or Git (where a link leads, which
 * remotes a repository has) is made before the transaction, never inside it.
 */

import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import {
  DEFAULT_BASE_BRANCH,
  ROOT_REPOSITORY,
  branchName,
  branchPrefix,
  projectName,
  repositoryPath,
} from '@hemera/core/domain'
import {
  type BaseBranchEdit,
  type BranchPrefixEdit,
  type InvalidBranchName,
  InvalidFolder,
  type InvalidProjectName,
  InvalidRepositoryPath,
  type NewProject,
  type NewRepository,
  type Project,
  type ProjectEdit,
  type RemoteEdit,
  type Repository,
  type RepositoryEdit,
  type RepositoryRemoval,
  StaleVersion,
  UnknownProject,
  UnknownRemote,
  UnknownRepository,
  type WorkspacesRootEdit,
} from '@hemera/ipc'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Effect, Option, Result, Stream } from 'effect'

import { DomainEvents } from './domain-events.ts'
import { Git, type GitRefusal } from './git.ts'
import type { DomainEvent, EventPayload, NewEvent } from './journal.ts'
import {
  Database,
  type DatabaseError,
  type EngineTransaction,
  refusedWhile,
} from './storage/database.ts'
import { projectRepositories, projects } from './storage/schema.ts'
import { mutate } from './transaction.ts'

/** The date every row and event of one change shares. */
const now = (): string => new Date().toISOString()

/** A folder as the disk spells it: links followed, and on Windows the case it was made with. */
function canonical(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

/** Where a path really leads: links followed as far as the disk has it, the rest as written. */
function whereItLeads(path: string): string {
  const rest: string[] = []
  let existing = path
  while (!existsSync(existing)) {
    const parent = dirname(existing)
    if (parent === existing) return path
    rest.unshift(basename(existing))
    existing = parent
  }
  return join(realpathSync.native(existing), ...rest)
}

/** Whether `path` is `folder` or below it. */
function within(folder: string, path: string): boolean {
  const below = relative(folder, path)
  return below === '' || !(below === '..' || below.startsWith(`..${sep}`) || isAbsolute(below))
}

/** A repository's path, refused when it leaves the main checkout, by `..` or through a link. */
const checkedPath = (mainCheckout: string, candidate: string) =>
  Effect.gen(function* () {
    const path = yield* Effect.fromResult(repositoryPath(candidate))
    if (!within(canonical(mainCheckout), whereItLeads(join(mainCheckout, path)))) {
      return yield* new InvalidRepositoryPath({
        path: candidate,
        reason: 'it leaves the main checkout',
      })
    }
    return path
  })

/** A main checkout: absolute, kept as the disk spells it. */
const checkedMainCheckout = (path: string) =>
  isAbsolute(path)
    ? Effect.succeed(canonical(path))
    : Effect.fail(new InvalidFolder({ path, reason: 'it is not an absolute path' }))

/**
 * The repositories in a folder: the folder itself when it is one, and each of its direct
 * subfolders that is one, as paths relative to it. A repository is a folder holding a `.git`,
 * whether or not Git can read it: one it cannot is proposed too, and shows Git's reason once
 * added. Links are not followed, so nothing proposed leaves the folder.
 */
export const detectRepositories = (
  folder: string,
): Effect.Effect<ReadonlyArray<string>, InvalidFolder> =>
  Effect.gen(function* () {
    if (!isAbsolute(folder)) {
      return yield* new InvalidFolder({ path: folder, reason: 'it is not an absolute path' })
    }
    const entries = yield* Effect.try({
      try: () => readdirSync(folder, { withFileTypes: true }),
      catch: () => new InvalidFolder({ path: folder, reason: 'it cannot be read' }),
    })
    const holdsGit = (path: string) => existsSync(join(path, '.git'))
    const below = entries
      .filter((entry) => entry.isDirectory() && holdsGit(join(folder, entry.name)))
      .map((entry) => entry.name)
      .toSorted()
    return holdsGit(folder) ? [ROOT_REPOSITORY, ...below] : below
  })

/**
 * The remote a repository is given when it is added: its only one, `origin` among several, or
 * none. A repository Git cannot read has none: adding it is never held up by Git.
 */
const defaultRemote = (folder: string): Effect.Effect<string | null, never, Git> =>
  Git.use((git) => git.remotes(folder)).pipe(
    Effect.map((remotes) => {
      if (remotes.length === 1) return remotes[0]?.name ?? null
      return remotes.some((remote) => remote.name === 'origin') ? 'origin' : null
    }),
    Effect.orElseSucceed(() => null),
  )

type ProjectRow = typeof projects.$inferSelect
type RepositoryRow = typeof projectRepositories.$inferSelect

const repositoryOf = (row: RepositoryRow): Repository => ({
  id: row.id,
  projectId: row.projectId,
  path: row.path,
  includedByDefault: row.includedByDefault,
  remote: row.remote,
  baseBranch: row.baseBranch,
  lastFetchedAt: row.lastFetchedAt,
})

const projectOf = (row: ProjectRow, repositories: ReadonlyArray<RepositoryRow>): Project => ({
  id: row.id,
  name: row.name,
  mainCheckout: row.mainCheckout,
  workspacesRoot: row.workspacesRoot,
  branchPrefix: row.branchPrefix,
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  repositories: repositories.map(repositoryOf),
})

/** The Projects asked for (all of them for null), each with its repositories in order. */
const readProjects = (ids: ReadonlyArray<string> | null) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(projects)
      .where(ids === null ? undefined : inArray(projects.id, [...ids]))
      .orderBy(asc(projects.createdAt), asc(projects.id))
      .pipe(Effect.mapError(refusedWhile('reading the Projects')))
    if (rows.length === 0) return []
    const repositories = yield* database
      .select()
      .from(projectRepositories)
      .where(
        inArray(
          projectRepositories.projectId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(projectRepositories.position))
      .pipe(Effect.mapError(refusedWhile('reading the repositories')))
    return rows.map((row) =>
      projectOf(
        row,
        repositories.filter((repository) => repository.projectId === row.id),
      ),
    )
  })

export const listProjects: Effect.Effect<
  ReadonlyArray<Project>,
  DatabaseError,
  Database
> = readProjects(null)

export const getProject = (
  id: string,
): Effect.Effect<Project, DatabaseError | UnknownProject, Database> =>
  Effect.flatMap(readProjects([id]), ([project]) =>
    project === undefined ? Effect.fail(new UnknownProject({ id })) : Effect.succeed(project),
  )

/** A repository, with the Project it belongs to. */
const getRepository = (id: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(projectRepositories)
      .where(eq(projectRepositories.id, id))
      .pipe(Effect.mapError(refusedWhile('reading the repositories')))
    if (row === undefined) return yield* new UnknownRepository({ id })
    const project = yield* getProject(row.projectId).pipe(
      Effect.catchTag('UnknownProject', () => Effect.fail(new UnknownRepository({ id }))),
    )
    return { repository: repositoryOf(row), project }
  })

/** The Project a repository belongs to, and the repository, as `repositories.ts` reads them. */
export const locateRepository = getRepository

/**
 * Takes a Project to its next version, and refuses an edit made from an older one. The comparison
 * is the write itself: `WHERE id = ? AND version = ?` changes a row or does not.
 */
/** What an edit of a Project may change of its row. */
type ProjectChange = Partial<
  Pick<ProjectRow, 'name' | 'mainCheckout' | 'workspacesRoot' | 'branchPrefix'>
>

/** What an edit of a repository may change of its row. */
type RepositoryChange = Partial<
  Pick<RepositoryRow, 'path' | 'includedByDefault' | 'remote' | 'baseBranch'>
>

const bump = (transaction: EngineTransaction, id: string, version: number, change: ProjectChange) =>
  Effect.gen(function* () {
    const written = yield* transaction
      .update(projects)
      .set({ ...change, updatedAt: now(), version: version + 1 })
      .where(and(eq(projects.id, id), eq(projects.version, version)))
      .returning({ id: projects.id })
      .pipe(Effect.mapError(refusedWhile('writing the Project')))
    if (written.length > 0) return
    const found = yield* transaction
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, id))
      .pipe(Effect.mapError(refusedWhile('reading the Project')))
    return yield* found.length === 0
      ? Effect.fail(new UnknownProject({ id }))
      : Effect.fail(new StaleVersion({ entity: 'Project', id, expected: version }))
  })

const byTheUser = { source: 'ui', author: 'human' } as const

const projectEvent = (type: string, id: string, payload: EventPayload): NewEvent => ({
  type,
  entityKind: 'project',
  entityId: id,
  ...byTheUser,
  payload,
})

const repositoryEvent = (
  type: string,
  row: Pick<Repository, 'id' | 'projectId' | 'path'>,
  more: EventPayload = {},
): NewEvent => ({
  type,
  entityKind: 'repository',
  entityId: row.id,
  ...byTheUser,
  payload: { projectId: row.projectId, path: row.path, ...more },
})

/** A repository about to be written, with its defaults read from Git. */
interface NewRow {
  readonly path: string
  readonly remote: string | null
}

const prepared = (mainCheckout: string, path: string) =>
  Effect.map(defaultRemote(join(mainCheckout, path)), (remote): NewRow => ({ path, remote }))

/** Inserts repositories after the last one of a Project, and tells what was added. */
const insertRepositories = (
  transaction: EngineTransaction,
  projectId: string,
  rows: ReadonlyArray<NewRow>,
) =>
  Effect.gen(function* () {
    if (rows.length === 0) return []
    const existing = yield* transaction
      .select({ position: projectRepositories.position })
      .from(projectRepositories)
      .where(eq(projectRepositories.projectId, projectId))
      .pipe(Effect.mapError(refusedWhile('reading the repositories')))
    const after = Math.max(0, ...existing.map((row) => row.position))
    const inserted = yield* transaction
      .insert(projectRepositories)
      .values(
        rows.map((row, rank) => ({
          id: crypto.randomUUID(),
          projectId,
          path: row.path,
          position: after + rank + 1,
          includedByDefault: true,
          remote: row.remote,
          baseBranch: DEFAULT_BASE_BRANCH,
          lastFetchedAt: null,
        })),
      )
      .returning()
      .pipe(Effect.mapError(refusedWhile('writing the repositories')))
    return inserted.map((row) =>
      repositoryEvent('repository.added', row, {
        remote: row.remote,
        baseBranch: row.baseBranch,
      }),
    )
  })

/** The same path twice in one Project, once each is in its one spelling. */
const twice = (paths: ReadonlyArray<string>, candidates: ReadonlyArray<string>) => {
  const index = paths.findIndex((path, at) => paths.indexOf(path) !== at)
  return index === -1
    ? Effect.void
    : Effect.fail(
        new InvalidRepositoryPath({
          path: candidates[index] ?? '',
          reason: 'it is already a repository of this Project',
        }),
      )
}

export const createProject = (asked: NewProject) =>
  Effect.gen(function* () {
    const name = yield* Effect.fromResult(projectName(asked.name))
    const mainCheckout = yield* checkedMainCheckout(asked.mainCheckout)
    const paths = yield* Effect.forEach(asked.repositories, (path) =>
      checkedPath(mainCheckout, path),
    )
    yield* twice(paths, asked.repositories)
    const rows = yield* Effect.forEach(paths, (path) => prepared(mainCheckout, path))
    const id = crypto.randomUUID()
    yield* mutate('creating a Project', (transaction) =>
      Effect.gen(function* () {
        const at = now()
        yield* transaction
          .insert(projects)
          .values({ id, name, mainCheckout, createdAt: at, updatedAt: at, version: 1 })
          .pipe(Effect.mapError(refusedWhile('writing the Project')))
        const added = yield* insertRepositories(transaction, id, rows)
        return {
          result: undefined,
          events: [projectEvent('project.created', id, { name, mainCheckout }), ...added],
        }
      }),
    )
    return yield* getProject(id)
  })

export const updateProject = (edit: ProjectEdit) =>
  Effect.gen(function* () {
    const name =
      edit.name === undefined ? undefined : yield* Effect.fromResult(projectName(edit.name))
    const mainCheckout =
      edit.mainCheckout === undefined ? undefined : yield* checkedMainCheckout(edit.mainCheckout)
    const change: ProjectChange = {}
    if (name !== undefined) change.name = name
    if (mainCheckout !== undefined) change.mainCheckout = mainCheckout
    yield* mutate('changing a Project', (transaction) =>
      Effect.as(bump(transaction, edit.id, edit.version, change), {
        result: undefined,
        events: [projectEvent('project.updated', edit.id, change)],
      }),
    )
    return yield* getProject(edit.id)
  })

/**
 * Where the Project's Workspaces are created: null for Hemera's own folder, or an absolute folder
 * outside the main checkout, so the Workspaces are never inside the clones they are worktrees of.
 */
export const setWorkspacesRoot = (edit: WorkspacesRootEdit) =>
  Effect.gen(function* () {
    let workspacesRoot: string | null = null
    if (edit.path !== null) {
      const path = edit.path.trim()
      if (!isAbsolute(path)) {
        return yield* new InvalidFolder({ path, reason: 'it is not an absolute path' })
      }
      workspacesRoot = canonical(path)
      const { mainCheckout } = yield* getProject(edit.id)
      if (within(canonical(mainCheckout), whereItLeads(workspacesRoot))) {
        return yield* new InvalidFolder({ path, reason: 'it is inside the main checkout' })
      }
    }
    yield* mutate('choosing the Workspaces folder', (transaction) =>
      Effect.as(bump(transaction, edit.id, edit.version, { workspacesRoot }), {
        result: undefined,
        events: [projectEvent('project.updated', edit.id, { workspacesRoot })],
      }),
    )
    return yield* getProject(edit.id)
  })

/** The prefix of the Project's Workspace branches: null for its name as a slug. */
export const setBranchPrefix = (edit: BranchPrefixEdit) =>
  Effect.gen(function* () {
    const prefix = edit.prefix === null ? null : yield* Effect.fromResult(branchPrefix(edit.prefix))
    yield* mutate('choosing the branch prefix', (transaction) =>
      Effect.as(bump(transaction, edit.id, edit.version, { branchPrefix: prefix }), {
        result: undefined,
        events: [projectEvent('project.updated', edit.id, { branchPrefix: prefix })],
      }),
    )
    return yield* getProject(edit.id)
  })

export const addRepository = (asked: NewRepository) =>
  Effect.gen(function* () {
    const project = yield* getProject(asked.projectId)
    const path = yield* checkedPath(project.mainCheckout, asked.path)
    yield* twice([...project.repositories.map((one) => one.path), path], [asked.path])
    const row = yield* prepared(project.mainCheckout, path)
    yield* mutate('adding a repository', (transaction) =>
      Effect.gen(function* () {
        yield* bump(transaction, project.id, asked.version, {})
        return {
          result: undefined,
          events: yield* insertRepositories(transaction, project.id, [row]),
        }
      }),
    )
    return yield* getProject(project.id)
  })

/**
 * Writes a change of one repository, at its Project's version. Nothing else in the Profile names a
 * repository by its path, so a new path needs nothing carried over to it.
 */
const changeRepository = (
  edit: { readonly id: string; readonly version: number },
  located: { readonly repository: Repository; readonly project: Project },
  change: RepositoryChange,
) =>
  Effect.gen(function* () {
    yield* mutate('changing a repository', (transaction) =>
      Effect.gen(function* () {
        yield* bump(transaction, located.project.id, edit.version, {})
        yield* transaction
          .update(projectRepositories)
          .set(change)
          .where(eq(projectRepositories.id, edit.id))
          .pipe(Effect.mapError(refusedWhile('writing the repository')))
        return {
          result: undefined,
          events: [
            repositoryEvent('repository.updated', { ...located.repository, ...change }, change),
          ],
        }
      }),
    )
    return yield* getProject(located.project.id)
  })

export const updateRepository = (edit: RepositoryEdit) =>
  Effect.gen(function* () {
    const located = yield* getRepository(edit.id)
    const { project, repository } = located
    const change: RepositoryChange = {}
    if (edit.path !== undefined) {
      const path = yield* checkedPath(project.mainCheckout, edit.path)
      const others = project.repositories.filter((one) => one.id !== repository.id)
      yield* twice([...others.map((one) => one.path), path], [edit.path])
      change.path = path
    }
    if (edit.includedByDefault !== undefined) change.includedByDefault = edit.includedByDefault
    return yield* changeRepository(edit, located, change)
  })

export const removeRepository = (edit: RepositoryRemoval) =>
  Effect.gen(function* () {
    const { project, repository } = yield* getRepository(edit.id)
    yield* mutate('removing a repository', (transaction) =>
      Effect.gen(function* () {
        yield* bump(transaction, project.id, edit.version, {})
        yield* transaction
          .delete(projectRepositories)
          .where(eq(projectRepositories.id, edit.id))
          .pipe(Effect.mapError(refusedWhile('removing the repository')))
        return { result: undefined, events: [repositoryEvent('repository.removed', repository)] }
      }),
    )
    return yield* getProject(project.id)
  })

/** The remote a repository's base is fetched from: one it has, or none. */
export const setRemote = (edit: RemoteEdit) =>
  Effect.gen(function* () {
    const located = yield* getRepository(edit.id)
    if (edit.remote !== null) {
      const folder = join(located.project.mainCheckout, located.repository.path)
      const remotes = yield* Git.use((git) => git.remotes(folder))
      if (!remotes.some((remote) => remote.name === edit.remote)) {
        return yield* new UnknownRemote({ name: edit.remote })
      }
    }
    return yield* changeRepository(edit, located, { remote: edit.remote })
  })

/** The branch a repository's work starts from and is delivered to: one Git accepts. */
export const setBaseBranch = (edit: BaseBranchEdit) =>
  Effect.gen(function* () {
    const branch = yield* Effect.fromResult(branchName(edit.branch))
    const located = yield* getRepository(edit.id)
    return yield* changeRepository(edit, located, { baseBranch: branch })
  })

/** The Project an event changed, when it changed a Project's record. */
const projectChanged = (event: DomainEvent): Result.Result<string, DomainEvent> => {
  if (event.entityKind === 'project') return Result.succeed(event.entityId)
  const projectId = event.payload['projectId']
  return event.entityKind === 'repository' &&
    event.type !== 'repository.status_changed' &&
    projectId !== undefined
    ? Result.succeed(String(projectId))
    : Result.fail(event)
}

/**
 * Each Project as a committed change left it, for as long as the caller listens. A Project gone
 * by the time it is read is skipped.
 */
export const projectChanges: Stream.Stream<Project, DatabaseError, Database | DomainEvents> =
  Stream.unwrap(
    Effect.map(
      DomainEvents.use((events) => events.subscribe),
      (committed) =>
        committed.pipe(
          Stream.filterMap(projectChanged),
          Stream.mapEffect((id) =>
            getProject(id).pipe(
              Effect.map(Option.some),
              Effect.catchTag('UnknownProject', () => Effect.succeed(Option.none())),
            ),
          ),
          Stream.filterMap((found) =>
            Option.isSome(found) ? Result.succeed(found.value) : Result.fail(found),
          ),
        ),
    ),
  )

/** What a Project call may be refused with, besides the data folder. */
export type ProjectRefusal =
  | InvalidProjectName
  | InvalidRepositoryPath
  | InvalidBranchName
  | InvalidFolder
  | StaleVersion
  | UnknownProject
  | UnknownRepository
  | UnknownRemote
  | GitRefusal
