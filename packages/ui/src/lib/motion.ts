/**
 * Motion the renderer can actually paint, and the curves the product moves on.
 *
 * Only opacity and corner radius animate wherever the element sits. A dimension or an offset
 * animates out of the flow or in a fixed box, there is no colour animation, and nothing
 * scales: a transform exists for a `<svg>` sprite and nowhere else.
 *
 * What the renderer does give is a real cubic bézier, and it only bounds the `x` of the
 * control points — a curve may overshoot and settle back. That is where the softness comes
 * from: nothing here is linear, and an element arriving and an element leaving never travel
 * at the same speed.
 */

import { duration } from '#tokens/primitives.ts'

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

/** A cubic bézier, as the renderer takes it: `[x1, y1, x2, y2]`. */
export type Curve = [number, number, number, number]

/**
 * The closed set of curves the product moves on.
 *
 * `enter` decelerates hard and lands without a bounce, which is what makes something feel
 * placed rather than dropped. `settle` overshoots by a hair and comes back, for what should
 * feel answered — a press, a toggle. `exit` accelerates away: leaving is not entering
 * played backwards, it is faster and it starts immediately.
 */
export const CURVES = {
  enter: [0.16, 1, 0.3, 1],
  settle: [0.34, 1.35, 0.64, 1],
  exit: [0.4, 0, 1, 1],
  /** Two points moving together: a panel resizing, a value sliding. */
  move: [0.4, 0, 0.2, 1],
} as const satisfies Record<string, Curve>

export type CurveName = keyof typeof CURVES

export interface Transition {
  duration: number
  ease: Curve
  delay?: number
}

/** A transition of the closed duration scale, on one of the closed curves. */
export function transition(
  speed: MotionSpeed,
  curve: CurveName = 'enter',
  delay?: number,
): Transition {
  return {
    duration: duration[speed],
    ease: [...CURVES[curve]] as Curve,
    ...(delay === undefined ? {} : { delay }),
  }
}
