import { faceArrive } from '../../motion.ts'

/**
 * The arithmetic the face's life is drawn from: dice from a seed, so the same seed tells the same
 * story every time it is told — when a waiting face blinks, which way a change looks — and the
 * shapes a change says something on the way with.
 */

/** A generator of numbers in [0, 1), the same ones for the same seed (mulberry32). */
export function dice(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** A seed of its own for one strand of a story: the same two numbers, the same strand. */
export function strand(seed: number, index: number): number {
  let mixed = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 0x632be5ab, 0xc2b2ae35)
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d)
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b)
  return (mixed ^ (mixed >>> 16)) >>> 0
}

/** Somewhere between `low` and `high`, `r` of the way along. */
export function between(r: number, low: number, high: number): number {
  return low + r * (high - low)
}

/** Nothing outside `[from, to]`, and a smooth rise and fall inside it. */
export function bump(q: number, from: number, to: number): number {
  if (q <= from || q >= to) return 0
  return Math.sin((Math.PI * (q - from)) / (to - from)) ** 2
}

/** A bump that rises in the first fifth of its span and takes the rest to fall: a start. */
export function spike(q: number, from: number, to: number): number {
  if (q <= from || q >= to) return 0
  const x = (q - from) / (to - from)
  return x < 0.2 ? faceArrive(x / 0.2) : 1 - faceArrive((x - 0.2) / 0.8)
}
