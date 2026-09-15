/**
 * The measure of the witness transition (design D0-06).
 *
 * A transition is counted frame by frame while it plays: how many frames were rendered, and
 * how long the longest one took. The refresh rate is the one the frames themselves show, not
 * the one the display claims — a transition that misses is a transition that missed here.
 */

import type { MotionMeasure } from '@hemera/ipc'

/** How long a measure watches, in milliseconds. Two seconds covers a calm spring twice over. */
export const MEASURE_DURATION = 2000

export function measureOf(frameTimes: number[]): MotionMeasure {
  const deltas: number[] = []
  for (let index = 1; index < frameTimes.length; index += 1) {
    deltas.push(frameTimes[index]! - frameTimes[index - 1]!)
  }
  if (deltas.length === 0) return { refreshRate: 0, frames: frameTimes.length, longestFrame: 0 }

  const sorted = [...deltas].toSorted((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]!
  return {
    refreshRate: Math.round(1000 / median),
    frames: frameTimes.length,
    longestFrame: Math.round(Math.max(...deltas) * 100) / 100,
  }
}

/** Counts the frames the browser actually renders over the next `duration` milliseconds. */
export async function measureFrames(duration = MEASURE_DURATION): Promise<MotionMeasure> {
  const frameTimes: number[] = []
  return await new Promise((resolve) => {
    const started = performance.now()
    const step = (now: number): void => {
      frameTimes.push(now)
      if (now - started >= duration) {
        resolve(measureOf(frameTimes))
        return
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}
