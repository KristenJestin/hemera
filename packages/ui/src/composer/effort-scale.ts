/**
 * What the two scales of the effort are drawn out of: one track, one fill, one thumb.
 *
 * The slider and the dial are the same control read down and read across, and the maintainer
 * judges them on their rendering — so the rendering is written once. Two tracks of two
 * thicknesses, two thumbs of two sizes or two halos of two strengths in one panel would be two
 * controls that came from two design systems, which is the one thing a comparison of two
 * variants must not introduce.
 *
 * Nothing here is a component: they are the class names and the one measurement the two share,
 * and each variant lays them out in its own direction.
 */

/** The track: a thin line in the page's own muted surface, rounded at both ends. */
export const TRACK = 'absolute overflow-hidden rounded-full bg-muted'

/** The track is drawn on a border of its own so it reads as a groove and not as a fill. */
export const SCALE = 'ring-1 ring-border ring-inset'

/**
 * The part of it behind the reader: the accent, which is what says how much of the scale is on.
 * Each variant anchors it to the end its scale begins at — the left of a dial, the bottom of a
 * slider — because a fill that grew from the wrong end is a fill that reads backwards.
 */
export const FILLED = 'absolute rounded-full bg-primary'

/**
 * The mark of a step: a dot a little wider than the track, so it reads as a notch on it.
 *
 * Ahead of the thumb it is the page own border, which is what an unspent step looks like;
 * behind it, it is the accent itself, so the dot disappears into the fill and what is read is
 * one filled length rather than a dotted line. A dot of any other colour on the filled side is
 * a row of gaps chewed out of the value.
 */
export const MARK = 'relative size-1 rounded-full bg-border'

export const MARK_DONE = 'bg-primary'

/**
 * The notch of the level the agent advises: the same dot, ringed in the accent.
 *
 * A ring rather than a colour, because the colour of a notch already says whether it is behind
 * the reader or ahead of them — the ring is a second thing said about the same dot and stays
 * legible on both sides of the thumb. It marks the level the agent itself named and nothing
 * Hemera chose: where no level is named, no notch wears it.
 */
export const ADVISED = 'ring-1 ring-primary'

/** The same thing said beside the short mark of that level, where a look has a column of them. */
export const ADVISED_DOT = 'size-1 shrink-0 rounded-full bg-primary'

/** And in words, beside the level's own name: quiet, because the name is what is being set. */
export const ADVISED_WORD = 'text-muted-foreground'

/**
 * The halo: the accent bleeding out of the thumb, which is what says the round thing on the
 * track is the thing the hand has hold of. It brightens under the hand and under the focus, on
 * the theme's own `thumb-motion` — a CSS transition, so a reader asking for less movement is
 * given the end of it and nothing on the way.
 *
 * `active` and not only `hover`: a thumb being dragged is held rather than pointed at, and a
 * halo that went back to its resting strength the moment the hand started moving would say the
 * control had been let go of.
 */
export const HALO =
  'thumb-motion absolute inset-0 rounded-full shadow-halo group-hover:shadow-halo-strong group-focus-visible:shadow-halo-strong group-active:shadow-halo-strong'

/**
 * The wide, blurred layer under that ring: the light the thumb throws on the surface it sits
 * on, which is what makes a thumb read as lit rather than as drawn (pass of 22 September 2026).
 *
 * A second element and not a second shadow on the first, so the two layers can be given to a
 * look one at a time: the minimal slider wears the ring alone, and the two that are meant to
 * feel like instruments wear both. It strengthens under the same three states the ring does,
 * because a halo whose two halves answered the hand differently would read as two halos.
 */
export const GLOW =
  'thumb-motion absolute inset-0 rounded-full shadow-halo-glow group-hover:shadow-halo-glow-strong group-focus-visible:shadow-halo-glow-strong group-active:shadow-halo-glow-strong'

/**
 * The thumb itself: a round surface larger than the track, ringed in the accent so that it
 * reads as part of the scale rather than as a bead dropped on it. It grows a little under the
 * hand and presses in under the finger.
 */
export const KNOB =
  'thumb-motion relative block size-full rounded-full border-2 border-primary bg-card shadow-sm group-hover:scale-110 group-active:scale-95'

/**
 * Where a step sits along the track, between the foot of it and the head: 0 and 1.
 *
 * Measured between the middle of the first mark and the middle of the last, which is where the
 * track itself begins and ends: a fill measured edge to edge would stop short of the last mark
 * at the top of the scale and read as a scale that cannot be filled. A scale of one step is
 * filled or it is not; nothing set at all is empty.
 */
export function fractionAt(here: number, last: number): number {
  if (here <= 0) return 0
  if (last <= 0) return 1
  return here / last
}

/** The same place as the length CSS draws it, which is what the fill and the thumb are given. */
export function share(fraction: number): string {
  return `${fraction * 100}%`
}

/** How much of the track is behind the reader, as a share of the whole of it. */
export function filledTo(here: number, last: number): string {
  return share(fractionAt(here, last))
}

/** How long a level's own word may be before it is worth shortening at all. */
const SHORT = 3

/**
 * The short mark every level of a scale is written beside its notch as.
 *
 * A vertical scale has no room for the agent's own words down its side, and a scale with no
 * words at all is six identical dots: the mark is the one letter that says which notch is which
 * without the panel growing a column of text. It is derived from the label and never chosen
 * here, because the levels are the agent's and not Hemera's — what `Default` means is the
 * agent's business, and inventing a word for it is inventing a level.
 *
 * The rule is the initials, the label itself when it is short enough to stand as it is, and the
 * first two letters where two levels would otherwise carry the same letter: Claude's six come
 * out `D`, `L`, `M`, `H`, `XH` and `Max`. It is a set of marks and not a set of names — two
 * levels that still collide read the same, and the word above the track is what settles it.
 */
export function marksOf(labels: readonly string[]): string[] {
  const marks: string[] = []
  for (const label of labels) marks.push(markOf(label, marks))
  return marks
}

/** One mark, kept out of the marks already given out. */
function markOf(label: string, taken: readonly string[]): string {
  const words = label.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '')
  // Two words are two initials: an agent that says "Very high" means both of them.
  if (words.length > 1) return words.map((word) => word.slice(0, 1).toUpperCase()).join('')
  const word = words[0] ?? label
  // `x` in front of a level is a prefix and not a word: `Xhigh` is an extra high, and reads XH.
  const first = /^x\p{L}/iu.test(word)
    ? `X${word.slice(1, 2).toUpperCase()}`
    : word.slice(0, 1).toUpperCase()
  if (!taken.includes(first)) return first
  // `Medium` took the M, so `Max` is written out rather than the two of them reading alike.
  return word.length <= SHORT ? word : word.slice(0, 2)
}
