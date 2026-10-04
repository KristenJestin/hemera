import type { ReactNode } from 'react'

import { IconChevronRight } from '../../icons.ts'

/**
 * The head of a section of a page: its name, how many it holds, and what it offers at its end —
 * drawn above the section's frame, never inside it. One head for every section of the window:
 * the lists of Home, the stages of a Project page, the sections of a Project's settings.
 *
 * A count that calls for the user wears a dot in the warning tone before it. A section that folds
 * makes its name and count one button, a chevron at its end turning as it opens; what folds is
 * the caller's.
 */
export interface SectionHeadProps {
  title: string
  /** How many things the section holds, after its title; left out while they load. */
  count?: number | undefined
  /** Whether the count calls for the user: a dot in the warning tone before it. */
  calls?: boolean | undefined
  /** What the section offers at the end of its head: Add a repository. */
  actions?: ReactNode
  /** For a section that folds: whether it is open, and what pressing its head does. */
  fold?: { open: boolean; onToggle: () => void } | undefined
}

const HEAD = 'flex min-h-control-md min-w-0 items-center gap-3'

const TITLE = 'text-base font-semibold tracking-tight'

const COUNT = 'flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums'

const CALLS = 'size-1.5 rounded-full bg-warning'

const TOGGLE =
  'flex h-control-sm items-center gap-3 rounded-md outline-none hover:tinted focus-ring hover-motion'

const CHEVRON = 'flex shrink-0 text-muted-foreground chevron-motion aria-expanded:rotate-90'

const ACTIONS = 'ml-auto flex shrink-0 items-center gap-2'

export function SectionHead({
  title,
  count,
  calls = false,
  actions,
  fold,
}: SectionHeadProps): ReactNode {
  const words = (
    <>
      <span className={TITLE}>{title}</span>
      {count !== undefined && (
        <span className={COUNT}>
          {calls && count > 0 && <span aria-hidden="true" className={CALLS} />}
          {count}
        </span>
      )}
    </>
  )
  return (
    <div className={HEAD}>
      <h2 className="flex min-w-0 items-center gap-3">
        {fold === undefined ? (
          words
        ) : (
          <button
            type="button"
            className={TOGGLE}
            aria-expanded={fold.open}
            onClick={fold.onToggle}
          >
            {words}
            <span className={CHEVRON} aria-expanded={fold.open} aria-hidden="true">
              <IconChevronRight size="sm" />
            </span>
          </button>
        )}
      </h2>
      {actions !== undefined && <div className={ACTIONS}>{actions}</div>}
    </div>
  )
}
