/**
 * The anchors of Review's code comments (#341, CT-44), as pure rules: the fingerprint of the
 * targeted lines with three lines of context, normalised for line endings; the excerpt kept; and
 * the re-anchoring of a range from the commented version of a file to the version now.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  type Reanchored,
  excerptOf,
  fingerprintOf,
  lineMapping,
  linesOf,
  reanchor,
} from '../src/engine/review/anchors.ts'

/** Twenty numbered lines, `line 1` to `line 20`. */
const FILE = Array.from({ length: 20 }, (_, at) => `line ${String(at + 1)}`)
const text = (lines: ReadonlyArray<string>) => `${lines.join('\n')}\n`

const anchored = (start: number, end: number) => ({
  range: { start, end },
  fingerprint: fingerprintOf(FILE, { start, end }),
})

describe('The fingerprint of the targeted lines', () => {
  test('is the same whatever the line endings', () => {
    const crlf = linesOf(Buffer.from(FILE.join('\r\n')))
    expect(fingerprintOf(crlf, { start: 10, end: 12 })).toBe(
      fingerprintOf(FILE, { start: 10, end: 12 }),
    )
  })
  test('changes when a line of context changes', () => {
    const changed = FILE.map((line) => (line === 'line 7' ? 'line seven' : line))
    expect(fingerprintOf(changed, { start: 10, end: 12 })).not.toBe(
      fingerprintOf(FILE, { start: 10, end: 12 }),
    )
  })
  test('keeps up to three lines of context at the ends of the file', () => {
    expect(excerptOf(FILE, { start: 2, end: 2 })).toEqual({
      before: ['line 1'],
      lines: ['line 2'],
      after: ['line 3', 'line 4', 'line 5'],
      start: 2,
    })
  })
})

describe('A code comment on lines 10–12 follows its lines', () => {
  test('the file unchanged: current, at the same range', () => {
    const { range, fingerprint } = anchored(10, 12)
    expect(reanchor(FILE, FILE, range, fingerprint)).toEqual({ kind: 'current', range })
  })
  test('the file changes above them: moved, with the new range', () => {
    const { range, fingerprint } = anchored(10, 12)
    const now = ['new 1', 'new 2', ...FILE]
    expect(reanchor(FILE, now, range, fingerprint)).toEqual({
      kind: 'moved',
      range: { start: 12, end: 14 },
    })
  })
  test('the file changes below them: current', () => {
    const { range, fingerprint } = anchored(10, 12)
    const now = [...FILE.slice(0, 16), 'new', ...FILE.slice(16)]
    expect(reanchor(FILE, now, range, fingerprint)).toEqual({ kind: 'current', range })
  })
  test('a line of their context changes: outdated, the fingerprint no longer matches there', () => {
    const { range, fingerprint } = anchored(10, 12)
    const now = FILE.map((line) => (line === 'line 9' ? 'line nine' : line))
    expect(reanchor(FILE, now, range, fingerprint)).toEqual({ kind: 'outdated' })
  })
  test('a guard negated just above an unchanged line makes the comment outdated', () => {
    const before = [
      'function purge(user) {',
      '  if (user.isAdmin) {',
      '    deleteAll()',
      '  }',
      '}',
    ]
    const now = before.map((line) => line.replace('user.isAdmin', '!user.isAdmin'))
    const range = { start: 3, end: 3 }
    expect(reanchor(before, now, range, fingerprintOf(before, range))).toEqual({
      kind: 'outdated',
    })
  })
  test('a change beyond the three lines of context: current', () => {
    const { range, fingerprint } = anchored(10, 12)
    const now = FILE.map((line) => (line === 'line 6' ? 'line six' : line))
    expect(reanchor(FILE, now, range, fingerprint)).toEqual({ kind: 'current', range })
  })
  test('the lines themselves change: outdated', () => {
    const { range, fingerprint } = anchored(10, 12)
    const now = FILE.map((line) => (line === 'line 11' ? 'line eleven' : line))
    expect(reanchor(FILE, now, range, fingerprint)).toEqual({ kind: 'outdated' })
  })
  test('the lines are deleted: outdated', () => {
    const { range, fingerprint } = anchored(10, 12)
    const now = [...FILE.slice(0, 9), ...FILE.slice(12)]
    expect(reanchor(FILE, now, range, fingerprint)).toEqual({ kind: 'outdated' })
  })
  test('the block with its context moves down the file: moved, found by its fingerprint', () => {
    const { range, fingerprint } = anchored(10, 12)
    // Lines 7 to 15 (the targets and their context) cut and pasted at the end.
    const now = [...FILE.slice(0, 6), ...FILE.slice(15), ...FILE.slice(6, 15)]
    expect(reanchor(FILE, now, range, fingerprint)).toEqual({
      kind: 'moved',
      range: { start: 15, end: 17 },
    })
  })
  test('lines repeated elsewhere never make a deleted range current', () => {
    const repeated = ['a', 'b', 'c', 'x', 'y', 'z', 'a', 'b', 'c']
    const fingerprint = fingerprintOf(repeated, { start: 4, end: 6 })
    const now = ['a', 'b', 'c', 'a', 'b', 'c']
    expect(reanchor(repeated, now, { start: 4, end: 6 }, fingerprint)).toEqual({
      kind: 'outdated',
    })
  })
})

describe('Lines are read the same with or without a last newline', () => {
  test('a text and its lines', () => {
    expect(linesOf(Buffer.from(text(['a', 'b'])))).toEqual(['a', 'b'])
    expect(linesOf(Buffer.from('a\nb'))).toEqual(['a', 'b'])
    expect(linesOf(Buffer.from(''))).toEqual([])
  })
})

describe('The line mapping keeps only lines that are the same, in order', () => {
  test('on two hundred edited files, every kept line is equal and the kept lines never cross', () => {
    let seed = 341
    const next = (below: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      return seed % below
    }
    for (let round = 0; round < 200; round += 1) {
      const before = Array.from({ length: 1 + next(60) }, () => `l${String(next(8))}`)
      const after = [...before]
      for (let edits = next(10); edits > 0; edits -= 1) {
        const at = next(after.length + 1)
        if (next(2) === 0) after.splice(at, 1)
        else after.splice(at, 0, `n${String(next(8))}`)
      }
      const mapping = lineMapping(before, after)
      expect(mapping).not.toBeNull()
      let last = -1
      let kept = 0
      for (const [from, to] of (mapping ?? []).entries()) {
        if (to < 0) continue
        expect(after[to]).toBe(before[from])
        expect(to).toBeGreaterThan(last)
        last = to
        kept += 1
      }
      // And as many as can be: a shortest edit script keeps a longest common subsequence.
      expect(kept).toBe(longestCommon(before, after))
    }
  })
})

/** The length of a longest common subsequence, by the textbook table. */
const longestCommon = (before: ReadonlyArray<string>, after: ReadonlyArray<string>) => {
  let row = new Array<number>(after.length + 1).fill(0)
  for (const line of before) {
    const next = [0]
    for (const [at, other] of after.entries()) {
      next.push(line === other ? (row[at] ?? 0) + 1 : Math.max(row[at + 1] ?? 0, next[at] ?? 0))
    }
    row = next
  }
  return row[after.length] ?? 0
}

describe('Re-anchoring a file rewritten whole stays cheap as the file grows', () => {
  test('a file ten times longer takes about the same time: bounded by the edits allowed', () => {
    const rewritten = (lines: number) => {
      const before = Array.from({ length: lines }, (_, at) => `old ${String(at)}`)
      const after = Array.from({ length: lines }, (_, at) => `new ${String(at)}`)
      const range = { start: 10, end: 12 }
      return () => reanchor(before, after, range, fingerprintOf(before, range))
    }
    const fastest = (work: () => Reanchored) => {
      let best = Number.POSITIVE_INFINITY
      for (let round = 0; round < 3; round += 1) {
        const started = performance.now()
        work()
        best = Math.min(best, performance.now() - started)
      }
      return best
    }
    const small = rewritten(2_000)
    const large = rewritten(20_000)
    expect(small()).toEqual({ kind: 'outdated' })
    expect(large()).toEqual({ kind: 'outdated' })
    // Bounded by the edits it allows, not by the file: a copy of the diagonals per edit (the
    // first version) made this ratio about ten, a quadratic one would make it a hundred.
    expect(fastest(large) / fastest(small)).toBeLessThan(4)
  })
})
