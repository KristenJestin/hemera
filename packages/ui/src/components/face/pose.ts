import type { Stroke } from './strokes.ts'

/**
 * The colours the face is drawn in: roles of the theme, never colours of its own. Telling two
 * states apart never depends on them — the shape says it, the colour only says it again.
 *
 * Ordinary work is drawn in the text's own colour: a face that is working is the usual case, and
 * a usual case in a colour of its own would always be shouting. A colour is kept for what it
 * says: waiting for the reader, something gone wrong, a turn done well; and asleep steps back
 * into the muted text.
 */
export const TONES = ['current', 'quiet', 'busy', 'needs', 'good', 'bad'] as const

export type FaceTone = (typeof TONES)[number]

/** The utility each tone is drawn with, which is a role of the theme and nothing else. */
export const TONE_CLASSES = {
  /** Whatever colour the face sits in, as the loading indicator it stands in for is. */
  current: 'text-current',
  quiet: 'text-muted-foreground',
  busy: 'text-foreground',
  needs: 'text-warning',
  good: 'text-success',
  bad: 'text-destructive',
} as const satisfies Record<FaceTone, string>

/**
 * Where the head is and where the eyes look, each from -1 to 1.
 *
 * `yaw` turns the head (right is positive) and `pitch` nods it (down is positive); `gazeX` and
 * `gazeY` move the eyes inside the face. Nothing tilts: a face that turns in the plane of the
 * screen is a drawing being rotated, and nothing of the face ever rotates.
 */
export interface Head {
  readonly yaw: number
  readonly pitch: number
  readonly gazeX: number
  readonly gazeY: number
}

/** A feature pulled part of the way towards another shape, `k` from 0 to 1. */
export interface Pull {
  readonly to: Stroke
  readonly k: number
}

/**
 * What a change says on the way at one instant: the head and the eyes, a shape either eye or the
 * mouth is pulled towards, how far it closes the lids, and how big it draws the mouth.
 */
export interface Beat extends Head {
  readonly left: Pull | null
  readonly right: Pull | null
  readonly mouth: Pull | null
  readonly lid: number
  readonly mouthScale: number
}

/** The face doing nothing at all. */
export const REST: Beat = {
  yaw: 0,
  pitch: 0,
  gazeX: 0,
  gazeY: 0,
  left: null,
  right: null,
  mouth: null,
  lid: 0,
  mouthScale: 1,
}

/** A beat that says only what it is given, and rests everywhere else. */
export function beat(said: Partial<Beat>): Beat {
  return { ...REST, ...said }
}

/**
 * A whole pose laid out as numbers, which is what a change eases, carries and interrupts: the
 * three strokes, the two lids, the head, the eyes, the orbit the features ride while loading and
 * how far round it they are, and one weight per tone. Every number of the
 * face lives at one place in it, so a change from any pose to any other is the same arithmetic.
 */
export const AT = {
  left: 0,
  right: 7,
  mouth: 14,
  lidLeft: 21,
  lidRight: 22,
  yaw: 23,
  pitch: 24,
  gazeX: 25,
  gazeY: 26,
  orbit: 27,
  spin: 28,
  reach: 29,
  tones: 30,
} as const

export const POSE_LENGTH = AT.tones + TONES.length

/** A pose as numbers, `POSE_LENGTH` of them, in the order `AT` gives. */
export type Pose = readonly number[]

/**
 * The parts of a pose a change moves on a clock of its own: the eyes' shapes, the mouth, the
 * lids, the head, the eyes' direction and the colour. Each part is a run of the vector.
 */
export const CHANNELS = {
  shape: [AT.left, AT.mouth],
  mouth: [AT.mouth, AT.lidLeft],
  lid: [AT.lidLeft, AT.yaw],
  head: [AT.yaw, AT.gazeX],
  gaze: [AT.gazeX, AT.orbit],
  orbit: [AT.orbit, AT.tones],
  tone: [AT.tones, POSE_LENGTH],
} as const

export type Channel = keyof typeof CHANNELS

/** One stroke of a pose. */
export function strokeAt(pose: Pose, start: number): Stroke {
  return [
    pose[start]!,
    pose[start + 1]!,
    pose[start + 2]!,
    pose[start + 3]!,
    pose[start + 4]!,
    pose[start + 5]!,
    pose[start + 6]!,
  ]
}

/** The weight a pose gives each tone, in the order `TONES` gives. */
export function tonesOf(pose: Pose): number[] {
  return TONES.map((_, index) => pose[AT.tones + index]!)
}

/** Everything a pose is made of, laid out as `AT` says. */
export interface PoseParts {
  readonly left: Stroke
  readonly right: Stroke
  readonly mouth: Stroke
  readonly lidLeft: number
  readonly lidRight: number
  readonly head: Head
  /** How far the features have left their places for the loading orbit, 0 to 1. */
  readonly orbit: number
  /** How far round that orbit they are, in turns. */
  readonly spin: number
  /** How much wider or narrower than its own the orbit is. */
  readonly reach: number
  readonly tone: FaceTone
}

/** A pose from its parts, the whole of its colour in one tone. */
export function poseOf(parts: PoseParts): number[] {
  const { head } = parts
  return [
    ...parts.left,
    ...parts.right,
    ...parts.mouth,
    parts.lidLeft,
    parts.lidRight,
    head.yaw,
    head.pitch,
    head.gazeX,
    head.gazeY,
    parts.orbit,
    parts.spin,
    parts.reach,
    ...TONES.map((tone) => (tone === parts.tone ? 1 : 0)),
  ]
}
