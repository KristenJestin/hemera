import { cn } from 'cn'
import type { ReactNode } from 'react'

import { IconDatabase } from '../icons.ts'

/**
 * What the session has spent (design D17-14).
 *
 * One figure for the window — how much of it is used, out of how much there is — and the cost
 * apart, because the two answer different questions: one says how much room is left before the
 * agent starts forgetting, the other what the turn cost. The window is always shown, because an
 * agent about to run out of room is a thing worth seeing coming.
 *
 * The cost is shown only when the agent reports one. Codex does not, and the honest answer to
 * "what did this cost" is then that the agent did not say — not a zero, which is a number
 * somebody would add up. The meter says which of the two it is, every time.
 *
 * The window is not always known either: an agent announces one when it announces one, and no
 * agent on this machine announces any — neither at `initialize` nor among the models it
 * publishes, `usage_update` being the protocol's only word on the subject (D5-20). What is left
 * then is what is in use and no denominator, and the meter says the window was not provided
 * rather than dividing by a size Hemera made up.
 *
 * The figure is compact — `12.4k / 200k` — because it sits in a row of controls and is read at a
 * glance, and the counts in full are the meter's own name, so a screen reader gets the number a
 * reader could add up rather than the abbreviation.
 */
const METER = 'flex items-center gap-1.5 text-xs text-muted-foreground'

const ICON = 'flex shrink-0 text-muted-foreground'

const FIGURE = 'font-mono tabular-nums'

const SEPARATOR = 'text-muted-foreground'

const MISSING = 'text-muted-foreground italic'

/** Short, as the eye reads it: `12.4k`, `200k`, and `0` rather than a rounded nothing. */
const COMPACT = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 })

/** In full, and only in what is spoken: grouping is not a locale's business, a count is a count. */
const EXACT = new Intl.NumberFormat('en-GB')

export interface UsageCost {
  amount: number
  currency: string
}

export interface UsageMeterProps {
  /** How much of the context window the session has used. */
  used: number
  /** How big the context window is, as the agent announced it — or null for none. */
  size: number | null
  /** What the turn cost, when the agent reports a cost at all. */
  cost?: UsageCost | undefined
  /** Where the meter sits; never how it looks. */
  className?: string | undefined
}

export function UsageMeter({ used, size, cost, className }: UsageMeterProps): ReactNode {
  const spent =
    cost === undefined
      ? undefined
      : new Intl.NumberFormat('en-GB', { style: 'currency', currency: cost.currency }).format(
          cost.amount,
        )
  const tokens =
    size === null
      ? `${EXACT.format(used)} tokens used, window not provided`
      : `${EXACT.format(used)} of ${EXACT.format(size)} tokens used`
  return (
    <p
      className={cn(METER, className)}
      aria-label={`${tokens}, ${spent === undefined ? 'cost not provided' : `${spent} spent`}`}
    >
      <span aria-hidden="true" className={ICON}>
        <IconDatabase size="sm" />
      </span>
      {size === null ? (
        // No denominator to divide by, so the half that is missing says so rather than the
        // figure being drawn against a size Hemera picked (D5-20).
        <>
          <span className={FIGURE}>{COMPACT.format(used)}</span>
          <span aria-hidden="true" className={SEPARATOR}>
            /
          </span>
          <span className={MISSING}>window not provided</span>
        </>
      ) : (
        <span className={FIGURE}>{`${COMPACT.format(used)} / ${COMPACT.format(size)}`}</span>
      )}
      <span aria-hidden="true" className={SEPARATOR}>
        ·
      </span>
      {spent === undefined ? (
        <span className={MISSING}>cost not provided</span>
      ) : (
        <span className={FIGURE}>{spent}</span>
      )}
    </p>
  )
}
