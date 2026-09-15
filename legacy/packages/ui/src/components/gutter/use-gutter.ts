/**
 * Behaviour of a resizable gutter.
 *
 * The caller owns the size. The gutter clamps what it reports between the bounds it is given,
 * moves by a step at the keyboard, and returns to the default on a double activation.
 */

import type { EventPayload } from '@gpuix/react'
import { useCallback } from 'react'

export interface UseGutterOptions {
  size: number
  onSizeChange: (size: number) => void
  min: number
  max: number
  /** Size a double activation returns to. */
  defaultSize: number
  /** Pixels one keyboard step moves. */
  step?: number
  orientation?: 'vertical' | 'horizontal'
}

export interface GutterBehaviour {
  orientation: 'vertical' | 'horizontal'
  /** The size clamped between the bounds. */
  clamp: (size: number) => number
  /** Moves by one step; returns false when the key asks for no move. */
  onKeyDown: (event: EventPayload) => boolean
  /** Returns to the default size. */
  reset: () => void
  drag: (delta: number) => void
}

export const DEFAULT_GUTTER_STEP = 8

/** A stored size outside its bounds falls back to the default rather than failing. */
export function sizeWithinBounds(
  size: number | null | undefined,
  bounds: { min: number; max: number; defaultSize: number },
): number {
  if (typeof size !== 'number' || !Number.isFinite(size)) return bounds.defaultSize
  if (size < bounds.min || size > bounds.max) return bounds.defaultSize
  return size
}

export function useGutter({
  size,
  onSizeChange,
  min,
  max,
  defaultSize,
  step = DEFAULT_GUTTER_STEP,
  orientation = 'vertical',
}: UseGutterOptions): GutterBehaviour {
  const clamp = useCallback((next: number) => Math.min(max, Math.max(min, next)), [min, max])

  return {
    orientation,
    clamp,
    reset: useCallback(() => onSizeChange(defaultSize), [defaultSize, onSizeChange]),
    drag: useCallback(
      (delta: number) => onSizeChange(clamp(size + delta)),
      [clamp, size, onSizeChange],
    ),
    onKeyDown: useCallback(
      (event: EventPayload) => {
        const grow = orientation === 'vertical' ? 'right' : 'down'
        const shrink = orientation === 'vertical' ? 'left' : 'up'
        if (event.key === grow) {
          onSizeChange(clamp(size + step))
          return true
        }
        if (event.key === shrink) {
          onSizeChange(clamp(size - step))
          return true
        }
        return false
      },
      [orientation, clamp, size, step, onSizeChange],
    ),
  }
}
