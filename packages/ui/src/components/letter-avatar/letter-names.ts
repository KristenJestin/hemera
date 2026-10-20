/**
 * Who it is, in a round mark: a helper, an agent, a person — wherever a name needs a face.
 *
 * - One letter, the first of its name; two when another name of the same set shares that letter,
 *   never the same two as another's (`initialsOf`).
 * - Its colour is read from its name, so it never changes as others come and go: one of the
 *   theme's tinted pairs — a muted fill and its own ink — which pass AA in both themes. A
 *   definition may give its own tone, which is worn instead.
 *
 * Beside its name it is decoration, hidden from a screen reader so the name is not said twice.
 * Drawn alone, `legend` makes the name its tooltip, on the mark itself.
 */

/** The tinted pairs an avatar can wear. */
export const LETTER_TONES = ['primary', 'info', 'success', 'warning', 'build'] as const

export type LetterTone = (typeof LETTER_TONES)[number]

/** A name's own tone, read from the name: the same name, the same tone, every time. */
export function letterToneOf(name: string): LetterTone {
  // djb2, which spreads names over the tones better than a sum of their letters does.
  const hash = [...name].reduce(
    (total, letter) => ((total * 33) ^ letter.charCodeAt(0)) >>> 0,
    5381,
  )
  return LETTER_TONES[hash % LETTER_TONES.length] ?? 'primary'
}

/**
 * A name's first letter, or two letters when one of `others` shares it, chosen so that no two
 * names of the set wear the same letters:
 *
 * - the first of each of its first two words, or the first two of a single word;
 * - when that is worn twice among the names sharing the letter (Reviewer and Researcher), the
 *   first letter and the letter at the first place where all their names differ (RV, RS);
 * - failing that, the first letter and the last one (Explore and Explorer: EE, ER).
 *
 * Two identical names cannot be told apart, and wear the same letters.
 */
export function initialsOf(name: string, others: readonly string[]): string {
  const initial = name.charAt(0).toUpperCase()
  const sharing = [
    ...new Set([name, ...others].filter((one) => one.charAt(0).toUpperCase() === initial)),
  ]
  if (sharing.length === 1) return initial
  const plain = sharing.map(twoLettersOf)
  if (new Set(plain).size === sharing.length) return twoLettersOf(name)
  const letters = sharing.map((one) => one.replace(/\s+/g, '').toUpperCase())
  const own = name.replace(/\s+/g, '').toUpperCase()
  const longest = Math.max(...letters.map((one) => one.length))
  for (let at = 1; at < longest; at += 1) {
    const there = letters.map((one) => one.charAt(at))
    if (there.every((letter) => letter !== '') && new Set(there).size === sharing.length) {
      return `${initial}${own.charAt(at)}`
    }
  }
  const lasts = letters.map((one) => one.charAt(one.length - 1))
  if (new Set(lasts).size === sharing.length) return `${initial}${own.charAt(own.length - 1)}`
  return twoLettersOf(name)
}

/** The first of each of a name's first two words, or the first two letters of a single word. */
function twoLettersOf(name: string): string {
  const [first = '', second] = name.split(/\s+/)
  const two = second === undefined ? first.slice(0, 2) : `${first.charAt(0)}${second.charAt(0)}`
  return two.toUpperCase()
}
