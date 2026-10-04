import { faceArrive } from '../../motion.ts'
import { type Beat, beat } from './pose.ts'
import { EYES, MOUTHS, type Stroke, standing } from './strokes.ts'

/**
 * The life of the face inside one state: what the head does when nothing else drives it, and
 * the few fixed pieces it plays now and then. Everything here is arithmetic on the time and on
 * dice drawn from a seed, so the same seed tells the same story every time it is told.
 */

/** A generator of numbers in [0, 1), the same ones for the same seed (mulberry32). */
export function dice(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** A seed of its own for one strand of a story: the same two numbers, the same strand. */
export function strand(seed: number, index: number): number {
  let mixed = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 0x632be5ab, 0xc2b2ae35)
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d)
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b)
  return (mixed ^ (mixed >>> 16)) >>> 0
}

/** Somewhere between `low` and `high`, `r` of the way along. */
export function between(r: number, low: number, high: number): number {
  return low + r * (high - low)
}

/** A rise over `up`, a hold over `hold` and a fall over `down`, all shares of `q`, eased. */
export function arc(q: number, up: number, hold: number, down: number): number {
  if (q <= 0 || q >= up + hold + down) return 0
  if (q < up) return faceArrive(q / up)
  if (q < up + hold) return 1
  return 1 - faceArrive((q - up - hold) / down)
}

/** Nothing outside `[from, to]`, and a smooth rise and fall inside it. */
export function bump(q: number, from: number, to: number): number {
  if (q <= from || q >= to) return 0
  return Math.sin((Math.PI * (q - from)) / (to - from)) ** 2
}

/** A bump that rises in the first fifth of its span and takes the rest to fall: a start. */
export function spike(q: number, from: number, to: number): number {
  if (q <= from || q >= to) return 0
  const x = (q - from) / (to - from)
  return x < 0.2 ? faceArrive(x / 0.2) : 1 - faceArrive((x - 0.2) / 0.8)
}

/** `k` of the way from `a` to `b`. */
function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

/** Six numbers in [0, 1), drawn afresh for every pass of a gesture. */
export type Roll = readonly [number, number, number, number, number, number]

/** The dice a gesture's first pass remembers as the pass before it: the middle of everything. */
export const MIDDLE: Roll = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]

/** Where a gesture is: one pass of it, `p` of the way through. */
export interface Pass {
  /** How far through the pass, 0 to 1. */
  readonly p: number
  /** The clock, in seconds, for what has to be quicker than a pass. */
  readonly t: number
  /** This pass's dice, and the last one's: a gesture that drifts eases on from where it was. */
  readonly r: Roll
  readonly was: Roll
  /** How many passes came before this one in the state: a reader is on its `n`th line. */
  readonly n: number
  /** The eyes of the state, so a gesture pulls an eye towards a shape on the same axis. */
  readonly eyes: readonly [Stroke, Stroke]
  /**
   * How much of the pass a change of shape takes: the face's `shape` beat, as a share of this
   * pass. A gesture that pulls an eye pulls it on that beat, whatever the length of its pass.
   */
  readonly rise: number
}

/** A pull towards `to`, `k` of the way. */
function pull(to: Stroke, k: number): { to: Stroke; k: number } | null {
  return k <= 0 ? null : { to, k }
}

/**
 * How the head moves when nothing else drives it, one kind per way of being busy.
 *
 * Every kind is a pass of a few seconds whose length and dice are drawn afresh each time, so two
 * faces side by side drift apart within seconds and never come back into step; and every kind
 * can only vary inside what it means — a reader can read a line lower, it cannot suddenly nod.
 */
export type MotionKind =
  | 'ponder'
  | 'weigh'
  | 'scan'
  | 'trace'
  | 'watch'
  | 'ask'
  | 'offer'
  | 'strain'
  | 'tick'
  | 'glance'
  | 'settle'
  | 'shudder'
  | 'breathe'
  | 'hold'

export interface Motion {
  /** How long one pass lasts, in seconds: bounds, the pass is drawn inside them. */
  readonly period: readonly [number, number]
  readonly beat: (pass: Pass) => Beat
}

/** Where the lines of a page sit for a reader, from the first to the last. */
const PAGE = [-0.3, -0.15, 0, 0.15, 0.3]

export const MOTIONS: Record<MotionKind, Motion> = {
  /** Nothing: the head holds still while something else moves, the loading orbit. */
  hold: { period: [3, 4], beat: () => beat({}) },
  /**
   * Thinking: the look of someone working it out — up and away, slowly, the head turning the way
   * it looks. Nothing down there is interesting yet.
   */
  ponder: {
    period: [3.8, 6.5],
    beat: ({ p, r, was }) => {
      const move = between(r[2], 0.6, 0.9)
      const head = faceArrive(p / move)
      const eyes = faceArrive(p / (move * 0.3))
      const x = (d: Roll): number => between(d[0], -0.6, 0.6)
      const y = (d: Roll): number => between(d[1], -0.5, -0.1)
      const yaw = lerp(x(was), x(r), head)
      return beat({
        yaw,
        pitch: lerp(y(was), y(r), head),
        gazeX: lerp(x(was), x(r), eyes) * 0.7,
        gazeY: lerp(y(was), y(r), eyes) * 0.9,
      })
    },
  },
  /** Thinking, now and then: two quick looks, one each way, weighing one thing against another. */
  weigh: {
    period: [1.8, 2.6],
    beat: ({ p, r }) => {
      const at = between(r[0], 0.08, 0.2)
      const gap = between(r[1], 0.22, 0.32)
      const side = r[2] < 0.5 ? -1 : 1
      const jump = (from: number): number => faceArrive((p - from) / 0.05)
      const x = side * 0.7 * (jump(at) - 2 * jump(at + gap) + jump(at + 2 * gap))
      return beat({ gazeX: x, gazeY: -0.3, yaw: x * 0.25, pitch: -0.2 })
    },
  },
  /**
   * Reading: a line at a time, in jumps — the eyes land three to five times across it and then
   * sweep back to the start of the next, a line lower, and to the top of the page after the last.
   * Real reading is saccades, not a pan; the jumps are what make it reading and not scanning.
   */
  scan: {
    period: [2.2, 3.4],
    beat: ({ p, r, n }) => {
      const line = PAGE[n % PAGE.length]!
      const next = PAGE[(n + 1) % PAGE.length]!
      const stops = 3 + Math.floor(r[0] * 3)
      const sweep = between(r[1], 0.6, 0.78)
      const back = 0.1
      const stopAt = (index: number): number => -0.7 + (1.4 * index) / stops
      let x = -0.7
      let y = next
      if (p < sweep) {
        const f = (p / sweep) * stops
        const index = Math.floor(f)
        x = lerp(stopAt(index), stopAt(index + 1), faceArrive((f - index) / 0.25))
        y = line
      } else if (p < sweep + back) {
        const k = faceArrive((p - sweep) / back)
        x = lerp(0.7, -0.7, k)
        y = lerp(line, next, k)
      }
      return beat({ gazeX: x, gazeY: y, yaw: x * 0.25, pitch: 0.08 + y * 0.3 })
    },
  },
  /**
   * Writing: the eyes follow a caret. They glide rather than jump — what is being written is
   * where the eyes already are — with a small nod at every word, and go back to the start of the
   * line when it is full.
   */
  trace: {
    period: [2.8, 4.2],
    beat: ({ p, r, n }) => {
      const words = 3 + Math.floor(r[0] * 4)
      const line = between(r[1], 0.72, 0.86)
      const rowY = (index: number): number => 0.2 + (index % 3) * 0.1
      if (p < line) {
        const f = p / line
        const word = (f * words) % 1
        return beat({
          gazeX: lerp(-0.6, 0.5, f),
          gazeY: rowY(n),
          yaw: lerp(-0.6, 0.5, f) * 0.2,
          pitch: 0.06 * bump(word, 0.55, 1),
        })
      }
      const k = faceArrive((p - line) / (1 - line))
      return beat({
        gazeX: lerp(0.5, -0.6, k),
        gazeY: lerp(rowY(n), rowY(n + 1), k),
        yaw: lerp(0.5, -0.6, k) * 0.2,
        pitch: -0.05 * bump(k, 0, 1),
      })
    },
  },
  /**
   * Running a command: watching its output. Lines arrive one at a time and the eyes go down with
   * them, and jump back up when the terminal scrolls. The head keeps still; a terminal is watched,
   * not read.
   */
  watch: {
    period: [2, 3.6],
    beat: ({ p, r }) => {
      const lines = 2 + Math.floor(r[0] * 3)
      const scroll = between(r[1], 0.72, 0.86)
      let down = 0
      for (let index = 0; index < lines; index += 1) {
        // Each line lands somewhere inside its own share of the pass, never on a beat.
        const at = (scroll * (index + 0.2 + 0.6 * r[2 + (index % 4)]!)) / lines
        down += faceArrive((p - at) / 0.04)
      }
      const depth = 0.1 * down * (1 - faceArrive((p - scroll) / 0.06))
      return beat({ gazeY: depth, pitch: depth * 0.2 })
    },
  },
  /**
   * A question: the head turns a little and lifts, and one eye stands down short, held a moment.
   * Which eye, which way, when and for how long all move; the gesture does not.
   */
  ask: {
    period: [3, 5.2],
    beat: ({ p, r, rise }) => {
      const at = between(r[0], 0.05, 0.3)
      const k = arc(p - at, rise, between(r[1], 0.15, 0.3), rise * 1.2)
      const side = r[3] < 0.5 ? -1 : 1
      const short = pull(EYES.cursor, k)
      return beat({
        pitch: -0.2 * k,
        yaw: side * 0.25 * k,
        gazeY: -0.1 * k,
        left: r[4] < 0.5 ? short : null,
        right: r[4] < 0.5 ? null : short,
      })
    },
  },
  /**
   * A permission: it looks at the thing it wants to do, then back up at you, with a small nod —
   * "this one? may I?" — and waits there.
   */
  offer: {
    period: [3.2, 5.4],
    beat: ({ p, r }) => {
      const side = r[0] < 0.5 ? -1 : 1
      const at = between(r[1], 0.05, 0.22)
      const hold = between(r[2], 0.12, 0.22)
      const away = faceArrive((p - at) / 0.08) - faceArrive((p - at - 0.08 - hold) / 0.1)
      const nod = bump(p, at + 0.16 + hold, at + 0.34 + hold)
      return beat({
        gazeX: side * 0.55 * away,
        gazeY: 0.7 * away,
        yaw: side * 0.2 * away,
        pitch: 0.1 * away + 0.12 * nod,
      })
    },
  },
  /**
   * Blocked: it leans in and pushes, holds, gives up — and looks about for a way round, before
   * coming back to you.
   */
  strain: {
    period: [3.4, 5.6],
    beat: ({ p, r, eyes, rise }) => {
      const at = between(r[0], 0.05, 0.12)
      const push = arc(p - at, rise, between(r[1], 0.1, 0.2), rise * 1.4)
      const side = r[2] < 0.5 ? -1 : 1
      const look = at + 0.4
      const search =
        r[3] < 0.65 ? arc(p - look, 0.05, 0.1, 0.05) - arc(p - look - 0.22, 0.05, 0.1, 0.06) : 0
      const tense = standing(eyes[0]) ? null : pull(EYES.flat, 0.5 * push)
      return beat({
        pitch: 0.2 * push,
        lid: 0.2 * push,
        gazeX: side * 0.5 * search,
        yaw: side * 0.2 * search,
        left: tense,
        right: tense,
      })
    },
  },
  /**
   * Checking: down a list, one item at a time, with a small nod on each — a tick — and back up to
   * the top at the end.
   */
  tick: {
    period: [2.4, 3.8],
    beat: ({ p, r }) => {
      const items = 3 + Math.floor(r[0] * 3)
      const list = between(r[1], 0.72, 0.86)
      if (p < list) {
        const f = (p / list) * items
        const index = Math.floor(f)
        const within = f - index
        const y = -0.15 + 0.12 * (index + faceArrive(within / 0.3))
        return beat({
          gazeY: y,
          gazeX: -0.2 + (index % 2) * 0.1,
          pitch: 0.07 * bump(within, 0.3, 0.75) + y * 0.2,
        })
      }
      const k = faceArrive((p - list) / (1 - list))
      const y = lerp(-0.15 + 0.12 * items, -0.15, k)
      return beat({ gazeY: y, gazeX: -0.2 + ((items - 1) % 2) * 0.1 * (1 - k), pitch: y * 0.2 })
    },
  },
  /**
   * One eye lifts off the work and the head turns towards it; the other narrows because the head
   * moved, not because it did anything.
   */
  glance: {
    period: [2.8, 4.6],
    beat: ({ p, r, eyes, rise }) => {
      const at = between(r[0], 0.05, 0.28)
      const k = arc(p - at, rise, between(r[1], 0.2, 0.36), rise * 1.1)
      const side = r[3] < 0.5 ? -1 : 1
      const eye = side < 0 ? eyes[0] : eyes[1]
      const lifted = pull(standing(eye) ? EYES.wide : EYES.chevron, k)
      return beat({
        gazeY: -0.3 * k,
        pitch: -0.18 * k,
        yaw: side * between(r[2], 0.2, 0.45) * k,
        left: side < 0 ? lifted : null,
        right: side < 0 ? null : lifted,
      })
    },
  },
  /** Done: one nod or two, at its own depth, sometimes none — approval, never a metronome. */
  settle: {
    period: [3.8, 5.6],
    beat: ({ p, r, was }) => {
      const nods = r[0] < 0.45 ? 0 : r[0] < 0.8 ? 1 : 2
      const span = between(r[1], 0.12, 0.18) * Math.max(nods, 1)
      const depth = between(r[2], 0.15, 0.26)
      const nodding = nods > 0 && p < span ? depth * Math.sin((Math.PI * nods * p) / span) ** 2 : 0
      const x = (d: Roll): number => between(d[3], -0.3, 0.3)
      return beat({ pitch: nodding, gazeX: lerp(x(was), x(r), faceArrive(p / 0.6)) })
    },
  },
  /**
   * An error: a short hard flinch, then dead still — worse than a constant shake, because it means
   * it happened and now it is staring at you. The rate is one a screen can draw: fifteen frames or
   * so to a shake, so it shivers rather than teleports.
   */
  shudder: {
    period: [2.6, 4.4],
    beat: ({ p, t, r }) => {
      const at = between(r[0], 0.02, 0.4)
      const q = (p - at) / between(r[1], 0.1, 0.18)
      const envelope = q > 0 && q < 1 ? (1 - q) ** 2 * faceArrive(q / 0.1) : 0
      const j = Math.sin(t * between(r[2], 18, 26)) * envelope
      return beat({ yaw: j * 0.35, pitch: j * 0.2 * (r[3] - 0.5), gazeX: j * 0.15 })
    },
  },
  /** Asleep: it rises and falls, slowly. Continuous across passes; only the depth is redrawn. */
  breathe: {
    period: [4, 5.2],
    beat: ({ p, r }) => {
      const depth = between(r[0], 0.7, 1.1)
      const s = Math.sin(p * Math.PI * 2)
      return beat({
        pitch: s * 0.1 * depth,
        gazeY: s * 0.12 * depth,
        yaw: Math.sin(p * Math.PI * 2 + 1) * 0.04,
        mouthScale: 1 + 0.15 * depth * Math.max(0, s),
      })
    },
  },
}

/** What a flourish does at one instant: where it puts the face, and how much of it it has. */
export interface FlourishFrame {
  /** How much of the face the flourish has taken, 0 to 1; the rest is the gesture under it. */
  readonly w: number
  readonly beat: Beat
}

/**
 * The fixed pieces: short choreographies played whole, the same every time.
 *
 * Everything else the face does is drawn from dice; a flourish is the opposite, and that is the
 * point of it — a sigh is a sigh because it has a shape, and a sigh drawn from dice is noise
 * with a longer name. The randomness is around them instead: when one plays, and which side a
 * look goes to, never how it goes.
 */
export type FlourishName = 'hmm' | 'sigh' | 'widen' | 'plead' | 'hop' | 'yawn'

export interface Flourish {
  /** How long it takes, in seconds: drawn inside these bounds each time it plays. */
  readonly length: readonly [number, number]
  /** How long between two plays, in seconds: drawn inside these bounds each time. */
  readonly every: readonly [number, number]
  /** Whether it says anything without a mouth: a face drawn too small for one skips the rest. */
  readonly mouthless: boolean
  /** The piece itself, `q` of the way through; `side` is -1 or 1, for the pieces that look away. */
  readonly play: (q: number, side: number) => FlourishFrame
}

export const FLOURISHES: Record<FlourishName, Flourish> = {
  /** Thinking harder: the head turns away, the eyes narrow and look up, the mouth twists. */
  hmm: {
    length: [1.2, 1.8],
    every: [7, 15],
    mouthless: true,
    play: (q, side) => {
      const k = arc(q, 0.2, 0.45, 0.35)
      return {
        w: arc(q, 0.15, 0.55, 0.3),
        beat: beat({
          pitch: -0.25 * k,
          yaw: side * 0.35 * k,
          gazeX: side * 0.5 * k,
          gazeY: -0.55 * k,
          lid: 0.35 * k,
          mouth: pull(MOUTHS.hmm, k),
        }),
      }
    },
  },
  /**
   * A sigh, in two halves: an inhale — the head comes right up and the eyes squeeze flat, the way
   * they do at the top of a deep breath — held a beat, and then everything let go at once. It
   * stays down a while before it comes back: the pause is what makes it read as having given up
   * on something for a second, and without it the whole thing is a swing.
   */
  sigh: {
    length: [2.6, 4],
    every: [10, 22],
    mouthless: true,
    play: (q) => {
      const inhale = q < 0.26 ? faceArrive(q / 0.26) : 1 - faceArrive((q - 0.34) / 0.18)
      const slump =
        q < 0.34 ? 0 : q < 0.76 ? faceArrive((q - 0.34) / 0.18) : 1 - faceArrive((q - 0.76) / 0.24)
      return {
        w: arc(q, 0.1, 0.76, 0.14),
        beat: beat({
          pitch: -0.8 * inhale + 0.8 * slump,
          yaw: 0.3 * slump,
          gazeX: 0.15 * slump,
          gazeY: -0.3 * inhale + 0.5 * slump,
          lid: 0.8 * slump,
          mouthScale: 1 + 0.3 * inhale + 0.5 * bump(q, 0.34, 0.56),
        }),
      }
    },
  },
  /**
   * A question asked again: the eyes widen, and the head goes still while they do — it breaks off
   * what it was doing and looks straight at you. It opens quickly and holds, and the hold is what
   * turns a twitch into a look.
   */
  widen: {
    length: [1.1, 1.8],
    every: [6, 14],
    mouthless: true,
    play: (q) => {
      const wide = arc(q, 0.18, 0.42, 0.34)
      const open = pull(EYES.wide, wide)
      return { w: arc(q, 0.12, 0.55, 0.33), beat: beat({ left: open, right: open }) }
    },
  },
  /** A permission asked again: the head drops a little, and the eyes look up at you. */
  plead: {
    length: [1, 1.5],
    every: [8, 16],
    mouthless: true,
    play: (q, side) => {
      const k = arc(q, 0.2, 0.45, 0.35)
      return {
        w: arc(q, 0.15, 0.55, 0.3),
        beat: beat({ pitch: 0.2 * k, gazeY: -0.45 * k, yaw: side * 0.1 * k }),
      }
    },
  },
  /** Done, and pleased with it: a small hop, the smile widening into a grin on the way up. */
  hop: {
    length: [0.7, 1],
    every: [9, 18],
    mouthless: true,
    play: (q) => {
      const up = bump(q, 0, 0.45)
      return {
        w: arc(q, 0.08, 0.72, 0.2),
        beat: beat({ pitch: -0.3 * up + 0.12 * bump(q, 0.4, 0.8), mouth: pull(MOUTHS.grin, up) }),
      }
    },
  },
  /**
   * A yawn: the mouth opens — wider and taller at once, never turning — while the eyes squeeze
   * flat and sink towards it; it holds with a tremble, and closes on the way home. It needs a mouth: without one it is a head going back for no reason.
   */
  yawn: {
    length: [2.8, 3.3],
    every: [12, 26],
    mouthless: false,
    play: (q) => {
      const open = arc(q, 0.45, 0.25, 0.3)
      const peak = arc(q, 0.46, 0.22, 0.16)
      return {
        w: arc(q, 0.25, 0.35, 0.35),
        beat: beat({
          pitch: -0.08 * open + Math.sin(q * Math.PI * 18) * 0.03 * peak,
          yaw: Math.sin(q * Math.PI * 14 + 0.8) * 0.015 * peak,
          // The eyes are squeezed flat and pulled down towards the mouth opening under them.
          gazeY: 0.85 * open,
          lid: 0.3 * open,
          left: pull(EYES.shut, 0.8 * open),
          right: pull(EYES.shut, 0.8 * open),
          mouth: pull(MOUTHS.gape, open),
        }),
      }
    },
  },
}
