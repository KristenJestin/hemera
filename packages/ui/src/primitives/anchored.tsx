/**
 * An overlay anchored to its trigger.
 *
 * The renderer has no plane order: a deferred anchored element is the only way to paint above
 * a virtual list. It also has to claim its own pointer events, or the list underneath keeps
 * taking the clicks meant for the overlay.
 */

import type { ReactNode } from 'react'

import { mergeStyle, withoutUndefined } from '../lib/style.ts'
import type { Style } from '../lib/style.ts'
import { space } from '../tokens/primitives.ts'

export interface AnchoredProps {
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  /** Distance from the trigger, from the spacing scale. */
  gap?: keyof typeof space
  style?: Style
  children?: ReactNode
  testId?: string
}

export function Anchored({
  side = 'bottom',
  align = 'start',
  gap = 'xs',
  style,
  children,
  testId,
}: AnchoredProps) {
  return (
    <anchored
      side={side}
      align={align}
      gap={space[gap]}
      // Painted above a virtual list, and taking its own clicks.
      deferred
      occlude
      {...withoutUndefined({
        style: mergeStyle(
          { display: 'flex', flexDirection: 'column', pointerEvents: 'auto' },
          style,
        ),
        testId,
      })}
    >
      {children}
    </anchored>
  )
}
