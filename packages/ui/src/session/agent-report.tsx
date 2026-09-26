import { cn } from 'cn'
import type { ReactNode } from 'react'

import { IconAlertTriangle } from '../icons.ts'

/**
 * What an agent said outside the conversation, or asked that Hemera cannot draw, as a quiet line
 * of the thread (issue #131).
 *
 * An agent whose provider refused it says so on its standard error and tells the protocol
 * nothing; an agent can ask Hemera for something no block of the thread draws. Either way the
 * reader was left with "Thinking…" and no reason. This is the reason, said where the turn is:
 * one line naming what happened, and under it what the agent wrote or asked, word for word.
 *
 * Quiet on purpose. It is not a message of the agent's and not a failure of the turn — the turn
 * may well go on — so it stands in the muted colour like a stopped turn does, with the warning
 * mark to say it is worth a glance.
 */
const REPORT = 'flex min-w-0 flex-col gap-1'

const HEAD = 'flex items-center gap-1.5'

const MARK = 'flex shrink-0 text-muted-foreground'

const TEXT = 'text-sm text-muted-foreground'

const AT = 'text-xs text-muted-foreground'

/** What the agent wrote or asked: its own words, which are code-like and kept as they came. */
const DETAIL = 'min-w-0 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground'

export interface AgentReportProps {
  /** What happened, in one sentence: "The agent reported an error". */
  title: string
  /** What the agent wrote or asked, as it wrote it: the line of its error, the method it asked. */
  detail?: string | undefined
  /** When, already written for the platform. */
  at: string
  /** Where the line sits; never how it looks. */
  className?: string | undefined
}

export function AgentReport({ title, detail, at, className }: AgentReportProps): ReactNode {
  return (
    <div className={cn(REPORT, className)}>
      <p className={HEAD}>
        <span aria-hidden="true" className={MARK}>
          <IconAlertTriangle size="sm" />
        </span>
        <span className={TEXT}>{title}</span>
        <span className={AT}>{at}</span>
      </p>
      {detail === undefined || detail === '' ? null : <p className={DETAIL}>{detail}</p>}
    </div>
  )
}
