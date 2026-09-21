import { cn } from 'cn'
import type { ReactNode } from 'react'

import { IconPlayerStop } from '../icons.ts'

/**
 * The line a turn leaves when it was stopped (design D17-13).
 *
 * Stopping is not an error and not an ending: the agent was interrupted between two calls, and
 * what it had already done is still in the thread above. So the line says who stopped it and
 * when, and it says what the turn was doing at that moment — a session where a stopped turn is a
 * blank is a session where the reader cannot tell "it finished" from "I cut it off".
 *
 * Nothing is resumed from here. Taking a stopped turn up again is a new turn with a new sentence,
 * and a client that replayed the old one on its own would be an agent acting on a request the
 * reader had already taken back.
 */
const LINE = 'flex items-center gap-1.5'

const MARK = 'flex shrink-0 text-muted-foreground'

const TEXT = 'text-sm text-muted-foreground'

const AT = 'text-xs text-muted-foreground'

export interface StoppedTurnProps {
  /** What the turn was doing when it stopped, in one line. */
  doing?: string | undefined
  /** When it stopped, already written for the platform. */
  at: string
  /** Whether the reader is the one who stopped it, which is the usual case. */
  byTheReader?: boolean | undefined
  /** Where the line sits; never how it looks. */
  className?: string | undefined
}

export function StoppedTurn({
  doing,
  at,
  byTheReader = true,
  className,
}: StoppedTurnProps): ReactNode {
  const who = byTheReader ? 'Stopped by you' : 'Stopped'
  return (
    <p className={cn(LINE, className)}>
      <span aria-hidden="true" className={MARK}>
        <IconPlayerStop size="sm" />
      </span>
      <span className={TEXT}>{doing === undefined ? who : `${who} while ${doing}`}</span>
      <span className={AT}>{at}</span>
    </p>
  )
}
