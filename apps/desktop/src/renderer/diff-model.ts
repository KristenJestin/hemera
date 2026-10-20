/**
 * What the diff view (#497) shows of a mission's diff (#249) and of Review's feedback (#341), in
 * the words of the screen: the files with their sides as they are read, what a change of a
 * repository moves, which sides to ask for, the comments under their lines, where the diff is read
 * from, and the anchor a new comment is written on. Plain functions, no React, no Effect.
 */

import {
  type CodeAnchorView,
  type DiffChange,
  type DiffContents,
  type DiffFile,
  type DiffRepository,
  type DiffSide,
  type FeedbackView,
  type MissionDiff,
  type ReviewStateView,
} from '@hemera/ipc'
import { CodeAnchorAsked } from '@hemera/core/domain'
import { diffFileId, type Diff, type MissionStage } from '@hemera/ui'
import { Match, Predicate } from 'effect'

import { whenOf } from './needs.ts'

/** One file's sides as the engine answered them, or why it could not read them. */
export type SideRead = { kind: 'read'; contents: DiffContents } | { kind: 'failed'; why: string }

/** A file whose sides are to be asked for; a large one with `force`, once its Show was pressed. */
export interface ToRead {
  repository: string
  path: string
  force: boolean
}

/** The comments of the diff, and the feedback each one's name stands for. */
export interface Comments {
  comments: Diff.DiffComment[]
  byName: ReadonlyMap<string, FeedbackView>
}

const UNITS = ['B', 'KB', 'MB', 'GB'] as const

/** A size in bytes as a reader reads it: `512 B`, `1.2 KB`, `3.0 MB`. */
export function sizeWords(bytes: number | null): string | null {
  if (bytes === null) return null
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024
    unit += 1
  }
  return unit === 0 ? `${String(size)} B` : `${size.toFixed(1)} ${UNITS[unit] ?? 'GB'}`
}

/** The text of a side, or null for a side the file does not have. */
const textOf = (side: DiffSide | null): string | null =>
  side !== null && Predicate.isTagged(side, 'DiffText') ? side.text : null

/** What a side holds that the view may not draw as text: a binary, or a withheld content. */
const opaque = (side: DiffSide | null): 'binary' | 'withheld' | null => {
  if (side === null) return null
  if (Predicate.isTagged(side, 'DiffWithheld')) return 'withheld'
  return Predicate.isTagged(side, 'DiffBinary') ? 'binary' : null
}

/** A file of the list, with what was read of its sides. */
function fileOf(file: DiffFile, read: SideRead | undefined): Diff.DiffFile {
  const binary = file.binary
    ? { before: sizeWords(file.sizeBefore), after: sizeWords(file.sizeAfter) }
    : undefined
  const shown: Diff.DiffFile = {
    path: file.path,
    from: file.oldPath ?? undefined,
    letter: file.letter,
    untracked: file.untracked,
    generated: file.generated,
    outside: file.changedOutside !== null,
    withheld: file.withheld || undefined,
    binary,
    added: file.added ?? 0,
    removed: file.removed ?? 0,
  }
  if (read === undefined)
    return file.large ? { ...shown, large: { lines: file.added ?? 0 } } : shown
  if (read.kind === 'failed') return { ...shown, unreadable: read.why }
  const contents = read.contents
  if (Predicate.isTagged(contents, 'DiffTooLarge')) {
    return { ...shown, large: { lines: contents.lines } }
  }
  // A side the list took for text and the read did not: drawn as what it turned out to be.
  const turned = opaque(contents.before) ?? opaque(contents.after)
  if (turned === 'withheld') return { ...shown, withheld: true }
  if (turned === 'binary') {
    return {
      ...shown,
      binary: {
        before: sizeWords(contents.before?.size ?? null),
        after: sizeWords(contents.after?.size ?? null),
      },
    }
  }
  const sides = { before: textOf(contents.before), after: textOf(contents.after) }
  return file.large ? { ...shown, large: { lines: file.added ?? 0 }, sides } : { ...shown, sides }
}

/** The repositories of the diff as the view draws them, each file with its sides once read. */
export function repositoriesOf(
  diff: MissionDiff,
  sides: ReadonlyMap<string, SideRead>,
): Diff.DiffRepository[] {
  return diff.repositories.map((repository) => ({
    name: repository.repository,
    outside: repository.changedOutside,
    unreadable: repository.unreadable ?? undefined,
    files: repository.files.map((file) =>
      fileOf(file, sides.get(diffFileId(repository.repository, file.path))),
    ),
  }))
}

/** The diff once a repository moved: its files replaced, added and gone, the others kept as are. */
export function withChange(diff: MissionDiff, change: DiffChange): MissionDiff {
  const gone = new Set(change.gone)
  const named = new Map(change.files.map((file) => [file.path, file]))
  const moved = (repository: DiffRepository): DiffRepository => {
    const kept = repository.files
      .filter((file) => !gone.has(file.path))
      .map((file) => named.get(file.path) ?? file)
    const known = new Set(kept.map((file) => file.path))
    const files = [...kept, ...change.files.filter((file) => !known.has(file.path))]
    return {
      ...repository,
      files,
      added: files.reduce((sum, file) => sum + (file.added ?? 0), 0),
      removed: files.reduce((sum, file) => sum + (file.removed ?? 0), 0),
      changedOutside: files.some((file) => file.changedOutside !== null),
      sequence: change.sequence,
      unreadable: change.unreadable,
    }
  }
  const listed = diff.repositories.some((one) => one.repository === change.repository)
  const repositories = listed
    ? diff.repositories.map((one) => (one.repository === change.repository ? moved(one) : one))
    : [
        ...diff.repositories,
        moved({
          repository: change.repository,
          branch: null,
          baseBranch: null,
          baseCommit: null,
          tree: null,
          files: [],
          added: 0,
          removed: 0,
          changedOutside: false,
          sequence: change.sequence,
          unreadable: null,
        }),
      ]
  return { ...diff, repositories }
}

/**
 * The files whose sides are to be asked for: every text file neither read nor being read, never a
 * binary or a withheld one. A large one is asked without `force` first, which answers its lines
 * counted, and with `force` once its Show was pressed.
 */
export function toRead(
  diff: MissionDiff,
  sides: ReadonlyMap<string, SideRead>,
  asked: ReadonlySet<string>,
  reading: ReadonlySet<string>,
): ToRead[] {
  const files: ToRead[] = []
  for (const repository of diff.repositories) {
    for (const file of repository.files) {
      const id = diffFileId(repository.repository, file.path)
      if (file.binary || file.withheld || reading.has(id)) continue
      const read = sides.get(id)
      const waits = read?.kind === 'read' && Predicate.isTagged(read.contents, 'DiffTooLarge')
      const force = file.large && asked.has(id)
      if (read === undefined || (force && waits)) {
        files.push({ repository: repository.repository, path: file.path, force })
      }
    }
  }
  return files
}

const STATES: Record<FeedbackView['state'], Diff.CommentState> = {
  waiting: 'waiting',
  in_round: 'inRound',
  addressed: 'addressed',
  resolved: 'resolved',
  withdrawn: 'withdrawn',
}

type CodeAnchor = typeof CodeAnchorView.Type

/** Where a code comment stands now, and where its lines were when it moved with them. */
interface Placed {
  place: Diff.Place
  movedFrom?: { start: number; end: number } | undefined
}

/** Where a code comment stands now: on its live lines, at its file's head once outdated. */
function placeOf(anchor: CodeAnchor): Placed {
  const at = { repository: anchor.repository, side: anchor.side }
  return Match.value(anchor.live).pipe(
    Match.tagsExhaustive({
      Current: (live): Placed => ({ place: { ...at, path: live.path, lines: live.lines } }),
      Moved: (live): Placed => ({
        place: { ...at, path: live.path, lines: live.lines },
        movedFrom: anchor.lines ?? undefined,
      }),
      // Its lines are gone or changed: it stands at its file's head, its excerpt saying where.
      Outdated: (): Placed => ({ place: { ...at, path: anchor.path, lines: null } }),
      Unread: (): Placed => ({ place: { ...at, path: anchor.path, lines: anchor.lines } }),
    }),
  )
}

const byTime = (left: FeedbackView, right: FeedbackView): number =>
  left.createdAt.localeCompare(right.createdAt)

/**
 * The comments of the diff: the feedback written on its code, under their lines. Each is named as
 * the Review page names it — `F` and its number among the user's feedback, `C` among the team's,
 * in the order they were written. A follow-up stands in the thread of what it follows up, under the
 * agent's answer, never on its own.
 */
export function commentsOf(review: ReviewStateView, now: Date): Comments {
  const all = review.feedback.toSorted(byTime)
  const names = new Map<string, string>()
  let mine = 0
  let team = 0
  for (const one of all) {
    if (Predicate.isTagged(one.author, 'Forge')) {
      team += 1
      names.set(one.id, `C${String(team)}`)
    } else {
      mine += 1
      names.set(one.id, `F${String(mine)}`)
    }
  }
  const byId = new Map(all.map((one) => [one.id, one]))
  const comments: Diff.DiffComment[] = []
  const byName = new Map<string, FeedbackView>()
  for (const one of all) {
    const anchor = one.anchor
    if (anchor === null || !Predicate.isTagged(anchor, 'Code') || one.followsUp !== null) continue
    const name = names.get(one.id) ?? one.id
    const { place, movedFrom } = placeOf(anchor)
    const answer = one.answer === null ? [] : [{ who: 'agent' as const, text: one.answer }]
    const followUps = one.followedBy.flatMap((id) => {
      const follow = byId.get(id)
      return follow === undefined
        ? []
        : [{ who: 'you' as const, text: follow.body, at: whenOf(follow.createdAt, now) }]
    })
    const thread = [...answer, ...followUps]
    comments.push({
      id: name,
      kind: one.kind === 'question' ? 'question' : 'remark',
      text: one.body,
      state: STATES[one.state],
      place,
      round: one.round,
      at: whenOf(one.createdAt, now),
      thread: thread.length === 0 ? undefined : thread,
      movedFrom,
      outdated: Predicate.isTagged(anchor.live, 'Outdated')
        ? {
            excerpt: (anchor.excerpt?.lines ?? []).join('\n'),
            version: `round ${String(one.round)}, ${whenOf(one.createdAt, now)}`,
          }
        : undefined,
      team: Predicate.isTagged(one.author, 'Forge')
        ? { name: one.author.login, forge: 'GitHub', resolved: one.state === 'resolved' }
        : undefined,
    })
    byName.set(name, one)
  }
  return { comments, byName }
}

const CHECKPOINT_DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' })
const CHECKPOINT_TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * Where the diff is read from: the Workspace, live — with the round that writes it while one does
 * — or, once the Workspace is gone, the last checkpoint, when it was taken and why it is read.
 */
export function sourceOf(diff: MissionDiff, stage: MissionStage, round: number): Diff.DiffSource {
  if (diff.source === 'checkpoint' && diff.checkpoint !== null) {
    const taken = new Date(diff.checkpoint.takenAt)
    return {
      kind: 'checkpoint',
      at: `${CHECKPOINT_DAY.format(taken)} at ${CHECKPOINT_TIME.format(taken)}`,
      why: stage === 'Done' ? 'done' : 'cleanup',
    }
  }
  return stage === 'Building' && round > 0 ? { kind: 'live', round } : { kind: 'live' }
}

/** The anchor of a new comment: its place, on the tree of its repository the window showed. */
export function anchorOf(place: Diff.Place, diff: MissionDiff): typeof CodeAnchorAsked.Type {
  const tree = diff.repositories.find((one) => one.repository === place.repository)?.tree ?? null
  return CodeAnchorAsked.make({
    repository: place.repository,
    path: place.path,
    side: place.side,
    lines: place.lines,
    tree,
  })
}
