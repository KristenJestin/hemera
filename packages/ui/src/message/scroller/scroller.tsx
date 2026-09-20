import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { Children, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { MARK_TRAVEL, arrival, useTransition } from '../../motion.ts'
import { atLiveEdge } from './live-edge.ts'
import { LatestPill } from './navigation-rail.tsx'

/**
 * The thread's own scrolling: it follows the live edge, and lets go when the reader does
 * (design D4b-08).
 *
 * The one behaviour worth a component. A thread that always jumps to the bottom takes the page
 * away from whoever is reading three days back; a thread that never does hides the message
 * that just arrived under the fold. So it follows while the reader is at the edge — `atLiveEdge`
 * says what "at" means and says it in one place — stops the moment they scroll up, and takes it
 * up again as soon as they come back down.
 *
 * The pill is the way back, and it exists only while there is somewhere to come back from. It
 * rises with the arrival of the design system and leaves the same way; nothing else here moves,
 * and the scrolling itself is the browser's own.
 */
const WRAP = 'relative flex min-h-0 flex-1 gap-2'

/** The scrolling element, and the only one on this surface: the page above it does not move. */
const VIEWPORT = 'min-w-0 flex-1 overflow-y-auto rounded-lg outline-none focus-ring'

const THREAD = 'flex flex-col gap-5 py-2'

const PILL = 'absolute inset-x-0 bottom-2 flex justify-center'

/** What following the live edge does while the reader is somewhere else in the thread. */
const NOTHING = (): void => {}

export interface MessageScrollerProps {
  /** What the thread is called to a screen reader. */
  label: string
  /** The rail drawn down its side, when the page has one to draw. */
  rail?: ReactNode
  /** Where the scroller sits; never how it looks. */
  className?: string | undefined
  children: ReactNode
}

export function MessageScroller({
  label,
  rail,
  className,
  children,
}: MessageScrollerProps): ReactNode {
  const viewport = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(true)
  const transition = useTransition(arrival)

  const toLiveEdge = useCallback(() => {
    const element = viewport.current
    if (element === null) return
    element.scrollTop = element.scrollHeight
    setStuck(true)
  }, [])

  /**
   * Follows what has just arrived, as long as the reader is still at the edge.
   *
   * Counted rather than watched: what changes when a message lands is how many things are in
   * the thread, and the array holding them is a new array on every render. A scroll asked for
   * on every render would be a scroll fighting the wheel. And the count is the only thing it
   * waits on: the reader leaving the edge is not a reason to move the page, and only something
   * arriving in the thread is.
   */
  const count = Children.count(children)
  const follow = useRef(toLiveEdge)
  follow.current = stuck ? toLiveEdge : NOTHING
  useEffect(() => {
    follow.current()
  }, [count])

  return (
    <div className={cn(WRAP, className)}>
      <div
        ref={viewport}
        role="log"
        aria-label={label}
        // A region that scrolls has to be reachable by the keyboard, or the whole thread is
        // readable with a mouse and with nothing else.
        tabIndex={0}
        className={VIEWPORT}
        onScroll={(event) => setStuck(atLiveEdge(event.currentTarget))}
      >
        <div className={THREAD}>{children}</div>
      </div>
      {rail}
      <AnimatePresence>
        {!stuck && (
          <motion.div
            key="latest"
            className={PILL}
            initial={{ opacity: 0, y: MARK_TRAVEL }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: MARK_TRAVEL }}
            transition={transition}
          >
            <LatestPill onClick={toLiveEdge} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
