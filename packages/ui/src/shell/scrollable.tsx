import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { IconButton } from '../components/button/button.tsx'
import { IconChevronLeft, IconChevronRight } from '../icons.ts'
import { arrival, useTransition } from '../motion.ts'

/**
 * The strip of Projects, and what says where it continues (design D2-02).
 *
 * The tabs run off the end of a narrow window, and the bar hides its scrollbar: one drawn
 * through a title bar is more chrome than title bar. What says it instead is an edge — the
 * bar's own colour fading sideways into nothing over the tab that is cut off, with an arrow in
 * it that moves the strip by most of what is on screen. There is one at each end, and each is
 * there only when there is something that way to reach.
 *
 * What it reads to know that is the strip's own scroll position, which is not a size taken off
 * any text: the width check has nothing to say about it, and there is nothing to lay out.
 */

/** How much of the visible strip one press of an arrow moves, as a share of what is on screen. */
const PAGE = 0.8

const STRIP =
  'scroll-quiet flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden'

const EDGE =
  'pointer-events-none absolute inset-y-0 flex w-10 items-center from-background to-transparent'

const PLACE = {
  start: 'left-0 justify-start bg-linear-to-r',
  end: 'right-0 justify-end bg-linear-to-l',
} as const

const MARKS = {
  start: <IconChevronLeft size="sm" />,
  end: <IconChevronRight size="sm" />,
} as const

const NAMES = { start: 'Scroll left', end: 'Scroll right' } as const

export interface ScrollableProps {
  /** What the strip is called, since a strip of Projects is a navigation. */
  label: string
  /** Where the strip sits; never how it looks. */
  className?: string | undefined
  children: ReactNode
}

export function Scrollable({ label, className, children }: ScrollableProps): ReactNode {
  const strip = useRef<HTMLElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  const look = useCallback(() => {
    const node = strip.current
    if (node === null) return
    const start = node.scrollLeft > 1
    const end = node.scrollLeft + node.clientWidth < node.scrollWidth - 1
    // The same answer is the same object: a fresh one would be a new state on every look, and
    // the look runs after every render — which is a render loop and not a scroll indicator.
    setEdges((was) => (was.start === start && was.end === end ? was : { start, end }))
  }, [])

  useEffect(() => {
    const node = strip.current
    if (node === null) return
    look()
    const watch = new ResizeObserver(look)
    watch.observe(node)
    for (const child of node.children) watch.observe(child)
    return () => {
      watch.disconnect()
    }
  })

  const move = (way: number): void => {
    const node = strip.current
    if (node === null) return
    node.scrollBy({ left: way * PAGE * node.clientWidth, behavior: 'smooth' })
  }

  return (
    <div className={cn('relative flex min-w-0', className)}>
      <nav ref={strip} onScroll={look} aria-label={label} className={STRIP}>
        {children}
      </nav>
      <Edge end="start" shown={edges.start} onMove={() => move(-1)} />
      <Edge end="end" shown={edges.end} onMove={() => move(1)} />
    </div>
  )
}

/** One end of the strip, when there is a Project past it. */
function Edge({
  end,
  shown,
  onMove,
}: {
  end: 'start' | 'end'
  shown: boolean
  onMove: () => void
}): ReactNode {
  const transition = useTransition(arrival)
  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.div
          className={cn(EDGE, PLACE[end])}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
        >
          <IconButton
            variant="ghost"
            size="sm"
            className="no-drag pointer-events-auto border-0"
            icon={MARKS[end]}
            aria-label={NAMES[end]}
            onClick={onMove}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
