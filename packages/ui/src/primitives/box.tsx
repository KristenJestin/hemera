/**
 * A styled box. The layout unit every other primitive builds on: it paints and positions,
 * and carries nothing else.
 */

import type { EventPayload } from '@gpuix/react'
import type { ReactNode } from 'react'

import { withoutUndefined } from '../lib/style.ts'
import type { Style } from '../lib/style.ts'

export interface BoxProps {
  style?: Style
  children?: ReactNode
  testId?: string
  onClick?: (event: EventPayload) => void
  onMouseDown?: (event: EventPayload) => void
  onMouseUp?: (event: EventPayload) => void
  onMouseMove?: (event: EventPayload) => void
  onMouseEnter?: (event: EventPayload) => void
  onMouseLeave?: (event: EventPayload) => void
}

export function Box({ style, children, testId, ...events }: BoxProps) {
  return <div {...withoutUndefined({ style, testId, ...events })}>{children}</div>
}
