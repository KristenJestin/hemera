import { realpathSync } from 'node:fs'
import {
  type Project as DomainProject,
  InvalidProjectNameError,
  InvalidRepositoryPathError,
  MAIN_WORKSPACE,
  type ProjectTone,
  projectName,
  rankBetween,
  repositoryPath,
} from '@hemera/core'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'

import { Database, DatabaseError, type EngineTransaction } from './storage/database.ts'
import { projectRepositories, projects, workspaces } from './storage/schema.ts'
import { type Mutation, StaleVersionError, mutate } from './transaction.ts'

/**
 * What a Project is once it has been read back out (design D4-02, D4-03).
 *
 * The domain's own Project, and the two things the interface never asks for separately: where
 * `main` points, and what the Project reads from. A page that had to fetch a path and a list of
 * locations after fetching a Project would be three round trips to draw one tab.
 *
 * Nothing here reads a disk. Whether a folder exists, and whether a location holds a Git
 * repository, is the main process's to find out at the moment it is shown — it changes without
 * anyone touching the database, so storing it would be storing something already stale.
 */
export interface Project extends DomainProject {
  /** Where the `main` Workspace points, which is the Project's own root. */
  mainPath: string
  /** What it reads from, relative to that root, in the order the user put them in. */
  repositories: string[]
  /** Where its dedicated Workspaces are made, and null for Hemera's own folder (D8-02). */
  workspacesRoot: string | null
  /** What their branches start with, and null for the Project's name as a slug (D8-04). */
  branchPrefix: string | null
  /** The repositories a dedicated Workspace gets a worktree of unless left out (D8-04). */
  included: string[]
}

/** A Project was asked for by an identifier nothing answers to. */
export class UnknownProjectError extends Error {
  constructor(readonly id: string) {
    super(`no Project has the identifier "${id}"`)
    this.name = 'UnknownProjectError'
  }
}

/** What the caller hands over to create one. */
export interface NewProject {
  name: string
  tone: ProjectTone
  /** The folder `main` will point at. Checked by the main process before it gets here. */
  mainPath: string
}

/** What can be changed about a Project without touching its Workspaces. */
export interface ProjectEdit {
  id: string
  version: number
  name?: string | undefined
  tone?: ProjectTone | undefined
}

/**
 * Everything that can be done to a Project, and nothing that cannot (design D4-03).
 *
 * There is no `delete`. Archiving is how a Project ends — its tab goes, its Journal and its
 * Sessions stay whole — and the absence of the use case is the guarantee: a service that cannot
 * be asked to delete is a service that cannot be made to.
 *
 * Every change goes through `mutate`, so every change writes the event that describes it in the
 * same transaction. Every change that touches an existing Project takes the version it was read
 * at and refuses a version that is no longer current: two windows editing the same Project both
 * believed they started from what was on screen, and the second one writing over the first would
 * lose a change nobody was told about.
 */
export interface ProjectsService {
  readonly list: (includeArchived?: boolean | undefined) => Effect.Effect<Project[], DatabaseError>
  readonly create: (
    asked: NewProject,
  ) => Effect.Effect<Project, DatabaseError | InvalidProjectNameError>
  readonly update: (edit: ProjectEdit) => Effect.Effect<Project, Refusal | InvalidProjectNameError>
  readonly moveMain: (id: string, version: number, path: string) => Effect.Effect<Project, Refusal>
  readonly archive: (id: string, version: number) => Effect.Effect<Project, Refusal>
  readonly restore: (id: string, version: number) => Effect.Effect<Project, Refusal>
  readonly addRepository: (
    id: string,
    version: number,
    relativePath: string,
  ) => Effect.Effect<Project, Refusal | InvalidRepositoryPathError>
  readonly removeRepository: (
    id: string,
    version: number,
    relativePath: string,
  ) => Effect.Effect<Project, Refusal>
  readonly setWorkspacesRoot: (
    id: string,
    version: number,
    path: string | null,
  ) => Effect.Effect<Project, Refusal>
  readonly setBranchPrefix: (
    id: string,
    version: number,
    prefix: string | null,
  ) => Effect.Effect<Project, Refusal>
  readonly setRepositoryIncluded: (
    id: string,
    version: number,
    relativePath: string,
    included: boolean,
  ) => Effect.Effect<Project, Refusal | InvalidRepositoryPathError>
}

export class Projects extends Context.Service<Projects, ProjectsService>()('Projects') {}

/** What any change to an existing Project can be refused with. */
type Refusal = DatabaseError | StaleVersionError | UnknownProjectError

/**
 * A Workspace path as the filesystem itself spells it: links followed, and on Windows the long
 * form of a DOS short name (`RUNNER~1`) and the case the folders were created with.
 *
 * The tools judge a path by where it really is (D6-05), and a root kept in another spelling of
 * the same place is a root every path inside it reads as leaving. A path that does not exist
 * (yet) is kept as it was given.
 */
function canonical(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

/** A setting cleared to nothing: the default it stands for, rather than an empty value. */
function blankAsNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** The date every row of one mutation shares, so a Project and its event agree on when. */
function now(): string {
  return new Date().toISOString()
}

/**
 * What the domain refuses, as something a caller can be told about.
 *
 * `core` is pure TypeScript and says no by throwing — which is the right thing for a library
 * with no notion of an effect, and the wrong thing to leave alone here: thrown inside a
 * transaction it is a defect, and a defect takes the process down instead of being answered.
 * Every call into the domain comes through one of these, so a refusal is a value the use case
 * declares and the interface can show.
 */
function named(candidate: string) {
  return Effect.try({
    try: () => projectName(candidate),
    catch: (cause) =>
      cause instanceof InvalidProjectNameError ? cause : new InvalidProjectNameError(String(cause)),
  })
}

function located(candidate: string) {
  return Effect.try({
    try: () => repositoryPath(candidate),
    catch: (cause) =>
      cause instanceof InvalidRepositoryPathError
        ? cause
        : new InvalidRepositoryPathError(candidate, String(cause)),
  })
}

export const projectsLayer = Layer.effect(
  Projects,
  Effect.gen(function* () {
    const database = yield* Database

    const failed = (doing: string) => (cause: unknown) => new DatabaseError({ doing, cause })

    /**
     * Hands the database to whatever is about to use it.
     *
     * The layer asked for it once, when it was built; everything it hands back is a program that
     * will be run later by a caller who has no reason to have it. Without this, every use case
     * of this service would put `Database` back into the requirements of whoever called it.
     */
    const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provideService(Database, database))

    /**
     * Reads Projects back with their path and their locations.
     *
     * Three queries and not one per Project: a page of tabs is one read, and a join that
     * multiplied a Project by its locations would be a page assembling rows in the renderer.
     *
     * Each of the three asks for the Projects wanted and no others. It used to read every row
     * of all three tables and narrow the first of them in memory, which for the list is the
     * same work — the list wants every Project — and for `readOne` is the whole data folder
     * read to write one row: a Project, its Workspaces and its locations are read back after
     * every rename, every path added, every archive.
     */
    const read = (ids: string[] | null, includeArchived: boolean) =>
      Effect.gen(function* () {
        const wanted = yield* database
          .select()
          .from(projects)
          .where(
            and(
              ids === null ? undefined : inArray(projects.id, ids),
              includeArchived ? undefined : isNull(projects.archivedAt),
            ),
          )
          .orderBy(asc(projects.createdAt))
          .pipe(Effect.mapError(failed('reading the Projects')))

        if (wanted.length === 0) return []
        const held = wanted.map((row) => row.id)

        const mains = yield* database
          .select()
          .from(workspaces)
          .where(and(eq(workspaces.name, MAIN_WORKSPACE), inArray(workspaces.projectId, held)))
          .pipe(Effect.mapError(failed('reading the Workspaces')))

        const locations = yield* database
          .select()
          .from(projectRepositories)
          .where(inArray(projectRepositories.projectId, held))
          .orderBy(asc(projectRepositories.rank))
          .pipe(Effect.mapError(failed('reading the repositories')))

        return wanted.map((row) => ({
          id: row.id,
          name: row.name,
          // SAFETY: the column is constrained by a check to the five tones the domain declares,
          // and nothing writes it but this service, which takes a `ProjectTone`.
          tone: row.tone as ProjectTone,
          createdAt: Date.parse(row.createdAt),
          updatedAt: Date.parse(row.updatedAt),
          archivedAt: row.archivedAt === null ? null : Date.parse(row.archivedAt),
          version: row.version,
          mainPath: mains.find((one) => one.projectId === row.id)?.path ?? '',
          repositories: locations
            .filter((one) => one.projectId === row.id)
            .map((one) => one.relativePath),
          workspacesRoot: row.workspacesRoot,
          branchPrefix: row.branchPrefix,
          included: locations
            .filter((one) => one.projectId === row.id && one.includedByDefault === 1)
            .map((one) => one.relativePath),
        }))
      })

    /** The one Project a change was about, read back inside the transaction that changed it. */
    const readOne = (id: string) =>
      Effect.gen(function* () {
        const found = yield* read([id], true)
        const project = found[0]
        if (project === undefined) return yield* Effect.fail(new UnknownProjectError(id))
        return project
      })

    /**
     * Takes a Project to its next version, and refuses a caller working from an older one.
     *
     * The comparison is the write: `WHERE id = ? AND version = ?` either changes a row or does
     * not, and there is no window between reading the version and acting on it. Asking first
     * and writing second is the same bug with more code.
     */
    const bump = (
      transaction: Parameters<Parameters<typeof mutate>[1]>[0],
      id: string,
      version: number,
      change: Partial<{
        name: string
        tone: string
        archivedAt: string | null
        workspacesRoot: string | null
        branchPrefix: string | null
      }>,
    ) =>
      Effect.gen(function* () {
        const written = yield* transaction
          .update(projects)
          .set({ ...change, updatedAt: now(), version: version + 1 })
          .where(and(eq(projects.id, id), eq(projects.version, version)))
          .returning({ id: projects.id })
          .pipe(Effect.mapError(failed('writing the Project')))
        if (written.length === 0) {
          return yield* Effect.fail(
            new StaleVersionError({ entity: 'project', id, expected: version }),
          )
        }
      })

    /**
     * The rank the last location of a Project holds, which is what the next one goes after.
     *
     * Asked of the table rather than worked out from how many there are: a rank is a string
     * that sorts and not a position, and a count says nothing about what the last one is
     * called. Rebuilt from a count, every location after the second came out with the rank the
     * second already had, and locations sharing a rank are locations in no order at all.
     */
    const lastRankOf = (transaction: EngineTransaction, id: string) =>
      transaction
        .select({ rank: projectRepositories.rank })
        .from(projectRepositories)
        .where(eq(projectRepositories.projectId, id))
        .orderBy(asc(projectRepositories.rank))
        .pipe(
          Effect.mapError(failed('reading the repositories')),
          Effect.map((rows) => rows.at(-1)?.rank ?? null),
        )

    return {
      list: (includeArchived = false) => withDatabase(read(null, includeArchived)),

      create: (asked) =>
        withDatabase(
          mutate('creating a Project', (transaction) =>
            Effect.gen(function* () {
              const id = crypto.randomUUID()
              const written = now()
              const name = yield* named(asked.name)
              const mainPath = canonical(asked.mainPath)
              yield* transaction
                .insert(projects)
                .values({ id, name, tone: asked.tone, createdAt: written, updatedAt: written })
                .pipe(Effect.mapError(failed('writing the Project')))
              // The Workspace is created with the Project and never removed: the path belongs to
              // it, so a Project without one is a Project with nowhere to be.
              yield* transaction
                .insert(workspaces)
                .values({
                  id: crypto.randomUUID(),
                  projectId: id,
                  name: MAIN_WORKSPACE,
                  path: mainPath,
                  createdAt: written,
                })
                .pipe(Effect.mapError(failed('writing the Workspace')))

              // Built from what was just written rather than read back: the row is known in
              // full, and reading it would make this use case declare a refusal — "no Project
              // has that identifier" — that cannot follow the insert that just succeeded.
              const project: Project = {
                id,
                name,
                tone: asked.tone,
                createdAt: Date.parse(written),
                updatedAt: Date.parse(written),
                archivedAt: null,
                version: 1,
                mainPath,
                repositories: [],
                workspacesRoot: null,
                branchPrefix: null,
                included: [],
              }
              return {
                result: project,
                events: [
                  {
                    type: 'project.created',
                    entityKind: 'project',
                    entityId: id,
                    source: 'ui',
                    author: 'human',
                    projectId: id,
                    payload: { name, tone: asked.tone, mainPath },
                  },
                ],
              } satisfies Mutation<Project>
            }),
          ),
        ),

      update: (edit) =>
        withDatabase(
          mutate('changing a Project', (transaction) =>
            Effect.gen(function* () {
              const change: Record<string, string | number | null> = {}
              // Through `named` and not through the domain directly: thrown inside a
              // transaction, a refusal is a defect, and a defect is not something the page can
              // be told about — which is the whole reason the use case declares it.
              if (edit.name !== undefined) change['name'] = yield* named(edit.name)
              if (edit.tone !== undefined) change['tone'] = edit.tone
              yield* bump(transaction, edit.id, edit.version, change)
              const project = yield* readOne(edit.id)
              return {
                result: project,
                events: [
                  {
                    type: 'project.updated',
                    entityKind: 'project',
                    entityId: edit.id,
                    source: 'ui',
                    author: 'human',
                    projectId: edit.id,
                    payload: { name: project.name, tone: project.tone },
                  },
                ],
              } satisfies Mutation<Project>
            }),
          ),
        ),

      moveMain: (id, version, moved) =>
        withDatabase(
          mutate('moving the main Workspace', (transaction) =>
            Effect.gen(function* () {
              const path = canonical(moved)
              yield* bump(transaction, id, version, {})
              yield* transaction
                .update(workspaces)
                .set({ path })
                .where(and(eq(workspaces.projectId, id), eq(workspaces.name, MAIN_WORKSPACE)))
                .pipe(Effect.mapError(failed('writing the Workspace')))
              const project = yield* readOne(id)
              return {
                result: project,
                events: [
                  {
                    type: 'project.main_moved',
                    entityKind: 'project',
                    entityId: id,
                    source: 'ui',
                    author: 'human',
                    projectId: id,
                    payload: { path },
                  },
                ],
              } satisfies Mutation<Project>
            }),
          ),
        ),

      archive: (id, version) =>
        withDatabase(
          mutate('archiving a Project', (transaction) =>
            Effect.gen(function* () {
              yield* bump(transaction, id, version, { archivedAt: now() })
              const project = yield* readOne(id)
              return {
                result: project,
                events: [
                  {
                    type: 'project.archived',
                    entityKind: 'project',
                    entityId: id,
                    source: 'ui',
                    author: 'human',
                    projectId: id,
                  },
                ],
              } satisfies Mutation<Project>
            }),
          ),
        ),

      restore: (id, version) =>
        withDatabase(
          mutate('restoring a Project', (transaction) =>
            Effect.gen(function* () {
              yield* bump(transaction, id, version, { archivedAt: null })
              const project = yield* readOne(id)
              return {
                result: project,
                events: [
                  {
                    type: 'project.restored',
                    entityKind: 'project',
                    entityId: id,
                    source: 'ui',
                    author: 'human',
                    projectId: id,
                  },
                ],
              } satisfies Mutation<Project>
            }),
          ),
        ),

      addRepository: (id, version, asked) =>
        withDatabase(
          mutate('adding a repository', (transaction) =>
            Effect.gen(function* () {
              // Refused by the domain before anything is written: an absolute path, one climbing
              // out of the root, or one already declared.
              const relativePath = yield* located(asked)
              const project = yield* readOne(id)
              if (project.repositories.includes(relativePath)) {
                return yield* Effect.fail(
                  new InvalidRepositoryPathError(asked, 'it is declared twice'),
                )
              }
              yield* bump(transaction, id, version, {})
              yield* transaction
                .insert(projectRepositories)
                .values({
                  id: crypto.randomUUID(),
                  projectId: id,
                  relativePath,
                  rank: rankBetween(yield* lastRankOf(transaction, id), null),
                })
                .pipe(Effect.mapError(failed('writing the repository')))
              const after = yield* readOne(id)
              return {
                result: after,
                events: [
                  {
                    type: 'project.repository_added',
                    entityKind: 'project',
                    entityId: id,
                    source: 'ui',
                    author: 'human',
                    projectId: id,
                    payload: { relativePath },
                  },
                ],
              } satisfies Mutation<Project>
            }),
          ),
        ),

      removeRepository: (id, version, relativePath) =>
        withDatabase(
          mutate('removing a repository', (transaction) =>
            Effect.gen(function* () {
              yield* bump(transaction, id, version, {})
              yield* transaction
                .delete(projectRepositories)
                .where(
                  and(
                    eq(projectRepositories.projectId, id),
                    eq(projectRepositories.relativePath, relativePath),
                  ),
                )
                .pipe(Effect.mapError(failed('removing the repository')))
              const project = yield* readOne(id)
              return {
                result: project,
                events: [
                  {
                    type: 'project.repository_removed',
                    entityKind: 'project',
                    entityId: id,
                    source: 'ui',
                    author: 'human',
                    projectId: id,
                    payload: { relativePath },
                  },
                ],
              } satisfies Mutation<Project>
            }),
          ),
        ),

      setWorkspacesRoot: (id, version, path) =>
        withDatabase(
          mutate('choosing the folder of the Workspaces', (transaction) =>
            Effect.gen(function* () {
              // An empty field is the default folder, not a folder with no name (D8-02).
              const workspacesRoot = blankAsNull(path)
              yield* bump(transaction, id, version, { workspacesRoot })
              const project = yield* readOne(id)
              return {
                result: project,
                events: [
                  {
                    type: 'project.updated',
                    entityKind: 'project',
                    entityId: id,
                    source: 'ui',
                    author: 'human',
                    projectId: id,
                    payload: { workspacesRoot },
                  },
                ],
              } satisfies Mutation<Project>
            }),
          ),
        ),

      setBranchPrefix: (id, version, prefix) =>
        withDatabase(
          mutate('choosing the branch prefix', (transaction) =>
            Effect.gen(function* () {
              // An empty field is the Project's name as a slug, not an empty prefix (D8-04).
              const branchPrefix = blankAsNull(prefix)
              yield* bump(transaction, id, version, { branchPrefix })
              const project = yield* readOne(id)
              return {
                result: project,
                events: [
                  {
                    type: 'project.updated',
                    entityKind: 'project',
                    entityId: id,
                    source: 'ui',
                    author: 'human',
                    projectId: id,
                    payload: { branchPrefix },
                  },
                ],
              } satisfies Mutation<Project>
            }),
          ),
        ),

      setRepositoryIncluded: (id, version, relativePath, included) =>
        withDatabase(
          mutate('changing a repository', (transaction) =>
            Effect.gen(function* () {
              yield* bump(transaction, id, version, {})
              const written = yield* transaction
                .update(projectRepositories)
                .set({ includedByDefault: included ? 1 : 0 })
                .where(
                  and(
                    eq(projectRepositories.projectId, id),
                    eq(projectRepositories.relativePath, relativePath),
                  ),
                )
                .returning({ id: projectRepositories.id })
                .pipe(Effect.mapError(failed('writing the repository')))
              if (written.length === 0) {
                return yield* Effect.fail(
                  new InvalidRepositoryPathError(relativePath, 'it is not declared'),
                )
              }
              const project = yield* readOne(id)
              return {
                result: project,
                events: [
                  {
                    type: 'project.repository_updated',
                    entityKind: 'project',
                    entityId: id,
                    source: 'ui',
                    author: 'human',
                    projectId: id,
                    payload: { relativePath, included },
                  },
                ],
              } satisfies Mutation<Project>
            }),
          ),
        ),
    } satisfies ProjectsService
  }),
)
