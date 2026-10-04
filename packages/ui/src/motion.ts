import { MotionConfigContext, useReducedMotion } from 'motion/react'
import type { Easing, TargetAndTransition, Transition } from 'motion/react'
import { type RefObject, useContext, useEffect, useRef, useState } from 'react'

/**
 * The motion personality of Hemera: a closed set of kinds, and nowhere else to write a spring. A
 * check of the repository (`tools/motion-presets.ts`) refuses a `stiffness`, a `damping`, a
 * duration, a curve or a keyframe written anywhere but this file, because a design system whose
 * springs are scattered has no personality at all.
 *
 * Components read a kind through `useTransition(kind)`, which answers a reader asking for less
 * movement with the end state and no journey. A movement the set has no kind for is added here,
 * named and explained, and read from here.
 */

/** What answers the hand: hover, press, a width following what the press changed. */
export const press: Transition = { type: 'spring', stiffness: 500, damping: 30, mass: 0.6 }

/** What puts itself in place: panels, popups, a mark moving to the item it is given. */
export const arrival: Transition = { type: 'spring', stiffness: 170, damping: 26 }

/**
 * What changes size in place. A dimension that overshoots reads as a mistake — the box goes past
 * its size and what is beside it comes back to meet it — so this one sits just past critical
 * damping and arrives without ever turning round.
 */
export const morph: Transition = { type: 'spring', stiffness: 260, damping: 33, mass: 1 }

/** The same arrival, with nothing in between: what a system asking for less movement gets. */
export const instant: Transition = { duration: 0 }

/**
 * How far the edges of a control travel under the hand, in pixels: inwards while it is pressed,
 * outwards while the pointer is over it. Pixels and not a share of the control, so a wide select
 * and a small icon button give by the same distance; both under two pixels, so a label never
 * leaves the room the layout gave it.
 */
export const PRESS_EDGE = 1.5
export const LIFT_EDGE = 1

/** The box a control took in the layout, which its press is a share of. */
export interface ControlBox {
  readonly width: number
  readonly height: number
}

/**
 * What a control is drawn at under the hand: the share of itself, one per axis. A type and not an
 * interface: motion takes a `Target`, which has an index signature an interface does not inherit.
 */
export type Scales = {
  readonly scaleX: number
  readonly scaleY: number
}

/** Nothing at all: what a control whose box is not known yet is drawn at. */
export const STILL: Scales = { scaleX: 1, scaleY: 1 }

/**
 * The shares that move each edge of a box by `edge` pixels: inwards when `edge` is positive,
 * outwards when it is negative. A box the layout has not measured yet is left alone.
 */
export function edgeScale(box: ControlBox, edge: number): Scales {
  if (box.width < 1 || box.height < 1) return STILL
  return { scaleX: 1 - (2 * edge) / box.width, scaleY: 1 - (2 * edge) / box.height }
}

/** How far the mark of a state travels in from under the edge, in pixels. */
export const MARK_TRAVEL = 12

/**
 * The durations of the theme, in the seconds motion counts in. `turn` is the one the stylesheet
 * spins and breathes on — `--duration-turn` — so what motion repeats keeps the same beat.
 */
export const durations = { fast: 0.16, base: 0.26, slow: 0.4, turn: 1.2 } as const

/** The curve the theme's `--ease-calm` draws, for the few transitions that are not a spring. */
export const easing: Easing = [0.25, 0.8, 0.25, 1]

/**
 * The `hover` kind: what changes colour under the hand or the keyboard — a row, an item, a button —
 * fades on the `fast` beat rather than jumping. In CSS it is the theme's `hover-motion` utility,
 * which components wear; this is the same beat for what motion drives.
 */
export const hover: Transition = { duration: durations.fast, ease: easing }

/**
 * The transition to animate with, which is the kind asked for unless less movement was.
 *
 * motion's own `reducedMotion` jumps a transform to its target and keeps animating opacity and
 * colour. What reduced motion means here is the end state without the journey, for every property
 * at once, so the journey is given no time instead. Both ways of asking are honoured: the system
 * preference, and a `MotionConfig` that says `always`.
 */
export function useTransition(kind: Transition = arrival): Transition {
  const { reducedMotion } = useContext(MotionConfigContext)
  const system = useReducedMotion()
  if (reducedMotion === 'always') return instant
  return system === true ? instant : kind
}

/** The hand of a control: what carries it, and what it is drawn at under the pointer and the press. */
export interface Hand {
  readonly element: RefObject<HTMLButtonElement | null>
  readonly hover: Scales
  readonly tap: Scales
}

/**
 * What a control answers the hand with, computed from the box it actually took: a control spreads
 * `hover` into `whileHover` and `tap` into `whileTap`, and every one of them gives by the same
 * `PRESS_EDGE` pixels. The box is read with `offsetWidth`, the layout's and not what a transform
 * is doing to it, and followed, because a control whose label changed is no longer the size it
 * was measured at.
 */
export function useHand(): Hand {
  const element = useRef<HTMLButtonElement | null>(null)
  const [box, setBox] = useState<ControlBox | null>(null)
  useEffect(() => {
    const node = element.current
    if (node === null) return
    const measure = (): void => {
      const { offsetWidth: width, offsetHeight: height } = node
      if (width < 1 || height < 1) return
      setBox((before) =>
        before?.width === width && before.height === height ? before : { width, height },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [])
  if (box === null) return { element, hover: STILL, tap: STILL }
  return { element, hover: edgeScale(box, -LIFT_EDGE), tap: edgeScale(box, PRESS_EDGE) }
}

/**
 * The `expand` and `collapse` kinds: a body whose height is its own, growing and folding away.
 *
 * Height and a fade together: the height makes room, so what is under it is pushed rather than
 * redrawn, and the fade keeps the clipped edge from reading as a line cut in half. The fade is a
 * `filter` and not an `opacity`: the accessibility check measures a text's contrast through an
 * opacity and refuses the value it reads mid-flight. Played on `fold`.
 */
export const expand = { height: 'auto', filter: 'opacity(1)' } as const
export const collapse = { height: 0, filter: 'opacity(0)' } as const

/**
 * The `fold` kind: what a body growing or folding away plays on. `morph` by name, started from
 * rest: a dimension turned round mid-flight would otherwise keep the speed it had and go on
 * growing for a frame after the hand said otherwise.
 */
export const fold: Transition = { ...morph, velocity: 0 }

/**
 * The `crossfade` kind: one content giving way to another in the same place, in opacity alone —
 * an icon giving way to the mark it ended on. A tween on the `fast` beat, because an opacity has
 * no weight to carry. `CROSSFADE` is where the content starts and where it lands, as a `filter`
 * for the reason `expand` gives.
 */
export const crossfade: Transition = { duration: durations.fast, ease: easing }
export const CROSSFADE = {
  from: { filter: 'opacity(0)' },
  to: { filter: 'opacity(1)' },
} as const

/**
 * The `ping` kind: a ring leaving what waits, over and over, read from the corner of the eye.
 * `ping` is what the ring travels through, `pinging` the beat it repeats on, the theme's `turn`.
 * A reader asking for less movement is given no ring at all: `useTransition` answers `instant`,
 * and the component then draws nothing.
 */
export const PING_REACH = 2.6
export const PING_OPACITY = 0.45
export const ping: TargetAndTransition = {
  // A whole transform rather than `scale`: the shorthand is played on the main thread, frame by
  // frame, where a transform is handed to the compositor and keeps its beat under load.
  transform: ['scale(1)', `scale(${String(PING_REACH)})`],
  opacity: [PING_OPACITY, 0],
}
export const pinging: Transition = {
  duration: durations.turn,
  ease: easing,
  repeat: Number.POSITIVE_INFINITY,
}

/**
 * The `check` kind: a stroke drawing itself — a tick when a box is checked, the glyph a status
 * mark closes on.
 *
 * - `draw` is what the stroke's length travels on: the `base` beat, on a curve that sets off fast
 *   and lands slowly, so it reads as a pen stroke rather than as a bar filling.
 * - `press` and `pressed` are the small give of a box as it is checked, down to `CHECK_PRESS` of
 *   itself and back, on the `fast` beat.
 */
export const CHECK_PRESS = 0.92
export const check = {
  draw: { duration: durations.base, ease: [0.16, 1, 0.3, 1] },
  press: { duration: durations.fast, ease: easing },
  pressed: { scale: [1, CHECK_PRESS, 1] },
} as const satisfies { draw: Transition; press: Transition; pressed: TargetAndTransition }

/**
 * The `wipe` kind: a tint crossing something once, from its left edge out through its right — a
 * live chip saying how its run ended. `WIPE.before` is the tint wholly out on the left,
 * `WIPE.past` wholly out on the right, so nothing tinted stays. A tween on the `slow` beat rather
 * than a spring, whose long settle would leave a sliver of tint standing on the right edge. A
 * whole transform and not `x`, for the reason `ping` gives.
 */
export const WIPE = {
  before: { transform: 'translateX(-100%)' },
  past: { transform: 'translateX(100%)' },
} as const
export const wipe: Transition = { duration: durations.slow, ease: [0.65, 0, 0.35, 1] }

/**
 * The `face` kind: the beats Hemera's face lives on.
 *
 * The face is not moved by motion. Every expression it has is the same seven numbers per stroke
 * moved around, eased on the frame by the face's own player, so that any shape travels into any
 * other and a change that arrives half-way through another is taken from wherever the face is.
 * What that player plays by is written here, in one table, so that the face reads its beats from
 * the preset like every other movement.
 *
 * The face is calm. A face that moves all the time is tiring to have in the corner of the eye, so
 * it holds still in its state and moves when its state changes: one short movement, then still
 * again. Two things loop, and only these. Loading is the loading indicator, and turns as one does.
 * The states that wait for the reader — a question, a permission, a blocker — keep a slow blink
 * at a long interval: the work has stopped until someone answers, and a face that blinks now and
 * then is a face still waiting, without anything moving enough to pull the eye from what it
 * reads. An error does not loop: its flinch is its change, and it then stares, still, in red.
 *
 * - `blink`: the lid a change is carried across, coming down and going back up a little slower,
 *   the way a real one moves. `hold` is how long the lid stays shut while the shape changes
 *   behind it — the way an animator cuts on a blink.
 * - `call`: the slow blink of a state that waits for the reader: the gap between two, drawn
 *   afresh each time inside `every` so that it never falls into a rhythm, and a lid twice as slow
 *   as a change's, so that it reads as patience and not as a twitch.
 * - `change`: how long each change of state lasts, by what it says, a second at most. Going from
 *   one kind of work to another is a glance and a flinch is quick; falling asleep and waking up
 *   take the longest.
 * - `carry`: how much of its speed the head keeps when a change takes it over, 0 to 1: at 0 it
 *   stops dead on the frame the change arrives, at 1 it finishes the move it was in first.
 * - `spin`: one turn of the loading orbit, on the theme's `turn`, the beat the loading indicator
 *   turns on, so a face that stands in for one goes round as fast.
 * - `loading`: the loading's two clocks, each drawn from the seed and neither knowing the other —
 *   how wide the dots sit (as they are, spread out or drawn in) and how fast they go (at the
 *   indicator's own beat or twice as fast). Each keeps what it drew for a while inside its
 *   `hold`, in seconds, then eases into the next draw over its `ease`: never a pause, never a
 *   pattern.
 * - `fade`: the one thing a reader asking for less movement is still given — a soft cross-fade
 *   from one still expression to the next, in opacity alone, so the face never jumps at them. No
 *   loop at all: a waiting face is as still as any other.
 */
export const face = {
  blink: { down: 0.09, up: 0.15, hold: 0.06 },
  call: { every: [7, 11], down: 0.18, up: 0.3 },
  change: {
    shift: 0.36,
    focus: 0.5,
    alert: 0.6,
    resume: 0.55,
    turn: 0.5,
    cheer: 0.7,
    flinch: 0.6,
    recover: 0.7,
    drift: 1,
    wake: 0.9,
    boot: 0.8,
    gather: 0.65,
  },
  carry: 0.6,
  spin: durations.turn,
  loading: {
    reaches: [0, 0.35, -0.3],
    reachHold: [0.5, 2.5],
    reachEase: 0.45,
    paces: [1, 2],
    paceHold: [1, 3],
    paceEase: 0.5,
  },
  fade: durations.slow,
} as const

/**
 * How far a number of the face has travelled at a share `k` of its change: at rest at both
 * ends and fastest in the middle.
 *
 * Not the theme's `easing`, which eases out only. That reads as calm on a panel putting itself in
 * place in a quarter of a second, and as a snap followed by a long tail on a face, where a change
 * is slow enough to be watched: an eye has to build into its new shape and then arrive.
 */
export function faceArrive(k: number): number {
  const q = Math.min(1, Math.max(0, k))
  return q * q * (3 - 2 * q)
}

/**
 * How far a number of the face has gone at a share `k` of a change of speed eased on
 * `faceArrive`, for a change of one: what a speed that builds and settles has covered, and past
 * the end of the change, everything it covers at its new speed.
 */
export function faceArriveSpan(k: number): number {
  if (k <= 0) return 0
  if (k >= 1) return 0.5 + (k - 1)
  return k ** 3 - k ** 4 / 2
}

/**
 * How far a number of the face coasts at a share `k` of a change, in lengths of it and for a speed
 * of one: the speed dies away evenly and is spent at the end. How the loading orbit stops when a
 * change that does not know it takes it over.
 */
export function faceCoast(k: number): number {
  const q = Math.min(1, Math.max(0, k))
  return (q * (2 - q)) / 2
}

/**
 * What is left of the speed a number of the face had when a change took it over, at a share `k`
 * of the change and in lengths of it.
 *
 * A change arriving half-way through another leaves from where the face is, and at the speed it
 * had: a head turning left that is told to look right finishes the turn it was in rather than
 * stopping dead on the frame the word came, and has spent that speed by the end of the change.
 * Nothing is left of it at either end, so the change still arrives at rest.
 */
export function faceCarry(k: number): number {
  const q = Math.min(1, Math.max(0, k))
  return q * (1 - q) * (1 - q)
}

/**
 * How far a view opened over a mission's base, or a notification arriving in the window's corner,
 * travels in from under the edge it comes from, in pixels. Short on purpose: what arrives is read
 * as having been there, a step away, and not as having crossed the window.
 */
export const VIEW_TRAVEL = 16
