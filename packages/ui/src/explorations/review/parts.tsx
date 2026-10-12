import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { IconChevronRight } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'

/**
 * The pieces the Review page shares with the rails of Planning and Building: a line that unfolds
 * to what it summarises, pushing what is under it. Drawn here while the Building exploration (#149)
 * holds its own copy; the build tickets make one part of the design system from both.
 */

/** A line that opens what it summarises: the whole width, its chevron turning as it opens. */
export const LINE =
  'flex min-h-control-md w-full min-w-0 items-center gap-2 px-4 py-1.5 text-left text-sm outline-none hover:tinted focus-ring hover-motion'

/** A line that says one thing and leads nowhere. */
export const ROW = 'flex min-h-control-md min-w-0 items-center gap-2 px-4 py-1.5 text-sm'

export const CHEVRON = 'flex shrink-0 text-muted-foreground chevron-motion data-open:rotate-90'

export const QUIET = 'shrink-0 text-xs text-muted-foreground tabular-nums'

export const ID = 'shrink-0 font-mono text-xs text-muted-foreground'

export const MONO = 'min-w-0 truncate font-mono text-xs text-muted-foreground'

export const CODE =
  'rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap break-words'

/** Prose of the agent or the user, opened: at its reading measure, wrapping. */
export const PROSE = 'max-w-measure text-sm break-words whitespace-pre-line'

/** The warning dot of a line that calls for the user. */
export function Calls(): ReactNode {
  return <span aria-hidden="true" className="ml-auto size-1.5 shrink-0 rounded-full bg-warning" />
}

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

/** The chevron of a line, turning as it opens. */
export function Chevron({ open }: { open: boolean }): ReactNode {
  return (
    <span className={CHEVRON} data-open={open ? '' : undefined}>
      <IconChevronRight size="sm" />
    </span>
  )
}

/**
 * One kind of thing summarised in one line — its glyph, its name, what it holds — that unfolds to
 * its own lines. A line that calls for the user wears the warning dot.
 */
export function Fold({
  glyph,
  title,
  detail,
  calls = false,
  initiallyOpen = false,
  children,
}: {
  glyph: ReactNode
  title: string
  detail: string
  calls?: boolean | undefined
  initiallyOpen?: boolean | undefined
  children: ReactNode
}): ReactNode {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <div className="flex flex-col">
      <button type="button" aria-expanded={open} className={LINE} onClick={() => setOpen(!open)}>
        <Chevron open={open} />
        <span className="flex shrink-0 text-muted-foreground">{glyph}</span>
        <span className="shrink-0 font-medium">{title}</span>
        <span className="min-w-0 truncate text-muted-foreground">{detail}</span>
        {calls && <Calls />}
      </button>
      <Unfolding open={open}>{children}</Unfolding>
    </div>
  )
}

export const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`
