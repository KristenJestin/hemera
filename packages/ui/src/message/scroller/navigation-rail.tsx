import { motion } from 'motion/react'
import type { ReactNode } from 'react'

import { IconChevronDown } from '../../icons.ts'
import { HOVERED, PRESSED, press, useTransition } from '../../motion.ts'

/**
 * The rail down the side of a thread, and the pill that brings the reader back (D4b-08).
 *
 * One tick per message and a taller one per day, so the shape of a long conversation is
 * readable at a glance: where the bursts are, where the nights are, how far down the one being
 * read sits. It is decoration over content that is already on the page — the thread itself is
 * what a screen reader reads — so the rail is hidden from the accessibility tree rather than
 * repeated into it.
 *
 * Nothing on it animates. A tick says where the reader is by being wider and by taking the
 * accent, and a width is a layout property: the design system animates transforms and opacity
 * and nothing else, and a rail whose every tick eased between two widths on every scroll
 * event would be the one place that rule bought nothing.
 */
const RAIL = 'sticky top-0 flex w-3 shrink-0 flex-col items-center gap-1.5 self-start py-1.5'

/** A tick is a message or the day a run of them started on. */
export interface NavigationTick {
  /** What tells this tick from the next one; the key of what it stands for. */
  key: string
  kind: 'message' | 'day'
}

const DAY = 'h-1.5 w-0.5 rounded-full bg-muted-foreground'

/** How a message tick is drawn: as it is, beside the one being read, and as the one read. */
const MESSAGE = {
  far: 'h-0.5 w-1.5 rounded-full bg-border',
  near: 'h-0.5 w-2 rounded-full bg-border',
  here: 'h-0.5 w-3 rounded-full bg-primary',
} as const

export interface NavigationRailProps {
  ticks: readonly NavigationTick[]
  /** The key of the message being read, which is the one tick the rail marks. */
  activeKey?: string | undefined
}

/** How far this tick is from the one being read, in ticks, and so how it is drawn. */
function howFar(index: number, active: number): keyof typeof MESSAGE {
  if (active === -1) return 'far'
  const distance = Math.abs(index - active)
  if (distance === 0) return 'here'
  return distance === 1 ? 'near' : 'far'
}

export function NavigationRail({ ticks, activeKey }: NavigationRailProps): ReactNode {
  const active = ticks.findIndex((tick) => tick.key === activeKey)
  return (
    <div aria-hidden="true" className={RAIL}>
      {ticks.map((tick, index) =>
        tick.kind === 'day' ? (
          <span key={tick.key} className={DAY} />
        ) : (
          <span key={tick.key} className={MESSAGE[howFar(index, active)]} />
        ),
      )}
    </div>
  )
}

/**
 * The pill is round and raised, and the button of the catalogue is neither.
 *
 * It floats over the thread rather than sitting in a row of controls, which is the one thing
 * asking for a shape of its own: a rectangle laid over text reads as a panel that has come
 * loose, and the shadow is what says it is above the page rather than in it. A variant of
 * `Button` for the one place this shape exists would be a variant nobody else could use, so it
 * is drawn here, with the press of the design system and the theme's own tokens.
 */
const PILL =
  'inline-flex h-control-sm items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm text-foreground shadow-lg outline-none hover:bg-muted focus-ring'

export interface LatestPillProps {
  onClick: () => void
}

/**
 * The way back to the live edge, shown only while the reader has left it.
 *
 * Shown and not always there: a button that says "go to the bottom" while you are at the
 * bottom is a button that has to be read before it can be ignored. The scroller decides when
 * it exists; this only says what it looks like and what pressing it does.
 */
export function LatestPill({ onClick }: LatestPillProps): ReactNode {
  const transition = useTransition(press)
  return (
    <motion.button
      type="button"
      className={PILL}
      whileHover={{ scale: HOVERED }}
      whileTap={{ scale: PRESSED }}
      transition={transition}
      onClick={onClick}
    >
      <IconChevronDown size="sm" />
      Latest
    </motion.button>
  )
}
