/**
 * The checkpoints of a mission's Workspace (#140, CT-01): at a key moment (before the automatic
 * review, at the entry into Review, at the end of each round), each repository's `HEAD`, the
 * snapshot tree of its working tree with untracked files, its base branch and the merge base of
 * `HEAD` with it, and the files from the merge base to the tree with their contents, copied into
 * the database. A checkpoint is read from the database alone: the same whether its Workspace still
 * exists or not.
 *
 * Git runs first, repository by repository, outside any transaction; then one transaction writes
 * the contents and the checkpoint. A sensitive file keeps its path and fingerprint only.
 */

import { and, asc, eq } from 'drizzle-orm'
import { Context, Effect, Layer, Option } from 'effect'

import { DomainEvents } from '../domain-events.ts'
import { Git, type GitBytesSpawn, type GitRefusal } from '../git.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import {
  checkpointFiles,
  checkpointRepositories,
  checkpoints,
  fileContents,
} from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import {
  type Captured,
  type ChangeStatus,
  type FileDiff,
  type FileSide,
  SnapshotFailed,
  Snapshots,
  keepCaptured,
} from './snapshots.ts'

/** The moment a checkpoint is taken at. */
export type CheckpointKind = 'review' | 'review_entry' | 'round_end'

/**
 * A repository of the Workspace as a checkpoint takes it: its name there, its working tree, and
 * its base (CT-24): the remote ref of its base branch (`origin/main`) and the commit the Workspace
 * recorded as its base, either of which may be missing.
 */
export interface CheckpointPlace {
  readonly name: string
  readonly folder: string
  readonly baseRef: string | null
  readonly baseCommit: string | null
}

/** One file of a checkpoint, from the merge base to the tree. */
export interface CheckpointFile {
  readonly repository: string
  readonly path: string
  readonly oldPath: string | null
  readonly status: ChangeStatus
  readonly added: number | null
  readonly removed: number | null
  readonly binary: boolean
  /** Whether Git does not track it in the working tree. */
  readonly untracked: boolean
  readonly sizeBefore: number | null
  readonly sizeAfter: number | null
}

export interface CheckpointsService {
  /** Takes a checkpoint of each repository, writes it, and answers its id. */
  readonly take: (
    missionId: string,
    kind: CheckpointKind,
    places: ReadonlyArray<CheckpointPlace>,
  ) => Effect.Effect<string, SnapshotFailed | DatabaseError>
  /** Its files, repository by repository in the order taken, each in Git's order. */
  readonly files: (
    checkpointId: string,
  ) => Effect.Effect<ReadonlyArray<CheckpointFile>, DatabaseError>
  /** One file with both its sides, null when the checkpoint does not list it. */
  readonly diff: (
    checkpointId: string,
    repository: string,
    path: string,
  ) => Effect.Effect<FileDiff | null, DatabaseError>
  /** One side of a file, null when the file does not have it or is not listed. */
  readonly content: (
    checkpointId: string,
    repository: string,
    path: string,
    side: 'before' | 'after',
  ) => Effect.Effect<FileSide | null, DatabaseError>
}

export class Checkpoints extends Context.Service<Checkpoints, CheckpointsService>()(
  'Checkpoints',
) {}

/** What `git ls-files --others --exclude-standard -z` printed: the untracked files. */
const untrackedOf = (printed: Buffer): ReadonlySet<string> =>
  new Set(
    printed
      .toString('utf8')
      .split('\0')
      .filter((path) => path !== ''),
  )

/** What Git found of one repository, before the transaction that writes it. */
interface Taken {
  readonly place: CheckpointPlace
  readonly head: string | null
  readonly tree: string
  readonly mergeBase: string | null
  readonly untracked: ReadonlySet<string>
  readonly captured: Captured
}

type FileRow = typeof checkpointFiles.$inferSelect

/** The checkpoints over a spawn of Git: the machine's own, through the engine's limits and mask. */
export const checkpointsLayer = (run: GitBytesSpawn) =>
  Layer.effect(
    Checkpoints,
    Effect.gen(function* () {
      const database = yield* Database
      const events = yield* DomainEvents
      const git = yield* Git
      const snapshots = yield* Snapshots

      /** A refusal of Git's while a checkpoint is taken, recorded as `snapshot.failed`. */
      const refused =
        (missionId: string, place: CheckpointPlace, checkpointId: string) => (cause: GitRefusal) =>
          Effect.gen(function* () {
            const failure = new SnapshotFailed({
              repository: place.name,
              owner: `checkpoint ${checkpointId}`,
              said: cause.message,
            })
            yield* snapshots.failed(missionId, failure)
            return yield* failure
          })

      /** The commit the files are listed from: the merge base with the base, or its stand-in. */
      const mergeBaseOf = (place: CheckpointPlace, head: string | null) =>
        Effect.gen(function* () {
          if (head === null) return null
          const remote =
            place.baseRef === null
              ? Option.none()
              : yield* git.commitOf(place.folder, place.baseRef)
          if (Option.isNone(remote)) return place.baseCommit ?? head
          const printed = yield* run(
            place.folder,
            ['merge-base', '--end-of-options', head, remote.value],
            'read',
          )
          return printed.toString('utf8').trim()
        })

      const takeOne = (missionId: string, checkpointId: string, place: CheckpointPlace) =>
        Effect.gen(function* () {
          const orRefused = refused(missionId, place, checkpointId)
          const repository = { name: place.name, folder: place.folder }
          const head = Option.getOrNull(
            yield* git.commitOf(place.folder, 'HEAD').pipe(Effect.catch(orRefused)),
          )
          const tree = yield* snapshots.take(repository, {
            kind: 'checkpoint',
            missionId,
            checkpointId,
          })
          const mergeBase = yield* mergeBaseOf(place, head).pipe(Effect.catch(orRefused))
          const recorded = (failure: SnapshotFailed) => snapshots.failed(missionId, failure)
          const files = yield* snapshots
            .changed(missionId, repository, mergeBase, tree)
            .pipe(Effect.tapError(recorded))
          const untracked = untrackedOf(
            yield* run(
              place.folder,
              ['--no-optional-locks', 'ls-files', '--others', '--exclude-standard', '-z'],
              'read',
            ).pipe(Effect.catch(orRefused)),
          )
          const captured = yield* snapshots
            .collect(missionId, repository, mergeBase, tree, files)
            .pipe(Effect.tapError(recorded))
          const taken: Taken = { place, head, tree, mergeBase, untracked, captured }
          return taken
        })

      const readRows = (checkpointId: string, where?: { repository: string; path: string }) =>
        database
          .select()
          .from(checkpointFiles)
          .innerJoin(
            checkpointRepositories,
            and(
              eq(checkpointRepositories.checkpointId, checkpointFiles.checkpointId),
              eq(checkpointRepositories.repository, checkpointFiles.repository),
            ),
          )
          .where(
            and(
              eq(checkpointFiles.checkpointId, checkpointId),
              where === undefined ? undefined : eq(checkpointFiles.repository, where.repository),
              where === undefined ? undefined : eq(checkpointFiles.path, where.path),
            ),
          )
          .orderBy(asc(checkpointRepositories.position), asc(checkpointFiles.position))
          .pipe(
            Effect.map((rows) => rows.map((row) => row.checkpoint_files)),
            Effect.mapError(refusedWhile('reading a checkpoint')),
          )

      /** One side of a row, its content joined. */
      const sideOf = (row: FileRow, side: 'before' | 'after') =>
        Effect.gen(function* () {
          const sha256 = side === 'before' ? row.beforeSha256 : row.afterSha256
          const size = side === 'before' ? row.beforeSize : row.afterSize
          const withheld = side === 'before' ? row.beforeWithheld : row.afterWithheld
          if (sha256 === null || size === null) return null
          const [content] =
            withheld === null
              ? yield* database
                  .select()
                  .from(fileContents)
                  .where(eq(fileContents.sha256, sha256))
                  .pipe(Effect.mapError(refusedWhile('reading a checkpoint')))
              : []
          const kept: FileSide = {
            sha256,
            size,
            content: content?.bytes ?? null,
            withheld,
            masked: content?.masked ?? false,
          }
          return kept
        })

      const statusOf = (row: FileRow): ChangeStatus =>
        (['A', 'M', 'D', 'R', 'T'] as const).find((one) => one === row.status) ?? 'M'

      const service: CheckpointsService = {
        take: (missionId, kind, places) =>
          Effect.gen(function* () {
            const id = crypto.randomUUID()
            const taken: Taken[] = []
            for (const place of places) taken.push(yield* takeOne(missionId, id, place))
            yield* mutate('writing a checkpoint', (transaction) =>
              Effect.gen(function* () {
                yield* transaction
                  .insert(checkpoints)
                  .values({ id, missionId, kind, takenAt: new Date().toISOString() })
                for (const [position, one] of taken.entries()) {
                  yield* keepCaptured(transaction, one.captured)
                  yield* transaction.insert(checkpointRepositories).values({
                    checkpointId: id,
                    repository: one.place.name,
                    position,
                    head: one.head,
                    tree: one.tree,
                    base: one.place.baseRef,
                    mergeBase: one.mergeBase,
                  })
                  for (const [at, file] of one.captured.files.entries()) {
                    yield* transaction.insert(checkpointFiles).values({
                      checkpointId: id,
                      repository: one.place.name,
                      position: at,
                      path: file.path,
                      oldPath: file.oldPath,
                      status: file.status,
                      added: file.added,
                      removed: file.removed,
                      untracked: one.untracked.has(file.path),
                      beforeSha256: file.before?.sha256 ?? null,
                      beforeSize: file.before?.size ?? null,
                      beforeWithheld: file.before?.withheld ?? null,
                      afterSha256: file.after?.sha256 ?? null,
                      afterSize: file.after?.size ?? null,
                      afterWithheld: file.after?.withheld ?? null,
                    })
                  }
                }
                return { result: id, events: [] }
              }).pipe(Effect.mapError(refusedWhile('writing a checkpoint'))),
            )
            return id
          }).pipe(
            Effect.provideService(Database, database),
            Effect.provideService(DomainEvents, events),
          ),
        files: (checkpointId) =>
          readRows(checkpointId).pipe(
            Effect.map((rows) =>
              rows.map((row): CheckpointFile => ({
                repository: row.repository,
                path: row.path,
                oldPath: row.oldPath,
                status: statusOf(row),
                added: row.added,
                removed: row.removed,
                binary: row.added === null,
                untracked: row.untracked,
                sizeBefore: row.beforeSize,
                sizeAfter: row.afterSize,
              })),
            ),
          ),
        diff: (checkpointId, repository, path) =>
          Effect.gen(function* () {
            const [row] = yield* readRows(checkpointId, { repository, path })
            if (row === undefined) return null
            const diff: FileDiff = {
              path: row.path,
              oldPath: row.oldPath,
              status: statusOf(row),
              added: row.added,
              removed: row.removed,
              before: yield* sideOf(row, 'before'),
              after: yield* sideOf(row, 'after'),
            }
            return diff
          }),
        content: (checkpointId, repository, path, side) =>
          Effect.gen(function* () {
            const [row] = yield* readRows(checkpointId, { repository, path })
            return row === undefined ? null : yield* sideOf(row, side)
          }),
      }
      return service
    }),
  )
