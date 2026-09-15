import type { Easing, Transition } from 'motion/react'

/**
 * The motion personality of Hemera, written once and read by everything that moves.
 *
 * A soft spring that arrives without overshooting: it is the verdict the prototype earned,
 * and the name says what it is rather than how it feels. No component writes these numbers
 * again — a lint check refuses a `stiffness`, a `damping` or a duration written anywhere else,
 * because a design system with two springs has none.
 */
export const spring: Transition = { type: 'spring', stiffness: 170, damping: 26 }

/** The durations of the theme, in the seconds motion counts in. */
export const durations = { fast: 0.16, base: 0.26, slow: 0.4 } as const

/** The curve the theme's `--ease-calm` draws, for the few transitions that are not a spring. */
export const easing: Easing = [0.25, 0.8, 0.25, 1]
