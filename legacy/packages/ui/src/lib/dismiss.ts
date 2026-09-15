/**
 * What tells an anchored overlay that the ground moved under it.
 *
 * An anchored element is placed by the renderer against its trigger, and snapped back inside
 * the window when the trigger leaves it: a menu left open while the panel scrolls stays stuck
 * to an edge, pointing at nothing. Nothing in the renderer reports that, so the scroller says
 * it, and whatever is anchored closes.
 *
 * A subscription, not a prop: the scroller and the overlay are never neighbours in the tree,
 * and a panel knows nothing of what a component three levels down chose to open.
 */

import { createContext, useContext, useEffect, useMemo, useRef } from 'react'

export interface DismissChannel {
  /** Called by a surface that moved. */
  dismiss: () => void
  /** Called by an overlay that wants to know. Returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void
}

/** A channel nobody listens to: an overlay outside any scroller has nothing to hear. */
const SILENT: DismissChannel = { dismiss: () => {}, subscribe: () => () => {} }

const Channel = createContext<DismissChannel>(SILENT)

export const DismissProvider = Channel.Provider

/** Creates the channel a surface publishes on. */
export function useDismissChannel(): DismissChannel {
  const listeners = useRef(new Set<() => void>())
  return useMemo(
    () => ({
      dismiss: () => {
        for (const listener of [...listeners.current]) listener()
      },
      subscribe: (listener: () => void) => {
        listeners.current.add(listener)
        return () => {
          listeners.current.delete(listener)
        }
      },
    }),
    [],
  )
}

/** The channel to publish on; silent outside any surface that publishes. */
export function useDismissPublisher(): () => void {
  return useContext(Channel).dismiss
}

/**
 * Closes `close` when the surface under the overlay moves.
 *
 * Only while `open`: an overlay that is not painted has nothing to close, and subscribing
 * anyway would make every closed menu of a page wake up on each scroll.
 */
export function useDismissOnScroll(open: boolean, close: () => void): void {
  const channel = useContext(Channel)
  const latest = useRef(close)
  latest.current = close

  useEffect(() => {
    if (!open) return undefined
    return channel.subscribe(() => latest.current())
  }, [open, channel])
}
