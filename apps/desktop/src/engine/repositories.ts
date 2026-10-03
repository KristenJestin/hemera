/**
 * What Git says of a Project's repositories now: their status, their remotes, and the commit a
 * piece of work starts from. Read when asked, never stored, except the date of the last fetch of
 * a base that succeeded.
 *
 * A repository Git cannot read stays visible with Git's own reason: its status says so, and a
 * change of readability is written to the journal and told to whoever follows it.
 *
 * The up-to-date base: main, in the design, means each repository's base branch, never a branch
 * named in the code. Up to date means the base fetched from the repository's remote now, into its
 * tracking ref only (no local branch and no checkout of the user's is touched), then the commit
 * of that tracking ref. When the fetch fails (offline, a remote that refuses, credentials it would
 * ask for), the last tracking ref known is used, with the date of the last fetch that succeeded.
 * A repository without a remote uses its local base branch. Every caller records the commit it
 * was given.
 */

import { join } from 'node:path'

import {
  BaseUnavailable,
  FetchedNow,
  type GitMissing,
  LocalBranch,
  NotFetchedSince,
  Readable,
  type Remote,
  type RepositoryStatus,
  type RepositoryStatusChange,
  Unreadable,
  type UnknownRepository,
  type UpToDateBase,
} from '@hemera/ipc'
import { eq } from 'drizzle-orm'
import { Context, Effect, Layer, Match, Option, Ref, Result, Schema, Stream } from 'effect'

import { DomainEvents } from './domain-events.ts'
import { Git, type GitRefusal } from './git.ts'
import type { DomainEvent } from './journal.ts'
import { getRepository } from './projects.ts'
import { type Database, type DatabaseError, refusedWhile } from './storage/database.ts'
import { projectRepositories } from './storage/schema.ts'
import { mutate } from './transaction.ts'

/**
 * Whether each repository was readable when last read in this run, by its identifier: Git's
 * reason when it was not. A repository not read yet is taken as readable, so one found unreadable
 * at its first read is a change.
 */
export class RepositoryStatuses extends Context.Service<
  RepositoryStatuses,
  Ref.Ref<ReadonlyMap<string, string | null>>
>()('RepositoryStatuses') {}

export const repositoryStatusesLayer = Layer.effect(
  RepositoryStatuses,
  Ref.make<ReadonlyMap<string, string | null>>(new Map()),
)

/** What the calls on Projects and repositories stand on. */
export type ProjectServices = Database | DomainEvents | Git | RepositoryStatuses

const located = (id: string) =>
  Effect.map(getRepository(id), ({ project, repository }) => ({
    project,
    repository,
    folder: join(project.mainCheckout, repository.path),
  }))

/** Flat, as a payload must be: everything a status says, with null where it says nothing. */
const statusPayload = (status: RepositoryStatus) =>
  Match.value(status).pipe(
    Match.tagsExhaustive({
      Readable: ({ branch, commit, dirty }) => ({
        readable: true,
        reason: null,
        branch,
        commit,
        dirty,
      }),
      Unreadable: ({ reason }) => ({
        readable: false,
        reason,
        branch: null,
        commit: null,
        dirty: false,
      }),
    }),
  )

/**
 * A repository's status: what Git read, or Git's reason when it could not read it, cut at its
 * limit included. A missing Git is not a repository's fault and is refused as itself.
 */
export const repositoryStatus = (
  id: string,
): Effect.Effect<
  RepositoryStatus,
  DatabaseError | UnknownRepository | GitMissing,
  ProjectServices
> =>
  Effect.gen(function* () {
    const { project, folder } = yield* located(id)
    const status: RepositoryStatus = yield* Git.use((git) => git.status(folder)).pipe(
      Effect.map((read) => Readable.make({ ...read })),
      Effect.catchTags({
        GitFailed: (refused) => Effect.succeed(Unreadable.make({ reason: refused.message })),
        GitCut: (cut) => Effect.succeed(Unreadable.make({ reason: cut.message })),
      }),
    )
    const told = statusPayload(status)
    const { reason } = told
    const memory = yield* RepositoryStatuses
    const changed = yield* Ref.modify(
      memory,
      (known): [boolean, ReadonlyMap<string, string | null>] => [
        (known.get(id) ?? null) !== reason,
        new Map(known).set(id, reason),
      ],
    )
    if (changed) {
      yield* mutate('noting a repository’s status', () =>
        Effect.succeed({
          result: undefined,
          events: [
            {
              type: 'repository.status_changed',
              entityKind: 'repository',
              entityId: id,
              source: 'system' as const,
              author: 'hemera' as const,
              payload: { projectId: project.id, ...told },
            },
          ],
        }),
      )
    }
    return status
  })

export const repositoryRemotes = (
  id: string,
): Effect.Effect<
  ReadonlyArray<Remote>,
  DatabaseError | UnknownRepository | GitRefusal,
  ProjectServices
> => Effect.flatMap(located(id), ({ folder }) => Git.use((git) => git.remotes(folder)))

/** Writes when a base was last fetched; the record's version is not the fetch's to change. */
const fetched = (id: string, at: string) =>
  mutate('noting a fetch', (transaction) =>
    transaction
      .update(projectRepositories)
      .set({ lastFetchedAt: at })
      .where(eq(projectRepositories.id, id))
      .pipe(
        Effect.mapError(refusedWhile('writing the repository')),
        Effect.as({ result: undefined, events: [] }),
      ),
  )

/** The commit a repository's work starts from, by the rule of the up-to-date base. */
export const upToDateBase = (
  id: string,
): Effect.Effect<
  UpToDateBase,
  DatabaseError | UnknownRepository | GitRefusal | BaseUnavailable,
  ProjectServices
> =>
  Effect.gen(function* () {
    const { repository, folder } = yield* located(id)
    const git = yield* Git
    const branch = repository.baseBranch
    const remote = repository.remote

    if (remote === null) {
      const ref = `refs/heads/${branch}`
      const commit = yield* git.commitOf(folder, ref)
      if (Option.isNone(commit)) {
        return yield* new BaseUnavailable({ remote, branch, reason: 'it does not exist' })
      }
      return { commit: commit.value, ref, freshness: LocalBranch.make({}) }
    }

    const failure = yield* git.fetchBranch(folder, remote, branch).pipe(
      Effect.as(null),
      Effect.catchTags({
        GitFailed: (refused) => Effect.succeed(refused.message),
        GitCut: (cut) => Effect.succeed(cut.message),
      }),
    )
    let freshness
    if (failure === null) {
      const at = new Date().toISOString()
      yield* fetched(id, at)
      freshness = FetchedNow.make({ at })
    } else {
      freshness = NotFetchedSince.make({ since: repository.lastFetchedAt, reason: failure })
    }
    const ref = `refs/remotes/${remote}/${branch}`
    const commit = yield* git.commitOf(folder, ref)
    if (Option.isNone(commit)) {
      return yield* new BaseUnavailable({
        remote,
        branch,
        reason: failure ?? 'the fetch left no tracking ref',
      })
    }
    return { commit: commit.value, ref, freshness }
  })

const StatusPayload = Schema.Struct({
  projectId: Schema.String,
  readable: Schema.Boolean,
  reason: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  commit: Schema.NullOr(Schema.String),
  dirty: Schema.Boolean,
})
const readStatusPayload = Schema.decodeUnknownOption(StatusPayload)

/** The change of status an event tells, when it tells one. */
const statusChange = (event: DomainEvent): Result.Result<RepositoryStatusChange, DomainEvent> => {
  if (event.type !== 'repository.status_changed') return Result.fail(event)
  const payload = readStatusPayload(event.payload)
  if (Option.isNone(payload)) return Result.fail(event)
  const { projectId, readable, reason, branch, commit, dirty } = payload.value
  return Result.succeed({
    repositoryId: event.entityId,
    projectId,
    status: readable
      ? Readable.make({ branch, commit, dirty })
      : Unreadable.make({ reason: reason ?? '' }),
  })
}

/** Each change of a repository's readability, for as long as the caller listens. */
export const repositoryChanges: Stream.Stream<RepositoryStatusChange, never, DomainEvents> =
  Stream.unwrap(
    Effect.map(
      DomainEvents.use((events) => events.subscribe),
      (committed) => committed.pipe(Stream.filterMap(statusChange)),
    ),
  )
