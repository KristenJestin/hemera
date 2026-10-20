/**
 * Review's feedback (#341): what the user writes while testing the result, the rounds that carry
 * it, and the hold on the agents while the user reviews.
 *
 * Review is one mechanism, in batches: a round collects feedback, and only a Fix (#R2) turns it
 * into work. A feedback is a remark from live testing, a comment on the code, or a question; it is
 * answered by the agent (`addressed`) and only its author resolves it. Nothing here touches the
 * database or Git: the engine does.
 */

import { Schema } from 'effect'

import type { Stage } from './mission.ts'
import type { ToolName } from './tools.ts'

/** Where a round stands, in the only order it moves in. */
export const ROUND_STATES = ['collecting', 'grilling', 'building', 'answered', 'closed'] as const
export const RoundState = Schema.Literals(ROUND_STATES)
export type RoundState = typeof RoundState.Type

/** The rounds that run: at most one at a time, beside one `collecting`. */
export const RUNNING_ROUND_STATES = ['grilling', 'building', 'answered'] as const

/** What a feedback is: a remark from live testing, a comment on the diff, or a question. */
export const FEEDBACK_KINDS = ['remark', 'code', 'question'] as const
export const FeedbackKind = Schema.Literals(FEEDBACK_KINDS)
export type FeedbackKind = typeof FeedbackKind.Type

/**
 * Where a feedback stands: written, taken by a Fix, answered by the agent, resolved by its author,
 * or withdrawn by its author.
 */
export const FEEDBACK_STATES = [
  'waiting',
  'in_round',
  'addressed',
  'resolved',
  'withdrawn',
] as const
export const FeedbackState = Schema.Literals(FEEDBACK_STATES)
export type FeedbackState = typeof FeedbackState.Type

/** The side of the diff a code anchor's lines are on: `old` for a deleted line. */
export const AnchorSide = Schema.Literals(['new', 'old'])
export type AnchorSide = typeof AnchorSide.Type

/** A range of lines, both ends included, counted from 1. */
export const LineRange = Schema.Struct({ start: Schema.Int, end: Schema.Int })
export type LineRange = typeof LineRange.Type

/** What a feedback points at, as the user writes it: a place in the diff, or a Spec item. */
export const CodeAnchorAsked = Schema.TaggedStruct('Code', {
  repository: Schema.String,
  path: Schema.String,
  side: AnchorSide,
  /** Absent for a comment on the whole file. */
  lines: Schema.NullOr(LineRange),
  /**
   * The tree of the repository the window showed (`DiffRepository.tree`): the lines are taken on
   * it and carried to the Workspace as it is when the comment is sent. Null: the Workspace now.
   */
  tree: Schema.NullOr(Schema.String),
})
export const SpecAnchorAsked = Schema.TaggedStruct('Spec', {
  /** A requirement (`R2`) or a scenario (`R2.S1`) of the frozen Spec. */
  item: Schema.String,
})
export const AnchorAsked = Schema.Union([CodeAnchorAsked, SpecAnchorAsked])
export type AnchorAsked = typeof AnchorAsked.Type

/** What of a feedback says whether it waits for a Fix. */
export interface FeedbackStanding {
  readonly kind: FeedbackKind
  readonly state: FeedbackState
}

/**
 * Whether a round's feedback waits for a Fix (R2 offers Fix, R9 refuses Ship): one still
 * `waiting`, not withdrawn, and not a question. A question is answered and never becomes work.
 */
export function waitsForFix(feedback: ReadonlyArray<FeedbackStanding>): boolean {
  return feedback.some((one) => one.state === 'waiting' && one.kind !== 'question')
}

/** Why round `number` may not move from one state to another, or null: forward only. */
export function roundMoveRefusal(number: number, from: RoundState, to: RoundState): string | null {
  if (ROUND_STATES.indexOf(to) > ROUND_STATES.indexOf(from)) return null
  return `round ${String(number)} is ${from}: it cannot become ${to}`
}

/**
 * Why a feedback may not be written on a mission standing where it does, or null: in Review, or
 * in "Building · round N" (it then goes to the next round), and never empty.
 */
export function feedbackRefusal(
  mission: { readonly stage: Stage; readonly round: number },
  body: string,
): string | null {
  const open = mission.stage === 'review' || (mission.stage === 'building' && mission.round > 0)
  if (!open) return `feedback is written in Review: the mission is in ${mission.stage}`
  if (body.trim() === '') return 'a feedback is never empty: write what you found'
  return null
}

/** Why a range of lines is not one in a file of `lines` lines, or null. */
export function rangeRefusal(range: LineRange, lines: number): string | null {
  if (range.start < 1) return `line ${String(range.start)} is not a line: lines start at 1`
  if (range.end < range.start)
    return `lines ${String(range.start)}–${String(range.end)} are not a range`
  if (range.end > lines) {
    return `lines ${String(range.start)}–${String(range.end)} go beyond the file, which has ${String(lines)} lines`
  }
  return null
}

/** What the agents are told when the hold of Review refuses them a call. */
export const REVIEW_HOLD =
  'The mission is in Review: the user is reviewing the Workspace, and nothing is written or run in it until a round starts.'

/** The tools held while the user reviews: what writes in the Workspace or runs there. */
const HELD_IN_REVIEW: ReadonlySet<ToolName> = new Set(['fs_write', 'fs_edit', 'commands_run'])

/** Why the held tools are refused when the mission's stage cannot be read: the hold fails closed. */
export const STAGE_UNREAD =
  "the mission's stage could not be read, so nothing is written or run: try again."

/**
 * Why a session of a mission in `stage` may not call `tool`, or null. Only Review holds: in
 * "Building · round N" the round's agents work. A stage that could not be read (`unread`) holds
 * the same tools: a guard that cannot tell refuses.
 */
export function reviewToolRefusal(stage: Stage | 'unread', tool: ToolName): string | null {
  if (!HELD_IN_REVIEW.has(tool)) return null
  if (stage === 'unread') return `refused: ${STAGE_UNREAD}`
  return stage === 'review' ? `refused: ${REVIEW_HOLD}` : null
}

/** An image's size in pixels. */
export interface Pixels {
  readonly width: number
  readonly height: number
}

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length))

/** The pixel size a PNG, a JPEG or a WebP says in its header, or null when it says none. */
export function imagePixels(bytes: Uint8Array): Pixels | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const fits = (end: number) => end <= bytes.length
  // PNG: the signature, then IHDR with the width and the height, big-endian.
  if (fits(24) && bytes[0] === 0x89 && ascii(bytes, 12, 4) === 'IHDR') {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  // JPEG: markers until a start of frame, which holds the height then the width.
  if (fits(4) && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2
    while (fits(at + 9)) {
      if (bytes[at] !== 0xff) return null
      const marker = bytes[at + 1] ?? 0
      const frame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
      if (frame) return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) }
      at += 2 + view.getUint16(at + 2)
    }
    return null
  }
  // WebP: RIFF, WEBP, then a VP8, VP8L or VP8X chunk.
  if (fits(16) && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const chunk = ascii(bytes, 12, 4)
    if (chunk === 'VP8L' && fits(25)) {
      const bits = view.getUint32(21, true)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8 ' && fits(30)) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    }
    if (chunk === 'VP8X' && fits(30)) {
      const read24 = (at: number) =>
        (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16)
      return { width: read24(24) + 1, height: read24(27) + 1 }
    }
  }
  return null
}
