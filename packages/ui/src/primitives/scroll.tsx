/**
 * The single scroll level of a panel.
 *
 * The renderer gives sibling scrollers of a non-scrolling split their own independent
 * offsets, and nesting two of them makes the wheel land on the wrong one. A panel therefore
 * declares exactly one `Scroll`, and this primitive refuses to nest.
 */

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

import { mergeStyle, withoutUndefined } from '#lib/style.ts'
import type { Style } from '#lib/style.ts'

export interface ScrollProps {
  axis?: 'vertical' | 'horizontal'
  style?: Style
  children?: ReactNode
  testId?: string
}

const InsideScroll = createContext(false)

export function Scroll({ axis = 'vertical', style, children, testId }: ScrollProps) {
  if (useContext(InsideScroll)) {
    throw new Error('Scroll cannot nest: a panel has exactly one scroll level')
  }
  const scrolling: Style =
    axis === 'vertical'
      ? { overflowY: 'scroll', overflowX: 'hidden' }
      : { overflowX: 'scroll', overflowY: 'hidden' }

  return (
    <InsideScroll.Provider value={true}>
      <div
        {...withoutUndefined({
          style: mergeStyle({ display: 'flex', flexDirection: 'column' }, scrolling, style),
          testId,
        })}
      >
        {children}
      </div>
    </InsideScroll.Provider>
  )
}
