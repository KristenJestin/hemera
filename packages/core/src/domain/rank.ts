/**
 * Rank of an item inside an ordered list.
 *
 * A rank is a string compared lexicographically, so inserting between two items never
 * renumbers the others: the new rank is simply a string that sorts between theirs. Ranks are
 * written in base 36, digits then lowercase letters, which is exactly the order
 * `String.prototype.localeCompare`-free comparison already gives.
 */

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length

/** Rank of the first item of an empty list. */
export const FIRST_RANK = 'i'

export class InvalidRankError extends Error {
  constructor(rank: string) {
    super(`"${rank}" is not a rank: ranks are written in base 36`)
    this.name = 'InvalidRankError'
  }
}

export class RankOrderError extends Error {
  constructor(before: string, after: string) {
    super(`"${before}" does not sort before "${after}"`)
    this.name = 'RankOrderError'
  }
}

export function isRank(value: string): boolean {
  return value.length > 0 && [...value].every((character) => DIGITS.includes(character))
}

function digitAt(rank: string, index: number): number {
  return index < rank.length ? DIGITS.indexOf(rank[index]!) : 0
}

/**
 * A rank sorting strictly between `before` and `after`.
 *
 * `null` stands for the start or the end of the list. The result never ends on the lowest
 * digit, so there is always room to insert before it later.
 */
export function rankBetween(before: string | null, after: string | null): string {
  if (before !== null && !isRank(before)) throw new InvalidRankError(before)
  if (after !== null && !isRank(after)) throw new InvalidRankError(after)
  if (before !== null && after !== null && before >= after) throw new RankOrderError(before, after)

  const low = before ?? ''
  const high = after
  let rank = ''
  // While true, the rank built so far still equals `high`'s prefix, so `high` still bounds it.
  let boundedAbove = high !== null

  for (let index = 0; ; index += 1) {
    const lowDigit = digitAt(low, index)
    const highDigit = boundedAbove ? digitAt(high!, index) : BASE

    if (highDigit - lowDigit > 1) {
      // The midpoint is never the lowest digit, so there is always room to insert before it.
      return rank + DIGITS[Math.floor((lowDigit + highDigit) / 2)]!
    }

    // The digits touch: keep the low one and look for room one place further down.
    rank += DIGITS[lowDigit]!
    if (boundedAbove && lowDigit < highDigit) boundedAbove = false
  }
}

/** Ranks placing `count` items in order, in one go. */
export function ranksFor(count: number): string[] {
  const ranks: string[] = []
  let previous: string | null = null
  for (let index = 0; index < count; index += 1) {
    previous = rankBetween(previous, null)
    ranks.push(previous)
  }
  return ranks
}

/** Compares two ranks, for sorting. */
export function compareRanks(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}
