/**
 * The live diff of a mission (#249, R3): what will be pushed, per repository of its Workspace.
 *
 * - **What it is.** The base side is the merge base of the Workspace's `HEAD` with the base branch
 *   recorded when the Workspace was made (its commit then, when that ref is gone); the live side is
 *   a #140 snapshot of the working tree, staged, unstaged and untracked files included, the user's
 *   index untouched. Commits made in the Workspace are inside the range: the diff is always "base
 *   to what would be pushed".
 * - **Each file** carries Git's letter, its counts or its binary sizes, and whether it is
 *   untracked, generated (Git's attributes or a lockfile's name), large (the two constants below),
 *   changed outside Hemera (#148's result, read and never decided here) or withheld (a sensitive
 *   place: listed, its content never sent). The list carries no content; `file` answers both sides
 *   of one file, masked, and a large one's only when forced.
 * - **Live.** A repository is computed again when the detector of #148 reports a change in the
 *   mission, when a Hemera write or command of the mission ends, and when the window regains the
 *   focus: 250 ms after the last of them, never twice at once. A computation that moves the list
 *   bumps the repository's sequence and is told on `changes`, with only what moved.
 * - **Without the Workspace** (cleaned up, or a mission Done or Cancelled), the diff is read from
 *   the mission's latest checkpoint (#140), from the database alone, and marked as such.
 */

import { isUtf8 } from 'node:buffer'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, posix } from 'node:path'

import { sensitivePlace } from '@hemera/core/domain'
import {
  type DiffChange,
  type DiffCheckpoint,
  type DiffContents,
  type DiffFile,
  type DiffRepository,
  DiffBinary,
  type DiffSide,
  DiffSides,
  DiffText,
  DiffTooLarge,
  DiffWithheld,
  DiffUnreadable,
  type MissionDiff,
  UnknownCheckpoint,
  UnknownDiffFile,
  UnknownMission,
} from '@hemera/ipc'
import { asc, desc, eq } from 'drizzle-orm'
import { Context, Effect, Layer, Option, PubSub, Semaphore, Stream } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { Checkpoints } from '../building/checkpoints.ts'
import { OutsideChanges } from '../building/outside.ts'
import {
  type ChangeStatus,
  type ChangedFile,
  type FileSide,
  Snapshots,
} from '../building/snapshots.ts'
import { latestBuildingIn } from '../building/tasks.ts'
import { DomainEvents } from '../domain-events.ts'
import { Git, type GitBytesSpawn } from '../git.ts'
import { Secrets } from '../secrets.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import {
  buildingLaunches,
  checkpointRepositories,
  checkpoints,
  commandRuns,
  effectfulActions,
  missions,
  workspaceRepositories,
  workspaces,
} from '../storage/schema.ts'

/** A file with more changed lines than this is large (open point of #249, to confirm). */
export const LARGE_LINES = 3_000
/** A file with a side larger than this, in bytes, is large. */
export const LARGE_BYTES = 1024 * 1024
/** How long a repository waits after the last reason to compute it again. */
export const DEBOUNCE_MS = 250

/** Lockfiles, generated whatever the attributes say. */
const LOCKFILES: ReadonlySet<string> = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
  'Cargo.lock',
  'poetry.lock',
  'Gemfile.lock',
  'composer.lock',
  'go.sum',
])

const CHECKPOINT_KINDS = ['review', 'review_entry', 'round_end'] as const

export interface DiffsService {
  /** The mission's diff, each repository computed now; from its last checkpoint without it. */
  readonly live: (missionId: string) => Effect.Effect<MissionDiff, UnknownMission | DatabaseError>
  /** Both sides of one file of the mission's diff, masked; a large one's only when `force`. */
  readonly file: (
    missionId: string,
    repository: string,
    path: string,
    force: boolean,
  ) => Effect.Effect<
    DiffContents,
    UnknownMission | UnknownDiffFile | DiffUnreadable | DatabaseError
  >
  /** The diff a checkpoint kept, from the database alone. */
  readonly atCheckpoint: (
    checkpointId: string,
  ) => Effect.Effect<MissionDiff, UnknownCheckpoint | DatabaseError>
  /** Both sides of one file of a checkpoint. */
  readonly fileAtCheckpoint: (
    checkpointId: string,
    repository: string,
    path: string,
  ) => Effect.Effect<DiffContents, UnknownCheckpoint | UnknownDiffFile | DatabaseError>
  /** What moves in the mission's diff, for as long as the caller listens. */
  readonly changes: (missionId: string) => Stream.Stream<DiffChange, UnknownMission | DatabaseError>
  /** The window regained the focus: every mission followed is computed again. */
  readonly focused: Effect.Effect<void>
  /**
   * One repository of the Workspace computed now, in its turn: its folder, the trees its list lies
   * between and its files; null without the Workspace, or when Git could not read it (#341).
   */
  readonly at: (
    missionId: string,
    repository: string,
  ) => Effect.Effect<RepositoryNow | null, UnknownMission | DatabaseError>
  /** The repositories of the mission's Workspace still on disk, in order; null without it (#341). */
  readonly places: (
    missionId: string,
  ) => Effect.Effect<ReadonlyArray<Place> | null, UnknownMission | DatabaseError>
}

/** A repository of the Workspace as the live diff computed it last. */
export interface RepositoryNow {
  readonly folder: string
  readonly base: string | null
  readonly tree: string
  readonly files: ReadonlyArray<DiffFile>
}

export class Diffs extends Context.Service<Diffs, DiffsService>()('Diffs') {}

/** A repository of the Workspace as the diff reads it. */
export interface Place {
  readonly name: string
  readonly folder: string
  readonly baseRef: string | null
  readonly baseCommit: string | null
}

/** The mission's Workspace still on disk, or null when the diff is read from a checkpoint. */
interface WorkspaceNow {
  readonly id: string
  readonly branch: string | null
  readonly places: ReadonlyArray<Place>
}

/** What the diff last knew of one repository. */
interface Known {
  readonly sequence: number
  readonly repository: DiffRepository
  /** The trees the list was computed between, for its files' sides. */
  readonly base: string | null
  readonly tree: string | null
}

/** Where a repository's computations queue: one at a time, one waiting at most. */
interface Turn {
  readonly turn: Semaphore.Semaphore
  scheduled: boolean
}

const treePathOf = (repository: string, path: string) =>
  repository === '' || repository === '.' ? path : `${repository}/${path}`

/** A ref as a branch is named: `refs/remotes/origin/main` is `origin/main`. */
const branchName = (ref: string | null) => ref?.replace(/^refs\/(?:remotes|heads)\//, '') ?? null

const keyOf = (missionId: string, repository: string) => `${missionId}\u0000${repository}`

const LETTERS: ReadonlyArray<ChangeStatus> = ['A', 'M', 'D', 'R', 'T']
const letterOf = (status: string): ChangeStatus => LETTERS.find((one) => one === status) ?? 'M'

/** A `-z` listing cut on its separators, without the empty field after the last one. */
const fieldsOf = (printed: Buffer): string[] => {
  const cut = printed.toString('utf8').split('\0')
  if (cut.at(-1) === '') cut.pop()
  return cut
}

/**
 * What `git check-attr -z` printed: `<path> NUL <attribute> NUL <value> NUL` for each path and
 * attribute. A path is generated when `linguist-generated` is set or true, or `diff` is unset.
 */
export const generatedOf = (printed: Buffer): ReadonlySet<string> => {
  const parts = fieldsOf(printed)
  const generated = new Set<string>()
  for (let at = 0; at + 2 < parts.length; at += 3) {
    const [path = '', attribute = '', value = ''] = parts.slice(at, at + 3)
    if (attribute === 'linguist-generated' && (value === 'set' || value === 'true')) {
      generated.add(path)
    }
    if (attribute === 'diff' && value === 'unset') generated.add(path)
  }
  return generated
}

/** One side of a file as the window receives it: its text, a binary, or what was withheld. */
const sideOf = (side: FileSide | null): DiffSide | null => {
  if (side === null) return null
  if (side.withheld !== null || side.content === null) {
    return DiffWithheld.make({ reason: side.withheld ?? 'content withheld', size: side.size })
  }
  const bytes = Buffer.from(side.content)
  if (bytes.includes(0) || !isUtf8(bytes)) return DiffBinary.make({ size: side.size })
  return DiffText.make({ text: bytes.toString('utf8'), encoding: 'utf-8', size: side.size })
}

/** A regular file's bytes on disk, or null: a link, a folder or a file gone is not read. */
function diskBytes(path: string): Buffer | null {
  try {
    return lstatSync(path).isFile() ? readFileSync(path) : null
  } catch {
    return null
  }
}

const linesOf = (file: DiffFile) => (file.added ?? 0) + (file.removed ?? 0)

/** What one file of a list is, from Git's listing and what is known around it. */
const fileOf = (
  repository: string,
  changed: Pick<
    ChangedFile,
    'path' | 'oldPath' | 'added' | 'removed' | 'sizeBefore' | 'sizeAfter'
  > & { readonly status: string },
  facts: {
    readonly untracked: boolean
    readonly generated: boolean
    readonly changedOutside: string | null
  },
): DiffFile => {
  const context = { home: homedir(), platform: process.platform }
  const withheld =
    sensitivePlace(changed.path, context) !== null ||
    (changed.oldPath !== null && sensitivePlace(changed.oldPath, context) !== null)
  const lines = (changed.added ?? 0) + (changed.removed ?? 0)
  return {
    repository,
    path: changed.path,
    treePath: treePathOf(repository, changed.path),
    oldPath: changed.oldPath,
    letter: letterOf(changed.status),
    untracked: facts.untracked,
    added: withheld ? null : changed.added,
    removed: withheld ? null : changed.removed,
    binary: !withheld && changed.added === null,
    sizeBefore: changed.sizeBefore,
    sizeAfter: changed.sizeAfter,
    generated: facts.generated || LOCKFILES.has(posix.basename(changed.path)),
    large:
      lines > LARGE_LINES ||
      Math.max(changed.sizeBefore ?? 0, changed.sizeAfter ?? 0) > LARGE_BYTES,
    changedOutside: facts.changedOutside,
    withheld,
  }
}

const repositoryOf = (
  shape: Pick<DiffRepository, 'repository' | 'branch' | 'baseBranch' | 'baseCommit'>,
  files: ReadonlyArray<DiffFile>,
  sequence: number,
  unreadable: string | null,
): DiffRepository => ({
  ...shape,
  files,
  added: files.reduce((sum, file) => sum + (file.added ?? 0), 0),
  removed: files.reduce((sum, file) => sum + (file.removed ?? 0), 0),
  changedOutside: files.some((file) => file.changedOutside !== null),
  sequence,
  unreadable,
})

/** What moved from one list to the next: the files new or changed, the paths gone. */
const movedBetween = (before: ReadonlyArray<DiffFile>, after: ReadonlyArray<DiffFile>) => {
  const was = new Map(before.map((file) => [file.path, JSON.stringify(file)]))
  const now = new Set(after.map((file) => file.path))
  return {
    files: after.filter((file) => was.get(file.path) !== JSON.stringify(file)),
    gone: before.filter((file) => !now.has(file.path)).map((file) => file.path),
  }
}

export const diffsLayer = (run: GitBytesSpawn, log: Log) =>
  Layer.effect(
    Diffs,
    Effect.gen(function* () {
      const database = yield* Database
      const events = yield* DomainEvents
      const git = yield* Git
      const snapshots = yield* Snapshots
      const checkpointsService = yield* Checkpoints
      const outside = yield* OutsideChanges
      const secrets = yield* Secrets
      const said = (line: string) => Effect.sync(() => log(`diff: ${line}`))
      const scope = yield* Effect.scope
      const hub = yield* PubSub.unbounded<{
        readonly missionId: string
        readonly change: DiffChange
      }>()
      const known = new Map<string, Known>()
      const turns = new Map<string, Turn>()
      /** The missions whose diff was asked or is followed, and their Workspace. */
      const followed = new Map<string, string | null>()

      const turnOf = (key: string) => {
        const found = turns.get(key) ?? { turn: Semaphore.makeUnsafe(1), scheduled: false }
        turns.set(key, found)
        return found
      }

      const missionRow = (missionId: string) =>
        database
          .select({ stage: missions.stage })
          .from(missions)
          .where(eq(missions.id, missionId))
          .pipe(
            Effect.mapError(refusedWhile('reading the mission')),
            Effect.flatMap(([row]) =>
              row === undefined
                ? Effect.fail(new UnknownMission({ id: missionId }))
                : Effect.succeed(row),
            ),
          )

      /** The mission's Workspace: its last Building's, or its last launch's. */
      const workspaceIdOf = (missionId: string) =>
        Effect.gen(function* () {
          const building = yield* latestBuildingIn(database, missionId)
          if (building?.workspaceId != null) return building.workspaceId
          const [launch] = yield* database
            .select({ workspaceId: buildingLaunches.workspaceId })
            .from(buildingLaunches)
            .where(eq(buildingLaunches.missionId, missionId))
            .orderBy(desc(buildingLaunches.startedAt))
            .limit(1)
            .pipe(Effect.mapError(refusedWhile('reading the launch')))
          return launch?.workspaceId ?? null
        })

      const workspaceRow = (workspaceId: string | null) =>
        workspaceId === null
          ? Effect.succeed(undefined)
          : database
              .select({ branch: workspaces.branch })
              .from(workspaces)
              .where(eq(workspaces.id, workspaceId))
              .pipe(
                Effect.mapError(refusedWhile('reading the Workspace')),
                Effect.map(([row]) => row),
              )

      /** The Workspace still on disk, or null: the mission is over, or its Workspace is gone. */
      const workspaceNow = (missionId: string) =>
        Effect.gen(function* () {
          const mission = yield* missionRow(missionId)
          const workspaceId = yield* workspaceIdOf(missionId)
          followed.set(missionId, workspaceId)
          if (mission.stage === 'done' || mission.stage === 'cancelled') return null
          if (workspaceId === null) return null
          const workspace = yield* workspaceRow(workspaceId)
          if (workspace === undefined) return null
          const rows = yield* database
            .select()
            .from(workspaceRepositories)
            .where(eq(workspaceRepositories.workspaceId, workspaceId))
            .orderBy(asc(workspaceRepositories.position))
            .pipe(Effect.mapError(refusedWhile('reading the Workspace')))
          if (rows.length === 0 || rows.some((row) => !existsSync(row.worktree))) return null
          const now: WorkspaceNow = {
            id: workspaceId,
            branch: workspace.branch,
            places: rows.map((row) => ({
              name: row.path,
              folder: row.worktree,
              baseRef: row.baseRef,
              baseCommit: row.baseCommit,
            })),
          }
          return now
        })

      /** The commit the diff starts from: the merge base with the base, or its stand-in. */
      const mergeBaseOf = (place: Place, head: string | null) =>
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
          ).pipe(Effect.option)
          return Option.match(printed, {
            onNone: () => place.baseCommit ?? head,
            onSome: (bytes) => bytes.toString('utf8').trim(),
          })
        })

      /** When each file of the mission was first seen changed outside Hemera, by repository. */
      const outsideOf = (missionId: string) =>
        Effect.gen(function* () {
          const listed = yield* outside.list(missionId)
          const since = new Map<string, string>()
          for (const repository of listed) {
            for (const change of repository.changes) {
              if (change.overwrittenBy !== null) continue
              const key = keyOf(repository.repository, change.path)
              const first = since.get(key)
              if (first === undefined || change.detectedAt < first)
                since.set(key, change.detectedAt)
            }
          }
          return since
        })

      /** One repository of the Workspace computed: its list, and the trees it lies between. */
      const computeOne = (
        missionId: string,
        workspace: WorkspaceNow,
        place: Place,
        changedOutside: ReadonlyMap<string, string>,
      ) =>
        Effect.gen(function* () {
          const repository = { name: place.name, folder: place.folder }
          const head = Option.getOrNull(yield* git.commitOf(place.folder, 'HEAD'))
          const base = yield* mergeBaseOf(place, head)
          const tree = yield* snapshots.take(repository, { kind: 'live', missionId })
          const changed = yield* snapshots.changed(missionId, repository, base, tree)
          const untracked = new Set(
            fieldsOf(
              yield* run(
                place.folder,
                ['--no-optional-locks', 'ls-files', '-z', '--others', '--exclude-standard'],
                'read',
              ),
            ),
          )
          const paths = changed.map((file) => file.path)
          const generated =
            paths.length === 0
              ? new Set<string>()
              : generatedOf(
                  yield* run(
                    place.folder,
                    ['check-attr', '-z', '--stdin', 'linguist-generated', 'diff'],
                    'read',
                    { input: Buffer.from(`${paths.join('\0')}\0`) },
                  ),
                )
          const files = changed.map((file) =>
            fileOf(place.name, file, {
              untracked: file.status === 'A' && untracked.has(file.path),
              generated: generated.has(file.path),
              changedOutside: changedOutside.get(keyOf(place.name, file.path)) ?? null,
            }),
          )
          return { files, base, tree, unreadable: null }
        }).pipe(
          Effect.catch((refused) =>
            Effect.succeed({
              files: [],
              base: null,
              tree: null,
              unreadable: refused.message,
            }),
          ),
          Effect.map((computed) => ({
            ...computed,
            shape: {
              repository: place.name,
              branch: workspace.branch,
              baseBranch: branchName(place.baseRef),
              baseCommit: computed.base,
            },
          })),
        )

      /**
       * Computes one repository in its turn, keeps it, and tells what moved: the first computation
       * of a repository sets where its sequence counts from, and tells nothing.
       */
      const recompute = (missionId: string, workspace: WorkspaceNow, place: Place) =>
        Effect.gen(function* () {
          const changedOutside = yield* outsideOf(missionId)
          const computed = yield* computeOne(missionId, workspace, place, changedOutside)
          const key = keyOf(missionId, place.name)
          const last = known.get(key)
          const moved =
            last === undefined ? null : movedBetween(last.repository.files, computed.files)
          const changed =
            moved !== null &&
            (moved.files.length > 0 ||
              moved.gone.length > 0 ||
              last?.repository.unreadable !== computed.unreadable)
          const sequence = (last?.sequence ?? 0) + (changed ? 1 : 0)
          const repository = repositoryOf(
            computed.shape,
            computed.files,
            sequence,
            computed.unreadable,
          )
          known.set(key, { sequence, repository, base: computed.base, tree: computed.tree })
          if (changed && moved !== null) {
            yield* PubSub.publish(hub, {
              missionId,
              change: {
                repository: place.name,
                sequence,
                files: moved.files,
                gone: moved.gone,
                unreadable: computed.unreadable,
              },
            })
          }
          return repository
        }).pipe(Semaphore.withPermits(turnOf(keyOf(missionId, place.name)).turn, 1))

      /** Every repository of the Workspace computed now, in its order. */
      const liveOf = (missionId: string, workspace: WorkspaceNow) =>
        Effect.forEach(workspace.places, (place) => recompute(missionId, workspace, place))

      /** The checkpoint's moment, and its repositories with their files. */
      const checkpointDiff = (checkpointId: string, branch: string | null, missionId: string) =>
        Effect.gen(function* () {
          const [row] = yield* database
            .select()
            .from(checkpoints)
            .where(eq(checkpoints.id, checkpointId))
            .pipe(Effect.mapError(refusedWhile('reading a checkpoint')))
          if (row === undefined) return yield* new UnknownCheckpoint({ id: checkpointId })
          const repositories = yield* database
            .select()
            .from(checkpointRepositories)
            .where(eq(checkpointRepositories.checkpointId, checkpointId))
            .orderBy(asc(checkpointRepositories.position))
            .pipe(Effect.mapError(refusedWhile('reading a checkpoint')))
          const files = yield* checkpointsService.files(checkpointId)
          const changedOutside = yield* outsideOf(missionId)
          const moment: DiffCheckpoint = {
            id: row.id,
            kind: CHECKPOINT_KINDS.find((one) => one === row.kind) ?? 'review',
            takenAt: row.takenAt,
          }
          const diff: MissionDiff = {
            source: 'checkpoint',
            checkpoint: moment,
            repositories: repositories.map((one) =>
              repositoryOf(
                {
                  repository: one.repository,
                  branch,
                  baseBranch: branchName(one.base),
                  baseCommit: one.mergeBase,
                },
                files
                  .filter((file) => file.repository === one.repository)
                  .map((file) =>
                    fileOf(one.repository, file, {
                      untracked: file.untracked,
                      // Git's attributes were the Workspace's: a checkpoint knows the lockfiles.
                      generated: false,
                      changedOutside: changedOutside.get(keyOf(one.repository, file.path)) ?? null,
                    }),
                  ),
                0,
                null,
              ),
            ),
          }
          return diff
        })

      /** The mission's latest checkpoint, or none. */
      const latestCheckpoint = (missionId: string) =>
        database
          .select({ id: checkpoints.id })
          .from(checkpoints)
          .where(eq(checkpoints.missionId, missionId))
          .orderBy(desc(checkpoints.takenAt))
          .limit(1)
          .pipe(
            Effect.mapError(refusedWhile('reading the checkpoints')),
            Effect.map(([row]) => row?.id ?? null),
          )

      /** The mission's diff from its latest checkpoint; nothing before its first. */
      const fromCheckpoint = (missionId: string) =>
        Effect.gen(function* () {
          const checkpointId = yield* latestCheckpoint(missionId)
          if (checkpointId === null) {
            const none: MissionDiff = { source: 'checkpoint', checkpoint: null, repositories: [] }
            return none
          }
          const branch = (yield* workspaceRow(followed.get(missionId) ?? null))?.branch ?? null
          return yield* checkpointDiff(checkpointId, branch, missionId).pipe(
            Effect.catchTag('UnknownCheckpoint', () =>
              Effect.die(`checkpoint ${checkpointId} vanished`),
            ),
          )
        })

      const live = (missionId: string) =>
        Effect.gen(function* () {
          const workspace = yield* workspaceNow(missionId)
          if (workspace === null) return yield* fromCheckpoint(missionId)
          const diff: MissionDiff = {
            source: 'live',
            checkpoint: null,
            repositories: yield* liveOf(missionId, workspace),
          }
          return diff
        })

      /** Both sides of a listed file, or "too large" until forced. */
      const contentsOf = <E>(
        file: DiffFile,
        force: boolean,
        read: Effect.Effect<
          { readonly before: FileSide | null; readonly after: FileSide | null } | null,
          E
        >,
      ) =>
        Effect.gen(function* () {
          if (file.large && !force) {
            const tooLarge: DiffContents = DiffTooLarge.make({
              sizeBefore: file.sizeBefore,
              sizeAfter: file.sizeAfter,
              lines: linesOf(file),
            })
            return tooLarge
          }
          const sides = yield* read
          if (sides === null) {
            return yield* new UnknownDiffFile({ repository: file.repository, path: file.path })
          }
          const contents: DiffContents = DiffSides.make({
            before: sideOf(sides.before),
            after: sideOf(sides.after),
          })
          return contents
        })

      const fileAtCheckpoint = (
        checkpointId: string,
        repository: string,
        path: string,
        force: boolean,
      ) =>
        Effect.gen(function* () {
          const [row] = yield* database
            .select({ missionId: checkpoints.missionId })
            .from(checkpoints)
            .where(eq(checkpoints.id, checkpointId))
            .pipe(Effect.mapError(refusedWhile('reading a checkpoint')))
          if (row === undefined) return yield* new UnknownCheckpoint({ id: checkpointId })
          const diff = yield* checkpointDiff(checkpointId, null, row.missionId)
          const file = diff.repositories
            .find((one) => one.repository === repository)
            ?.files.find((one) => one.path === path)
          if (file === undefined) return yield* new UnknownDiffFile({ repository, path })
          return yield* contentsOf(
            file,
            force,
            checkpointsService.diff(checkpointId, repository, path),
          )
        })

      const file = (missionId: string, repository: string, path: string, force: boolean) =>
        Effect.gen(function* () {
          const workspace = yield* workspaceNow(missionId)
          if (workspace === null) {
            const checkpointId = yield* latestCheckpoint(missionId)
            if (checkpointId === null) return yield* new UnknownDiffFile({ repository, path })
            return yield* fileAtCheckpoint(checkpointId, repository, path, force).pipe(
              Effect.catchTag('UnknownCheckpoint', () =>
                Effect.fail(new UnknownDiffFile({ repository, path })),
              ),
            )
          }
          const place = workspace.places.find((one) => one.name === repository)
          if (place === undefined) return yield* new UnknownDiffFile({ repository, path })
          const key = keyOf(missionId, repository)
          const listed = known.get(key)
          if (listed === undefined || !listed.repository.files.some((one) => one.path === path)) {
            yield* recompute(missionId, workspace, place)
          }
          const current = known.get(key)
          const found = current?.repository.files.find((one) => one.path === path)
          if (current === undefined || found === undefined || current.tree === null) {
            return yield* new UnknownDiffFile({ repository, path })
          }
          const { base, tree } = current
          return yield* contentsOf(
            found,
            force,
            snapshots
              .diff(missionId, { name: place.name, folder: place.folder }, base, tree, path)
              .pipe(
                Effect.map((diffs) => diffs.find((one) => one.path === path) ?? null),
                Effect.catchTag('SnapshotUnavailable', (unavailable) =>
                  Effect.fail(new DiffUnreadable({ reason: unavailable.message })),
                ),
                Effect.flatMap((sides) =>
                  sides === null ? Effect.succeed(null) : checkedOut(place, base, found, sides),
                ),
              ),
          )
        })

      /** A text's bytes as they are kept: masked when they hold a known secret. */
      const textSide = (side: FileSide, bytes: Buffer): FileSide => {
        if (bytes.includes(0) || !isUtf8(bytes)) return side
        const original = bytes.toString('utf8')
        const masked = secrets.mask(original)
        return {
          ...side,
          size: bytes.length,
          content: Buffer.from(masked, 'utf8'),
          masked: masked !== original,
        }
      }

      /**
       * Both sides as the user's checkout has them, on any Git configuration: the snapshot holds
       * what Git stores (`core.autocrlf` or `eol` turn CRLF into LF), so the live side is read from
       * the disk, and the base side through Git's line-ending conversions. A file whose attributes
       * name a filter driver keeps both sides as stored, as the list counted them: a driver is a
       * program of the user's, and what it checks out (git-lfs's bytes) is never read.
       */
      const checkedOut = (
        place: Place,
        base: string | null,
        found: DiffFile,
        sides: { readonly before: FileSide | null; readonly after: FileSide | null },
      ) =>
        Effect.gen(function* () {
          const readable = (side: FileSide | null): side is FileSide =>
            side !== null && side.withheld === null && side.content !== null
          if (!readable(sides.before) && !readable(sides.after)) return sides
          const stored = found.oldPath ?? found.path
          const filtered = yield* run(
            place.folder,
            ['check-attr', '-z', 'filter', '--', ...new Set([stored, found.path])],
            'read',
          ).pipe(
            Effect.map((printed) =>
              fieldsOf(printed).some((value, at) => at % 3 === 2 && value !== 'unspecified'),
            ),
            Effect.orElseSucceed(() => true),
          )
          if (filtered) return sides
          const onDisk = readable(sides.after) ? diskBytes(join(place.folder, found.path)) : null
          const after =
            onDisk === null || sides.after === null ? sides.after : textSide(sides.after, onDisk)
          const was = sides.before
          const before =
            readable(was) && base !== null
              ? yield* run(
                  place.folder,
                  ['cat-file', '--filters', `${base}:${stored}`],
                  'read',
                ).pipe(
                  Effect.map((bytes) => textSide(was, bytes)),
                  Effect.orElseSucceed(() => was),
                )
              : was
          return { before, after }
        })

      /** A reason to compute the mission's repositories again: each one 250 ms after the last. */
      const refresh = (missionId: string) =>
        Effect.gen(function* () {
          const workspace = yield* workspaceNow(missionId)
          if (workspace === null) return
          for (const place of workspace.places) {
            const turn = turnOf(keyOf(missionId, place.name))
            if (turn.scheduled) continue
            turn.scheduled = true
            yield* Effect.forkIn(
              Effect.sleep(DEBOUNCE_MS).pipe(
                Effect.andThen(
                  Effect.sync(() => {
                    turn.scheduled = false
                  }),
                ),
                Effect.andThen(recompute(missionId, workspace, place)),
                Effect.catchCause((cause) =>
                  said(`${missionId}/${place.name} was not computed: ${String(cause)}`),
                ),
              ),
              scope,
            )
          }
        }).pipe(
          Effect.catchCause((cause) => said(`${missionId} was not computed: ${String(cause)}`)),
        )

      /** The missions a committed event concerns: a write or a command that ended. */
      const missionsOf = (type: string, entityId: string) =>
        Effect.gen(function* () {
          if (type === 'action.done' || type === 'action.failed') {
            const [action] = yield* database
              .select({ ownerKind: effectfulActions.ownerKind, ownerId: effectfulActions.ownerId })
              .from(effectfulActions)
              .where(eq(effectfulActions.id, entityId))
              .pipe(Effect.mapError(refusedWhile('reading an action')))
            return action?.ownerKind === 'mission' ? [action.ownerId] : []
          }
          if (type === 'run.ended') {
            const [ended] = yield* database
              .select({ missionId: commandRuns.missionId, workspaceId: commandRuns.workspaceId })
              .from(commandRuns)
              .where(eq(commandRuns.id, entityId))
              .pipe(Effect.mapError(refusedWhile('reading a run')))
            if (ended === undefined) return []
            if (ended.missionId !== null) return [ended.missionId]
            return [...followed]
              .filter(
                ([, workspaceId]) => workspaceId !== null && workspaceId === ended.workspaceId,
              )
              .map(([missionId]) => missionId)
          }
          return []
        })

      const committed = yield* events.subscribe
      yield* Effect.forkScoped(
        Stream.runForEach(committed, (event) =>
          missionsOf(event.type, event.entityId).pipe(
            Effect.flatMap((ids) =>
              Effect.forEach(
                ids.filter((id) => followed.has(id)),
                refresh,
                { discard: true },
              ),
            ),
            Effect.catchCause((cause) => said(`an event was not followed: ${String(cause)}`)),
          ),
        ),
      )
      yield* Effect.forkScoped(
        Stream.runForEach(outside.changes, (missionId) =>
          followed.has(missionId) ? refresh(missionId) : Effect.void,
        ),
      )

      const service: DiffsService = {
        live,
        file,
        atCheckpoint: (checkpointId) =>
          Effect.gen(function* () {
            const [row] = yield* database
              .select({ missionId: checkpoints.missionId })
              .from(checkpoints)
              .where(eq(checkpoints.id, checkpointId))
              .pipe(Effect.mapError(refusedWhile('reading a checkpoint')))
            if (row === undefined) return yield* new UnknownCheckpoint({ id: checkpointId })
            const branch =
              (yield* workspaceRow(yield* workspaceIdOf(row.missionId)))?.branch ?? null
            return yield* checkpointDiff(checkpointId, branch, row.missionId)
          }),
        fileAtCheckpoint: (checkpointId, repository, path) =>
          fileAtCheckpoint(checkpointId, repository, path, true),
        changes: (missionId) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const subscription = yield* PubSub.subscribe(hub)
              // Where the sequence counts from, before anything moves.
              const workspace = yield* workspaceNow(missionId)
              if (workspace !== null) {
                for (const place of workspace.places) {
                  if (!known.has(keyOf(missionId, place.name))) {
                    yield* recompute(missionId, workspace, place)
                  }
                }
              }
              return Stream.fromSubscription(subscription).pipe(
                Stream.filter((told) => told.missionId === missionId),
                Stream.map((told) => told.change),
              )
            }),
          ),
        focused: Effect.suspend(() =>
          Effect.forEach([...followed.keys()], refresh, { discard: true }),
        ),
        places: (missionId) =>
          Effect.map(workspaceNow(missionId), (workspace) => workspace?.places ?? null),
        at: (missionId, repository) =>
          Effect.gen(function* () {
            const workspace = yield* workspaceNow(missionId)
            const place = workspace?.places.find((one) => one.name === repository)
            if (workspace === null || place === undefined) return null
            yield* recompute(missionId, workspace, place)
            const current = known.get(keyOf(missionId, repository))
            if (current === undefined || current.tree === null) return null
            const now: RepositoryNow = {
              folder: place.folder,
              base: current.base,
              tree: current.tree,
              files: current.repository.files,
            }
            return now
          }),
      }
      return service
    }),
  )
