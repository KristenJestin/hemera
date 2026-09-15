import { MotionConfigContext, useReducedMotion } from 'motion/react'
import type { Easing, Transition } from 'motion/react'
import { useContext } from 'react'

/**
 * The motion personality of Hemera, written once and read by everything that moves.
 *
 * A soft spring that arrives without overshooting: it is the verdict the prototype earned,
 * and the name says what it is rather than how it feels. No component writes these numbers
 * again — a lint check refuses a `stiffness`, a `damping` or a duration written anywhere else,
 * because a design system with two springs has none.
 */
export const spring: Transition = { type: 'spring', stiffness: 170, damping: 26 }

/** The same arrival, with nothing in between: what a system asking for less movement gets. */
export const instant: Transition = { duration: 0 }

/** The durations of the theme, in the seconds motion counts in. */
export const durations = { fast: 0.16, base: 0.26, slow: 0.4 } as const

/** The curve the theme's `--ease-calm` draws, for the few transitions that are not a spring. */
export const easing: Easing = [0.25, 0.8, 0.25, 1]

/**
 * The transition to animate with, which is the spring unless less movement was asked for.
 *
 * motion's own `reducedMotion` leaves a transform where it was rather than putting it where it
 * belongs, so a panel that should have arrived stays offset for good. What reduced motion has
 * to mean is the end state without the journey, so the journey is given no time instead.
 *
 * Both ways of asking are honoured: the system preference, and the `MotionConfig` a story or a
 * screen sets around the component.
 */
export function useTransition(): Transition {
  const { reducedMotion } = useContext(MotionConfigContext)
  const system = useReducedMotion()
  if (reducedMotion === 'always') return instant
  if (reducedMotion === 'never') return spring
  return system === true ? instant : spring
}
