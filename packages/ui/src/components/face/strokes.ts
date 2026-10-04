import { faceArrive } from '../../motion.ts'

/**
 * The one primitive of the face: a stroke of three points with round caps, and its weight.
 *
 * An eye is one, a mouth is one, and every expression the face has is those seven numbers moved
 * around. That is what lets any shape travel into any other without a cut: the three points of
 * one shape go to the three points of the next, and the stroke on screen stays one stroke all
 * the way. Points are read left to right, in a frame centred on the feature, `y` downwards.
 */
export type Stroke = readonly [
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  weight: number,
]

/**
 * The same stroke seen in a mirror: what the right eye of an asymmetric pair is.
 *
 * A lying stroke is still read left to right, so its ends swap; a standing one is read top to
 * bottom and keeps its order, or it would travel through a level line on its way to any other.
 */
export function mirrored(stroke: Stroke): Stroke {
  const [x1, y1, x2, y2, x3, y3, weight] = stroke
  if (standing(stroke)) return [-x1, y1, -x2, y2, -x3, y3, weight]
  return [-x3, y3, -x2, y2, -x1, y1, weight]
}

/**
 * The eyes, all read against the first.
 *
 * `chevron` is the prompt's `>` turned down, the mark itself and the eye at rest. The others are
 * departures from it that can be named: creased further, barely bent, stood up, closed, sloped.
 */
export const EYES = {
  /** The mark. Everything else is a departure from this one. */
  chevron: [-4.4, -3.4, 0, 0.9, 4.4, -3.4, 2.9],
  /** The chevron creased further: pleased. */
  deep: [-4.4, -4.7, 0, 1.3, 4.4, -4.7, 2.9],
  /**
   * Barely bent, and heavier: on the work. Heavier than a closed eye, or the two read as the same
   * bar in anything but colour; as wide as the chevron, so the gap over the nose does not move.
   */
  flat: [-4.4, -1.5, 0, 0.5, 4.4, -1.5, 3.7],
  /** The terminal's block cursor stood up: wide awake, and looking at you. */
  block: [0, -3, 0, 0, 0, 3, 5.4],
  /** A shorter cursor: the one a running command leaves blinking, and one eye of a question. */
  cursor: [0, -1.8, 0, 0, 0, 1.8, 5],
  /**
   * The cursor cut down until its own round caps close it: an eye wide open. It stands up like
   * the cursor, so it opens out of one without passing through anything else.
   */
  wide: [0, -0.15, 0, 0, 0, 0.15, 7],
  /** Level and thin: closed. What every blink closes onto. */
  shut: [-3.8, 0, 0, 0, 3.8, 0, 2.6],
  /** Closed and curved: asleep, the lid resting rather than blinking. */
  sleep: [-3.8, -0.9, 0, 0.8, 3.8, -0.9, 2.3],
  /**
   * A glare: the chevron with its inner half dropped. It keeps the kink, which is what keeps it an
   * eye; a sloped bar beside another reads as two dashes, not as anger.
   */
  glare: [-4.4, -4.6, 0, 0.3, 3.8, -1, 3],
  /**
   * The prompt's `>` itself, stood up and pointing in: with its mirror it is `>_<`, eyes screwed
   * shut against something that will not give. Read top to bottom, like the cursor it opens from.
   */
  squeeze: [-1.9, -2.6, 2.1, 0, -1.9, 2.6, 3.2],
} as const satisfies Record<string, Stroke>

export type EyeName = keyof typeof EYES

/**
 * The mouths, drawn with the same stroke — which is a small piece of luck: the chevron that
 * makes an eye is, at mouth size, a smile. The mouth says little on purpose: the eyes carry the
 * state, and a mouth that reacts to everything turns the face into an emoji.
 */
export const MOUTHS = {
  /** Present and saying nothing: most states wear it. */
  line: [-2.8, 0, 0, 0, 2.8, 0, 2.3],
  /** The chevron again, wider and shallower: a smile. */
  smile: [-4, -1, 0, 1.2, 4, -1, 2.3],
  /** Wider and shallower: a grin across the face. */
  grin: [-4.6, -1, 0, 1.4, 4.6, -1, 2.3],
  /**
   * A dot: a mouth open, round, for a breath let out. A dot and not an arc, because a short heavy
   * arc under two eyes is a heart; and a dot lying level, so a line shrinks into it without
   * turning on the way.
   */
  open: [-0.3, 0, 0, 0, 0.3, 0, 4.6],
  /** The same dot, heavier: a yawn at its widest, grown in height and width together. */
  gape: [-0.4, 0, 0, 0, 0.4, 0, 7],
  /** The smile upside down. */
  frown: [-3.2, 1.2, 0, -1.2, 3.2, 1.2, 2.3],
  /** Shorter, and pushed to one side, level: working something out. */
  hmm: [-0.6, 0.2, 1, 0.2, 2.6, 0.2, 2.3],
  /** A small line: held back, hoping. */
  small: [-1.6, 0, 0, 0, 1.6, 0, 2.3],
} as const satisfies Record<string, Stroke>

export type MouthName = keyof typeof MOUTHS

/** A stroke `k` of the way from `from` to `to`, every number on the same line. */
export function mix(from: Stroke, to: Stroke, k: number): Stroke {
  if (k <= 0) return from
  if (k >= 1) return to
  const at = (index: number): number => from[index]! + (to[index]! - from[index]!) * k
  return [at(0), at(1), at(2), at(3), at(4), at(5), at(6)]
}

/** The same stroke drawn bigger or smaller about its centre, its weight untouched. */
export function scaled(stroke: Stroke, by: number): Stroke {
  if (by === 1) return stroke
  const [x1, y1, x2, y2, x3, y3, weight] = stroke
  return [x1 * by, y1 * by, x2 * by, y2 * by, x3 * by, y3 * by, weight]
}

/**
 * What a stroke is, by its build: a dot (a wide-open eye, an open mouth), standing (a cursor, a
 * `>`), or lying (everything bent or level). Two strokes of one family travel into each other on
 * a straight line; two of different families do not, and are met some other way.
 */
export type Family = 'dot' | 'standing' | 'lying'

export function family(stroke: Stroke): Family {
  const [x1, y1, x2, y2, x3, y3] = stroke
  const width = Math.max(x1, x2, x3) - Math.min(x1, x2, x3)
  const height = Math.max(y1, y2, y3) - Math.min(y1, y2, y3)
  if (width < 1.2 && height < 1.2) return 'dot'
  return height > width ? 'standing' : 'lying'
}

/** Whether a stroke stands up rather than lies: taller than it is wide, and more than a dot. */
export function standing(stroke: Stroke): boolean {
  return family(stroke) === 'standing'
}

/**
 * Whether two strokes travel into each other on a straight line without turning into a third
 * thing on the way. A dot and a standing stroke share an axis; a lying one shares none with
 * either: a cursor laid down turns on its side, and a chevron balled up into a dot passes through
 * a heart.
 */
export function meet(one: Stroke, other: Stroke): boolean {
  const a = family(one)
  const b = family(other)
  return a === b || (a !== 'lying' && b !== 'lying')
}

/** The same stroke laid level, its width and weight kept. */
function levelled(stroke: Stroke): Stroke {
  const [x1, , x2, , x3, , weight] = stroke
  return [x1, 0, x2, 0, x3, 0, weight]
}

/**
 * A stroke `k` of the way towards another, by a road that stays a face.
 *
 * Two strokes that meet go on a straight line. A bent stroke and a dot go through a level line
 * instead — it flattens, and then balls up — because the straight line between a chevron and a
 * dot is a short heavy chevron, which is a heart, and a face that flashes hearts on its way to
 * being startled says something nobody meant.
 */
export function toward(from: Stroke, to: Stroke, k: number): Stroke {
  if (k <= 0) return from
  if (k >= 1) return to
  const road = family(from) === 'dot' || family(to) === 'dot'
  if (meet(from, to) || !road) return mix(from, to, k)
  const bent = family(to) === 'dot' ? from : to
  const halfway = levelled(bent)
  // As much of the road is spent flattening as there is bend to take out: none for a level line.
  const [, y1, , y2, , y3] = bent
  const flatten = Math.min(0.5, (Math.max(y1, y2, y3) - Math.min(y1, y2, y3)) / 8)
  if (family(to) !== 'dot') {
    // Out of a dot, the same road the other way: it spreads into a line, and the line bends.
    const back = 1 - flatten
    return k < back
      ? mix(from, halfway, faceArrive(k / back))
      : mix(halfway, to, faceArrive((k - back) / flatten))
  }
  return k < flatten
    ? mix(from, halfway, faceArrive(k / flatten))
    : mix(halfway, to, faceArrive((k - flatten) / (1 - flatten)))
}

/** The least half-width a closing eye spreads to: a cursor closes to a short dash, not a bar. */
const CLOSED_HALF = 1.3

/**
 * Where the width begins to follow a closing lid. Before it, only the height goes: a cursor that
 * spread while it was still tall would turn on its side on the way, which is a rotation and not
 * a lid.
 */
const SPREAD_FROM = 0.6

/**
 * An eye closed by `lid`, from 0 (open) to 1 (shut).
 *
 * The lid is its own quantity, laid over whatever shape the eye is: a blink closes a chevron, a
 * cursor or a glare alike, and a shape that changes behind a closed lid changes unseen. The
 * height goes first and all the way, the width follows at the end, and the weight thins on the
 * whole of it, or a half-shut cursor reads as a blob. A closed eye keeps its own width, so a
 * chevron closes to a line as wide as itself and a cursor to a short dash.
 */
export function closed(stroke: Stroke, lid: number): Stroke {
  if (lid <= 0) return stroke
  const k = Math.min(1, lid)
  const [x1, y1, x2, y2, x3, y3, weight] = stroke
  // A lying eye closes as a lid does. A standing one or a dot is all height, and it goes before
  // the width follows, or the stroke would turn on its side on the way down.
  const height = family(stroke) === 'lying' ? 1 - k : Math.max(0, 1 - k / SPREAD_FROM)
  const spread = faceArrive((k - SPREAD_FROM) / (1 - SPREAD_FROM))
  const half = Math.max(Math.abs(x3 - x1) / 2, CLOSED_HALF)
  return [
    x1 + (-half - x1) * spread,
    y1 * height,
    x2 * (1 - spread),
    y2 * height,
    x3 + (half - x3) * spread,
    y3 * height,
    weight + (EYES.shut[6] - weight) * k,
  ]
}
