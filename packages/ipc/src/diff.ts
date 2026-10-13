/**
 * The live diff of a mission (#249, R3), as it crosses the links: per repository of its Workspace,
 * the files changed from the merge base with the repository's base branch to the working tree as
 * it is now, untracked files included; the two sides of one file; the same read from a checkpoint
 * once the Workspace is gone; and what moved, as it moves.
 *
 * The list carries no content: a file's sides are asked one file at a time, and a large file's are
 * refused until asked with `force`. A file in a sensitive place is listed, never its content.
 */

import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { UnknownMission } from './missions.ts'
import { StorageFailed } from './profile.ts'

/** Git's letter for a change: added, modified, deleted, renamed, or its type changed. */
export const DiffLetter = Schema.Literals(['A', 'M', 'D', 'R', 'T'])
export type DiffLetter = typeof DiffLetter.Type

/** One changed file of a repository; `repository` and `path` together are its key. */
export const DiffFile = Schema.Struct({
  repository: Schema.String,
  path: Schema.String,
  /** Where the file tree shows it: `<repository>/<path>`, the path alone for the root. */
  treePath: Schema.String,
  /** Its path before a rename, null otherwise. */
  oldPath: Schema.NullOr(Schema.String),
  letter: DiffLetter,
  /** Git does not track it yet (its letter is `A`). */
  untracked: Schema.Boolean,
  /** Lines added and removed, null for a binary or a withheld file. */
  added: Schema.NullOr(Schema.Number),
  removed: Schema.NullOr(Schema.Number),
  /** Git sees no text in it. */
  binary: Schema.Boolean,
  /** The size in bytes of each side, null for the side it does not have. */
  sizeBefore: Schema.NullOr(Schema.Number),
  sizeAfter: Schema.NullOr(Schema.Number),
  /** Git's attributes mark it generated (`linguist-generated`, `-diff`), or it is a lockfile. */
  generated: Schema.Boolean,
  /** Past the thresholds: its sides are refused until asked with `force`. */
  large: Schema.Boolean,
  /** When its current change was first seen made outside Hemera, null when it was not. */
  changedOutside: Schema.NullOr(Schema.String),
  /** It is in a sensitive place: listed, its content never sent. */
  withheld: Schema.Boolean,
})
export type DiffFile = typeof DiffFile.Type

/** One repository of the Workspace and its changed files, in Git's order. */
export const DiffRepository = Schema.Struct({
  repository: Schema.String,
  /** The Workspace's branch, null when the repository is detached. */
  branch: Schema.NullOr(Schema.String),
  /** The base branch recorded when the Workspace was made (`origin/main`), null when none was. */
  baseBranch: Schema.NullOr(Schema.String),
  /** The commit the diff starts from, null for a repository with no commit yet. */
  baseCommit: Schema.NullOr(Schema.String),
  files: Schema.Array(DiffFile),
  added: Schema.Number,
  removed: Schema.Number,
  /** Whether one of its files was changed outside Hemera. */
  changedOutside: Schema.Boolean,
  /** The number of its last recomputation that moved the list: `diff.changes` counts from it. */
  sequence: Schema.Number,
  /** Why Git could not read it, in Git's words; its files are then none. */
  unreadable: Schema.NullOr(Schema.String),
})
export type DiffRepository = typeof DiffRepository.Type

/** The moment a checkpoint was taken at, which the diff read from it is marked with. */
export const DiffCheckpoint = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(['review', 'review_entry', 'round_end']),
  takenAt: Schema.String,
})
export type DiffCheckpoint = typeof DiffCheckpoint.Type

/** A mission's diff: live from its Workspace, or from a checkpoint once the Workspace is gone. */
export const MissionDiff = Schema.Struct({
  source: Schema.Literals(['live', 'checkpoint']),
  /** The checkpoint read, null for a live diff or a mission with neither. */
  checkpoint: Schema.NullOr(DiffCheckpoint),
  repositories: Schema.Array(DiffRepository),
})
export type MissionDiff = typeof MissionDiff.Type

/** One side of a file as text, masked, with its encoding. */
export const DiffText = Schema.TaggedStruct('DiffText', {
  text: Schema.String,
  encoding: Schema.Literal('utf-8'),
  size: Schema.Number,
})
/** One side of a file Git sees no text in. */
export const DiffBinary = Schema.TaggedStruct('DiffBinary', { size: Schema.Number })
/** One side of a file in a sensitive place: why its content is not sent. */
export const DiffWithheld = Schema.TaggedStruct('DiffWithheld', {
  reason: Schema.String,
  size: Schema.Number,
})

/** One side of a file: its text (masked) and its encoding, a binary, or a withheld content. */
export const DiffSide = Schema.Union([DiffText, DiffBinary, DiffWithheld])
export type DiffSide = typeof DiffSide.Type

/** Both sides of one file. */
export const DiffSides = Schema.TaggedStruct('DiffSides', {
  before: Schema.NullOr(DiffSide),
  after: Schema.NullOr(DiffSide),
})
/** A large file's sizes and changed lines, its sides kept until asked with `force`. */
export const DiffTooLarge = Schema.TaggedStruct('DiffTooLarge', {
  sizeBefore: Schema.NullOr(Schema.Number),
  sizeAfter: Schema.NullOr(Schema.Number),
  lines: Schema.Number,
})

/** Both sides of one file, or "too large" with its sizes until asked with `force`. */
export const DiffContents = Schema.Union([DiffSides, DiffTooLarge])
export type DiffContents = typeof DiffContents.Type

/** What moved in one repository's list: the files new or changed, and the paths gone from it. */
export const DiffChange = Schema.Struct({
  repository: Schema.String,
  sequence: Schema.Number,
  files: Schema.Array(DiffFile),
  gone: Schema.Array(Schema.String),
  unreadable: Schema.NullOr(Schema.String),
})
export type DiffChange = typeof DiffChange.Type

export class UnknownDiffFile extends Schema.TaggedError<UnknownDiffFile>()('UnknownDiffFile', {
  repository: Schema.String,
  path: Schema.String,
}) {
  override get message(): string {
    return 'This file is not in the changes.'
  }
}

export class UnknownCheckpoint extends Schema.TaggedError<UnknownCheckpoint>()(
  'UnknownCheckpoint',
  { id: Schema.String },
) {
  override get message(): string {
    return 'This version of the changes is not known to Hemera.'
  }
}

/** Git could not read a file's sides, in its words. */
export class DiffUnreadable extends Schema.TaggedError<DiffUnreadable>()('DiffUnreadable', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason
  }
}

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const always = [StorageFailed, EngineGone] as const

export const DiffRpcs = RpcGroup.make(
  /** The mission's diff, every repository of its Workspace listed, recomputed now. */
  Rpc.make('diff.live', {
    payload: { missionId: Schema.String },
    success: MissionDiff,
    error: failing(...always, UnknownMission),
  }),
  /** Both sides of one file of the mission's diff, masked; a large one only with `force`. */
  Rpc.make('diff.file', {
    payload: {
      missionId: Schema.String,
      repository: Schema.String,
      path: Schema.String,
      force: Schema.optionalKey(Schema.Boolean),
    },
    success: DiffContents,
    error: failing(...always, UnknownMission, UnknownDiffFile, DiffUnreadable),
  }),
  /** The diff a checkpoint kept, read from the database alone. */
  Rpc.make('diff.atCheckpoint', {
    payload: { checkpointId: Schema.String },
    success: MissionDiff,
    error: failing(...always, UnknownCheckpoint),
  }),
  /** Both sides of one file of a checkpoint. */
  Rpc.make('diff.fileAtCheckpoint', {
    payload: { checkpointId: Schema.String, repository: Schema.String, path: Schema.String },
    success: DiffContents,
    error: failing(...always, UnknownCheckpoint, UnknownDiffFile),
  }),
  /** What moves in the mission's diff, repository by repository, for as long as the caller listens. */
  Rpc.make('diff.changes', {
    payload: { missionId: Schema.String },
    success: DiffChange,
    error: failing(...always, UnknownMission),
    stream: true,
  }),
)
