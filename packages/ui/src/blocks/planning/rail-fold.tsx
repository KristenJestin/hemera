import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { IconChevronRight } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'

/**
 * The line the Planning page's rail is made of: one kind of thing summarised in one line that
 * unfolds to its own lines, pushing what is under it.
 */

/** A line that opens what it summarises: the whole width, its chevron turning as it opens. */
export const LINE =
  'flex min-h-control-md w-full min-w-0 items-center gap-2 px-4 py-1.5 text-left text-sm outline-none hover:tinted focus-ring hover-motion'

/** What a line says beside its words, quietly: a count, a time, a place. */
export const QUIET = 'shrink-0 text-xs text-muted-foreground tabular-nums'

const CHEVRON = 'flex shrink-0 text-muted-foreground chevron-motion data-open:rotate-90'

/** A body that grows from its line and folds back into it, pushing what is under it. */
export function Unfolding({ open, children }: { open: boolean; children: ReactNode }): ReactNode {
  const folding = useTransition(fold)
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="body"
          className="overflow-hidden"
          initial={collapse}
          animate={expand}
          exit={collapse}
          transition={folding}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * One kind of thing, summarised in one line — its glyph, its name and how many — that unfolds to
 * its own lines.
 */
export function Fold({
  glyph,
  title,
  detail,
  initiallyOpen = false,
  children,
}: {
  glyph: ReactNode
  title: string
  detail: string
  initiallyOpen?: boolean | undefined
  children: ReactNode
}): ReactNode {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <div className="flex flex-col">
      <button type="button" aria-expanded={open} className={LINE} onClick={() => setOpen(!open)}>
        <span className={CHEVRON} data-open={open ? '' : undefined}>
          <IconChevronRight size="sm" />
        </span>
        <span className="flex shrink-0 text-muted-foreground">{glyph}</span>
        <span className="shrink-0 font-medium">{title}</span>
        <span className="min-w-0 truncate text-muted-foreground">{detail}</span>
      </button>
      <Unfolding open={open}>{children}</Unfolding>
    </div>
  )
}
