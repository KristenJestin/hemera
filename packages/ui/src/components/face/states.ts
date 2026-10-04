import type { FlourishName, MotionKind } from './life.ts'
import type { FaceTone, Head } from './pose.ts'
import { EYES, MOUTHS, type Stroke, mirrored } from './strokes.ts'

/**
 * Every state an agent of Hemera can be in, and the one expression each of them wears.
 *
 * Loading is the face before it is a face: its three features are the three dots of the loading
 * indicator, going round, and whatever comes next they spiral into. Waiting for the user is three
 * states and not one, because it is three things to answer: a
 * question, a permission, and a blocker — which is also what a build that cannot go on is
 * waiting for, so the two share `blocked`. Nothing running is asleep: there is no face that is
 * awake and doing nothing, and no face for having heard nothing for a while either.
 */
export const FACE_STATES = [
  'loading',
  'thinking',
  'reading',
  'writing',
  'running',
  'checking',
  'question',
  'permission',
  'blocked',
  'done',
  'error',
  'asleep',
] as const

export type FaceState = (typeof FACE_STATES)[number]

/** How a state blinks: bounds on the gap, drawn afresh each time, and how often it blinks twice. */
export interface Blink {
  readonly every: readonly [number, number]
  readonly double: number
}

/** A gesture a state borrows now and then, and how often: drawn afresh every pass. */
export interface Aside {
  readonly motion: MotionKind
  readonly chance: number
}

export interface Expression {
  /** What the state is called, which is also what the face says to whoever cannot see it. */
  readonly label: string
  readonly eyes: readonly [Stroke, Stroke]
  readonly mouth: Stroke
  /** How far the lids rest closed, 0 to 1: heavy with thought, or with waiting. */
  readonly lid: number
  /** Where the head rests, around which its gesture plays. */
  readonly look: Head
  /** Left out for a state that does not blink: asleep, or staring at what went wrong. */
  readonly blink: Blink | null
  readonly motion: MotionKind
  readonly aside: Aside | null
  /** The fixed pieces the state plays now and then, one drawn at a time. */
  readonly flourishes: readonly FlourishName[]
  readonly tone: FaceTone
}

const LEVEL: Head = { yaw: 0, pitch: 0, gazeX: 0, gazeY: 0 }

/** A dot of the loading indicator: a stroke of no length, all cap. */
const DOT: Stroke = [0, -0.01, 0, 0, 0, 0.01, 5.5]

/** A resting head that says only what it is given. */
function look(said: Partial<Head>): Head {
  return { ...LEVEL, ...said }
}

/**
 * The expressions.
 *
 * Every one is a pair of eyes departing from the chevron in a way that can be named, and every
 * one differs from all the others in shape and in where the head rests, before any colour — which
 * is what reduced motion shows, and all it shows. The mouth says little: a line for most, a smile
 * when it is done, a frown when it went wrong.
 */
export const EXPRESSIONS: Record<FaceState, Expression> = {
  /**
   * Loading: no face yet, three dots going round in whatever colour the face sits in — the
   * loading indicator itself, until the face it becomes is known. How wide they sit and how fast
   * they go are two clocks of their own, which the player keeps.
   */
  loading: {
    label: 'Loading',
    eyes: [DOT, DOT],
    mouth: DOT,
    lid: 0,
    look: LEVEL,
    blink: null,
    motion: 'hold',
    aside: null,
    flourishes: [],
    tone: 'current',
  },
  /** Working something out: heavy-lidded, looking up and away. */
  thinking: {
    label: 'Thinking',
    eyes: [EYES.chevron, EYES.chevron],
    mouth: MOUTHS.hmm,
    lid: 0.3,
    look: look({ yaw: -0.08, gazeY: -0.1 }),
    blink: { every: [2.8, 6], double: 0.12 },
    motion: 'ponder',
    aside: { motion: 'weigh', chance: 0.3 },
    flourishes: ['hmm'],
    tone: 'busy',
  },
  /** Reading: flattened on the page, a line at a time. */
  reading: {
    label: 'Reading',
    eyes: [EYES.flat, EYES.flat],
    mouth: MOUTHS.line,
    lid: 0,
    look: look({ pitch: 0.08 }),
    blink: { every: [2.2, 4.8], double: 0.2 },
    motion: 'scan',
    aside: { motion: 'glance', chance: 0.15 },
    flourishes: [],
    tone: 'busy',
  },
  /** Writing: flattened and lidded, looking down at what it writes, following the caret. */
  writing: {
    label: 'Writing',
    eyes: [EYES.flat, EYES.flat],
    mouth: MOUTHS.small,
    lid: 0.3,
    look: look({ pitch: 0.25, gazeY: 0.1 }),
    blink: { every: [1.8, 3.8], double: 0.3 },
    motion: 'trace',
    aside: { motion: 'glance', chance: 0.12 },
    flourishes: ['sigh'],
    tone: 'busy',
  },
  /** Running a command: two terminal cursors on the output, watching it scroll. */
  running: {
    label: 'Running a command',
    eyes: [EYES.cursor, EYES.cursor],
    mouth: MOUTHS.line,
    lid: 0,
    look: look({ yaw: 0.12, pitch: 0.12, gazeX: 0.3, gazeY: 0.15 }),
    blink: { every: [2.4, 5], double: 0.15 },
    motion: 'watch',
    aside: { motion: 'glance', chance: 0.2 },
    flourishes: [],
    tone: 'busy',
  },
  /**
   * Checking what was built: one eye narrowed on the work and the other still open, going down
   * the list and ticking. The build's own colour.
   */
  checking: {
    label: 'Checking',
    eyes: [EYES.chevron, EYES.flat],
    mouth: MOUTHS.line,
    lid: 0,
    look: look({ yaw: -0.08, pitch: 0.15, gazeX: -0.1 }),
    blink: { every: [2, 4.2], double: 0.28 },
    motion: 'tick',
    aside: { motion: 'glance', chance: 0.25 },
    flourishes: [],
    tone: 'build',
  },
  /**
   * A question for you: two cursors stood up, straight at you, the head turned a little — and every so
   * often the eyes widen, which asks again without saying anything new.
   */
  question: {
    label: 'Waiting for your answer',
    eyes: [EYES.block, EYES.block],
    mouth: MOUTHS.line,
    lid: 0,
    look: look({ yaw: 0.1, pitch: -0.06 }),
    blink: { every: [2.2, 4.4], double: 0.4 },
    motion: 'ask',
    aside: null,
    flourishes: ['widen'],
    tone: 'needs',
  },
  /**
   * A permission: eyes wide open, looking up at you from under a lowered head, and down at the
   * thing it wants to do, and back.
   */
  permission: {
    label: 'Waiting for your permission',
    eyes: [EYES.wide, EYES.wide],
    mouth: MOUTHS.small,
    lid: 0,
    look: look({ pitch: 0.15, gazeY: -0.25 }),
    blink: { every: [2, 4], double: 0.35 },
    motion: 'offer',
    aside: null,
    flourishes: ['plead'],
    tone: 'needs',
  },
  /**
   * Blocked: `>_<`, eyes screwed shut against what will not give, pushing at it and looking for a
   * way round.
   */
  blocked: {
    label: 'Blocked',
    eyes: [EYES.squeeze, mirrored(EYES.squeeze)],
    mouth: MOUTHS.small,
    lid: 0,
    look: look({ pitch: 0.06 }),
    blink: { every: [2.6, 5], double: 0.2 },
    motion: 'strain',
    aside: null,
    flourishes: ['sigh'],
    tone: 'needs',
  },
  /** A turn that ended well: creased, smiling, nodding now and then. */
  done: {
    label: 'Done',
    eyes: [EYES.deep, EYES.deep],
    mouth: MOUTHS.smile,
    lid: 0,
    look: look({ pitch: -0.08 }),
    blink: { every: [3, 5.5], double: 0.25 },
    motion: 'settle',
    aside: null,
    flourishes: ['hop'],
    tone: 'good',
  },
  /** Something went wrong: a glare and a frown, and it does not blink. */
  error: {
    label: 'Error',
    eyes: [EYES.glare, mirrored(EYES.glare)],
    mouth: MOUTHS.frown,
    lid: 0,
    look: LEVEL,
    blink: null,
    motion: 'shudder',
    aside: null,
    flourishes: [],
    tone: 'bad',
  },
  /** Nothing running: eyes closed, breathing, yawning now and then. */
  asleep: {
    label: 'Asleep',
    eyes: [EYES.sleep, EYES.sleep],
    mouth: MOUTHS.small,
    lid: 0,
    look: look({ pitch: 0.2 }),
    blink: null,
    motion: 'breathe',
    aside: null,
    flourishes: ['yawn'],
    tone: 'quiet',
  },
}
