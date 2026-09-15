import type { Transition } from 'motion/react'

/**
 * The motion personality of the application: a soft spring that arrives without overshooting.
 * Every transition of the renderer reads it; none writes its own numbers.
 */
export const calmSpring: Transition = { type: 'spring', stiffness: 170, damping: 26 }
