import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Badge, type BadgeProps } from '../components/badge/badge.tsx'

/**
 * The agents this machine has (design D17-01).
 *
 * Hemera runs the agents that are installed here and nothing else. There is no fallback: an
 * agent that is missing is missing, and a session that opened on another one would be a session
 * the reader did not ask for. So the section says what was found, version and all, what was not
 * found and what to do about it, and which one is installed but not signed in — three answers
 * that are not the same answer, and only the last one is the reader's to fix in one command.
 *
 * Nothing is chosen here either. The section reports the machine; the choice of the agent belongs
 * to the session that is about to start, where the reader is the one who makes it.
 */
const SECTION = 'flex flex-col gap-2'

const TITLE = 'flex flex-col gap-1'

const NAME = 'text-sm font-medium text-foreground'

const LEAD = 'text-xs text-muted-foreground'

const LIST = 'flex flex-col gap-1'

const ROW = 'flex items-baseline gap-2 rounded-md border border-border px-2 py-1.5'

const AGENT = 'shrink-0 text-sm text-foreground'

const VERSION = 'shrink-0 font-mono text-xs text-muted-foreground'

const HINT = 'min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground'

/** How an agent's standing is drawn: found, absent, or waiting for a sign-in. */
const STANDING: Record<AgentStanding, { word: string; tone: NonNullable<BadgeProps['tone']> }> = {
  ready: { word: 'Found', tone: 'success' },
  missing: { word: 'Not installed', tone: 'neutral' },
  unauthenticated: { word: 'Not signed in', tone: 'warning' },
}

/** What the machine can say about an agent. */
export type AgentStanding = 'ready' | 'missing' | 'unauthenticated'

export interface AgentOnTheMachine {
  /** The agent, as the protocol names it. */
  id: string
  /** What it is called on screen. */
  name: string
  /** The version that was found, when there is one to report. */
  version?: string | undefined
  standing: AgentStanding
  /** What to do about it, for an agent that is not ready: how to install it, or how to sign in. */
  hint?: string | undefined
}

export interface AgentsSectionProps {
  /** Every agent Hemera knows about, with what this machine says about it. */
  agents: readonly AgentOnTheMachine[]
  /** Where the section sits; never how it looks. */
  className?: string | undefined
}

export function AgentsSection({ agents, className }: AgentsSectionProps): ReactNode {
  return (
    <section className={cn(SECTION, className)}>
      <div className={TITLE}>
        <h3 className={NAME}>Agents</h3>
        <p className={LEAD}>
          The agents installed on this machine. A session opens on the one you choose: nothing is
          picked for you, and a missing agent is not replaced by another.
        </p>
      </div>
      <ul className={LIST}>
        {agents.map((agent) => (
          <li key={agent.id} className={ROW}>
            <span className={AGENT}>{agent.name}</span>
            {agent.version === undefined ? null : <span className={VERSION}>{agent.version}</span>}
            <Badge tone={STANDING[agent.standing].tone}>{STANDING[agent.standing].word}</Badge>
            {agent.hint === undefined ? null : <code className={HINT}>{agent.hint}</code>}
          </li>
        ))}
      </ul>
    </section>
  )
}
