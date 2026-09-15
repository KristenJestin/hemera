/**
 * A row or a column with a gap from the spacing scale.
 *
 * `div` is a block by default in the renderer, so `display: flex` is written before any flex
 * property, every time.
 */

import type { ReactNode } from 'react'

import { mergeStyle, withoutUndefined } from '#lib/style.ts'
import type { Style } from '#lib/style.ts'
import { space } from '#tokens/primitives.ts'

export type StackGap = keyof typeof space

export interface StackProps {
  direction?: 'row' | 'column'
  gap?: StackGap
  align?: 'start' | 'center' | 'end' | 'stretch'
  justify?: 'start' | 'center' | 'end' | 'between'
  /** Grows to fill the free space of its parent. */
  grow?: boolean
  style?: Style
  children?: ReactNode
  testId?: string
}

const ALIGN = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
} as const

const JUSTIFY = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
} as const

export function Stack({
  direction = 'row',
  gap = 'none',
  align = direction === 'row' ? 'center' : 'stretch',
  justify = 'start',
  grow = false,
  style,
  children,
  testId,
}: StackProps) {
  const layout: Style = {
    display: 'flex',
    flexDirection: direction,
    alignItems: ALIGN[align],
    justifyContent: JUSTIFY[justify],
    gap: space[gap],
    ...(grow ? { flexGrow: 1, minWidth: 0 } : {}),
  }
  return <div {...withoutUndefined({ style: mergeStyle(layout, style), testId })}>{children}</div>
}
