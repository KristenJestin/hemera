/**
 * Ticket events (#97): each change the sync finds on a watched ticket, between the last known
 * version Hemera holds and the one it reads now, with the difference the user is shown.
 *
 * - The title or the description whose fingerprint moved: `description_changed`, with a line
 *   difference of the normalised title and description.
 * - The status moved: `status_changed`, before and after.
 * - A comment id not seen before: `comment_added`; a known comment whose body changed:
 *   `comment_edited`; a known comment missing: `comment_removed`, recorded only.
 *
 * Hemera detects, the agent analyses, the user decides: nothing here applies anything.
 */

import { Schema } from 'effect'

import { type TicketComment, type TicketStatus, normalisedText } from './tickets.ts'

export const TICKET_EVENT_KINDS = [
  'description_changed',
  'status_changed',
  'comment_added',
  'comment_edited',
  'comment_removed',
] as const
export const TicketEventKind = Schema.Literals(TICKET_EVENT_KINDS)
export type TicketEventKind = typeof TicketEventKind.Type

/**
 * New; delivered (to the Planner, or to a `ticket-event` session); analysed by that session;
 * integrated by the Planner; or seen by the user.
 */
export const TICKET_EVENT_STATES = ['new', 'delivered', 'analysed', 'integrated', 'seen'] as const
export const TicketEventState = Schema.Literals(TICKET_EVENT_STATES)
export type TicketEventState = typeof TicketEventState.Type

/** Whether a change matters to the frozen Spec, as a `ticket-event` session judges it. */
export const TicketEventMatters = Schema.Literals(['yes', 'no', 'unsure'])
export type TicketEventMatters = typeof TicketEventMatters.Type

/** How often a Project's tickets are checked by default, and at least, in minutes. */
export const DEFAULT_SYNC_MINUTES = 60
export const MIN_SYNC_MINUTES = 5
/** At most once a week: a longer interval is a sync turned off, which 1.0 does not offer. */
export const MAX_SYNC_MINUTES = 7 * 24 * 60

/** Why an interval is refused, or null when it is kept. */
export const syncIntervalRefusal = (minutes: number): string | null => {
  if (!Number.isInteger(minutes)) return 'the interval is a whole number of minutes'
  if (minutes < MIN_SYNC_MINUTES) {
    return `the interval is at least ${String(MIN_SYNC_MINUTES)} minutes, for the trackers’ rate limits`
  }
  if (minutes > MAX_SYNC_MINUTES) return 'the interval is at most a week'
  return null
}

/** One change found between two versions of a ticket. */
export interface DetectedChange {
  readonly kind: TicketEventKind
  /** The comment it is about; null for the description and the status. */
  readonly commentId: string | null
  /** What moved, as the user is shown it. */
  readonly difference: string
}

/** What the comparison reads of a version. */
export interface ComparedVersion {
  readonly title: string
  readonly description: string
  readonly fingerprint: string
  readonly status: TicketStatus
  readonly comments: ReadonlyArray<TicketComment>
}

type Step = { readonly op: ' ' | '-' | '+'; readonly line: string }

/**
 * The most cells the comparison's table may hold (about 8 MB): past it, two texts are not compared
 * line by line, and the whole of one is said removed and the whole of the other added.
 */
export const MAX_DIFFERENCE_CELLS = 2_000_000

/**
 * The steps from one list of lines to the other, by their longest common subsequence; past the
 * bound, every line before removed, then every line after added.
 */
const steps = (
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
): ReadonlyArray<Step> => {
  const rows = before.length + 1
  const columns = after.length + 1
  if (rows * columns > MAX_DIFFERENCE_CELLS) {
    return [
      ...before.map((line): Step => ({ op: '-', line })),
      ...after.map((line): Step => ({ op: '+', line })),
    ]
  }
  const common = new Uint32Array(rows * columns)
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      common[i * columns + j] =
        before[i] === after[j]
          ? (common[(i + 1) * columns + j + 1] ?? 0) + 1
          : Math.max(common[(i + 1) * columns + j] ?? 0, common[i * columns + j + 1] ?? 0)
    }
  }
  const out: Step[] = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      out.push({ op: ' ', line: before[i] ?? '' })
      i += 1
      j += 1
    } else if ((common[(i + 1) * columns + j] ?? 0) >= (common[i * columns + j + 1] ?? 0)) {
      out.push({ op: '-', line: before[i] ?? '' })
      i += 1
    } else {
      out.push({ op: '+', line: after[j] ?? '' })
      j += 1
    }
  }
  for (; i < before.length; i += 1) out.push({ op: '-', line: before[i] ?? '' })
  for (; j < after.length; j += 1) out.push({ op: '+', line: after[j] ?? '' })
  return out
}

/**
 * The lines that changed from one text to the other, normalised first (Unicode NFC, line endings
 * LF, trailing spaces trimmed): removed lines `- `, added lines `+ `, and `…` between two hunks.
 * Empty when nothing changed. Two texts too long to compare (`MAX_DIFFERENCE_CELLS`) give the whole
 * of the first removed and the whole of the second added.
 */
export const lineDifference = (before: string, after: string): string => {
  const was = normalisedText(before)
  const now = normalisedText(after)
  if (was === now) return ''
  const lines: string[] = []
  let gap = false
  for (const step of steps(was.split('\n'), now.split('\n'))) {
    if (step.op === ' ') {
      gap = lines.length > 0
      continue
    }
    if (gap) lines.push('…')
    gap = false
    lines.push(`${step.op} ${step.line}`)
  }
  return lines.join('\n')
}

/** A ticket's title and description as one text, the title first. */
const ticketBody = (version: ComparedVersion): string =>
  `${version.title}\n\n${version.description}`

/** A whole text as added or removed lines. */
const marked = (op: '+' | '-', text: string): string =>
  normalisedText(text)
    .split('\n')
    .map((line) => `${op} ${line}`)
    .join('\n')

const statusSaid = (status: TicketStatus): string => status.wording

/**
 * Every change from the last known version to the one read now, in a fixed order: the description,
 * the status, the comments of the version read now in their order, then the comments removed.
 */
export const ticketChanges = (
  before: ComparedVersion,
  after: ComparedVersion,
): ReadonlyArray<DetectedChange> => {
  const changes: DetectedChange[] = []
  if (before.fingerprint !== after.fingerprint) {
    changes.push({
      kind: 'description_changed',
      commentId: null,
      difference: lineDifference(ticketBody(before), ticketBody(after)),
    })
  }
  if (
    before.status.state !== after.status.state ||
    before.status.wording !== after.status.wording
  ) {
    changes.push({
      kind: 'status_changed',
      commentId: null,
      difference: `${statusSaid(before.status)} → ${statusSaid(after.status)}`,
    })
  }
  const known = new Map(before.comments.map((one) => [one.id, one]))
  for (const comment of after.comments) {
    const was = known.get(comment.id)
    if (was === undefined) {
      changes.push({
        kind: 'comment_added',
        commentId: comment.id,
        difference: marked('+', comment.body),
      })
    } else if (was.fingerprint !== comment.fingerprint) {
      changes.push({
        kind: 'comment_edited',
        commentId: comment.id,
        difference: lineDifference(was.body, comment.body),
      })
    }
  }
  const kept = new Set(after.comments.map((one) => one.id))
  for (const comment of before.comments) {
    if (kept.has(comment.id)) continue
    changes.push({
      kind: 'comment_removed',
      commentId: comment.id,
      difference: marked('-', comment.body),
    })
  }
  return changes
}

/** How a sentence names a change. */
export const TICKET_EVENT_SAID: Readonly<Record<TicketEventKind, string>> = {
  description_changed: 'The ticket’s description changed',
  status_changed: 'The ticket’s status changed',
  comment_added: 'A comment was added to the ticket',
  comment_edited: 'A comment of the ticket was edited',
  comment_removed: 'A comment of the ticket was removed',
}

const Bounded = (maximum: number, description: string) =>
  Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(maximum)).annotate({ description })

/** What `answer_propose` carries. */
export const AnswerPropose = Schema.Struct({
  question: Bounded(20, 'The question it answers (`Q3`): open, or waiting on someone.'),
  source: Bounded(200, 'The id of the ticket comment that answers it, as the delivery named it.'),
  text: Bounded(4000, 'The answer, in the user’s words, taken from the comment.'),
}).annotate({
  description:
    'Propose an answer to a question that waits, from a comment of the ticket. Hemera shows it to the user beside the question; it becomes an answer only if the user accepts it. Never answer the question yourself.',
})
export type AnswerPropose = typeof AnswerPropose.Type

/** What `ticket_event_report` carries. */
export const TicketEventReport = Schema.Struct({
  event: Bounded(40, 'The ticket event, as the brief named it.'),
  summary: Bounded(2000, 'What changed, in a few sentences.'),
  matters: TicketEventMatters.annotate({
    description: 'Whether it matters to the frozen Spec: `yes`, `no` or `unsure`.',
  }),
  why: Bounded(2000, 'Why it matters, or why not.'),
}).annotate({
  description:
    'Report your analysis of one ticket event. Call it once per event of your brief: your session ends when every event has its report.',
})
export type TicketEventReport = typeof TicketEventReport.Type
