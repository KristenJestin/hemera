import type { ReactNode } from 'react'

import { Badge, type BadgeProps } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { Card } from '../components/card/card.tsx'
import { IconRefresh } from '../icons.ts'

/**
 * The agents this machine has, and the one thing the reader can do about them (design D17-01,
 * D5-18).
 *
 * Hemera runs the agents that are installed here and nothing else. There is no fallback: an
 * agent that is missing is missing, and a session that opened on another one would be a session
 * the reader did not ask for. So the section says what was found, version and all, what was not
 * found and what to do about it, and which one is installed but not signed in — three answers
 * that are not the same answer, and only the last one is the reader's to fix in one command.
 *
 * It is the shape of the other sections and not a shape of its own: the same card, the same rows
 * of key and value, the same quiet buttons under them. A reader who has read the Profile block
 * has read this one.
 *
 * Nothing here chooses and nothing here fetches. The choice of the agent belongs to the session
 * that is about to start, where the reader is the one who makes it; what the registries published
 * is asked once, when the section is opened, and never by this component. And an update runs on a
 * button press and on nothing else: Hemera does not move a tool on the reader's behalf.
 */
const LEAD =
  'The agents installed on this machine. A session opens on the one you choose: nothing is picked for you, and a missing agent is not replaced by another.'

const NOTE = 'text-sm text-muted-foreground'

const LIST = 'flex flex-col gap-4'

const ITEM = 'flex flex-col gap-3 border-b border-border pb-4 last:border-b-0 last:pb-0'

const HEAD = 'flex flex-wrap items-center gap-2'

const NAME = 'text-sm font-medium text-foreground'

const ROW = 'flex flex-col gap-3 text-sm'

const PAIR = 'flex flex-wrap items-baseline gap-x-6 gap-y-1'

/** As wide as the longest key, so every value starts on the same column as the Profile's. */
const KEY = 'w-sidebar-collapse shrink-0 text-sm text-muted-foreground'

const VALUE = 'min-w-0 truncate font-mono text-sm'

/** What an installer answered, kept whole: it is the tool's words and not a summary of them. */
const SAID =
  'scroll-quiet max-h-40 overflow-auto rounded-md border border-border bg-muted px-2 py-1.5 font-mono text-xs whitespace-pre-wrap text-foreground'

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
  /** Whether the command is on this machine at all. */
  found: boolean
  /** What the command answered when it was asked its version, or null when it answered none. */
  version: string | null
  /** Whether it said it was signed in, which is only ever learned from a Session it started. */
  authenticated: boolean
  /** The one sentence that says how to get it, for an agent that is not there. */
  installHint: string
  /** The tool that installed it, which is the only one that can move it. */
  installer: string
  /** What its registry published, or null when nobody has asked it yet. */
  latest: string | null
}

export interface AgentsSectionProps {
  /** Every agent Hemera knows about, with what this machine says about it. */
  agents: readonly AgentOnTheMachine[]
  /** Whether the registries have answered for this visit to the section. */
  checked: boolean
  /**
   * The agent whose update is running, or null when none is.
   *
   * One at a time on purpose: two tools write the same global prefix, and a second update
   * running beside the first is a race nobody watching the page could see.
   */
  updating: string | null
  /** What each agent's own tool last said, by agent, in the tool's own words. */
  output: Readonly<Record<string, string>>
  /** Asks the agent's own tool to move it, which only ever happens on a press. */
  onUpdate: (id: string) => void
  /** Where the section sits; never how it looks. */
  className?: string | undefined
}

export function AgentsSection({
  agents,
  checked,
  updating,
  output,
  onUpdate,
  className,
}: AgentsSectionProps): ReactNode {
  return (
    <Card title="Agents" description={LEAD} className={className}>
      {agents.length === 0 ? (
        <p className={NOTE}>Hemera knows no agent.</p>
      ) : (
        <ul className={LIST}>
          {agents.map((agent) => {
            const standing = STANDING[standingOf(agent)]
            const update = updateOf(agent)
            const said = output[agent.id]
            const working = updating === agent.id
            return (
              <li key={agent.id} className={ITEM}>
                <div className={HEAD}>
                  <span className={NAME}>{agent.name}</span>
                  <Badge tone={standing.tone}>{standing.word}</Badge>
                </div>
                <dl className={ROW}>
                  <Pair label="Installed">{installedOf(agent)}</Pair>
                  <Pair label="Published">{publishedOf(agent, checked)}</Pair>
                  <Pair label={agent.found ? 'Installed with' : 'How to get it'}>
                    {agent.found ? agent.installer : agent.installHint}
                  </Pair>
                </dl>
                {update === null ? null : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      state={working ? 'loading' : 'idle'}
                      disabled={updating !== null}
                      onClick={() => onUpdate(agent.id)}
                    >
                      <IconRefresh size="sm" />
                      Update to {update}
                    </Button>
                    <span className={NOTE}>
                      Runs {agent.installer}, and only when you press it.
                    </span>
                  </div>
                )}
                {said === undefined ? null : (
                  <pre aria-label={`What the update of ${agent.name} said`} className={SAID}>
                    {said}
                  </pre>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className={NOTE}>{CHECKED[checked ? 'asked' : 'asking']}</p>
    </Card>
  )
}

/** What the last line says about the one question that leaves the machine. */
const CHECKED = {
  asked: 'Each registry was asked what it published when this section was opened, and only then.',
  asking: 'Asking each registry what it published…',
}

/** One row of the section, in the rhythm every other settings section uses. */
function Pair({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className={PAIR}>
      <dt className={KEY}>{label}</dt>
      <dd className={VALUE}>{children}</dd>
    </div>
  )
}

/** The three answers, which are read off what the machine said rather than stored beside it. */
function standingOf(agent: AgentOnTheMachine): AgentStanding {
  if (!agent.found) return 'missing'
  return agent.authenticated ? 'ready' : 'unauthenticated'
}

/** What was found, in the version the command itself reports. */
function installedOf(agent: AgentOnTheMachine): string {
  if (!agent.found) return 'not on this machine'
  return agent.version ?? 'no version reported'
}

/**
 * What the registry answered, and which of the two ways of not knowing it is.
 *
 * A version nobody asked for and a registry that answered nothing are not the same absence, and
 * neither of them is a version. Saying which one it is is the whole value of the line.
 */
function publishedOf(agent: AgentOnTheMachine, checked: boolean): string {
  if (agent.latest !== null) return agent.latest
  return checked ? 'no registry answered' : 'not asked yet'
}

/**
 * The version this agent could be moved to, or null when there is nothing to offer.
 *
 * Offered only where both versions are known and differ, and only where the tool that installed
 * the command is one Hemera can place: an update run with the wrong tool is a second installation
 * rather than an update, and a command from somewhere else is left exactly where it is.
 */
function updateOf(agent: AgentOnTheMachine): string | null {
  if (!agent.found || agent.installer === 'unknown') return null
  if (agent.version === null || agent.latest === null) return null
  return agent.version === agent.latest ? null : agent.latest
}
