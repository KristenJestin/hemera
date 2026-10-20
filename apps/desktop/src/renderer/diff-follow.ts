/**
 * How the diff view (#497) follows a mission: its diff listed, then each file's sides read a few at
 * a time; each change of a repository applied as it comes, the files it names read again and no
 * other; a large file's sides asked with `force` once its Show is pressed; the sides read from the
 * checkpoint once the Workspace is gone; Review read again at each change of it and of the diff,
 * since its anchors follow the live lines; and what the user writes, sent by the feedback each
 * comment's name stands for. A read overtaken by a change of its file is not heard.
 */

import type { MissionDiff, ReviewStateView } from '@hemera/ipc'
import { diffFileId, type CommentAction, type NewComment } from '@hemera/ui'

import { anchorOf, commentsOf, toRead, withChange, type SideRead } from './diff-model.ts'
import type { Link } from './link.ts'

/** What of the window's link the diff view asks. */
export type DiffFollowLink = Pick<
  Link,
  | 'liveDiff'
  | 'onDiffChanges'
  | 'diffFile'
  | 'diffFileAtCheckpoint'
  | 'reviewState'
  | 'onReviewChanges'
  | 'addFeedback'
  | 'editFeedback'
  | 'withdrawFeedback'
  | 'resolveFeedback'
  | 'followUpFeedback'
>

/** What the diff view has read of the mission, and why something did not go through. */
export interface DiffState {
  /** The list, once read. */
  diff: MissionDiff | null
  /** Each file's sides as they were read, by the file's id. */
  sides: ReadonlyMap<string, SideRead>
  review: ReviewStateView | null
  /** Why the list could not be read, in words. */
  error?: string | undefined
  /** Why the last gesture did not go through, in words. */
  notice?: string | undefined
}

export interface DiffFollowing {
  stop: () => void
  /** Reads the list again, after it could not be. */
  retry: () => void
  /** A large file's Show pressed: its sides are asked for with `force`. */
  show: (id: string) => void
  add: (comment: NewComment) => void
  act: (name: string, action: CommentAction) => void
  edit: (name: string, text: string) => void
  followUp: (name: string, text: string) => void
}

/** How many files' sides are read at once: enough to fill a screen soon, not a queue of hundreds. */
const AT_ONCE = 4

export function followDiff(
  link: DiffFollowLink,
  missionId: string,
  onState: (state: DiffState) => void,
): DiffFollowing {
  let stopped = false
  let diff: MissionDiff | null = null
  let review: ReviewStateView | null = null
  let error: string | undefined
  let notice: string | undefined
  const sides = new Map<string, SideRead>()
  /** Each file's reads, counted: a read answered after a later one was asked is not heard. */
  const reads = new Map<string, number>()
  const reading = new Set<string>()
  const asked = new Set<string>()
  let reviewReads = 0

  const emit = (): void => {
    if (stopped) return
    onState({ diff, sides: new Map(sides), review, error, notice })
  }

  const readSides = (): void => {
    if (stopped || diff === null) return
    const checkpoint = diff.source === 'checkpoint' ? diff.checkpoint : null
    for (const next of toRead(diff, sides, asked, reading).slice(
      0,
      Math.max(0, AT_ONCE - reading.size),
    )) {
      const id = diffFileId(next.repository, next.path)
      const mine = (reads.get(id) ?? 0) + 1
      reads.set(id, mine)
      reading.add(id)
      const answer =
        checkpoint === null
          ? link.diffFile(missionId, next.repository, next.path, next.force)
          : link.diffFileAtCheckpoint(checkpoint.id, next.repository, next.path)
      answer.then(
        (contents) => heard(id, mine, { kind: 'read', contents }),
        (failure: Error) => heard(id, mine, { kind: 'failed', why: failure.message }),
      )
    }
  }

  function heard(id: string, mine: number, read: SideRead): void {
    if (stopped || reads.get(id) !== mine) return
    reading.delete(id)
    sides.set(id, read)
    emit()
    readSides()
  }

  const readReview = (): void => {
    reviewReads += 1
    const mine = reviewReads
    link.reviewState(missionId).then(
      (next) => {
        if (stopped || mine !== reviewReads) return
        review = next
        emit()
      },
      (failure: Error) => {
        if (stopped || mine !== reviewReads) return
        notice = failure.message
        emit()
      },
    )
  }

  const readList = (): void => {
    link.liveDiff(missionId).then(
      (read) => {
        if (stopped) return
        diff = read
        error = undefined
        emit()
        readSides()
      },
      (failure: Error) => {
        if (stopped) return
        error = failure.message
        emit()
      },
    )
  }

  readList()
  readReview()

  const stopChanges = link.onDiffChanges(
    missionId,
    (change) => {
      if (diff === null) return
      diff = withChange(diff, change)
      // What moved is read again; what did not keeps its sides and is not drawn again.
      for (const path of [...change.files.map((file) => file.path), ...change.gone]) {
        const id = diffFileId(change.repository, path)
        sides.delete(id)
        reading.delete(id)
        reads.set(id, (reads.get(id) ?? 0) + 1)
      }
      emit()
      readReview()
      readSides()
    },
    (failure) => {
      notice = failure.message
      emit()
    },
  )
  const stopReview = link.onReviewChanges(missionId, readReview, (failure) => {
    notice = failure.message
    emit()
  })

  /** Sends a gesture: what it answers comes back through Review's changes; a refusal, in words. */
  const send = (gesture: Promise<unknown>): void => {
    notice = undefined
    gesture.then(readReview, (failure: Error) => {
      if (stopped) return
      notice = failure.message
      emit()
    })
  }

  const feedbackOf = (name: string) =>
    review === null ? undefined : commentsOf(review, new Date()).byName.get(name)

  return {
    stop: () => {
      stopped = true
      stopChanges()
      stopReview()
    },
    retry: readList,
    show: (id) => {
      asked.add(id)
      readSides()
    },
    add: (comment) => {
      if (diff === null) return
      const kind = comment.kind === 'question' ? 'question' : 'code'
      send(link.addFeedback(missionId, kind, comment.text, anchorOf(comment.place, diff)))
    },
    act: (name, action) => {
      const one = feedbackOf(name)
      if (one === undefined) return
      send(action === 'withdraw' ? link.withdrawFeedback(one.id) : link.resolveFeedback(one.id))
    },
    edit: (name, text) => {
      const one = feedbackOf(name)
      if (one !== undefined) send(link.editFeedback(one.id, text, one.version))
    },
    followUp: (name, text) => {
      const one = feedbackOf(name)
      if (one !== undefined) send(link.followUpFeedback(one.id, text))
    },
  }
}
