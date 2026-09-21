import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'

/**
 * The composer while the turn is waiting on a person (design D17-15).
 *
 * A turn that asked for a permission is a turn that is not moving, and the composer is the one
 * place the reader is already looking. The strip says what is being waited on, and it keeps the
 * Stop: a reader who does not want to answer can end the turn from here, and the one control
 * that must never be taken away while something is running is the way to stop it.
 *
 * It is a status and not an alert: it says where the session is, it does not interrupt.
 */
const BANNER = 'flex items-center gap-2 rounded-md border border-warning bg-warning-muted px-2 py-1'

const TEXT = 'min-w-0 flex-1 text-xs text-warning-muted-foreground'

const LEAD = 'font-medium'

export interface BlockedBannerProps {
  /** What the turn is waiting on, in one sentence. */
  waiting: string
  /** Ends the turn, which is what the reader wants when they do not want to answer. */
  onStop: () => void
  /** Where the strip sits; never how it looks. */
  className?: string | undefined
}

export function BlockedBanner({ waiting, onStop, className }: BlockedBannerProps): ReactNode {
  return (
    <div role="status" className={cn(BANNER, className)}>
      <p className={TEXT}>
        <span className={LEAD}>Waiting for you</span>
        {`: ${waiting}`}
      </p>
      <Button variant="secondary" size="sm" onClick={onStop}>
        Stop
      </Button>
    </div>
  )
}
