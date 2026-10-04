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

export interface Expression {
  /** What the state is called, which is also what the face says to whoever cannot see it. */
  readonly label: string
  readonly eyes: readonly [Stroke, Stroke]
  readonly mouth: Stroke
  /** How far the lids rest closed, 0 to 1: heavy with thought, or with waiting. */
  readonly lid: number
  /** Where the head rests. */
  readonly look: Head
  /**
   * Whether the state waits for the reader, and so keeps a slow blink at a long interval. Every
   * other state but loading, whose dots go on turning, holds still once its change is over.
   */
  readonly waits: boolean
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
    waits: false,
    tone: 'current',
  },
  /** Working something out: heavy-lidded, looking up and away. */
  thinking: {
    label: 'Thinking',
    eyes: [EYES.chevron, EYES.chevron],
    mouth: MOUTHS.hmm,
    lid: 0.3,
    look: look({ yaw: -0.08, gazeY: -0.1 }),
    waits: false,
    tone: 'busy',
  },
  /** Reading: flattened on the page. */
  reading: {
    label: 'Reading',
    eyes: [EYES.flat, EYES.flat],
    mouth: MOUTHS.line,
    lid: 0,
    look: look({ pitch: 0.08 }),
    waits: false,
    tone: 'busy',
  },
  /** Writing: flattened and lidded, looking down at what it writes. */
  writing: {
    label: 'Writing',
    eyes: [EYES.flat, EYES.flat],
    mouth: MOUTHS.small,
    lid: 0.3,
    look: look({ pitch: 0.25, gazeY: 0.1 }),
    waits: false,
    tone: 'busy',
  },
  /** Running a command: two terminal cursors on the output. */
  running: {
    label: 'Running a command',
    eyes: [EYES.cursor, EYES.cursor],
    mouth: MOUTHS.line,
    lid: 0,
    look: look({ yaw: 0.12, pitch: 0.12, gazeX: 0.3, gazeY: 0.15 }),
    waits: false,
    tone: 'busy',
  },
  /** Checking what was built: one eye narrowed on the work and the other still open. */
  checking: {
    label: 'Checking',
    eyes: [EYES.chevron, EYES.flat],
    mouth: MOUTHS.line,
    lid: 0,
    look: look({ yaw: -0.08, pitch: 0.15, gazeX: -0.1 }),
    waits: false,
    tone: 'busy',
  },
  /** A question for you: two cursors stood up, straight at you, the head turned a little. */
  question: {
    label: 'Waiting for your answer',
    eyes: [EYES.block, EYES.block],
    mouth: MOUTHS.line,
    lid: 0,
    look: look({ yaw: 0.1, pitch: -0.06 }),
    waits: true,
    tone: 'needs',
  },
  /** A permission: eyes wide open, looking up at you from under a lowered head. */
  permission: {
    label: 'Waiting for your permission',
    eyes: [EYES.wide, EYES.wide],
    mouth: MOUTHS.small,
    lid: 0,
    look: look({ pitch: 0.15, gazeY: -0.25 }),
    waits: true,
    tone: 'needs',
  },
  /** Blocked: `>_<`, eyes screwed shut against what will not give. */
  blocked: {
    label: 'Blocked',
    eyes: [EYES.squeeze, mirrored(EYES.squeeze)],
    mouth: MOUTHS.small,
    lid: 0,
    look: look({ pitch: 0.06 }),
    waits: true,
    tone: 'needs',
  },
  /** A turn that ended well: creased and smiling. */
  done: {
    label: 'Done',
    eyes: [EYES.deep, EYES.deep],
    mouth: MOUTHS.smile,
    lid: 0,
    look: look({ pitch: -0.08 }),
    waits: false,
    tone: 'good',
  },
  /** Something went wrong: a glare and a frown, staring still after its flinch. */
  error: {
    label: 'Error',
    eyes: [EYES.glare, mirrored(EYES.glare)],
    mouth: MOUTHS.frown,
    lid: 0,
    look: LEVEL,
    waits: false,
    tone: 'bad',
  },
  /** Nothing running: eyes closed, in the muted tone. */
  asleep: {
    label: 'Asleep',
    eyes: [EYES.sleep, EYES.sleep],
    mouth: MOUTHS.small,
    lid: 0,
    look: look({ pitch: 0.2 }),
    waits: false,
    tone: 'quiet',
  },
}
