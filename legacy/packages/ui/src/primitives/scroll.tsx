/**
 * The single scroll level of a panel.
 *
 * The renderer gives sibling scrollers of a non-scrolling split their own independent
 * offsets, and nesting two of them makes the wheel land on the wrong one. A panel therefore
 * declares exactly one `Scroll`, and this primitive refuses to nest.
 */

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

import { DismissProvider, useDismissChannel } from '#lib/dismiss.ts'
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
  const nested = useContext(InsideScroll)
  const dismissal = useDismissChannel()
  if (nested) {
    throw new Error('Scroll cannot nest: a panel has exactly one scroll level')
  }
  const scrolling: Style =
    axis === 'vertical'
      ? { overflowY: 'scroll', overflowX: 'hidden' }
      : { overflowX: 'scroll', overflowY: 'hidden' }

  return (
    <InsideScroll.Provider value={true}>
      <DismissProvider value={dismissal}>
        <div
          // An anchored overlay is placed against a trigger that just moved: it is told, and
          // closes, rather than staying snapped to an edge of the window.
          onScroll={dismissal.dismiss}
          {...withoutUndefined({
            style: mergeStyle({ display: 'flex', flexDirection: 'column' }, scrolling, style),
            testId,
          })}
        >
          {children}
        </div>
      </DismissProvider>
    </InsideScroll.Provider>
  )
}
