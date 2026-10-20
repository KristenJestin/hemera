import type { RemarkState } from '../review/types.ts'

/**
 * What the diff view of #264 draws, as plain values in the words the screen uses. The engine's
 * names stay in the RPCs the build tickets wire (`diff.live`, `diff.file`, `review.state`…).
 */

/** Git's letter for a change: added, modified, deleted, renamed, type changed. */
export type GitLetter = 'A' | 'M' | 'D' | 'R' | 'T'

/** One file a repository of the Workspace changed, with both sides of its content. */
export interface DiffFile {
  path: string
  /** Where a renamed file was. */
  from?: string | undefined
  letter: GitLetter
  /** A file Git does not track yet: a commit would leave it out. */
  untracked?: boolean | undefined
  /** A file a tool writes (a lockfile, a generated client): it comes folded. */
  generated?: boolean | undefined
  /** A file whose content is not text: its sizes before and after, in words. */
  binary?: { before: string | null; after: string | null } | undefined
  /** A file too long to draw at once: it waits until it is asked for. */
  large?: boolean | undefined
  /** A file that may hold secrets: listed, its content never shown. */
  withheld?: boolean | undefined
  /** Changed outside Hemera since the mission last looked. */
  outside?: boolean | undefined
  /** Lines added and removed; none for a binary or a withheld file. */
  added: number
  removed: number
  /** The content before, null for a file it added. */
  before: string | null
  /** The content now, null for a file it deleted. */
  after: string | null
}

export interface DiffRepository {
  name: string
  /** Changed outside Hemera: a file of it was written by something else than the mission. */
  outside?: boolean | undefined
  files: readonly DiffFile[]
}

/** Where a comment points: lines on one side of a file, or the whole file. */
export interface Place {
  repository: string
  path: string
  /** The side its lines are on: the file before, or the file now. */
  side: 'old' | 'new'
  /** Its lines, both ends included; null for a comment on the whole file. */
  lines: { start: number; end: number } | null
}

/** One answer under a comment: the agent's, or the user's follow-up. */
export interface Reply {
  who: 'agent' | 'you'
  text: string
  at: string
}

/** Who wrote a comment on the forge, and where it stands there. */
export interface TeamAuthor {
  name: string
  forge: 'GitHub' | 'Bitbucket'
  url: string
  /** Resolved on the forge: settled there, folded here. */
  resolved: boolean
}

/**
 * A comment on the diff. The user's comments are remarks of the Review page (#254) with a place:
 * the same ids, the same states. A team member's comes from the forge and keeps its own state
 * there.
 */
export interface DiffComment {
  id: string
  kind: 'remark' | 'question'
  text: string
  state: RemarkState
  place: Place
  round?: number | undefined
  at: string
  /** What the agent answered, and what followed, under it. */
  thread?: readonly Reply[] | undefined
  /** Moved with its lines: where its lines were when it was written. */
  movedFrom?: { start: number; end: number } | undefined
  /**
   * Its lines changed since it was written: the excerpt it was written on, and the version it
   * was written on, which opens on request.
   */
  outdated?: { excerpt: string; version: string } | undefined
  /** From the forge: who wrote it there. */
  team?: TeamAuthor | undefined
}

/** Where the diff is read from: the Workspace as it is, or the last checkpoint once it is gone. */
export type DiffSource =
  | { kind: 'live'; round?: number | undefined }
  | { kind: 'checkpoint'; at: string; why: 'cleanup' | 'done' }

export interface DiffMoment {
  repositories: readonly DiffRepository[]
  comments: readonly DiffComment[]
  source: DiffSource
}

/** A comment being written: on lines, or on a whole file. */
export interface Draft {
  place: Place
}
