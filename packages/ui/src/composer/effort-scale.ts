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
 * The halo: the accent bleeding out of the thumb, which is what says the round thing on the
 * track is the thing the hand has hold of. It brightens under the hand and under the focus, on
 * the theme's own `thumb-motion` — a CSS transition, so a reader asking for less movement is
 * given the end of it and nothing on the way.
 */
export const HALO =
  'thumb-motion absolute inset-0 rounded-full shadow-halo group-hover:shadow-halo-strong group-focus-visible:shadow-halo-strong'

/**
 * The thumb itself: a round surface larger than the track, ringed in the accent so that it
 * reads as part of the scale rather than as a bead dropped on it. It grows a little under the
 * hand and presses in under the finger.
 */
export const KNOB =
  'thumb-motion relative block size-full rounded-full border-2 border-primary bg-card shadow-sm group-hover:scale-110 group-active:scale-95'

/**
 * How much of the track is behind the reader, as a share of the whole of it.
 *
 * Measured between the middle of the first mark and the middle of the last, which is where the
 * track itself begins and ends: a fill measured edge to edge would stop short of the last mark
 * at the top of the scale and read as a scale that cannot be filled. A scale of one step is
 * filled or it is not; nothing set at all is empty.
 */
export function filledTo(here: number, last: number): string {
  if (here <= 0) return '0%'
  if (last <= 0) return '100%'
  return `${(here / last) * 100}%`
}
