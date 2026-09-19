import { MotionConfigContext, useReducedMotion } from 'motion/react'
import type { Easing, Transition } from 'motion/react'
import { useContext } from 'react'

/**
 * The motion personality of Hemera: a closed set of presets, and nowhere else to write a
 * spring. A lint check refuses a `stiffness`, a `damping` or a duration written anywhere but
 * this file, because a design system whose springs are scattered has no personality at all.
 *
 * Two of them, and not one, because one cannot do both jobs. The spring the prototype earned
 * is made for a panel that arrives without overshooting, and it takes its time doing it; under
 * a finger it takes so long to settle that a three per cent press is not visible at all. What
 * answers the hand has to be stiff and light, and what arrives on its own has to be soft.
 *
 * A third preset arrived with the shell, for the one thing neither of these serves: a width
 * that changes. The set is meant to stay short.
 */

/** What answers the hand: hover, press, a width following what the press changed. */
export const press: Transition = { type: 'spring', stiffness: 500, damping: 30, mass: 0.6 }

/** What puts itself in place: panels, popups, a swap of content. The prototype's own spring. */
export const arrival: Transition = { type: 'spring', stiffness: 170, damping: 26 }

/**
 * What changes size in place: the sidebar folding to its rail and opening back out (D2-03).
 *
 * The other two presets are made for a transform, where a little overshoot reads as life. A
 * dimension that overshoots reads as a mistake — the panel goes past its width and the
 * columns beside it come back to meet it — so this one sits just past critical damping and
 * arrives without ever turning round.
 */
export const morph: Transition = { type: 'spring', stiffness: 260, damping: 33, mass: 1 }

/**
 * How the active tab crosses the strip, as two edges rather than one slab (design D2-02).
 *
 * A slab that slides keeps its width the whole way and reads as a piece of chrome being moved.
 * Two edges let it stretch: the mark first opens far enough to cover both the tab it is leaving
 * and the tab it is going to, then closes onto the second — so it reads as one sheet reaching
 * across rather than as a rectangle in transit.
 *
 * `reach` is the opening, a tween because it has one job and no weight to it. `lead` is the
 * edge in the direction of travel closing first, and `trail` the one behind it closing after,
 * which is what leaves the stretch. `settle` is what takes the trailing edge off the small
 * overshoot it lands with.
 */
export const reach: Transition = { duration: 0.19, ease: [0.23, 1, 0.32, 1] }
export const lead: Transition = { type: 'spring', duration: 0.3, bounce: 0 }
export const trail: Transition = { type: 'spring', duration: 0.3, bounce: 0.2 }
export const settle: Transition = { duration: 0.16, ease: [0.23, 1, 0.32, 1] }

/** How long the mark stays open before the edges begin to close, in seconds. */
export const REACH_HANDOFF = 0.15

/** How far the trailing edge overshoots before it relaxes, in pixels. */
export const REACH_OVERSHOOT = 3

/** The same arrival, with nothing in between: what a system asking for less movement gets. */
export const instant: Transition = { duration: 0 }

/**
 * How far a press takes a control from its resting size — and a second, deeper one for a
 * control that is only as wide as it is tall.
 *
 * The same ratio does not read the same on two sizes: a wide button pulls its edges in by
 * several pixels and is unmistakable, while a square one moves by a single pixel and looks
 * like nothing happened at all. What has to match between them is the movement, not the
 * number, so the small one goes deeper.
 */
export const PRESSED = 0.93
export const PRESSED_COMPACT = 0.86
export const HOVERED = 1.02

/** How far the mark of a state travels in from under the edge, in pixels. */
export const MARK_TRAVEL = 12

/** How far the label of a folding panel slides in from, in pixels. */
export const LABEL_TRAVEL = 8

/**
 * How long the labels of a folding panel let the width go first, in the seconds motion counts
 * in. Opening only: on the way out they leave at once, because a label still sitting in a rail
 * that has already closed is the one frame that reads as a bug.
 */
export const LABEL_DELAY = 0.08

/** The durations of the theme, in the seconds motion counts in. */
export const durations = { fast: 0.16, base: 0.26, slow: 0.4 } as const

/** The curve the theme's `--ease-calm` draws, for the few transitions that are not a spring. */
export const easing: Easing = [0.25, 0.8, 0.25, 1]

/**
 * The transition to animate with, which is the preset asked for unless less movement was.
 *
 * motion's own `reducedMotion` jumps a transform to its target and keeps animating opacity and
 * colour. What reduced motion has to mean here is the end state without the journey, for every
 * property at once, so the journey is given no time instead. The tree still runs under
 * `MotionConfig reducedMotion="user"`: it is the net under any motion element that forgets
 * this hook, and the lint refuses one that does.
 *
 * Both ways of asking are honoured: the system preference, and a `MotionConfig` that says
 * `always`. `never` is not one of them, because `never` is also motion's own default: a
 * component rendered outside any `MotionConfig` reads it, and reading it as "this tree opted
 * out" is how the one guard the design system has ends up switched off by nobody.
 */
export function useTransition(preset: Transition = arrival): Transition {
  const { reducedMotion } = useContext(MotionConfigContext)
  const system = useReducedMotion()
  if (reducedMotion === 'always') return instant
  return system === true ? instant : preset
}
