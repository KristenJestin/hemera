import { describe, expect, test } from 'bun:test'

import {
  FIRST_RANK,
  InvalidRankError,
  RankOrderError,
  compareRanks,
  isRank,
  rankBetween,
  ranksFor,
} from '../src/index.ts'

/** A deterministic pseudo-random source, so a failing run is reproducible. */
function sequence(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
}

describe('Rang rééquilibrable', () => {
  test('a rank between two others sorts strictly between them', () => {
    const middle = rankBetween('a', 'c')
    expect(middle > 'a').toBe(true)
    expect(middle < 'c').toBe(true)
  })

  test('appending and prepending stay ordered', () => {
    const first = rankBetween(null, null)
    const after = rankBetween(first, null)
    const before = rankBetween(null, first)
    expect(before < first).toBe(true)
    expect(first < after).toBe(true)
  })

  test('touching ranks still make room', () => {
    const between = rankBetween('a', 'b')
    expect(between > 'a').toBe(true)
    expect(between < 'b').toBe(true)
  })

  test('inserting repeatedly at the same place never renumbers anything', () => {
    let low = 'a'
    const high = 'b'
    for (let step = 0; step < 50; step += 1) {
      const inserted = rankBetween(low, high)
      expect(inserted > low).toBe(true)
      expect(inserted < high).toBe(true)
      low = inserted
    }
  })

  test('a rank that is not base 36 is refused by name', () => {
    expect(() => rankBetween('A', null)).toThrow(InvalidRankError)
    expect(() => rankBetween(null, '!')).toThrow(InvalidRankError)
    expect(isRank('a0z')).toBe(true)
    expect(isRank('')).toBe(false)
  })

  test('ranks given in the wrong order are refused', () => {
    expect(() => rankBetween('c', 'a')).toThrow(RankOrderError)
    expect(() => rankBetween('a', 'a')).toThrow(RankOrderError)
  })

  test('the first rank of an empty list leaves room on both sides', () => {
    expect(rankBetween(null, FIRST_RANK) < FIRST_RANK).toBe(true)
    expect(rankBetween(FIRST_RANK, null) > FIRST_RANK).toBe(true)
  })
})

describe('Ordre des entrées', () => {
  test('a run of ranks is produced already ordered', () => {
    const ranks = ranksFor(20)
    expect(ranks).toHaveLength(20)
    expect([...ranks].toSorted(compareRanks)).toEqual(ranks)
  })

  test('random insertions always read back in the order they were written', () => {
    const random = sequence(20_260_913)
    for (let run = 0; run < 40; run += 1) {
      const ordered: string[] = []
      for (let insertion = 0; insertion < 30; insertion += 1) {
        const at = Math.floor(random() * (ordered.length + 1))
        const before = at === 0 ? null : ordered[at - 1]!
        const after = at === ordered.length ? null : ordered[at]!
        ordered.splice(at, 0, rankBetween(before, after))
      }
      // The list built by insertion is exactly the list sorted by rank.
      expect([...ordered].toSorted(compareRanks)).toEqual(ordered)
      expect(new Set(ordered).size).toBe(ordered.length)
    }
  })
})
