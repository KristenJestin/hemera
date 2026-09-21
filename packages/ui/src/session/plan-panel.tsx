import type { ReactNode } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { IconCheck, IconPlayerPlay, IconTimelineEvent } from '../icons.ts'
import { Disclosure } from '../activity/disclosure.tsx'
import { cn } from 'cn'

/**
 * The plan the agent is working to (design D17-16).
 *
 * A plan arrives whole, every time: the protocol sends the entries the agent is holding, and the
 * client replaces what it had rather than merging into it. Merging would be the one thing that
 * cannot be done here — an entry that a later notification took away would stay drawn, and the
 * reader would be reading a plan the agent no longer has.
 *
 * It is folded by default, with the count that says how far along it is: a plan is a thing the
 * reader checks on, not a thing that follows the thread down the page.
 */
export type PlanStatus = 'pending' | 'in_progress' | 'completed'

export type PlanPriority = 'high' | 'medium' | 'low'

export interface PlanEntry {
  /** What the step is, in the agent's words. */
  content: string
  priority: PlanPriority
  status: PlanStatus
}

export interface PlanPanelProps {
  /** The whole plan as the agent last sent it. It replaces, it never merges. */
  entries: readonly PlanEntry[]
  defaultOpen?: boolean | undefined
  /** Where the panel sits; never how it looks. */
  className?: string | undefined
}

/** The mark of a step, which is the only thing that changes when the agent moves on. */
const MARK: Record<PlanStatus, ReactNode> = {
  completed: <IconCheck size="sm" />,
  in_progress: <IconPlayerPlay size="sm" />,
  pending: <IconTimelineEvent size="sm" />,
}

const TONE: Record<PlanStatus, string> = {
  completed: 'flex shrink-0 text-success-muted-foreground',
  in_progress: 'flex shrink-0 text-primary',
  pending: 'flex shrink-0 text-muted-foreground',
}

const STEP = 'flex items-start gap-2 text-sm'

const CONTENT = 'min-w-0 flex-1'

/** A step that is done reads as done, without the line through it that makes it hard to read. */
const DONE = 'text-muted-foreground'

const LIST = 'flex flex-col gap-1.5 pt-1'

/** What a plan that has not been sent yet says, rather than an empty box. */
const EMPTY = 'pt-1 text-sm text-muted-foreground'

export function PlanPanel({ entries, defaultOpen = false, className }: PlanPanelProps): ReactNode {
  const done = entries.filter((entry) => entry.status === 'completed').length
  return (
    <Disclosure
      className={className}
      defaultOpen={defaultOpen}
      summary={
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="flex shrink-0 text-muted-foreground">
            <IconTimelineEvent size="sm" />
          </span>
          <span className="text-sm text-foreground">Plan</span>
          <Badge tone={done === entries.length && entries.length > 0 ? 'success' : 'neutral'}>
            {`${done} of ${entries.length}`}
          </Badge>
          {entries.some((entry) => entry.priority === 'high') ? (
            <Badge tone="warning">High priority</Badge>
          ) : null}
        </span>
      }
    >
      {entries.length === 0 ? (
        <p className={EMPTY}>The agent has not sent a plan.</p>
      ) : (
        <ul className={LIST}>
          {entries.map((entry, index) => (
            <li key={index} className={STEP}>
              <span aria-hidden="true" className={TONE[entry.status]}>
                {MARK[entry.status]}
              </span>
              <span className={cn(CONTENT, entry.status === 'completed' && DONE)}>
                {entry.content}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Disclosure>
  )
}
