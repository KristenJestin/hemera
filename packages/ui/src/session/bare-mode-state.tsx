import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Badge } from '../components/badge/badge.tsx'

/**
 * Whether each agent can run bare, and what it would take (design D6-15).
 *
 * Bare mode is a decision about an adapter and not about Hemera: what it asks is that the agent
 * leaves its own tools behind and works through the ones Hemera lends it. An adapter answers for
 * one agent, on one date, and the answer is read here rather than assumed — a list that said
 * "supported" without saying when it was last true would be a promise nobody can check.
 *
 * An agent that is not qualified is not a broken agent: it runs with its own tools, the thread
 * says so, and what would qualify it is on the line, so the reader knows what to wait for. The
 * reason is a fact and the remedy is a fact about the adapter, and the two are read together
 * because one without the other is either an excuse or a mystery.
 */

/** Where one agent stands with bare mode. */
export interface BareModeEntry {
  /** The agent, as the machine names it. */
  agent: string
  /** Whether its adapter is qualified: it runs without its own tools. */
  qualified: boolean
  /** Why it is, or why it is not. */
  reason: string
  /** What would qualify it, said only where something would. */
  remedy?: string | undefined
  /** When the qualification was last checked, as the adapter records it. */
  checkedAt?: string | undefined
}

export interface BareModeStateProps {
  /** The agents of this machine, in the order the settings list them. */
  entries: readonly BareModeEntry[]
  /** Where the block sits; never how it looks. */
  className?: string | undefined
}

const BLOCK = 'flex w-full flex-col gap-2'

const ROW = 'flex flex-col gap-0.5'

const HEAD = 'flex items-center gap-2'

const AGENT = 'text-sm text-foreground'

const REASON = 'text-sm text-muted-foreground'

/** What would qualify an adapter, said as the one thing that would change the answer. */
const REMEDY = 'text-sm text-warning-muted-foreground'

const AT = 'ml-auto shrink-0 font-mono text-xs text-muted-foreground'

export function BareModeState({ entries, className }: BareModeStateProps): ReactNode {
  return (
    <ul className={cn(BLOCK, className)}>
      {entries.map((entry) => (
        <li key={entry.agent} className={ROW}>
          <div className={HEAD}>
            <span className={AGENT}>{entry.agent}</span>
            <Badge tone={entry.qualified ? 'success' : 'warning'}>
              {entry.qualified ? 'Bare' : 'Not bare'}
            </Badge>
            {entry.checkedAt !== undefined && <span className={AT}>{entry.checkedAt}</span>}
          </div>
          <p className={REASON}>{entry.reason}</p>
          {entry.remedy !== undefined && <p className={REMEDY}>{entry.remedy}</p>}
        </li>
      ))}
    </ul>
  )
}
