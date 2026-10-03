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
