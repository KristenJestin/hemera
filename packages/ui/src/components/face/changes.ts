import type { face } from '../../motion.ts'
import { bump, spike } from './life.ts'
import { type Beat, type Channel, beat } from './pose.ts'
import type { FaceState } from './states.ts'
import { EYES, MOUTHS, type Stroke } from './strokes.ts'

/**
 * How the face goes from one state to another: every change is a designed motion, never a cut.
 *
 * A change starts from wherever the face is — a head half-way through a turn, an eye half-way
 * through a blink, a colour half-way to another — and each part of the face makes its journey on
 * a window of its own inside the change: the eyes can jump before the head follows, the colour
 * can arrive with the shape it belongs to. On top of that journey, a change can say something on
 * the way: a nod, a flinch, a yawn. What it says is nothing at both ends, so a change always
 * leaves from where the face was and always lands on the life of the state it goes to.
 */
export type ChangeName = keyof typeof face.change

/** The families of states a change is chosen by. */
type Family = 'loading' | 'work' | 'needs' | 'done' | 'error' | 'asleep'

const FAMILY: Record<FaceState, Family> = {
  loading: 'loading',
  thinking: 'work',
  reading: 'work',
  writing: 'work',
  running: 'work',
  checking: 'work',
  question: 'needs',
  permission: 'needs',
  blocked: 'needs',
  done: 'done',
  error: 'error',
  asleep: 'asleep',
}

/**
 * The change between two states, by what the second one means after the first.
 *
 * The order of the questions is the order of what matters: waking up is the first thing that
 * happens to a face that was asleep, whatever it wakes into; something going wrong is a flinch
 * whatever the face was doing; something needing the reader lifts the head towards them.
 */
export function changeBetween(from: FaceState, to: FaceState): ChangeName {
  const was = FAMILY[from]
  const now = FAMILY[to]
  if (was === 'loading') return 'boot'
  if (now === 'loading') return 'gather'
  if (was === 'asleep') return 'wake'
  if (now === 'asleep') return 'drift'
  if (now === 'error') return 'flinch'
  if (now === 'needs') return was === 'needs' ? 'turn' : 'alert'
  if (now === 'done') return 'cheer'
  if (was === 'error') return 'recover'
  if (was === 'work') return 'shift'
  return was === 'needs' ? 'resume' : 'focus'
}

/**
 * How much shorter a change is than its own length: a face woken by a question or by something
 * going wrong wakes with a start.
 */
export function changePace(name: ChangeName, to: FaceState): number {
  const urgent = FAMILY[to] === 'needs' || FAMILY[to] === 'error'
  return name === 'wake' && urgent ? 0.6 : 1
}

/** When each part of the face makes its journey, as shares of the change. */
export type Windows = Readonly<Record<Channel, readonly [number, number]>>

const WHOLE: Windows = {
  shape: [0, 1],
  mouth: [0, 1],
  lid: [0, 1],
  head: [0, 1],
  gaze: [0, 1],
  orbit: [0, 1],
  tone: [0, 1],
}

/** The whole change for every part, but for the parts said otherwise. */
function windows(said: Partial<Windows>): Windows {
  return { ...WHOLE, ...said }
}

/** Where a change is, for what it says on the way. */
export interface Moment {
  /** How far through the change, 0 to 1. */
  readonly q: number
  /** Which way a look or a flinch goes: -1 or 1, drawn once per change. */
  readonly side: number
  /** A number drawn once per change, for what a change does only sometimes. */
  readonly chance: number
  readonly from: FaceState
  readonly to: FaceState
}

export interface Choreography {
  readonly windows: Windows
  /** What the change does on the way; nothing at either end. */
  readonly beat: (moment: Moment) => Beat
}

/** A pull of both eyes, `k` of the way towards `to`. */
function eyes(to: Stroke, k: number): Pick<Beat, 'left' | 'right'> {
  const pulled = k <= 0 ? null : { to, k }
  return { left: pulled, right: pulled }
}

/**
 * A head shaken off something: two turns each way, dying out, starting and ending at rest.
 */
function shake(q: number, from: number, to: number): number {
  if (q <= from || q >= to) return 0
  const x = (q - from) / (to - from)
  return Math.sin(4 * Math.PI * x) * Math.sin(Math.PI * x) * (1 - x)
}

/** A nod of thanks, deeper for the one who was asked leave. */
const THANKS: Partial<Record<FaceState, number>> = { permission: 0.26, blocked: 0.22 }

export const CHOREOGRAPHIES: Record<ChangeName, Choreography> = {
  /**
   * Loading gives way to a face: the dots keep turning, slow down, and each spirals into the
   * feature it becomes, rounding out into its shape on the way in. The journey is the player's
   * own, since it is a turn and not a straight line; nothing is said on top of it.
   */
  boot: { windows: WHOLE, beat: () => beat({}) },
  /** A face gives way to loading: its features ball up into dots and are taken round. */
  gather: { windows: WHOLE, beat: () => beat({}) },
  /**
   * From one kind of work to another: a glance. The eyes jump to where the new work is before
   * the head follows, and a blink comes with the jump nearly half the time, as it does with a
   * real one. Quick and quiet, because it happens all the time.
   */
  shift: {
    windows: windows({ gaze: [0, 0.45], shape: [0.05, 0.8], tone: [0.05, 0.8] }),
    beat: () => beat({}),
  },
  /** Getting to work: a small dip towards it, the eyes narrowing onto it. */
  focus: {
    windows: windows({ gaze: [0, 0.5], shape: [0.15, 0.85], tone: [0.15, 0.85] }),
    beat: ({ q }) => beat({ pitch: 0.16 * bump(q, 0.05, 0.65), lid: 0.28 * bump(q, 0, 0.55) }),
  },
  /**
   * Something needs the reader: the head comes round to face them and lifts, and a blink settles
   * the eyes on the reader — the eyes that open are the ones that ask. The colour comes early,
   * with the look.
   */
  alert: {
    windows: windows({ head: [0, 0.4], gaze: [0, 0.25], shape: [0.35, 0.85], tone: [0.05, 0.6] }),
    beat: ({ q }) => beat({ pitch: -0.22 * bump(q, 0.02, 0.55) }),
  },
  /** Answered: a nod — got it — and back to work. */
  resume: {
    windows: windows({ shape: [0.25, 0.9], gaze: [0.2, 0.7], tone: [0.25, 0.9] }),
    beat: ({ q, from }) => beat({ pitch: (THANKS[from] ?? 0.2) * bump(q, 0.1, 0.55) }),
  },
  /** From one need to another: the head turns away and back to ask the new thing. */
  turn: {
    windows: WHOLE,
    beat: ({ q, side }) => beat({ yaw: side * 0.2 * bump(q, 0, 0.8) }),
  },
  /**
   * Done: a small hop, the eyes screwed up with pleasure on the way up — which is where they
   * crease into their new shape and take their new colour, out of sight — and the smile coming in
   * with the landing. Two colours as far apart as the work's and the done's pass through grey on
   * the way; behind nearly shut lids, nobody sees it.
   */
  cheer: {
    windows: windows({ shape: [0.08, 0.3], mouth: [0.25, 0.7], tone: [0.06, 0.3] }),
    beat: ({ q }) => {
      const grin = bump(q, 0.3, 0.9)
      return beat({
        pitch: -0.3 * bump(q, 0, 0.35) + 0.12 * bump(q, 0.3, 0.65),
        lid: 0.75 * bump(q, 0, 0.38),
        mouth: grin <= 0 ? null : { to: MOUTHS.grin, k: 0.5 * grin },
      })
    },
  },
  /**
   * Something went wrong: a start — the head jerks back and away, the eyes snap wide — and then
   * the glare. The red arrives with the start, not after it.
   */
  flinch: {
    windows: windows({ head: [0, 0.9], shape: [0.22, 0.6], mouth: [0.3, 0.8], tone: [0, 0.25] }),
    beat: ({ q, side }) => {
      const start = spike(q, 0, 0.3)
      return beat({
        pitch: -0.35 * start,
        yaw: side * 0.18 * start,
        ...eyes(EYES.wide, spike(q, 0, 0.42)),
      })
    },
  },
  /** Past an error: it shakes it off, blinks, and moves on. */
  recover: {
    windows: windows({ shape: [0.3, 0.9], tone: [0.2, 0.8] }),
    beat: ({ q }) => beat({ yaw: 0.28 * shake(q, 0, 0.65) }),
  },
  /** Falling asleep: the eyes grow heavy and close slowly while the head goes down. The yawn
   * is the sleeping face's own, now and then, and not something every falling asleep does. */
  drift: {
    windows: windows({ lid: [0.2, 1], shape: [0.2, 1], head: [0.1, 1], tone: [0.2, 1] }),
    beat: ({ q }) => beat({ lid: 0.4 * bump(q, 0.2, 1), pitch: 0.1 * bump(q, 0.2, 1) }),
  },
  /**
   * Waking up: the eyes open, fall shut once more — the one heavy blink of someone waking — and
   * open for good while the head comes up.
   */
  wake: {
    windows: windows({ lid: [0.2, 0.55], shape: [0.2, 0.7], head: [0.1, 1], tone: [0.2, 0.8] }),
    beat: ({ q }) => beat({ lid: 0.75 * bump(q, 0.48, 0.62), pitch: -0.15 * bump(q, 0.2, 0.8) }),
  },
}

/**
 * The changes that come with a blink of their own: a glance from one work to another nearly half
 * the time, an alert to settle the eyes on the reader, a head shaken off an error. As shares of
 * the change, where the blink begins; `null` when this change has none.
 */
export function blinkOf(name: ChangeName, chance: number): number | null {
  if (name === 'shift') return chance < 0.45 ? 0.05 : null
  if (name === 'alert') return 0.72
  if (name === 'recover') return 0.5
  if (name === 'resume') return 0.6
  return null
}
