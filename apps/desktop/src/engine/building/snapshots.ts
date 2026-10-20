/**
 * The invisible snapshots of a Building (#140, CT-01) and of a Freeze's main checkout (#208), and
 * the copy of what they hold.
 *
 * A snapshot is a Git tree and nothing more, written into Hemera's own object store: one bare
 * repository per Project, `<data folder>/snapshots/<project-id>.git`. The working tree is added
 * whole to a copy of the user's index (`git rev-parse --git-path index`, a linked worktree's own),
 * in a temporary folder removed however the snapshot ends; `GIT_OBJECT_DIRECTORY` sends what Git
 * writes to a folder apart in the store, moved into it once the snapshot is whole (one a crash
 * left behind is swept when the store opens), and the user's
 * object folder is lent as an alternate, read only. A link is stored as itself, never followed. The user's
 * repository receives no object, no ref and no index change. Each tree is held by a ref of the
 * store, `refs/hemera/<mission-id>/…/<repository>`, the repository last: a Workspace has several
 * repositories, and a ref is never a folder of another.
 *
 * What a tree borrows from the user's repository can disappear once the Workspace's branch is
 * deleted and Git collects it, so `capture` copies the content before and after of each changed
 * file into the database, deduplicated by the sha256 of the original bytes: masked first when it
 * is text, binaries as they are, and nothing of a sensitive file but its path and its fingerprint.
 * `read` and `diff` answer from the store while it is complete, and from the database otherwise,
 * the same answer either way.
 *
 * Every Git call goes through the engine's spawn and its limits, never inside a transaction: a use
 * case takes its snapshot, then writes the row that names it.
 */

import { isUtf8 } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, relative } from 'node:path'

import { type RunnerTree, sensitivePlace } from '@hemera/core/domain'
import { and, asc, count, countDistinct, eq, or } from 'drizzle-orm'
import { Context, Effect, Layer, Option, Predicate, Schema } from 'effect'

import { DomainEvents } from '../domain-events.ts'
import type { GitBytesSpawn, GitRefusal } from '../git.ts'
import { ProfileHome } from '../profile-home.ts'
import { Secrets } from '../secrets.ts'
import {
  Database,
  type DatabaseError,
  type EngineTransaction,
  refusedWhile,
} from '../storage/database.ts'
import {
  fileContents,
  missions,
  projectRepositories,
  projects,
  snapshotChanges,
  snapshotFiles,
} from '../storage/schema.ts'
import { readOwnSync } from '../tools/judged.ts'
import { mutate } from '../transaction.ts'
import { recordTreeIn } from './proof-store.ts'

/**
 * The most of a file a snapshot reads itself (the user's index, a sensitive file it withholds):
 * far above any index Git writes, and what keeps a file planted there from filling the engine.
 */
export const READ_CAP = 256 * 1024 * 1024

/**
 * Why a snapshot is refused when the Git folder its repository names is not the repository's own
 * (#439): a worktree's `.git` an agent pointed at a Git folder of its own making, whose index the
 * snapshot would otherwise read.
 */
export const FOREIGN_GIT_FOLDER =
  "its Git folder is not the repository's own (the Git folder of one of its Project's repositories in the main checkout, or a worktree's entry in it)"

/** The folder of the data folder that holds the snapshot stores, one per Project. */
export const SNAPSHOTS_FOLDER = 'snapshots'

/** The tree of nothing, which every Git knows by this id: the side before a first commit. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** A repository of a Workspace: its name there, and the folder of its working tree. */
export interface RepositoryPlace {
  readonly name: string
  readonly folder: string
}

/** What a snapshot is taken for, which names the ref that holds its tree. */
export type SnapshotOwner =
  | {
      readonly kind: 'attempt'
      readonly missionId: string
      readonly attemptId: string
      readonly side: 'start' | 'end'
    }
  | { readonly kind: 'checkpoint'; readonly missionId: string; readonly checkpointId: string }
  | { readonly kind: 'building'; readonly missionId: string; readonly buildingId: string }
  | {
      readonly kind: 'run'
      readonly missionId: string
      readonly runId: string
      readonly side: 'before' | 'after'
    }
  | { readonly kind: 'freeze'; readonly missionId: string; readonly freezeId: string }
  /** The last tree the detector of changes outside Hemera compared (#148). */
  | { readonly kind: 'outside'; readonly missionId: string; readonly buildingId: string }
  /** The tree a Building left its end with, compared with its review checkpoint (#147). */
  | { readonly kind: 'review_exit'; readonly missionId: string; readonly buildingId: string }
  /** The Workspace as the live diff last read it (#249). */
  | { readonly kind: 'live'; readonly missionId: string }
  /** The Workspace a code comment of Review was written on, kept as long as the mission (#341). */
  | { readonly kind: 'feedback'; readonly missionId: string; readonly feedbackId: string }

/** Git's letter for a change: added, modified, deleted, renamed, or its type changed. */
export type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'T'

/** One file changed between two trees, in Git's order. */
export interface ChangedFile {
  /** Its path in the later tree; a deleted file's path in the earlier one. */
  readonly path: string
  /** Its path before a rename, null otherwise. */
  readonly oldPath: string | null
  readonly status: ChangeStatus
  /** Lines added and removed, null for a binary file. */
  readonly added: number | null
  readonly removed: number | null
  /** The size in bytes of each side, null for the side the file does not have. */
  readonly sizeBefore: number | null
  readonly sizeAfter: number | null
}

/** One side of a file as Hemera keeps it. */
export interface FileSide {
  /** The fingerprint of the original bytes, and the key of the content kept. */
  readonly sha256: string
  /** The original's size in bytes. */
  readonly size: number
  /** The content as it is kept (masked when `masked`), null when withheld. */
  readonly content: Uint8Array | null
  /** Why the content was not copied ("content withheld: .env"), null when it was. */
  readonly withheld: string | null
  readonly masked: boolean
}

/** One changed file with both its sides, null for the side it does not have. */
export interface FileDiff {
  readonly path: string
  readonly oldPath: string | null
  readonly status: ChangeStatus
  readonly added: number | null
  readonly removed: number | null
  readonly before: FileSide | null
  readonly after: FileSide | null
}

/** What the store and the database hold for one repository of a mission. */
export interface RepositoryDiagnosis {
  readonly repository: string
  /** The refs of the store that hold its trees. */
  readonly refs: ReadonlyArray<string>
  /** The file sides copied, and the distinct contents they name. */
  readonly files: number
  readonly contents: number
}

/** A snapshot, a listing or a capture Git refused, in Git's words, masked. */
export class SnapshotFailed extends Schema.TaggedError<SnapshotFailed>()('SnapshotFailed', {
  repository: Schema.String,
  owner: Schema.String,
  said: Schema.String,
}) {
  override get message(): string {
    return this.said
  }
}

/** Neither the store nor the database can say what a tree held. */
export class SnapshotUnavailable extends Schema.TaggedError<SnapshotUnavailable>()(
  'SnapshotUnavailable',
  { repository: Schema.String, tree: Schema.String, path: Schema.NullOr(Schema.String) },
) {
  override get message(): string {
    const what = this.path === null ? 'the changes' : this.path
    return `Hemera has neither the tree ${this.tree} of ${this.repository} nor a copy of ${what}.`
  }
}

export interface SnapshotsService {
  /**
   * Writes the working tree as it stands, staged, unstaged and untracked changes included and
   * ignored files left out, into the store, holds it by the owner's ref, and answers its id.
   */
  readonly take: (
    repository: RepositoryPlace,
    owner: SnapshotOwner,
  ) => Effect.Effect<string, SnapshotFailed>
  /**
   * Every file of a tree of the mission's store, and the target of each of its links, as the link
   * holds it (#479: what a red's runner reads).
   */
  readonly listing: (
    missionId: string,
    repository: RepositoryPlace,
    tree: string,
  ) => Effect.Effect<RunnerTree, SnapshotFailed>
  /** The files changed between two trees of the mission's store; null is the empty tree. */
  readonly changed: (
    missionId: string,
    repository: RepositoryPlace,
    fromTree: string | null,
    toTree: string,
  ) => Effect.Effect<ReadonlyArray<ChangedFile>, SnapshotFailed>
  /** Copies the content before and after of each file listed into the database; idempotent. */
  readonly capture: (
    missionId: string,
    repository: RepositoryPlace,
    fromTree: string | null,
    toTree: string,
    files: ReadonlyArray<ChangedFile>,
  ) => Effect.Effect<void, SnapshotFailed | DatabaseError>
  /**
   * What `capture` copies, read from Git and nothing written: for a caller that writes it in its
   * own transaction with `keepCaptured`.
   */
  readonly collect: (
    missionId: string,
    repository: RepositoryPlace,
    fromTree: string | null,
    toTree: string,
    files: ReadonlyArray<ChangedFile>,
  ) => Effect.Effect<Captured, SnapshotFailed>
  /** One file of a tree, null when the tree does not hold it. */
  readonly read: (
    missionId: string,
    repository: RepositoryPlace,
    tree: string,
    path: string,
  ) => Effect.Effect<FileSide | null, SnapshotUnavailable | DatabaseError>
  /** The files changed between two trees with their sides, or the one at `path`. */
  readonly diff: (
    missionId: string,
    repository: RepositoryPlace,
    fromTree: string | null,
    toTree: string,
    path?: string,
  ) => Effect.Effect<ReadonlyArray<FileDiff>, SnapshotUnavailable | DatabaseError>
  /**
   * Writes a tree of the store into an empty folder, as files to read (#147: the reviewers' copy
   * of a checkpoint): a sensitive file is its stand-in there, as in the tree.
   */
  readonly materialize: (
    missionId: string,
    repository: RepositoryPlace,
    tree: string,
    folder: string,
  ) => Effect.Effect<void, SnapshotFailed>
  /** The refs and the copied rows of a mission, per repository: for diagnosis. */
  readonly diagnose: (
    missionId: string,
  ) => Effect.Effect<ReadonlyArray<RepositoryDiagnosis>, DatabaseError>
  /** Records a failed snapshot or checkpoint as `snapshot.failed`, for the caller's Journal line. */
  readonly failed: (missionId: string, failure: SnapshotFailed) => Effect.Effect<void>
}

export class Snapshots extends Context.Service<Snapshots, SnapshotsService>()('Snapshots') {}

/** What a capture read from Git, nothing written yet: written by `keepCaptured`. */
export interface Captured {
  readonly missionId: string
  readonly repository: string
  readonly fromTree: string
  readonly toTree: string
  readonly files: ReadonlyArray<FileDiff>
}

/**
 * A name as one segment of a ref: letters, digits, `-` and `_` as they are, every other byte as
 * `%XX`, and the Workspace's root (an empty name) as a lone `%`, which no name encodes to.
 */
export const refSegment = (name: string): string =>
  name === ''
    ? '%'
    : [...Buffer.from(name, 'utf8')]
        .map((byte) => {
          const character = String.fromCharCode(byte)
          return /[A-Za-z0-9_-]/.test(character)
            ? character
            : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
        })
        .join('')

/** A segment of a ref read back as the name it encodes. */
export const nameOfSegment = (segment: string): string =>
  segment === '%' ? '' : decodeURIComponent(segment)

/** The ref of the store that holds an owner's tree of one repository. */
export function refOf(owner: SnapshotOwner, repository: string): string {
  const mission = `refs/hemera/${owner.missionId}`
  const leaf = refSegment(repository)
  switch (owner.kind) {
    case 'attempt':
      return `${mission}/${owner.attemptId}/${owner.side}/${leaf}`
    case 'checkpoint':
      return `${mission}/checkpoints/${owner.checkpointId}/${leaf}`
    case 'building':
      return `${mission}/buildings/${owner.buildingId}/base/${leaf}`
    case 'run':
      return `${mission}/runs/${owner.runId}/${owner.side}/${leaf}`
    case 'freeze':
      return `${mission}/freezes/${owner.freezeId}/${leaf}`
    case 'outside':
      return `${mission}/buildings/${owner.buildingId}/outside/${leaf}`
    case 'review_exit':
      return `${mission}/buildings/${owner.buildingId}/review-exit/${leaf}`
    case 'live':
      return `${mission}/live/${leaf}`
    case 'feedback':
      return `${mission}/feedback/${owner.feedbackId}/${leaf}`
  }
}

/** An owner as the journal names it. */
export function ownerText(owner: SnapshotOwner): string {
  switch (owner.kind) {
    case 'attempt':
      return `attempt ${owner.attemptId} ${owner.side}`
    case 'checkpoint':
      return `checkpoint ${owner.checkpointId}`
    case 'building':
      return `the base of Building ${owner.buildingId}`
    case 'run':
      return `run ${owner.runId} ${owner.side}`
    case 'freeze':
      return `the Freeze ${owner.freezeId}`
    case 'outside':
      return `the Workspace compared for Building ${owner.buildingId}`
    case 'review_exit':
      return `the end of Building ${owner.buildingId}`
    case 'live':
      return 'the live diff'
    case 'feedback':
      return `the comment ${owner.feedbackId}`
  }
}

/**
 * An object folder as `GIT_ALTERNATE_OBJECT_DIRECTORIES` reads it: the list separator is the
 * platform's (`:`, or `;` on Windows), so a folder holding it, or starting with a quote, is
 * written quoted as Git unquotes it.
 */
export const alternateOf = (objects: string): string =>
  objects.includes(delimiter) || objects.startsWith('"')
    ? `"${objects.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
    : objects

/** One entry of `git diff-tree --raw -z`, with the blobs and modes of both sides. */
interface RawChange {
  readonly path: string
  readonly oldPath: string | null
  readonly status: ChangeStatus
  readonly modeBefore: string
  readonly modeAfter: string
  readonly blobBefore: string
  readonly blobAfter: string
}

const ABSENT_MODE = '000000'
const SUBMODULE_MODE = '160000'
const LINK_MODE = '120000'
const STATUSES: ReadonlyArray<ChangeStatus> = ['A', 'M', 'D', 'R', 'T']

/**
 * What a snapshot's tree holds in place of a sensitive file's content: its fingerprint and its
 * size, never its bytes, so neither the store nor a backup of it holds the value (CT-01, CT-16).
 */
export const withheldBlob = (bytes: Uint8Array): string =>
  `Hemera withheld this file's content.\nsha256 ${sha256Of(bytes)}\nsize ${String(bytes.length)}\n`

/** The fingerprint and size a withheld blob records, or null for any other content. */
export function withheldOf(bytes: Buffer): { sha256: string; size: number } | null {
  const match = /^Hemera withheld this file's content\.\nsha256 ([0-9a-f]{64})\nsize (\d+)\n$/.exec(
    bytes.toString('utf8'),
  )
  return match === null ? null : { sha256: match[1] ?? '', size: Number(match[2]) }
}

/** The blobs a change's sides hold: none for a side it does not have, or a submodule's commit. */
const blobsOf = (change: RawChange): ReadonlyArray<string> =>
  [
    { mode: change.modeBefore, blob: change.blobBefore },
    { mode: change.modeAfter, blob: change.blobAfter },
  ]
    .filter(({ mode }) => mode !== ABSENT_MODE && mode !== SUBMODULE_MODE)
    .map(({ blob }) => blob)

/** A `-z` listing cut on its separators, without the empty field after the last one. */
function fields(printed: string): string[] {
  const cut = printed.split('\0')
  if (cut.at(-1) === '') cut.pop()
  return cut
}

/**
 * What `git diff-tree -r -z -M --raw` printed: `:<mode> <mode> <blob> <blob> <letter>[score]`, then
 * the path, or the old path and the new one for a rename. `-z` quotes nothing: a tab or a newline
 * in a name is read whole.
 */
export function rawChangesOf(printed: string): ReadonlyArray<RawChange> {
  const parts = fields(printed)
  const changes: RawChange[] = []
  for (let at = 0; at < parts.length;) {
    const [modeBefore = '', modeAfter = '', blobBefore = '', blobAfter = '', letters = ''] = (
      parts[at] ?? ''
    )
      .slice(1)
      .split(' ')
    const letter = letters.charAt(0)
    const moved = letter === 'R' || letter === 'C'
    const status = STATUSES.find((one) => one === letter) ?? 'M'
    changes.push({
      path: parts[at + (moved ? 2 : 1)] ?? '',
      oldPath: moved ? (parts[at + 1] ?? null) : null,
      status,
      modeBefore,
      modeAfter,
      blobBefore,
      blobAfter,
    })
    at += moved ? 3 : 2
  }
  return changes
}

/**
 * What `git diff-tree -r -z -M --numstat` printed, by the later path: `<added>\t<removed>\t<path>`,
 * or for a rename the counts, an empty path, then the old and the new path; `-` for a binary.
 */
export function countsOf(
  printed: string,
): ReadonlyMap<string, { added: number | null; removed: number | null }> {
  const counts = new Map<string, { added: number | null; removed: number | null }>()
  const parts = fields(printed)
  const counted = (said: string) => (said === '-' ? null : Number(said))
  for (let at = 0; at < parts.length;) {
    const record = parts[at] ?? ''
    const first = record.indexOf('\t')
    const second = record.indexOf('\t', first + 1)
    const named = record.slice(second + 1)
    const path = named === '' ? (parts[at + 2] ?? '') : named
    at += named === '' ? 3 : 1
    counts.set(path, {
      added: counted(record.slice(0, first)),
      removed: counted(record.slice(first + 1, second)),
    })
  }
  return counts
}

/**
 * What `git cat-file --batch` printed for the objects asked, in their order: for each, a line
 * `<id> <type> <size>` then its bytes and a newline, or `<id> missing`. A missing object is none.
 */
export function batchOf(printed: Buffer): ReadonlyMap<string, Buffer> {
  const objects = new Map<string, Buffer>()
  let at = 0
  while (at < printed.length) {
    const end = printed.indexOf(0x0a, at)
    if (end === -1) break
    const [id = '', type = '', size = ''] = printed.subarray(at, end).toString('utf8').split(' ')
    at = end + 1
    if (type === 'missing' || size === '') continue
    const length = Number(size)
    objects.set(id, printed.subarray(at, at + length))
    at += length + 1
  }
  return objects
}

/** What `git cat-file --batch-check` printed: the size of each object found. */
export function sizesOf(printed: string): ReadonlyMap<string, number> {
  const sizes = new Map<string, number>()
  for (const line of printed.split('\n')) {
    const [id = '', type = '', size = ''] = line.trim().split(' ')
    if (type !== '' && type !== 'missing' && size !== '') sizes.set(id, Number(size))
  }
  return sizes
}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** How much a batch of contents may weigh, well below what a Git call may print. */
const BATCH_BYTES = 16 * 1024 * 1024

/** Groups blobs into batches whose contents stay under the weight a call may print. */
function batches(blobs: ReadonlyArray<string>, sizes: ReadonlyMap<string, number>): string[][] {
  const groups: string[][] = []
  let current: string[] = []
  let weight = 0
  for (const blob of blobs) {
    const size = sizes.get(blob) ?? 0
    if (current.length > 0 && weight + size > BATCH_BYTES) {
      groups.push(current)
      current = []
      weight = 0
    }
    current.push(blob)
    weight += size
  }
  if (current.length > 0) groups.push(current)
  return groups
}

/**
 * Git's words for writing a whole index into the copy. A split index (`core.splitIndex`, or a
 * `link` extension the copy already carries) has Git write a `sharedindex.*` file into the
 * repository's own Git folder: a change to the user's repository. Written whole, the copy keeps
 * what `copyIndex` gave it, so the racy-entry check of #267 is the same.
 */
const WHOLE_INDEX = ['-c', 'core.splitIndex=false']

/** A repository whose working tree is not there any more has no objects to lend. */
const NO_ALTERNATE: Readonly<Record<string, string>> = {}

/** The snapshots over a spawn of Git: the machine's own, through the engine's limits and mask. */
export const snapshotsLayer = (run: GitBytesSpawn) =>
  Layer.effect(
    Snapshots,
    Effect.gen(function* () {
      const database = yield* Database
      const events = yield* DomainEvents
      const secrets = yield* Secrets
      /** A mutation of the database, its services handed. */
      const written = <A, E>(effect: Effect.Effect<A, E, Database | DomainEvents>) =>
        effect.pipe(
          Effect.provideService(Database, database),
          Effect.provideService(DomainEvents, events),
        )
      const recordFailure = (missionId: string, failure: SnapshotFailed) =>
        written(
          mutate('recording a failed snapshot', () =>
            Effect.succeed({
              result: undefined,
              events: [
                {
                  type: 'snapshot.failed',
                  entityKind: 'mission',
                  entityId: missionId,
                  source: 'system' as const,
                  author: 'hemera' as const,
                  payload: {
                    repository: failure.repository,
                    owner: failure.owner,
                    said: failure.said,
                  },
                },
              ],
            }),
          ),
        ).pipe(Effect.ignore)
      const { dataFolder } = yield* ProfileHome
      const context = { home: homedir(), platform: process.platform }
      const text = (bytes: Buffer) => bytes.toString('utf8')
      const sensitive = (path: string) => sensitivePlace(path, context) !== null
      /** Lines are not counted for a withheld file: they would be the stand-in's. */
      const countsFor = (
        change: RawChange,
        counts: ReturnType<typeof countsOf>,
      ): { added: number | null; removed: number | null } =>
        sensitive(change.path) || (change.oldPath !== null && sensitive(change.oldPath))
          ? { added: null, removed: null }
          : (counts.get(change.path) ?? { added: null, removed: null })

      /**
       * The side of a file as it is kept, from its original bytes. A text is masked in slices of
       * time: the engine answers while a large file is masked (#402).
       */
      const sideOf = (path: string, mode: string, bytes: Buffer): Effect.Effect<FileSide> =>
        Effect.gen(function* () {
          const sha256 = sha256Of(bytes)
          if (mode === SUBMODULE_MODE) {
            return {
              sha256,
              size: 0,
              content: null,
              withheld: 'content withheld: a submodule',
              masked: false,
            }
          }
          if (sensitive(path)) {
            const recorded = withheldOf(bytes)
            return {
              sha256: recorded?.sha256 ?? sha256,
              size: recorded?.size ?? bytes.length,
              content: null,
              withheld: `content withheld: ${path}`,
              masked: false,
            }
          }
          // A binary is kept as it is: masking replaces text, and would break its bytes.
          if (bytes.includes(0) || !isUtf8(bytes)) {
            return { sha256, size: bytes.length, content: bytes, withheld: null, masked: false }
          }
          const original = bytes.toString('utf8')
          const masked = yield* secrets.maskPaced(original)
          return masked === original
            ? { sha256, size: bytes.length, content: bytes, withheld: null, masked: false }
            : {
                sha256,
                size: bytes.length,
                content: Buffer.from(masked, 'utf8'),
                withheld: null,
                masked: true,
              }
        })

      /** The stores this engine has opened, and the quarantines its snapshots are using now. */
      const opened = new Set<string>()
      const quarantines = new Set<string>()
      /** The store of the mission's Project, made bare on first use. */
      const storeOf = (missionId: string) =>
        Effect.gen(function* () {
          const [row] = yield* database
            .select({ projectId: missions.projectId })
            .from(missions)
            .where(eq(missions.id, missionId))
            .pipe(Effect.mapError(refusedWhile('reading the mission of a snapshot')))
          if (row === undefined) return yield* Effect.die(`no mission ${missionId}`)
          const folder = join(dataFolder, SNAPSHOTS_FOLDER)
          const store = join(folder, `${row.projectId}.git`)
          if (!existsSync(join(store, 'HEAD'))) {
            mkdirSync(folder, { recursive: true })
            // Made aside, then moved into place: Git refuses an `init` over one still writing, so
            // two snapshots that create the store at once each make their own, and the one moved
            // second gives way to the other's (#369).
            const aside = `${store}.${randomUUID()}`
            yield* run(folder, ['init', '--bare', '--quiet', aside], 'read').pipe(
              Effect.andThen(
                Effect.try({
                  try: () => {
                    try {
                      renameSync(aside, store)
                    } catch (lost) {
                      if (!existsSync(join(store, 'HEAD'))) throw lost
                    }
                  },
                  catch: String,
                }),
              ),
              Effect.ensuring(Effect.sync(() => rmSync(aside, { recursive: true, force: true }))),
            )
          }
          // What a crash left in the store is swept the first time this engine opens it, before
          // any snapshot of the engine makes its own quarantine.
          if (!opened.has(store)) {
            opened.add(store)
            sweepQuarantines(join(store, 'objects'), quarantines)
          }
          return store
        })

      /**
       * The object folder of a repository, its main one for a linked worktree: found once, it does
       * not move, and every Git process costs tens of milliseconds on Windows (#444).
       */
      const objectFolders = new Map<string, string>()
      const objectsOf = (folder: string) => {
        const known = objectFolders.get(folder)
        if (known !== undefined) return Effect.succeed(known)
        return run(
          folder,
          ['rev-parse', '--path-format=absolute', '--git-common-dir'],
          'read',
        ).pipe(
          Effect.map((printed) => join(text(printed).trim(), 'objects')),
          Effect.tap((objects) => Effect.sync(() => objectFolders.set(folder, objects))),
        )
      }

      /**
       * The Git folders a snapshot of the mission's Project may read, as they really are: the
       * shared one of each of its repositories in the main checkout. They are named by the main
       * checkout, never by a Workspace an agent writes in.
       */
      /**
       * The shared Git folder of a repository of a main checkout, once found: it does not move. A
       * folder that is no repository (the main checkout of a Project that holds several) is
       * remembered as such, rather than asked again by every snapshot (#444).
       */
      const sharedOf = new Map<string, string | null>()
      const ownGitFolders = (missionId: string) =>
        Effect.gen(function* () {
          const rows = yield* database
            .select({ main: projects.mainCheckout, path: projectRepositories.path })
            .from(missions)
            .innerJoin(projects, eq(projects.id, missions.projectId))
            .leftJoin(projectRepositories, eq(projectRepositories.projectId, projects.id))
            .where(eq(missions.id, missionId))
            .pipe(Effect.mapError(refusedWhile('reading the repositories of a snapshot')))
          const folders = new Set(
            rows.flatMap((row) =>
              row.path === null ? [row.main] : [row.main, join(row.main, row.path)],
            ),
          )
          const found = yield* Effect.forEach([...folders], (folder) => {
            const known = sharedOf.get(folder)
            if (known !== undefined) return Effect.succeed(Option.fromNullishOr(known))
            return run(
              folder,
              ['rev-parse', '--path-format=absolute', '--git-common-dir'],
              'read',
            ).pipe(
              Effect.flatMap((printed) =>
                Effect.try({ try: () => realpathSync.native(text(printed).trim()), catch: String }),
              ),
              Effect.tap((shared) => Effect.sync(() => sharedOf.set(folder, shared))),
              Effect.option,
              Effect.tap((seen) =>
                Option.isNone(seen) ? Effect.sync(() => sharedOf.set(folder, null)) : Effect.void,
              ),
            )
          })
          return found.flatMap(Option.toArray)
        })

      /**
       * The index a snapshot of a repository copies, at its real path, and the objects it borrows:
       * only from the repository's own Git folder (its shared one, or a worktree's entry in it),
       * else refused with why (#439).
       */
      const gitFoldersOf = (repository: RepositoryPlace, missionId: string) =>
        Effect.gen(function* () {
          // Both in one call: each Git process is tens of milliseconds on Windows, and a Building
          // takes dozens of snapshots (#442). Its own Git folder's `index` is the one Git uses (no
          // GIT_INDEX_FILE is set).
          const [common = '', own = ''] = text(
            yield* run(
              repository.folder,
              ['rev-parse', '--path-format=absolute', '--git-common-dir', '--absolute-git-dir'],
              'read',
            ),
          )
            .trim()
            .split('\n')
          const real = (path: string) =>
            Effect.try({ try: () => realpathSync.native(path), catch: String })
          const shared = yield* real(common)
          const folder = yield* real(own)
          const project = yield* ownGitFolders(missionId)
          const ownEntry = folder === shared || dirname(folder) === join(shared, 'worktrees')
          if (!project.includes(shared) || !ownEntry) {
            return yield* Effect.fail(`${FOREIGN_GIT_FOLDER}: ${folder}`)
          }
          return { index: join(folder, 'index'), objects: join(shared, 'objects') }
        })

      /** What a call in the store is handed: the repository's objects to borrow, when it is there. */
      const borrowing = (repository: RepositoryPlace) =>
        objectsOf(repository.folder).pipe(
          Effect.map((objects) => ({ GIT_ALTERNATE_OBJECT_DIRECTORIES: alternateOf(objects) })),
          Effect.orElseSucceed(() => NO_ALTERNATE),
        )

      /** The changes between two trees of the store, with their blobs, modes and counts. */
      const listed = (
        store: string,
        env: Readonly<Record<string, string>>,
        from: string,
        to: string,
      ) =>
        Effect.gen(function* () {
          const between = ['-r', '-z', '-M', '--end-of-options', from, to]
          const raw = rawChangesOf(
            text(yield* run(store, ['diff-tree', '--raw', ...between], 'work', { env })),
          )
          const counts = countsOf(
            text(yield* run(store, ['diff-tree', '--numstat', ...between], 'work', { env })),
          )
          const blobs = [...new Set(raw.flatMap(blobsOf))]
          const sizes =
            blobs.length === 0
              ? new Map<string, number>()
              : sizesOf(
                  text(
                    yield* run(store, ['cat-file', '--batch-check'], 'work', {
                      env,
                      input: Buffer.from(`${blobs.join('\n')}\n`),
                    }),
                  ),
                )
          // A sensitive file's side in a snapshot tree is its stand-in: its size is the one recorded.
          const standIns = [
            ...new Set(
              raw
                .flatMap((change) => [
                  ...(sensitive(change.oldPath ?? change.path) ? [change.blobBefore] : []),
                  ...(sensitive(change.path) ? [change.blobAfter] : []),
                ])
                .filter((blob) => sizes.has(blob)),
            ),
          ]
          const recorded = new Map(sizes)
          if (standIns.length > 0) {
            const read = yield* contentsOf(store, env, standIns, sizes)
            for (const [blob, bytes] of read) {
              const withheld = withheldOf(bytes)
              if (withheld !== null) recorded.set(blob, withheld.size)
            }
          }
          return { raw, counts, sizes: recorded }
        })

      /** The contents of blobs, read from the store in batches; a missing one fails the read. */
      const contentsOf = (
        store: string,
        env: Readonly<Record<string, string>>,
        blobs: ReadonlyArray<string>,
        sizes: ReadonlyMap<string, number>,
      ) =>
        Effect.gen(function* () {
          const found = new Map<string, Buffer>()
          for (const group of batches(blobs, sizes)) {
            const printed = batchOf(
              yield* run(store, ['cat-file', '--batch'], 'work', {
                env,
                input: Buffer.from(`${group.join('\n')}\n`),
              }),
            )
            for (const blob of group) {
              const bytes = printed.get(blob)
              if (bytes === undefined) return yield* Effect.fail(`the object ${blob} is gone`)
              found.set(blob, bytes)
            }
          }
          return found
        })

      /** The changed files and their sides, read from the store alone. */
      const diffFromGit = (
        missionId: string,
        repository: RepositoryPlace,
        from: string,
        to: string,
        keep: (change: RawChange) => boolean,
      ) =>
        Effect.gen(function* () {
          const store = yield* storeOf(missionId)
          const env = yield* borrowing(repository)
          const { raw, counts, sizes } = yield* listed(store, env, from, to)
          const kept = raw.filter(keep)
          const contents = yield* contentsOf(store, env, [...new Set(kept.flatMap(blobsOf))], sizes)
          const side = (
            path: string,
            mode: string,
            blob: string,
          ): Effect.Effect<FileSide | null> =>
            mode === ABSENT_MODE
              ? Effect.succeed(null)
              : sideOf(
                  path,
                  mode,
                  mode === SUBMODULE_MODE
                    ? Buffer.from(blob)
                    : (contents.get(blob) ?? Buffer.alloc(0)),
                )
          return yield* Effect.forEach(kept, (change) =>
            Effect.all({
              before: side(change.oldPath ?? change.path, change.modeBefore, change.blobBefore),
              after: side(change.path, change.modeAfter, change.blobAfter),
            }).pipe(
              Effect.map(({ before, after }): FileDiff => ({
                path: change.path,
                oldPath: change.oldPath,
                status: change.status,
                added: countsFor(change, counts).added,
                removed: countsFor(change, counts).removed,
                before,
                after,
              })),
            ),
          )
        })

      /** One side as the database kept it, its content joined. */
      const keptSide = (missionId: string, repository: string, tree: string, path: string) =>
        Effect.gen(function* () {
          const [row] = yield* database
            .select({
              sha256: snapshotFiles.sha256,
              size: snapshotFiles.size,
              withheld: snapshotFiles.withheld,
              bytes: fileContents.bytes,
              masked: fileContents.masked,
            })
            .from(snapshotFiles)
            .leftJoin(fileContents, eq(fileContents.sha256, snapshotFiles.sha256))
            .where(
              and(
                eq(snapshotFiles.missionId, missionId),
                eq(snapshotFiles.repository, repository),
                eq(snapshotFiles.tree, tree),
                eq(snapshotFiles.path, path),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('reading a snapshot')))
          if (row === undefined) return null
          const side: FileSide = {
            sha256: row.sha256,
            size: row.size,
            content: row.withheld === null ? row.bytes : null,
            withheld: row.withheld,
            masked: row.masked ?? false,
          }
          return side
        })

      const failure =
        (repository: RepositoryPlace, owner: string) =>
        (cause: GitRefusal | DatabaseError | string) =>
          new SnapshotFailed({
            repository: repository.name,
            owner,
            said: Predicate.isString(cause) ? secrets.mask(cause) : cause.message,
          })

      /** A quarantine just made, kept out of any sweep until its snapshot ends. */
      const live = (folder: string) => {
        quarantines.add(folder)
        return folder
      }

      const take = (repository: RepositoryPlace, owner: SnapshotOwner) =>
        Effect.gen(function* () {
          // When it began: a snapshot that ends after a later one never makes its tree current.
          const takenAt = new Date().toISOString()
          const store = yield* storeOf(owner.missionId)
          const { index, objects } = yield* gitFoldersOf(repository, owner.missionId)
          const alternate = { GIT_ALTERNATE_OBJECT_DIRECTORIES: alternateOf(objects) }
          // One go at the tree, or null when a link stood in the way of what it added: a go that
          // fails on that is made again once from the listing, and the second failure is final.
          const attempt = (last: boolean) =>
            Effect.acquireUseRelease(
              Effect.try({
                try: () => ({
                  scratch: mkdtempSync(join(tmpdir(), 'hemera-snapshot-')),
                  // What Git writes is held apart in the store's own object folder, as Git's own
                  // quarantine does, and joins the store only once nothing it added was reached
                  // through a link (#449).
                  incoming: live(mkdtempSync(join(store, 'objects', QUARANTINE))),
                }),
                catch: (cause) => String(cause),
              }),
              ({ scratch, incoming }) =>
                Effect.gen(function* () {
                  const copy = join(scratch, 'index')
                  yield* Effect.try({
                    try: () => copyIndex(index, copy),
                    catch: (cause) =>
                      `the index ${index} is not read: ${cause instanceof Error ? cause.message : String(cause)}`,
                  })
                  const env = {
                    GIT_ALTERNATE_OBJECT_DIRECTORIES: [join(store, 'objects'), objects]
                      .map(alternateOf)
                      .join(delimiter),
                    GIT_INDEX_FILE: copy,
                    GIT_OBJECT_DIRECTORY: incoming,
                  }
                  // What Git would add (untracked, or changed), listed once: only those paths are
                  // added, never the folder, so a file or a link made there since is left to the
                  // next snapshot. A sensitive one is left out of `add`, and a stand-in holding only
                  // its fingerprint takes its place in the copied index.
                  const pending = fields(
                    text(
                      yield* run(
                        repository.folder,
                        [
                          '--no-optional-locks',
                          'ls-files',
                          '-z',
                          '-t',
                          '--others',
                          '--modified',
                          '--exclude-standard',
                        ],
                        'read',
                        { env },
                      ),
                    ),
                  ).map((line) => line.slice(2))
                  const paths = [...new Set(pending)]
                  const touched = paths.filter(sensitive)
                  const withheld = touched.flatMap((path) => {
                    const real = regularFileIn(repository.folder, path)
                    return real === null ? [] : [{ path, real }]
                  })
                  // A sensitive path that is not a regular file of the repository (a link, or a file
                  // a folder link leads to) is left out of the tree, as it is out of `add`, which
                  // would copy what it leads to.
                  const dropped = touched.filter(
                    (path) => !withheld.some((one) => one.path === path),
                  )
                  // A path with a link on its way (itself, or a folder above it) is never handed to
                  // `add`: Git for Windows walks a junction as a folder, and would store what it
                  // leads to. The link is kept as itself, its target and nothing more, unless its
                  // own name is sensitive; Git never reads it.
                  const onTheWay = new Map(
                    paths.map((path) => [path, linkOnTheWay(repository.folder, path)]),
                  )
                  const links = [
                    ...new Set(
                      [...onTheWay.values()].filter(
                        (link): link is string => link !== null && !sensitive(link),
                      ),
                    ),
                  ].flatMap((link) => {
                    const target = targetOf(repository.folder, link)
                    return target === null ? [] : [{ link, target }]
                  })
                  const free = paths.filter(
                    (path) => !sensitive(path) && onTheWay.get(path) === null,
                  )
                  // A changed path that is now a folder (a tracked file replaced by one) is never
                  // handed to `add` either: what it holds is listed on its own, and the path leaves
                  // the tree.
                  const folders = free.filter((path) => walkedInto(repository.folder, path))
                  const ordinary = free.filter((path) => !folders.includes(path))
                  const added =
                    ordinary.length === 0
                      ? Effect.succeed(true)
                      : run(
                          repository.folder,
                          [
                            ...WHOLE_INDEX,
                            'add',
                            '--all',
                            '--pathspec-from-file=-',
                            '--pathspec-file-nul',
                          ],
                          'work',
                          {
                            env,
                            input: Buffer.from(ordinary.map(pathspecOf).join('')),
                          },
                        ).pipe(Effect.as(true))
                  // Git refuses a listed path that matches nothing (an untracked file removed since
                  // it was listed) or that a link now stands on the way of: the go is made again.
                  if (
                    !(yield* last
                      ? added
                      : added.pipe(Effect.catchTag('GitFailed', () => Effect.succeed(false))))
                  ) {
                    return null
                  }
                  const removed = [...dropped, ...folders]
                  if (removed.length > 0) {
                    yield* run(
                      repository.folder,
                      [...WHOLE_INDEX, 'update-index', '--force-remove', '--', ...removed],
                      'work',
                      { env },
                    )
                  }
                  const kept: string[] = []
                  for (const { link, target } of links) {
                    const blob = text(
                      yield* run(repository.folder, ['hash-object', '-w', '--stdin'], 'work', {
                        env,
                        input: target,
                      }),
                    ).trim()
                    kept.push('--cacheinfo', `120000,${blob},${link}`)
                  }
                  if (kept.length > 0) {
                    // `--replace` drops what the index held under it: a tracked folder replaced by
                    // a link.
                    yield* run(
                      repository.folder,
                      [...WHOLE_INDEX, 'update-index', '--add', '--replace', ...kept],
                      'work',
                      { env },
                    )
                  }
                  for (const { path, real } of withheld) {
                    // Read at its real path, never waited on (#434): a pipe put there since is
                    // refused.
                    const bytes = yield* Effect.try({
                      try: () => readOwnSync(real, READ_CAP, real).bytes,
                      catch: (cause) =>
                        `${path} is not read: ${cause instanceof Error ? cause.message : String(cause)}`,
                    })
                    const blob = text(
                      yield* run(repository.folder, ['hash-object', '-w', '--stdin'], 'work', {
                        env,
                        input: Buffer.from(withheldBlob(bytes)),
                      }),
                    ).trim()
                    yield* run(
                      repository.folder,
                      [
                        ...WHOLE_INDEX,
                        'update-index',
                        '--add',
                        '--cacheinfo',
                        '100644',
                        blob,
                        path,
                      ],
                      'work',
                      { env },
                    )
                  }
                  const tree = text(
                    yield* run(repository.folder, [...WHOLE_INDEX, 'write-tree'], 'work', { env }),
                  ).trim()
                  // A link made on the way of an added path while Git ran: what Git read there may
                  // be what the link leads to, and none of it joins the store.
                  if (ordinary.some((path) => linkOnTheWay(repository.folder, path) !== null)) {
                    return null
                  }
                  yield* Effect.try({
                    try: () => joinObjects(incoming, join(store, 'objects')),
                    catch: (cause) =>
                      `the snapshot's objects are not stored: ${cause instanceof Error ? cause.message : String(cause)}`,
                  })
                  return tree
                }),
              // A folder left behind is litter, not a failed snapshot.
              ({ scratch, incoming }) =>
                Effect.sync(() => {
                  for (const folder of [scratch, incoming]) {
                    try {
                      rmSync(folder, { recursive: true, force: true })
                    } catch {}
                  }
                  quarantines.delete(incoming)
                }),
            )
          const tree = (yield* attempt(false)) ?? (yield* attempt(true))
          if (tree === null) {
            return yield* Effect.fail(
              'a link was made on the way of a file while it was added, twice',
            )
          }
          yield* run(store, ['update-ref', refOf(owner, repository.name), tree], 'read', {
            env: alternate,
          })
          // The Workspace's current tree (#144, CT-38); a Freeze's is of the main checkout.
          if (owner.kind !== 'freeze') {
            yield* written(
              mutate('recording the current tree', (transaction) =>
                Effect.map(
                  recordTreeIn(transaction, owner.missionId, repository.name, tree, takenAt),
                  (stale) => ({ result: undefined, events: stale }),
                ),
              ),
            )
          }
          return tree
        }).pipe(
          Effect.mapError(failure(repository, ownerText(owner))),
          Effect.tapError((failed) => recordFailure(owner.missionId, failed)),
        )

      const changed = (
        missionId: string,
        repository: RepositoryPlace,
        fromTree: string | null,
        toTree: string,
      ) =>
        Effect.gen(function* () {
          const store = yield* storeOf(missionId)
          const env = yield* borrowing(repository)
          const { raw, counts, sizes } = yield* listed(store, env, fromTree ?? EMPTY_TREE, toTree)
          return raw.map((change): ChangedFile => ({
            path: change.path,
            oldPath: change.oldPath,
            status: change.status,
            added: countsFor(change, counts).added,
            removed: countsFor(change, counts).removed,
            sizeBefore:
              change.modeBefore === ABSENT_MODE ? null : (sizes.get(change.blobBefore) ?? 0),
            sizeAfter: change.modeAfter === ABSENT_MODE ? null : (sizes.get(change.blobAfter) ?? 0),
          }))
        }).pipe(
          Effect.mapError(
            failure(repository, `changes from ${fromTree ?? 'nothing'} to ${toTree}`),
          ),
        )

      const listing = (missionId: string, repository: RepositoryPlace, tree: string) =>
        Effect.gen(function* () {
          const store = yield* storeOf(missionId)
          const env = yield* borrowing(repository)
          const printed = yield* run(
            store,
            ['ls-tree', '-r', '-z', '--end-of-options', tree],
            'read',
            { env },
          )
          const files: Array<string> = []
          const links = new Map<string, string>()
          for (const entry of fields(text(printed))) {
            const tab = entry.indexOf('\t')
            const [mode = '', type = '', blob = ''] = entry.slice(0, tab).split(' ')
            if (type !== 'blob') continue
            files.push(entry.slice(tab + 1))
            if (mode === LINK_MODE) links.set(entry.slice(tab + 1), blob)
          }
          const targets = yield* contentsOf(store, env, [...new Set(links.values())], new Map())
          return {
            files,
            links: new Map(
              [...links].map(([path, blob]) => [path, text(targets.get(blob) ?? Buffer.alloc(0))]),
            ),
          }
        }).pipe(Effect.mapError(failure(repository, `the files of ${tree}`)))

      const collect = (
        missionId: string,
        repository: RepositoryPlace,
        fromTree: string | null,
        toTree: string,
        files: ReadonlyArray<ChangedFile>,
      ) => {
        const from = fromTree ?? EMPTY_TREE
        const asked = new Set(files.map((file) => file.path))
        return diffFromGit(missionId, repository, from, toTree, (change) =>
          asked.has(change.path),
        ).pipe(
          Effect.map((diffs): Captured => ({
            missionId,
            repository: repository.name,
            fromTree: from,
            toTree,
            files: diffs,
          })),
          Effect.mapError(failure(repository, `capture from ${from} to ${toTree}`)),
        )
      }

      const materialize = (
        missionId: string,
        repository: RepositoryPlace,
        tree: string,
        folder: string,
      ) =>
        Effect.gen(function* () {
          const store = yield* storeOf(missionId)
          const borrowed = yield* borrowing(repository)
          yield* Effect.acquireUseRelease(
            Effect.try({
              try: () => mkdtempSync(join(tmpdir(), 'hemera-materialize-')),
              catch: (cause) => String(cause),
            }),
            (scratch) =>
              Effect.gen(function* () {
                const env = { ...borrowed, GIT_INDEX_FILE: join(scratch, 'index') }
                yield* Effect.try({
                  try: () => mkdirSync(folder, { recursive: true }),
                  catch: String,
                })
                yield* run(store, ['read-tree', '--end-of-options', tree], 'work', { env })
                yield* run(
                  store,
                  ['-c', 'core.bare=false', '--work-tree', folder, 'checkout-index', '-a', '-f'],
                  'work',
                  { env },
                )
              }),
            (scratch) => Effect.sync(() => rmSync(scratch, { recursive: true, force: true })),
          )
        }).pipe(Effect.mapError(failure(repository, `a copy of ${tree}`)))

      const service: SnapshotsService = {
        take,
        listing,
        changed,
        collect,
        materialize,
        failed: recordFailure,
        capture: (missionId, repository, fromTree, toTree, files) =>
          Effect.gen(function* () {
            const captured = yield* collect(missionId, repository, fromTree, toTree, files)
            yield* written(
              mutate('keeping a snapshot', (transaction) =>
                keepCaptured(transaction, captured).pipe(
                  Effect.as({ result: undefined, events: [] }),
                ),
              ),
            )
          }),
        read: (missionId, repository, tree, path) =>
          Effect.gen(function* () {
            const fromGit = yield* Effect.option(
              Effect.gen(function* () {
                const store = yield* storeOf(missionId)
                const env = yield* borrowing(repository)
                const entries = fields(
                  text(
                    yield* run(
                      store,
                      [
                        '--literal-pathspecs',
                        'ls-tree',
                        '-z',
                        '--end-of-options',
                        tree,
                        '--',
                        path,
                      ],
                      'read',
                      { env },
                    ),
                  ),
                )
                const [entry] = entries
                if (entry === undefined) return null
                const [mode = '', , blob = ''] = entry.slice(0, entry.indexOf('\t')).split(' ')
                if (mode === SUBMODULE_MODE) return yield* sideOf(path, mode, Buffer.from(blob))
                const contents = yield* contentsOf(store, env, [blob], new Map())
                return yield* sideOf(path, mode, contents.get(blob) ?? Buffer.alloc(0))
              }),
            )
            if (Option.isSome(fromGit)) return fromGit.value
            const kept = yield* keptSide(missionId, repository.name, tree, path)
            if (kept === null) {
              return yield* new SnapshotUnavailable({ repository: repository.name, tree, path })
            }
            return kept
          }),
        diff: (missionId, repository, fromTree, toTree, path) =>
          Effect.gen(function* () {
            const from = fromTree ?? EMPTY_TREE
            const concerns = (one: { path: string; oldPath: string | null }) =>
              path === undefined || one.path === path || one.oldPath === path
            const fromGit = yield* Effect.option(
              diffFromGit(missionId, repository, from, toTree, concerns),
            )
            if (Option.isSome(fromGit)) return fromGit.value
            const rows = yield* database
              .select()
              .from(snapshotChanges)
              .where(
                and(
                  eq(snapshotChanges.missionId, missionId),
                  eq(snapshotChanges.repository, repository.name),
                  eq(snapshotChanges.fromTree, from),
                  eq(snapshotChanges.toTree, toTree),
                  path === undefined
                    ? undefined
                    : or(eq(snapshotChanges.path, path), eq(snapshotChanges.oldPath, path)),
                ),
              )
              .orderBy(asc(snapshotChanges.position))
              .pipe(Effect.mapError(refusedWhile('reading a snapshot')))
            if (rows.length === 0) {
              return yield* new SnapshotUnavailable({
                repository: repository.name,
                tree: toTree,
                path: path ?? null,
              })
            }
            return yield* Effect.forEach(rows, (row) =>
              Effect.gen(function* () {
                const status = STATUSES.find((one) => one === row.status) ?? 'M'
                const diff: FileDiff = {
                  path: row.path,
                  oldPath: row.oldPath,
                  status,
                  added: row.added,
                  removed: row.removed,
                  before:
                    status === 'A'
                      ? null
                      : yield* keptSide(missionId, repository.name, from, row.oldPath ?? row.path),
                  after:
                    status === 'D'
                      ? null
                      : yield* keptSide(missionId, repository.name, toTree, row.path),
                }
                return diff
              }),
            )
          }),
        diagnose: (missionId) =>
          Effect.gen(function* () {
            const rows = yield* database
              .select({
                repository: snapshotFiles.repository,
                files: count(),
                contents: countDistinct(fileContents.sha256),
              })
              .from(snapshotFiles)
              .leftJoin(fileContents, eq(fileContents.sha256, snapshotFiles.sha256))
              .where(eq(snapshotFiles.missionId, missionId))
              .groupBy(snapshotFiles.repository)
              .pipe(Effect.mapError(refusedWhile('reading the snapshots of a mission')))
            const refs = yield* storeOf(missionId).pipe(
              Effect.flatMap((store) =>
                run(
                  store,
                  ['for-each-ref', '--format=%(refname)', `refs/hemera/${missionId}/`],
                  'read',
                ),
              ),
              Effect.map((printed) =>
                text(printed)
                  .split('\n')
                  .filter((line) => line !== ''),
              ),
              Effect.orElseSucceed((): ReadonlyArray<string> => []),
            )
            const byRepository = new Map<string, RepositoryDiagnosis>()
            const entry = (repository: string) =>
              byRepository.get(repository) ?? { repository, refs: [], files: 0, contents: 0 }
            for (const ref of refs) {
              const repository = nameOfSegment(ref.slice(ref.lastIndexOf('/') + 1))
              const known = entry(repository)
              byRepository.set(repository, { ...known, refs: [...known.refs, ref] })
            }
            for (const row of rows) {
              const known = entry(row.repository)
              byRepository.set(row.repository, {
                ...known,
                files: row.files,
                contents: row.contents,
              })
            }
            return [...byRepository.values()].sort((one, other) =>
              one.repository.localeCompare(other.repository),
            )
          }),
      }
      return service
    }),
  )

/**
 * The real path of a file of a repository when it is a regular file reached through no link, the
 * repository's folder aside; null for anything else: a link, a folder, or a file a folder link
 * leads to is never read as a sensitive content.
 */
function regularFileIn(folder: string, path: string): string | null {
  try {
    const real = join(realpathSync.native(folder), path)
    return realpathSync.native(real) === real && lstatSync(real).isFile() ? real : null
  } catch {
    return null
  }
}

/**
 * A listed path as `add` reads it: that path and nothing under it, so a file replaced by a folder
 * since it was listed adds nothing it holds. A nested repository (listed `sub/`) is added as its
 * commit: Git never walks into one.
 */
function pathspecOf(path: string): string {
  const only = `:(literal)${path}\0`
  if (path.endsWith('/')) return only
  return `${only}:(exclude,glob)${path.replace(/[\\*?[\]]/g, '\\$&')}/**\0`
}

/**
 * Whether Git would walk into a repository's path that has no link on its way: a folder. A nested
 * repository, listed `sub/`, is never walked.
 */
function walkedInto(folder: string, path: string): boolean {
  if (path.endsWith('/')) return false
  try {
    return lstatSync(join(folder, path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * The first link on a repository's path, the path itself included, null when there is none: a
 * junction too, which Node reads as a link and Git for Windows walks as a folder.
 */
function linkOnTheWay(folder: string, path: string): string | null {
  const names = path.split('/').filter((name) => name !== '')
  for (let at = 1; at <= names.length; at++) {
    const prefix = names.slice(0, at).join('/')
    try {
      if (lstatSync(join(folder, prefix)).isSymbolicLink()) return prefix
    } catch {
      return null
    }
  }
  return null
}

/**
 * What Git stores for a link: its target as written, with `/` on Windows as Git for Windows writes
 * it; null when the path is no link any more.
 */
function targetOf(folder: string, link: string): Buffer | null {
  try {
    const target = readlinkSync(join(folder, link), { encoding: 'buffer' })
    return process.platform === 'win32'
      ? Buffer.from(target.toString('utf8').replaceAll('\\', '/'), 'utf8')
      : target
  } catch {
    return null
  }
}

/**
 * The objects a snapshot wrote apart moved into the store, each to the same place; one the store
 * already holds (written by another snapshot meanwhile) is the same bytes and stays as it is.
 */
function joinObjects(incoming: string, objects: string): void {
  const files = readdirSync(incoming, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(incoming, join(entry.parentPath, entry.name)))
  // A pack's index is moved after its pack, so a reader never finds the index alone.
  files.sort((one, other) => Number(one.endsWith('.idx')) - Number(other.endsWith('.idx')))
  for (const file of files) {
    const to = join(objects, file)
    mkdirSync(dirname(to), { recursive: true })
    try {
      renameSync(join(incoming, file), to)
    } catch (failure) {
      if (!existsSync(to)) throw failure
    }
  }
}

/** The name every quarantine folder of a snapshot starts with, under the store's objects. */
const QUARANTINE = 'incoming-'

/**
 * The quarantines a crash left in a store's object folder removed: the `incoming-*` folders
 * directly under `objects`, but the ones in `live`, which a snapshot of this engine is using.
 * A link of that name is removed itself and never followed; a file, a pack, an object folder or a
 * name that merely resembles it stays. What cannot be removed (a file still held open on Windows)
 * stays for the next opening, and never fails the one in progress.
 */
export function sweepQuarantines(objects: string, live: ReadonlySet<string>): void {
  let names: string[]
  try {
    names = readdirSync(objects)
      .filter((name) => name.startsWith(QUARANTINE))
      .sort()
  } catch {
    return
  }
  for (const name of names) {
    const path = join(objects, name)
    if (live.has(path)) continue
    try {
      const kind = lstatSync(path)
      if (kind.isSymbolicLink()) unlinkSync(path)
      else if (kind.isDirectory()) rmSync(path, { recursive: true, force: true })
    } catch {}
  }
}

/**
 * The user's index copied to where the snapshot writes, or nothing when there is none yet. Git
 * trusts an entry's stat only when it is older than the index (its racy check), so the copy must
 * never be newer than the index, or a file rewritten at the same size in the second the index was
 * written would read as unchanged. Its times are the index's floored to the second: older or equal
 * whatever precision Git compares, where a `Date` rounds to the millisecond and can be newer.
 * It is read at its real path in the repository's own Git folder as the engine reads a file on its
 * own behalf (#439): a link, a pipe or a file over the cap there is refused, never waited on.
 */
function copyIndex(from: string, to: string): void {
  try {
    const { bytes, stats } = readOwnSync(from, READ_CAP, from)
    writeFileSync(to, bytes)
    utimesSync(to, Number(stats.atimeNs / 1_000_000_000n), Number(stats.mtimeNs / 1_000_000_000n))
  } catch (failure) {
    if (Predicate.hasProperty(failure, 'code') && failure.code === 'ENOENT') return
    throw failure
  }
}

/**
 * Writes what a capture read, in the transaction given: each content once across the Profile,
 * each side once per tree, each change once per pair of trees. Writing it again writes nothing.
 */
export const keepCaptured = (transaction: EngineTransaction, captured: Captured) =>
  Effect.gen(function* () {
    const { missionId, repository, fromTree, toTree } = captured
    const sides = captured.files.flatMap((file) => [
      ...(file.before === null
        ? []
        : [{ tree: fromTree, path: file.oldPath ?? file.path, side: file.before }]),
      ...(file.after === null ? [] : [{ tree: toTree, path: file.path, side: file.after }]),
    ])
    for (const { side } of sides) {
      if (side.content === null) continue
      yield* transaction
        .insert(fileContents)
        .values({
          sha256: side.sha256,
          bytes: Buffer.from(side.content),
          size: side.size,
          masked: side.masked,
        })
        .onConflictDoNothing()
    }
    for (const { tree, path, side } of sides) {
      yield* transaction
        .insert(snapshotFiles)
        .values({
          missionId,
          repository,
          tree,
          path,
          sha256: side.sha256,
          size: side.size,
          withheld: side.withheld,
        })
        .onConflictDoNothing()
    }
    for (const [position, file] of captured.files.entries()) {
      yield* transaction
        .insert(snapshotChanges)
        .values({
          missionId,
          repository,
          fromTree,
          toTree,
          position,
          path: file.path,
          oldPath: file.oldPath,
          status: file.status,
          added: file.added,
          removed: file.removed,
        })
        .onConflictDoNothing()
    }
  }).pipe(Effect.mapError(refusedWhile('keeping a snapshot')))
