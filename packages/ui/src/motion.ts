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
 * A third preset needs an interaction neither of these serves. The set is meant to stay short.
 */

/** What answers the hand: hover, press, a width following what the press changed. */
export const press: Transition = { type: 'spring', stiffness: 500, damping: 30, mass: 0.6 }

/** What puts itself in place: panels, popups, a swap of content. The prototype's own spring. */
export const arrival: Transition = { type: 'spring', stiffness: 170, damping: 26 }

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
 * Both ways of asking are honoured: the system preference, and the `MotionConfig` a story or a
 * screen sets around the component.
 */
export function useTransition(preset: Transition = arrival): Transition {
  const { reducedMotion } = useContext(MotionConfigContext)
  const system = useReducedMotion()
  if (reducedMotion === 'always') return instant
  if (reducedMotion === 'never') return preset
  return system === true ? instant : preset
}
