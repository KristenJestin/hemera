import type { FaceDetail } from './player.ts'
import { AT, type Pose, strokeAt } from './pose.ts'
import { type Stroke, closed } from './strokes.ts'

/**
 * The head: how a pose is laid on the drawing, in a square of 32 units.
 *
 * A small model in three dimensions rather than a sliding picture. The eyes ride a circle seen
 * from above, so a turn slides them and squashes the far one against the near; eyes and mouth
 * ride a circle seen from the side, so a nod moves them by different amounts and a face tipping
 * down opens its eyes out while its mouth flattens. What sells a turn is not that things move, it
 * is that they move by different amounts — and a change of shape survives at sixteen pixels where
 * a change of position does not.
 */
export const VIEW = 32

const CENTER = 16
/** Half the distance between the eyes, looking straight ahead. */
const SPREAD = 6.8
/** Where the eyes sit on a face drawn without a mouth, and on one drawn with it. */
const EYES_ALONE = 15.6
const EYES_OVER_MOUTH = 13.8
const MOUTH = 22
/** How far under the eyes a mouthless face nods about, as if it had a mouth there. */
const CHIN = 7
/** Half the angle between the eyes seen from above, and between eyes and mouth from the side. */
const EYE_ANGLE = 0.55
const ELEVATION = 0.5
/** How far a whole turn and nod take the head, in radians. */
const MAX_YAW = 0.5
const MAX_PITCH = 0.85
/** How much a nod opens the eyes out and flattens the mouth. */
const PITCH_DEPTH = 0.2
/** How far the eyes travel inside the face when they look away. */
const GAZE_X = 1.6
const GAZE_Y = 1.3
/**
 * The orbit the features ride while the face is loading: its radius, and where on it each feature
 * sits, in turns — the mouth underneath and the eyes a third of a turn either side of it, so that
 * the three are the three dots of a loading indicator, a third of a turn apart.
 */
const ORBIT = 7
const SLOTS = { left: 0.25 + 1 / 3, right: 0.25 - 1 / 3, mouth: 0.25 } as const

/** The least a feature is squashed to, so the far eye of a full turn is still an eye. */
const LEAST = 0.2

/** A stroke as it is drawn: its three points on the square and its width. */
export interface DrawnStroke {
  readonly points: readonly [number, number, number, number, number, number]
  readonly width: number
}

export interface Drawn {
  readonly left: DrawnStroke
  readonly right: DrawnStroke
  /** Left out on a face too small to hold one. */
  readonly mouth: DrawnStroke | null
  /** The point the head turns, nods and tilts about. */
  readonly pivot: readonly [number, number]
}

/** Gestures multiply, but nothing leaves the square: a gesture that fills it stops growing. */
function held(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

/**
 * A pose laid on the square.
 *
 * The detail's `gain` makes a gesture travel further without changing what it is: a scan tuned
 * to read at a hundred pixels is a shimmer at sixteen.
 */
export function drawnOf(pose: Pose, detail: FaceDetail): Drawn {
  const g = detail.gain
  const yaw = held(pose[AT.yaw]! * g) * MAX_YAW
  const tilt = held(pose[AT.pitch]! * g)
  const gazeX = held(pose[AT.gazeX]! * g)
  const gazeY = held(pose[AT.gazeY]! * g)

  const eyesAt = detail.mouth ? EYES_OVER_MOUTH : EYES_ALONE
  const mouthAt = detail.mouth ? MOUTH : EYES_ALONE + CHIN
  const pivotY = (eyesAt + mouthAt) / 2
  const radius = (mouthAt - eyesAt) / 2 / Math.sin(ELEVATION)
  const nod = tilt * MAX_PITCH
  const ride = (elevation: number) => ({
    y: pivotY + Math.sin(nod + elevation) * radius,
    squash: Math.max(LEAST, Math.cos(nod + elevation) / Math.cos(elevation)),
  })
  const reach = SPREAD / Math.sin(EYE_ANGLE)
  const place = (rest: number) => ({
    x: CENTER + Math.sin(rest + yaw) * reach,
    squash: Math.max(LEAST, Math.cos(rest + yaw) / Math.cos(rest)),
  })

  // Drawn larger about the middle of the square for a small size.
  const turned = (x: number, y: number): [number, number] => [
    CENTER + (x - CENTER) * detail.scale,
    CENTER + (y - CENTER) * detail.scale,
  ]

  const orbit = pose[AT.orbit]!
  const spin = pose[AT.spin]!
  /** A feature's place, and how it is squashed, moved out onto the orbit as far as it has gone. */
  const onOrbit = (
    slot: number,
    x: number,
    y: number,
    sx: number,
    sy: number,
  ): readonly [number, number, number, number] => {
    if (orbit <= 0) return [x, y, sx, sy]
    const angle = 2 * Math.PI * (spin + slot)
    const wide = ORBIT * (1 + pose[AT.reach]!)
    const ox = CENTER + Math.cos(angle) * wide
    const oy = CENTER + Math.sin(angle) * wide
    const at = (a: number, b: number): number => a + (b - a) * orbit
    return [at(x, ox), at(y, oy), at(sx, 1), at(sy, 1)]
  }

  const lay = (
    stroke: Stroke,
    slot: number,
    placed: readonly [number, number, number, number],
    width: number,
  ): DrawnStroke => {
    const [x, y, sx, sy] = onOrbit(slot, ...placed)
    const [ax, ay] = turned(x + stroke[0] * sx, y + stroke[1] * sy)
    const [bx, by] = turned(x + stroke[2] * sx, y + stroke[3] * sy)
    const [cx, cy] = turned(x + stroke[4] * sx, y + stroke[5] * sy)
    return { points: [ax, ay, bx, by, cx, cy], width }
  }

  const eyeDepth = 1 + tilt * PITCH_DEPTH
  const eyes = ride(-ELEVATION)
  const eye = (side: -1 | 1): DrawnStroke => {
    const at = place(side * EYE_ANGLE)
    const start = side < 0 ? AT.left : AT.right
    const lid = pose[side < 0 ? AT.lidLeft : AT.lidRight]!
    const stroke = closed(strokeAt(pose, start), lid)
    return lay(
      stroke,
      side < 0 ? SLOTS.left : SLOTS.right,
      [
        at.x + gazeX * GAZE_X * at.squash,
        eyes.y + gazeY * GAZE_Y,
        at.squash * eyeDepth,
        eyes.squash,
      ],
      stroke[6] * detail.weight * detail.scale * Math.sqrt(eyeDepth),
    )
  }

  let mouth: DrawnStroke | null = null
  if (detail.mouth) {
    const mouthDepth = 1 - tilt * PITCH_DEPTH
    const at = place(0)
    const lips = ride(ELEVATION)
    const stroke = strokeAt(pose, AT.mouth)
    mouth = lay(
      stroke,
      SLOTS.mouth,
      [at.x, lips.y, at.squash * mouthDepth, lips.squash],
      stroke[6] * detail.weight * detail.scale * Math.sqrt(mouthDepth),
    )
  }

  return { left: eye(-1), right: eye(1), mouth, pivot: turned(CENTER, pivotY) }
}

/** A drawn stroke as the path it is drawn with. */
export function pathOf(stroke: DrawnStroke): string {
  const [ax, ay, bx, by, cx, cy] = stroke.points
  const n = (value: number): string => String(Math.round(value * 1000) / 1000)
  return `M${n(ax)} ${n(ay)}L${n(bx)} ${n(by)}L${n(cx)} ${n(cy)}`
}
