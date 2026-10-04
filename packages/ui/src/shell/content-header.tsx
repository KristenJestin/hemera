import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { IconButton } from '../components/button/button.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import {
  IconChevronRight,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
} from '../icons.ts'
import { arrival, useTransition } from '../motion.ts'

/**
 * The line across the top of the sheet: the sidebar's fold, where you are, and what the page
 * offers at its end.
 *
 * Where you are is one breadcrumb for the whole window — `Acme › ACME-12 › Review · round 1 ›
 * Spec` — the Project, the mission, its stage, and the views opened over it when the mission
 * navigates as a stack. Every crumb but the last goes back to what it names; the last is where
 * you are. A crumb arriving or leaving does so by its own width, pushing what stands after it,
 * so the trail grows and shrinks rather than redrawing.
 *
 * The line is the window's drag zone, as is the sidebar's head beside it: a frameless window
 * is moved by its top edge, and the two heads are that edge. The system's own controls are drawn
 * over the end of the line by the window, which leaves them their room.
 */
const HEADER =
  'flex h-titlebar shrink-0 items-center gap-1 border-b border-border pr-2 pl-2 drag-zone'

const CRUMBS = 'flex min-w-0 flex-1 items-center gap-0.5 no-drag'

const CRUMB =
  'flex h-control-sm min-w-0 items-center gap-1.5 rounded-md px-1.5 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-ring hover-motion'

const HERE =
  'flex h-control-sm min-w-0 items-center gap-1.5 px-1.5 text-sm font-medium text-foreground'

const SEPARATOR = 'flex shrink-0 text-muted-foreground'

/** A crumb arriving and leaving by its own width, pushing what stands after it. */
const SLOT = 'flex shrink-0 items-center overflow-hidden'

const SHOWN = { width: 'auto', filter: 'opacity(1)' } as const

const HIDDEN = { width: 0, filter: 'opacity(0)' } as const

const ACTIONS = 'ml-auto flex shrink-0 items-center gap-1 no-drag'

/** The room the window's controls take at the end, and nothing drawn in it. */
const CONTROLS_ROOM = 'flex h-full w-window-controls shrink-0 items-center justify-end'

export interface Crumb {
  id: string
  label: string
  /** Whether the label is a key, drawn in the mono face. */
  mono?: boolean | undefined
  icon?: ReactNode
  /** Where the crumb goes back to; the last crumb has none. */
  onPress?: (() => void) | undefined
}

export interface ContentHeaderProps {
  folded: boolean
  onFold: (folded: boolean) => void
  crumbs: readonly Crumb[]
  /** What the page offers, at the end of the line. */
  actions?: ReactNode
  /** What stands in for the system's controls, in a catalogue where the window draws none. */
  controls?: ReactNode
}

export function ContentHeader({
  folded,
  onFold,
  crumbs,
  actions,
  controls,
}: ContentHeaderProps): ReactNode {
  const arriving = useTransition(arrival)
  const last = crumbs.at(-1)
  return (
    <header className={HEADER}>
      <span className="flex no-drag">
        <Tooltip
          label={folded ? 'Open the sidebar' : 'Fold the sidebar'}
          keys="Ctrl+B"
          side="bottom"
        >
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={folded ? 'Open the sidebar' : 'Fold the sidebar'}
            aria-pressed={folded}
            icon={
              folded ? (
                <IconLayoutSidebarLeftExpand size="md" />
              ) : (
                <IconLayoutSidebarLeftCollapse size="md" />
              )
            }
            onClick={() => onFold(!folded)}
          />
        </Tooltip>
      </span>
      <nav aria-label="Where you are" className={CRUMBS}>
        <AnimatePresence initial={false}>
          {crumbs.map((crumb, index) => (
            <motion.span
              key={crumb.id}
              className={SLOT}
              initial={HIDDEN}
              animate={SHOWN}
              exit={HIDDEN}
              transition={arriving}
            >
              {index > 0 && (
                <span className={SEPARATOR} aria-hidden="true">
                  <IconChevronRight size="sm" />
                </span>
              )}
              {crumb === last || crumb.onPress === undefined ? (
                <span className={HERE} aria-current={crumb === last ? 'page' : undefined}>
                  {crumb.icon}
                  <span className={cn('truncate', crumb.mono === true && 'font-mono')}>
                    {crumb.label}
                  </span>
                </span>
              ) : (
                <button type="button" className={CRUMB} onClick={crumb.onPress}>
                  {crumb.icon}
                  <span className={cn('truncate', crumb.mono === true && 'font-mono')}>
                    {crumb.label}
                  </span>
                </button>
              )}
            </motion.span>
          ))}
        </AnimatePresence>
      </nav>
      {actions !== undefined && <div className={ACTIONS}>{actions}</div>}
      <div className={cn(CONTROLS_ROOM, actions === undefined && 'ml-auto')}>{controls}</div>
    </header>
  )
}
