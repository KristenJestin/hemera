import type { LiveState } from './tint.tsx'

/** How each state is said to a screen reader, after the name. */
export const LIVE_WORDS: Record<LiveState, string> = {
  running: 'running',
  stuck: 'no activity',
  finished: 'done',
  failed: 'failed',
  stopped: 'stopped',
}

/** How long without an event a chip is said to be stuck, in the words of its legend. */
export const STUCK_AFTER = '5 minutes'

/** A duration in seconds and nothing else, the unit against the number: `1s`, `84s`, `1200s`. */
export function durationOf(ms: number): string {
  return `${String(Math.max(0, Math.floor(ms / 1000)))}s`
}

/** The state and how long, in words. */
export function glanceWordsOf(state: LiveState, time: string): string {
  if (state === 'running') return `Running for ${time}`
  if (state === 'stuck') return `No activity for 5 minutes · ${time}`
  if (state === 'finished') return `Done in ${time}`
  if (state === 'failed') return `Failed after ${time}`
  return `Stopped after ${time}`
}
