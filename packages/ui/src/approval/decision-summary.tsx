import { cn } from 'cn'
import type { ReactNode } from 'react'

import { IconCheck, IconX } from '../icons.ts'

/**
 * What was answered, kept in the thread where it was asked (design D17-10).
 *
 * A permission request that vanishes when it is answered leaves the thread with a gap: a tool
 * call starts, and nothing says why it was allowed to. The line stays — one line, no body, no
 * button — so that the record of a session answers the question "who let this happen" without
 * being re-opened.
 *
 * It says the answer and when it was given, and nothing else: the permission is the agent's
 * decision to make and this is a note, not a control.
 */
const LINE = 'flex items-center gap-1.5'

const AGREED = 'flex shrink-0 text-success-muted-foreground'

const REFUSED = 'flex shrink-0 text-muted-foreground'

const ANSWER = 'text-sm text-muted-foreground'

const AT = 'text-xs text-muted-foreground'

export interface DecisionSummaryProps {
  /** What was answered, in the words the request was read in. */
  answer: string
  /** When it was answered, already written for the platform. */
  at: string
  /** Whether the answer was a refusal, which is drawn as a note rather than as an agreement. */
  refused?: boolean | undefined
  /** Where the line sits; never how it looks. */
  className?: string | undefined
}

export function DecisionSummary({
  answer,
  at,
  refused = false,
  className,
}: DecisionSummaryProps): ReactNode {
  return (
    <p className={cn(LINE, className)}>
      <span aria-hidden="true" className={refused ? REFUSED : AGREED}>
        {refused ? <IconX size="sm" /> : <IconCheck size="sm" />}
      </span>
      <span className={ANSWER}>{answer}</span>
      <span className={AT}>{at}</span>
    </p>
  )
}
