import { cn } from 'cn'
import type { ReactNode } from 'react'

import { IconDatabase } from '../icons.ts'

/**
 * What the session has spent (design D17-14).
 *
 * Two numbers and a word, of the kind a reader checks without meaning to: how full the context
 * is, and what the turn cost. The window is always shown, because an agent that is about to run
 * out of room is a thing worth seeing coming.
 *
 * The cost is shown only when the agent reports one. Codex does not, and the honest answer to
 * "what did this cost" is then that the agent did not say — not a zero, which is a number
 * somebody would add up. The meter says which of the two it is, every time.
 */
const METER = 'flex items-center gap-1.5 text-xs text-muted-foreground'

const ICON = 'flex shrink-0 text-muted-foreground'

const NUMBERS = 'font-mono'

const SEPARATOR = 'text-muted-foreground'

const MISSING = 'text-muted-foreground italic'

/** Numbers are grouped, and the grouping is not a locale's business: a count is a count. */
const COUNT = new Intl.NumberFormat('en-GB')

export interface UsageCost {
  amount: number
  currency: string
}

export interface UsageMeterProps {
  /** How much of the context window the session has used. */
  used: number
  /** How big the context window is, as the agent reports it. */
  size: number
  /** What the turn cost, when the agent reports a cost at all. */
  cost?: UsageCost | undefined
  /** Where the meter sits; never how it looks. */
  className?: string | undefined
}

export function UsageMeter({ used, size, cost, className }: UsageMeterProps): ReactNode {
  return (
    <p className={cn(METER, className)}>
      <span aria-hidden="true" className={ICON}>
        <IconDatabase size="sm" />
      </span>
      <span className={NUMBERS}>{`${COUNT.format(used)} / ${COUNT.format(size)} tokens`}</span>
      <span aria-hidden="true" className={SEPARATOR}>
        ·
      </span>
      {cost === undefined ? (
        <span className={MISSING}>Cost not provided</span>
      ) : (
        <span className={NUMBERS}>
          {new Intl.NumberFormat('en-GB', { style: 'currency', currency: cost.currency }).format(
            cost.amount,
          )}
        </span>
      )}
    </p>
  )
}
