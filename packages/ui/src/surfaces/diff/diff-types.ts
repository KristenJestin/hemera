/**
 * What the diff view draws, as plain values in the words the screen uses. The engine's names stay
 * in the RPCs the renderer reads (`diff.live`, `diff.file`, `review.state`…).
 */

/** Git's letter for a change: added, modified, deleted, renamed, type changed. */
export type GitLetter = 'A' | 'M' | 'D' | 'R' | 'T'

/** The two sides of a text file: null before for a file it added, null after for one it deleted. */
export interface DiffSides {
  before: string | null
  after: string | null
}

/** One file a repository of the Workspace changed. */
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
  /** A file too long to draw at once: its lines, and it waits until it is asked for. */
  large?: { lines: number } | undefined
  /** A file that may hold secrets: listed, its content never shown. */
  withheld?: boolean | undefined
  /** Changed outside Hemera since the mission last looked. */
  outside?: boolean | undefined
  /** Lines added and removed; none for a binary or a withheld file. */
  added: number
  removed: number
  /** Its two sides once read; absent while they are read, or while a large file waits. */
  sides?: DiffSides | undefined
  /** Why its sides could not be read, in words. */
  unreadable?: string | undefined
}

export interface DiffRepository {
  name: string
  /** Changed outside Hemera: a file of it was written by something else than the mission. */
  outside?: boolean | undefined
  /** Why Git could not read it, in words: its files are then none. */
  unreadable?: string | undefined
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

/**
 * Where a comment of the user stands. It waits until Fix sends it; it is in a round while the
 * round works on it; the agent marks it addressed, and only its author resolves it; its author may
 * withdraw it while it is not resolved.
 */
export type CommentState = 'waiting' | 'inRound' | 'addressed' | 'resolved' | 'withdrawn'

/** One answer under a comment: the agent's, or the user's follow-up. */
export interface Reply {
  who: 'agent' | 'you'
  text: string
  at?: string | undefined
}

/** Who wrote a comment on the forge, and where it stands there. */
export interface TeamAuthor {
  name: string
  forge: 'GitHub' | 'Bitbucket'
  /** Where it is read on the forge, when the forge said. */
  url?: string | undefined
  /** Resolved on the forge: settled there, folded here. */
  resolved: boolean
}

/**
 * A comment on the diff. The user's comments are remarks of the Review page with a place: the
 * same ids, the same states. A team member's comes from the forge and keeps its own state there.
 */
export interface DiffComment {
  id: string
  kind: 'remark' | 'question'
  text: string
  state: CommentState
  place: Place
  round?: number | undefined
  at: string
  /** What the agent answered, and what followed, under it. */
  thread?: readonly Reply[] | undefined
  /** Moved with its lines: where its lines were when it was written. */
  movedFrom?: { start: number; end: number } | undefined
  /**
   * Its lines changed since it was written: the excerpt it was written on, and the version it
   * was written on in words, which opens on request.
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
