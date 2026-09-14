/**
 * Motion the renderer can actually paint.
 *
 * Only opacity and corner radius animate freely. A dimension or an offset animates only
 * outside the flow or inside a fixed box, and there is no spring, no colour animation, no
 * transform and no exit animation: an element stops painting the frame it is removed.
 */

import { duration } from '../tokens/primitives.ts'

export type MotionSpeed = keyof typeof duration

/** Properties the renderer animates wherever the element sits. */
export const FREE_TARGETS = ['opacity', 'borderRadius'] as const

/** Properties the renderer animates only out of the flow or in a fixed box. */
export const CONSTRAINED_TARGETS = ['width', 'height', 'top', 'right', 'bottom', 'left'] as const

export type MotionTarget = (typeof FREE_TARGETS)[number] | (typeof CONSTRAINED_TARGETS)[number]

export interface MotionContext {
  /** True when the element is positioned or sits in a box of fixed size. */
  outOfFlow: boolean
}

/** Whether animating `target` is allowed where the element sits. */
export function canAnimate(target: MotionTarget, context: MotionContext): boolean {
  if ((FREE_TARGETS as readonly string[]).includes(target)) return true
  return context.outOfFlow
}

export interface Transition {
  duration: number
  ease: 'linear' | 'easeOut'
}

/** A transition of the closed duration scale. */
export function transition(speed: MotionSpeed, ease: Transition['ease'] = 'easeOut'): Transition {
  return { duration: duration[speed], ease }
}
