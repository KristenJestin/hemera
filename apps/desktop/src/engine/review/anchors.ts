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

/**
 * For each line of `before`, its index in `after` when a shortest edit script keeps it, or -1:
 * Myers' diff, after the common head and tail are set aside. Null past `MAPPING_EDITS_MAX` edits.
 */
export const lineMapping = (
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
): Int32Array | null => {
  const mapping = new Int32Array(before.length).fill(-1)
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) {
    mapping[head] = head
    head += 1
  }
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    mapping[before.length - 1 - tail] = after.length - 1 - tail
    tail += 1
  }
  const a = before.slice(head, before.length - tail)
  const b = after.slice(head, after.length - tail)
  const n = a.length
  const m = b.length
  const max = n + m
  if (max === 0) return mapping
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = -1
  for (let d = 0; d <= Math.min(max, MAPPING_EDITS_MAX); d += 1) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x += 1
        y += 1
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
    if (found >= 0) break
  }
  if (found < 0) return null
  // Back from the end: the diagonal before each edit is lines kept.
  let x = n
  let y = m
  for (let d = found; d > 0; d -= 1) {
    const previous = trace[d] ?? v
    const k = x - y
    const down =
      k === -d || (k !== d && (previous[offset + k - 1] ?? 0) < (previous[offset + k + 1] ?? 0))
    const fromK = down ? k + 1 : k - 1
    const fromX = previous[offset + fromK] ?? 0
    const fromY = fromX - fromK
    while (x > fromX && y > fromY) {
      x -= 1
      y -= 1
      mapping[head + x] = head + y
    }
    x = fromX
    y = fromY
  }
  while (x > 0 && y > 0) {
    x -= 1
    y -= 1
    mapping[head + x] = head + y
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
  const found: number[] = []
  for (let start = 1; start + length - 1 <= after.length; start += 1) {
    if (fingerprintOf(after, { start, end: start + length - 1 }) === fingerprint) found.push(start)
  }
  const [only] = found
  return found.length === 1 && only !== undefined ? at(range, only) : { kind: 'outdated' }
}
