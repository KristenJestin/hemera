/**
 * Hemera's face, asked what it promises: one expression per state an agent can be in, held still
 * — but for the slow blink of a state waiting for the reader, and the loading's orbit — a change
 * between any two states that is one short motion and never a cut, taken from wherever the face
 * is when it arrives half-way through another, sizes that simplify rather than blur, and still
 * expressions for a reader asking for less movement.
 *
 * The face is a function of time, so every one of these is asked one frame at a time, far faster
 * than a screen draws them, and nothing here waits for a clock.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { changeBetween, CHOREOGRAPHIES } from '../src/components/face/changes.ts'
import {
  DETAILS,
  type FaceDetail,
  type FaceFrame,
  createFace,
} from '../src/components/face/player.ts'
import { AT, TONE_CLASSES, TONES, tonesOf } from '../src/components/face/pose.ts'
import { drawnOf } from '../src/components/face/rig.ts'
import { EXPRESSIONS, FACE_STATES, type FaceState } from '../src/components/face/states.ts'
import { face } from '../src/motion.ts'

const theme = readFileSync(join(import.meta.dirname, '..', 'src', 'theme.css'), 'utf8')

/** How often the face is asked, per second: four frames to every one a screen draws. */
const RATE = 240

/**
 * The most any point of the drawing may travel between two frames that close, in units of the
 * 32-unit square. The quickest things the face does on purpose — a flinch, a shudder, a blink, the
 * look away that is meant to be quicker than the eye expects, at the gain of an icon — travel
 * under one; a cut, a shape swapped or a head snapped somewhere, is several units in one frame.
 */
const CUT = 1.5

/** Every number the drawing is made of: the three points and the width of every stroke drawn. */
function drawing(frame: FaceFrame, detail: FaceDetail = DETAILS.full): number[] {
  const numbers: number[] = []
  for (const layer of frame.layers) {
    const drawn = drawnOf(layer.pose, detail)
    for (const stroke of [drawn.left, drawn.right, drawn.mouth]) {
      if (stroke !== null) numbers.push(...stroke.points, stroke.width)
    }
  }
  return numbers
}

/** The three ways of pairing three strokes with three others, and the rest of the six. */
const ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]

/**
 * The furthest any number of the drawing went from one frame to the next, whichever stroke is
 * which: out of loading the three dots are alike, and which one becomes the mouth is chosen when
 * the change comes — the same picture, told with its strokes in another order.
 */
function travel(before: number[], after: number[]): number {
  const strokes = before.length / 7
  const furthest = (order: readonly number[]): number => {
    let most = 0
    for (let stroke = 0; stroke < strokes; stroke += 1) {
      for (let at = 0; at < 7; at += 1) {
        const was = before[stroke * 7 + at]!
        const now = after[order[stroke]! * 7 + at]!
        most = Math.max(most, Math.abs(was - now))
      }
    }
    return most
  }
  if (strokes !== 3) return furthest([0, 1, 2, 3, 4, 5].slice(0, strokes))
  return Math.min(...ORDERS.map(furthest))
}

interface Played {
  readonly state: FaceState
  readonly at: number
}

interface Story {
  readonly seed: number
  readonly start: FaceState
  readonly changes?: readonly Played[]
  readonly detail?: FaceDetail
  readonly reduced?: boolean
}

/** A face that starts at zero and is given its changes as the clock reaches them. */
function told(story: Story): (at: number) => FaceFrame {
  const player = createFace({
    state: story.start,
    at: 0,
    seed: story.seed,
    detail: story.detail ?? DETAILS.full,
    reduced: story.reduced ?? false,
  })
  const waiting = [...(story.changes ?? [])]
  return (at) => {
    while (waiting.length > 0 && waiting[0]!.at <= at) {
      const next = waiting.shift()!
      player.change(next.state, next.at)
    }
    return player.frame(at)
  }
}

/** The furthest the drawing travels in one frame, between `from` and `to` seconds. */
function largestStep(
  frameAt: (at: number) => FaceFrame,
  from: number,
  to: number,
  detail: FaceDetail = DETAILS.full,
): number {
  let before = drawing(frameAt(from), detail)
  let most = 0
  for (let tick = 1; tick <= Math.round((to - from) * RATE); tick += 1) {
    const after = drawing(frameAt(from + tick / RATE), detail)
    most = Math.max(most, travel(before, after))
    before = after
  }
  return most
}

/** A pair of states, as a test's name reads it. */
const PAIRS = FACE_STATES.flatMap((from) =>
  FACE_STATES.filter((to) => to !== from).map((to) => [from, to] as const),
)

/** The states that wait for the reader: the only ones that keep a loop, a slow blink. */
const WAITING: readonly FaceState[] = ['question', 'permission', 'blocked']

/** The states that hold still once shown: every one but loading and those that wait. */
const CALM = FACE_STATES.filter((state) => state !== 'loading' && !WAITING.includes(state))

/** The working states, which are ordinary and drawn in no colour of their own. */
const WORK: readonly FaceState[] = ['thinking', 'reading', 'writing', 'running', 'checking']

/** A pose with its lids left out: everything a blink does not move. */
function lidless(frame: FaceFrame): number[] {
  return frame.layers[0]!.pose.filter((_, index) => index !== AT.lidLeft && index !== AT.lidRight)
}

/** How long a change from one state to another lasts at the preset's own pace. */
function lengthOf(from: FaceState, to: FaceState): number {
  return face.change[changeBetween(from, to)]
}

describe('One expression per state an agent can be in', () => {
  test('every state says what it is in words of its own', () => {
    const labels = FACE_STATES.map((state) => EXPRESSIONS[state].label)
    expect(labels.every((label) => label.trim() !== '')).toBe(true)
    expect(new Set(labels).size).toBe(FACE_STATES.length)
  })

  test('the working states are drawn in a neutral role, and nothing in the primary', () => {
    for (const state of WORK) {
      expect(['text-foreground', 'text-muted-foreground']).toContain(
        TONE_CLASSES[EXPRESSIONS[state].tone],
      )
    }
    expect(Object.values(TONE_CLASSES)).not.toContain('text-primary')
  })

  test('colour is kept for what it means: waiting, an error, done', () => {
    for (const state of WAITING) expect(TONE_CLASSES[EXPRESSIONS[state].tone]).toBe('text-warning')
    expect(TONE_CLASSES[EXPRESSIONS.error.tone]).toBe('text-destructive')
    expect(TONE_CLASSES[EXPRESSIONS.done.tone]).toBe('text-success')
  })

  test('every state is drawn in a role of the theme and never in a colour of its own', () => {
    for (const tone of TONES) {
      const role = TONE_CLASSES[tone].replace(/^text-/, '')
      expect(theme, `${tone} is drawn in ${role}, which the theme does not declare`).toContain(
        `--color-${role}:`,
      )
    }
  })

  test.each([
    ['full', DETAILS.full],
    ['icon', DETAILS.icon],
  ] as const)(
    'every state is told from every other by its shape alone, at %s size',
    (_, detail) => {
      const stills = FACE_STATES.map((state) => ({
        state,
        drawn: drawing(told({ seed: 1, start: state, reduced: true })(0), detail),
      }))
      const alike = stills.flatMap((one, index) =>
        stills
          .slice(index + 1)
          .filter((other) => travel(one.drawn, other.drawn) < 1)
          .map((other) => `${one.state} and ${other.state}`),
      )
      expect(alike).toEqual([])
    },
  )
})

describe('Within a state', () => {
  test('only the states that wait for the reader keep a loop', () => {
    expect(FACE_STATES.filter((state) => EXPRESSIONS[state].waits)).toEqual(WAITING)
  })

  test.each(FACE_STATES)('%s lives for a minute without a single cut', (state) => {
    for (const [seed, detail] of [
      [3, DETAILS.full],
      [17, DETAILS.icon],
    ] as const) {
      const frameAt = told({ seed, start: state, detail })
      expect(largestStep(frameAt, 0, 60, detail)).toBeLessThan(CUT)
    }
  })

  test.each(CALM)('%s holds still from the moment it is shown', (state) => {
    const frameAt = told({ seed: 3, start: state })
    const first = drawing(frameAt(0))
    for (let at = 0; at < 60; at += 0.1) {
      const frame = frameAt(at)
      expect(frame.still).toBe(true)
      expect(drawing(frame)).toEqual(first)
    }
  })

  test.each(WAITING)('%s keeps a slow blink, and nothing else moves', (state) => {
    const frameAt = told({ seed: 3, start: state })
    const first = lidless(frameAt(0))
    let shut = 0
    let was = false
    for (let tick = 0; tick < 60 * RATE; tick += 1) {
      const frame = frameAt(tick / RATE)
      expect(frame.still).toBe(false)
      expect(lidless(frame)).toEqual(first)
      const closed = frame.layers[0]!.pose[AT.lidLeft]! > 0.9
      if (closed && !was) shut += 1
      was = closed
    }
    expect(shut).toBeGreaterThanOrEqual(Math.floor(60 / face.call.every[1]))
    expect(shut).toBeLessThanOrEqual(Math.ceil(60 / face.call.every[0]))
  })

  test('loading goes on turning: it is the loading indicator', () => {
    const frameAt = told({ seed: 3, start: 'loading' })
    expect(frameAt(1).still).toBe(false)
    expect(travel(drawing(frameAt(1)), drawing(frameAt(1.3)))).toBeGreaterThan(0.5)
  })

  test('the same seed tells the same story, and another seed another one', () => {
    const changes = [
      { state: 'thinking', at: 2 },
      { state: 'running', at: 5.5 },
      { state: 'question', at: 5.8 },
    ] as const
    const one = told({ seed: 42, start: 'asleep', changes })
    const same = told({ seed: 42, start: 'asleep', changes })
    const other = told({ seed: 43, start: 'asleep', changes })
    let differs = false
    for (let at = 0; at < 40; at += 0.05) {
      const drawn = drawing(one(at))
      expect(drawing(same(at))).toEqual(drawn)
      differs ||= travel(drawn, drawing(other(at))) > 0.01
    }
    expect(differs).toBe(true)
  })

  test('a face asked about a moment it let go of tells it again, the same', () => {
    const frameAt = told({ seed: 9, start: 'question' })
    const early = Array.from({ length: 400 }, (_, index) => drawing(frameAt(index / 20)))
    // Far enough on for the early blinks to have been let go of.
    frameAt(900)
    expect(Array.from({ length: 400 }, (_, index) => drawing(frameAt(index / 20)))).toEqual(early)
  })

  test('slow blinks never fall into a rhythm, and keep inside their bounds', () => {
    const frameAt = told({ seed: 5, start: 'question' })
    const starts: number[] = []
    let was = false
    for (let tick = 0; tick < 300 * RATE; tick += 1) {
      const at = tick / RATE
      const lid = frameAt(at).layers[0]!.pose[AT.lidLeft]!
      if (lid > 0.9 && !was) starts.push(at)
      was = lid > 0.9
    }
    const gaps = starts.slice(1).map((at, index) => at - starts[index]!)
    expect(gaps.length).toBeGreaterThan(20)
    const reach = face.call.down + face.call.up
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(face.call.every[0] - reach)
      expect(gap).toBeLessThanOrEqual(face.call.every[1] + reach)
    }
    const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
    const spread = Math.sqrt(gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / gaps.length)
    expect(spread).toBeGreaterThan(0.5)
  })

  test('a state that does not wait never closes its eyes on its own', () => {
    for (const state of CALM) {
      const frameAt = told({ seed: 5, start: state })
      for (let at = 0; at < 60; at += 1 / 60) {
        expect(frameAt(at).layers[0]!.pose[AT.lidLeft]).toBe(EXPRESSIONS[state].lid)
      }
    }
  })
})

describe('Transitions', () => {
  test('every pair of states has a change of its own, designed and not a cut', () => {
    for (const [from, to] of PAIRS) {
      expect(CHOREOGRAPHIES[changeBetween(from, to)]).toBeDefined()
    }
  })

  test.each(PAIRS)('%s to %s is a motion from wherever the face is', (from, to) => {
    for (const seed of [2, 11]) {
      const at = 2.3 + seed / 10
      const frameAt = told({ seed, start: from, changes: [{ state: to, at }] })
      expect(largestStep(frameAt, at - 0.2, at + lengthOf(from, to) + 0.3)).toBeLessThan(CUT)
    }
  })

  test.each(PAIRS)(
    '%s to %s, interrupted half-way, is taken from wherever the face is',
    (from, to) => {
      const at = 2.1
      const length = lengthOf(from, to)
      // Back where it came from, and on to the state after the one it was going to.
      const then = FACE_STATES[(FACE_STATES.indexOf(to) + 5) % FACE_STATES.length]!
      for (const [third, share] of [
        [from, 0.3],
        [then === to ? from : then, 0.6],
      ] as const) {
        const interrupted = at + length * share
        const frameAt = told({
          seed: 7,
          start: from,
          changes: [
            { state: to, at },
            { state: third, at: interrupted },
          ],
        })
        const end = interrupted + lengthOf(to, third) + 0.3
        expect(largestStep(frameAt, at - 0.1, end)).toBeLessThan(CUT)
      }
    },
  )

  test('every change is one short movement: a second at most', () => {
    for (const length of Object.values(face.change)) expect(length).toBeLessThanOrEqual(1)
  })

  test.each(PAIRS.filter(([, to]) => CALM.includes(to)))(
    '%s to %s plays its movement once, and then holds still',
    (from, to) => {
      const at = 2.3
      const frameAt = told({ seed: 2, start: from, changes: [{ state: to, at }] })
      expect(frameAt(at + lengthOf(from, to) / 2).still).toBe(false)
      const landed = at + lengthOf(from, to) + 0.001
      const rest = drawing(frameAt(landed))
      for (let when = landed; when < landed + 30; when += 0.25) {
        const frame = frameAt(when)
        expect(frame.still).toBe(true)
        expect(drawing(frame)).toEqual(rest)
      }
    },
  )

  test('the colour travels with the change and lands whole on the new state', () => {
    for (const [from, to] of PAIRS) {
      const at = 1.7
      const frameAt = told({ seed: 4, start: from, changes: [{ state: to, at }] })
      for (let when = at - 0.1; when < at + lengthOf(from, to) + 0.1; when += 1 / 120) {
        const weights = tonesOf(frameAt(when).layers[0]!.pose)
        expect(weights.every((weight) => weight >= 0)).toBe(true)
        expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 9)
      }
      const landed = tonesOf(frameAt(at + lengthOf(from, to) + 0.01).layers[0]!.pose)
      expect(landed[TONES.indexOf(EXPRESSIONS[to].tone)]).toBe(1)
    }
  })

  test('a change lasts what the motion preset says it does', () => {
    const frameAt = told({ seed: 1, start: 'thinking', changes: [{ state: 'done', at: 1 }] })
    const length = face.change[changeBetween('thinking', 'done')]
    const half = frameAt(1 + length / 2).change
    expect(half?.name).toBe('cheer')
    expect(half?.progress).toBeCloseTo(0.5, 9)
    expect(frameAt(1 + length + 0.001).change).toBeNull()
  })
})

describe('Loading', () => {
  /** How far the dots are from the middle of the square, on average. */
  const spread = (pose: readonly number[]): number => {
    const drawn = drawnOf(pose, DETAILS.full)
    const strokes = [drawn.left, drawn.right, drawn.mouth!]
    const far = (stroke: { points: readonly number[] }): number =>
      Math.hypot(stroke.points[2]! - 16, stroke.points[3]! - 16)
    return strokes.reduce((sum, stroke) => sum + far(stroke), 0) / 3
  }

  test('the dots sit as they are, spread out and drawn in, in turn and without a pause', () => {
    const frameAt = told({ seed: 12, start: 'loading' })
    const widths = new Set<number>()
    for (let at = 0; at < 60; at += 0.05) {
      widths.add(Math.round(spread(frameAt(at).layers[0]!.pose)))
    }
    // Drawn in, as they are and spread out: three widths at least, and every one between.
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThanOrEqual(4)
  })

  test('the dots go at their beat and twice as fast, whatever their width', () => {
    const frameAt = told({ seed: 12, start: 'loading' })
    const speeds: number[] = []
    for (let at = 5; at < 60; at += 0.25) {
      const pose = (when: number): readonly number[] => frameAt(when).layers[0]!.pose
      speeds.push((pose(at + 0.01)[AT.spin]! - pose(at)[AT.spin]!) / 0.01)
    }
    const beat = 1 / face.spin
    expect(Math.min(...speeds)).toBeCloseTo(beat, 2)
    expect(Math.max(...speeds)).toBeCloseTo(2 * beat, 2)
  })
})

describe('Falling asleep', () => {
  test.each(FACE_STATES.filter((state) => state !== 'asleep' && state !== 'loading'))(
    '%s falls asleep without a yawn: the mouth never opens on the way',
    (from) => {
      const frameAt = told({ seed: 6, start: from, changes: [{ state: 'asleep', at: 1 }] })
      const length = face.change.drift
      for (let at = 1; at < 1 + length; at += 1 / 60) {
        const mouth = drawnOf(frameAt(at).layers[0]!.pose, DETAILS.full).mouth!
        expect(mouth.width).toBeLessThan(3.5)
      }
    },
  )
})

describe('Sizes', () => {
  test('an icon draws heavier strokes than the full face, and its mouth unless left out', () => {
    const pose = told({ seed: 1, start: 'done', reduced: true })(0).layers[0]!.pose
    const icon = drawnOf(pose, DETAILS.icon)
    const full = drawnOf(pose, DETAILS.full)
    expect(icon.mouth).not.toBeNull()
    expect(drawnOf(pose, { ...DETAILS.icon, mouth: false }).mouth).toBeNull()
    expect(icon.left.width).toBeGreaterThan(full.left.width)
  })

  test('small, a movement travels further so that it still reads', () => {
    const frameAt = told({ seed: 3, start: 'thinking', changes: [{ state: 'done', at: 1 }] })
    const pose = frameAt(1.1).layers[0]!.pose
    const reach = (detail: FaceDetail): number => {
      const moved = drawnOf(pose, detail)
      const still = drawnOf(
        pose.map((value, index) => (index >= AT.yaw && index < AT.tones ? 0 : value)),
        detail,
      )
      return Math.max(
        ...moved.left.points.map((value, index) => Math.abs(value - still.left.points[index]!)),
      )
    }
    expect(reach(DETAILS.icon)).toBeGreaterThan(reach(DETAILS.full))
  })
})

describe('Reduced motion', () => {
  test.each(FACE_STATES)('%s holds still: its expression, and nothing moving', (state) => {
    const frameAt = told({ seed: 8, start: state, reduced: true })
    const first = drawing(frameAt(0))
    for (let at = 0; at < 30; at += 0.25) {
      const frame = frameAt(at)
      expect(frame.still).toBe(true)
      expect(drawing(frame)).toEqual(first)
    }
  })

  test('a change is a soft cross-fade between two still expressions, and nothing moves', () => {
    const at = 2
    const frameAt = told({
      seed: 8,
      start: 'thinking',
      changes: [{ state: 'question', at }],
      reduced: true,
    })
    const before = drawing(frameAt(at - 0.01))
    const after = drawing(told({ seed: 8, start: 'question', reduced: true })(0))
    const half = frameAt(at + face.fade / 2)
    expect(half.layers).toHaveLength(2)
    expect(half.layers[0]!.opacity + half.layers[1]!.opacity).toBeCloseTo(1, 9)
    expect(drawing(half)).toEqual([...before, ...after])
    const landed = frameAt(at + face.fade + 0.01)
    expect(landed.layers).toHaveLength(1)
    expect(drawing(landed)).toEqual(after)
    expect(landed.still).toBe(true)
  })
})
