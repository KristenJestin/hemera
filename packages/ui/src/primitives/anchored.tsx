/**
 * An overlay anchored to its trigger.
 *
 * The renderer has no plane order: a deferred anchored element is the only way to paint above
 * a virtual list. It also has to claim its own pointer events, or the list underneath keeps
 * taking the clicks meant for the overlay.
 */

import { motion } from '@gpuix/react'
import type { ReactNode } from 'react'

import { transition } from '#lib/motion.ts'
import { mergeStyle, withoutUndefined } from '#lib/style.ts'
import type { Style } from '#lib/style.ts'
import { overlay } from '#tokens/components.ts'
import { space } from '#tokens/primitives.ts'

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
      {/* Appearing in one frame reads as a glitch. The overlay rises into place; there is no
          exit animation to match it, because an element stops painting the frame it leaves. */}
      <motion.div
        initial={{ opacity: 0, top: overlay.entryOffset }}
        animate={{ opacity: 1, top: 0 }}
        transition={transition('fast')}
        style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}
      >
        {children}
      </motion.div>
    </anchored>
  )
}
