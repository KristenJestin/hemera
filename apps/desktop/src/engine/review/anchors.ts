/**
 * The anchors of Review's code comments (#341, CT-44), as pure rules.
 *
 * - **The fingerprint** of an anchor is the sha256 of its targeted lines with up to three lines of
 *   context above and below, line endings normalised: what proves later that the same lines stand
 *   in the same surroundings.
 * - **Re-anchoring** maps the anchored range from the commented version of the file to the version
 *   now, through the line mapping of a diff between the two. Lines the mapping carries over
 *   unchanged and together, whose fingerprint still matches there (their context too), are
 *   `current` at the same place, `moved` at another. Otherwise (a block cut and pasted, say) the
 *   fingerprint is looked for in the new version: found once, the lines `moved` there. Otherwise
 *   the comment is `outdated`, and keeps its excerpt: a line of its context that changed is enough.
 */

import { createHash } from 'node:crypto'

import type { LineRange } from '@hemera/core/domain'

/** How many lines of context the fingerprint and the excerpt take on each side. */
export const CONTEXT_LINES = 3

/** Past this many edits between the two versions, the mapping gives up and the fingerprint decides. */
const MAPPING_EDITS_MAX = 4_000

/** A file's lines, its line endings normalised; the newline after the last line ends it. */
export const linesOf = (bytes: Uint8Array): ReadonlyArray<string> => {
  const text = Buffer.from(bytes).toString('utf8').replaceAll('\r\n', '\n')
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/** The lines of a range with their context, and where the range starts. */
export interface Excerpt {
  readonly before: ReadonlyArray<string>
  readonly lines: ReadonlyArray<string>
  readonly after: ReadonlyArray<string>
  readonly start: number
}

export const excerptOf = (lines: ReadonlyArray<string>, range: LineRange): Excerpt => ({
  before: lines.slice(Math.max(0, range.start - 1 - CONTEXT_LINES), range.start - 1),
  lines: lines.slice(range.start - 1, range.end),
  after: lines.slice(range.end, range.end + CONTEXT_LINES),
  start: range.start,
})

/** The sha256 of a range's lines with their context, one `\n` after each line. */
export const fingerprintOf = (lines: ReadonlyArray<string>, range: LineRange): string => {
  const excerpt = excerptOf(lines, range)
  const hash = createHash('sha256')
  for (const line of [...excerpt.before, '\u0000', ...excerpt.lines, '\u0000', ...excerpt.after])
    hash.update(`${line}\n`)
  return hash.digest('hex')
}

/** Where an anchor stands on the version now. */
export type Reanchored =
  | { readonly kind: 'current'; readonly range: LineRange }
  | { readonly kind: 'moved'; readonly range: LineRange }
  | { readonly kind: 'outdated' }

/** The middle snake of a part: its diagonal's two ends, and the edits of the part's script. */
interface Snake {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly edits: number
}

/**
 * Myers' middle snake of `a[aLo, aHi)` against `b[bLo, bHi)`, in space linear in their lengths:
 * null when the part takes more than `limit` edits.
 */
const middleSnake = (
  a: ReadonlyArray<string>,
  aLo: number,
  aHi: number,
  b: ReadonlyArray<string>,
  bLo: number,
  bHi: number,
  limit: number,
): Snake | null => {
  const n = aHi - aLo
  const m = bHi - bLo
  const delta = n - m
  const odd = (delta & 1) !== 0
  const most = Math.min(Math.ceil((n + m) / 2), Math.ceil(limit / 2))
  const offset = most + 1
  const forward = new Int32Array(2 * most + 3)
  const backward = new Int32Array(2 * most + 3)
  for (let d = 0; d <= most; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      const down =
        k === -d || (k !== d && (forward[offset + k - 1] ?? 0) < (forward[offset + k + 1] ?? 0))
      const x0 = down ? (forward[offset + k + 1] ?? 0) : (forward[offset + k - 1] ?? 0) + 1
      const y0 = x0 - k
      let x = x0
      let y = y0
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
        x += 1
        y += 1
      }
      forward[offset + k] = x
      const back = delta - k
      if (odd && back >= -(d - 1) && back <= d - 1 && x + (backward[offset + back] ?? 0) >= n) {
        return { x0, y0, x1: x, y1: y, edits: 2 * d - 1 }
      }
    }
    for (let k = -d; k <= d; k += 2) {
      const down =
        k === -d || (k !== d && (backward[offset + k - 1] ?? 0) < (backward[offset + k + 1] ?? 0))
      const x0 = down ? (backward[offset + k + 1] ?? 0) : (backward[offset + k - 1] ?? 0) + 1
      const y0 = x0 - k
      let x = x0
      let y = y0
      while (x < n && y < m && a[aHi - 1 - x] === b[bHi - 1 - y]) {
        x += 1
        y += 1
      }
      backward[offset + k] = x
      const ahead = delta - k
      if (!odd && ahead >= -d && ahead <= d && x + (forward[offset + ahead] ?? 0) >= n) {
        return { x0: n - x, y0: m - y, x1: n - x0, y1: m - y0, edits: 2 * d }
      }
    }
  }
  return null
}

/**
 * For each line of `before`, its index in `after` when a shortest edit script keeps it, or -1:
 * Myers' diff in linear space (the middle snake, part by part), after the common head and tail
 * are set aside. Null past `MAPPING_EDITS_MAX` edits.
 */
export const lineMapping = (
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
): Int32Array | null => {
  const mapping = new Int32Array(before.length).fill(-1)
  const parts: Array<readonly [number, number, number, number]> = [
    [0, before.length, 0, after.length],
  ]
  let first = true
  for (let part = parts.pop(); part !== undefined; part = parts.pop()) {
    let [aLo, aHi, bLo, bHi] = part
    while (aLo < aHi && bLo < bHi && before[aLo] === after[bLo]) {
      mapping[aLo] = bLo
      aLo += 1
      bLo += 1
    }
    while (aLo < aHi && bLo < bHi && before[aHi - 1] === after[bHi - 1]) {
      mapping[aHi - 1] = bHi - 1
      aHi -= 1
      bHi -= 1
    }
    if (aLo === aHi || bLo === bHi) continue
    const snake = middleSnake(before, aLo, aHi, after, bLo, bHi, MAPPING_EDITS_MAX)
    // Each part takes fewer edits than the whole: the first one decides whether it is too many.
    if (snake === null) {
      if (first) return null
      continue
    }
    first = false
    for (let step = 0; step < snake.x1 - snake.x0; step += 1)
      mapping[aLo + snake.x0 + step] = bLo + snake.y0 + step
    // Head and tail set aside, both sides hold a line: the part takes two edits at least.
    parts.push([aLo, aLo + snake.x0, bLo, bLo + snake.y0])
    parts.push([aLo + snake.x1, aHi, bLo + snake.y1, bHi])
  }
  return mapping
}

/** A range at a place: `current` where it was, `moved` elsewhere. */
const at = (was: LineRange, start: number): Reanchored => {
  const range = { start, end: start + was.end - was.start }
  return start === was.start ? { kind: 'current', range } : { kind: 'moved', range }
}

/** Where an anchored range of `before` stands in `after`. */
export const reanchor = (
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
  range: LineRange,
  fingerprint: string,
): Reanchored => {
  const mapping = lineMapping(before, after)
  if (mapping !== null) {
    const first = mapping[range.start - 1] ?? -1
    const together =
      first >= 0 &&
      Array.from({ length: range.end - range.start + 1 }, (_, step) => step).every(
        (step) => mapping[range.start - 1 + step] === first + step,
      )
    // Current or moved only where the fingerprint, context included, still matches (CT-44).
    const mapped = { start: first + 1, end: first + 1 + range.end - range.start }
    if (together && fingerprintOf(after, mapped) === fingerprint) return at(range, first + 1)
  }
  const length = range.end - range.start + 1
  const targeted = before.slice(range.start - 1, range.end)
  const found: number[] = []
  for (let start = 1; start + length - 1 <= after.length; start += 1) {
    // The lines themselves first, a string compare; the fingerprint only where they stand.
    if (!targeted.every((line, step) => after[start - 1 + step] === line)) continue
    if (fingerprintOf(after, { start, end: start + length - 1 }) === fingerprint) found.push(start)
  }
  const [only] = found
  return found.length === 1 && only !== undefined ? at(range, only) : { kind: 'outdated' }
}
