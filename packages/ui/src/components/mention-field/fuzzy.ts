/**
 * The fuzzy search of the mention field: every letter of the query, in order, anywhere in the
 * text. A letter right after the previous one, or at the start of a segment (after `/`, `-`,
 * `_`, `.` or a space), counts more, so `srvts` ranks `server.ts` above a path that only happens
 * to hold those letters.
 */

const SEGMENT = /[/\-_. ]/

/** The match's score, or null when the text does not hold every letter of the query in order. */
export function fuzzyScore(text: string, query: string): number | null {
  const hay = text.toLowerCase()
  const needle = query.toLowerCase()
  let score = 0
  let from = 0
  let last = -2
  for (const letter of needle) {
    const at = hay.indexOf(letter, from)
    if (at === -1) return null
    score += 1 + (at === last + 1 ? 2 : 0) + (at === 0 || SEGMENT.test(hay[at - 1] ?? '') ? 3 : 0)
    last = at
    from = at + 1
  }
  return score
}
