/**
 * Where a task stands, as one small mark that changes in place: one ring and what it holds, every
 * state a pose of the same strokes, so a change is a stroke moving and never one glyph swapped
 * for another.
 *
 * - `todo` · a dotted ring, quiet: nothing has started.
 * - `running` · an arc of the ring, turning, in the running tone.
 * - `done` · the ring closes and a ✓ draws itself in it; `failed`, a ✕.
 * - `waiting` · the ring closes around a dot that waits for the user, a ring leaving it on the
 *   beat of the theme's `ping`.
 * - `blocked` · the ring closes around a bar: the way is shut.
 * - `skipped` · the dotted ring, a stroke across it.
 *
 * Asked for less movement, every pose is there at once, the arc does not turn and no ring leaves
 * the dot. With `legend`, the state in words is a tooltip on the mark; without, the mark is
 * decoration beside a line that already says the state.
 */

export type MarkState =
  | 'todo'
  | 'running'
  | 'done'
  | 'failed'
  | 'waiting'
  | 'blocked'
  | 'skipped'
  | 'idle'

/** What each state means, in words: the legend, and what a screen reader says. */
export const MARK_LEGENDS: Record<MarkState, string> = {
  todo: 'To do',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  waiting: 'Waiting for you',
  blocked: 'Blocked',
  skipped: 'Skipped',
  idle: 'Idle',
}
