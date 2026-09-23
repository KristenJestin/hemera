import type { ReactNode } from 'react'

import { Disclosure } from '../activity/disclosure.tsx'
import { Badge, type BadgeProps } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { Card } from '../components/card/card.tsx'
import { IconRefresh } from '../icons.ts'

/**
 * The agents this machine has, and the one thing the reader can do about them (design D17-01,
 * D5-18, D5-21).
 *
 * Hemera runs the agents that are installed here and nothing else. There is no fallback: an
 * agent that is missing is missing, and a session that opened on another one would be a session
 * the reader did not ask for. So the section says whether the agent is signed in, what was found
 * version and all, what was not found and what to do about it, and which one is installed but
 * not signed in — answers that are not the same answer, and only the last one is the reader's to
 * fix in one command.
 *
 * It names the agent and never the adapter a Session may reach it through: Claude Code, Codex
 * and OpenCode are what the reader installs, what the reader signs in, and the only names that
 * appear here (D5-21). The sign-in is read first and the command second, because two of the
 * three are reached through an adapter that carries its own copy of the agent — on such a
 * machine the login is what the agent needs to be usable, and the command is only where the
 * reader's own CLI is or is not.
 *
 * It is the shape of the other sections and not a shape of its own: the same card, the same rows
 * of key and value, the same quiet buttons under them. A reader who has read the Profile block
 * has read this one.
 *
 * Only what a reader acts on is a row (trial of 23 September 2026): whether the agent is signed
 * in, what is installed, and one line for the only question a version raises — is it up to date.
 * What was published, which tool installed it and how bare mode is reached were rows the reader
 * had to read past to get there. Bare mode is one folded line under the agent: what it keeps
 * that Hemera does not control, or why it is not available here.
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
  /** Whether the login this agent's own command wrote is there. Looked for, never opened (D5-21). */
  authenticated: boolean
  /** The one sentence that says how to get it, for an agent that is not there. */
  installHint: string
  /** The command that signs it in, which is the agent's own and not Hemera's (D5-21). */
  loginHint: string
  /** The tool that installed it, which is the only one that can move it. */
  installer: string
  /** What its registry published, or null when nobody has asked it yet or it answered nothing. */
  latest: string | null
  /**
   * Where its adapter stands with bare mode (design D6-15), or nothing when it has not been asked.
   *
   * Asked of the adapter and not guessed from the agent. Drawn as one folded line: an agent that
   * runs with Hemera's tools only opens on what it still keeps out of Hemera's sight, one that
   * does not opens on why.
   */
  bare?: BareMode | undefined
}

/** What an adapter answered about bare mode on this machine. */
export type BareMode =
  | {
      /** This agent runs with Hemera's tools only. */
      qualified: true
      /** What its means does not reach: its own sources that still load, which Hemera does not read. */
      private: string
    }
  | {
      /** This agent cannot run here: a Session is not opened on it. */
      qualified: false
      /** Why it cannot, in its adapter's words. */
      reason: string
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
                  <Pair label="Signed in">{agent.authenticated ? 'yes' : 'no'}</Pair>
                  <Pair label="Installed">{installedOf(agent)}</Pair>
                  {agent.found ? (
                    <Pair label="Updates">{updatesOf(agent, checked)}</Pair>
                  ) : (
                    <Pair label="How to get it">{agent.installHint}</Pair>
                  )}
                  {agent.authenticated ? null : <Pair label="To sign in">{agent.loginHint}</Pair>}
                </dl>
                {agent.bare === undefined ? null : (
                  <BareFold agent={agent.name} bare={agent.bare} />
                )}
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

/**
 * Bare mode, in one line that opens on the rest (D6-02, D6-09).
 *
 * The line is what a reader needs to know at a glance — this agent runs with Hemera's tools only,
 * or it is not available here — and the fold is the sentence behind it, which is long and read
 * once: what the agent still keeps out of Hemera's sight, or the adapter's reason for refusing it.
 *
 * The agent's name is part of the control's name and not of the line: the eye reads the line under
 * the agent's header, and whoever walks the page from control to control hears three folds that
 * would otherwise all say the same words.
 */
function BareFold({ agent, bare }: { agent: string; bare: BareMode }): ReactNode {
  return (
    <Disclosure
      summary={
        <span className={NOTE}>
          <span className="sr-only">{`${agent}: `}</span>
          {bare.qualified ? "Runs with Hemera's tools only" : 'Not available here'}
        </span>
      }
    >
      <p className={NOTE}>
        {bare.qualified ? `Hemera does not control: ${bare.private}` : bare.reason}
      </p>
    </Disclosure>
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
 * The one question a version raises — is it up to date — answered for an agent that is found.
 *
 * Still being asked and asked with no answer are not the same absence, and neither is a version:
 * the line says which it is rather than guessing. A version that cannot be compared — none
 * reported, or not plain dotted numbers — is not called up to date or behind: the line says what
 * was published and leaves the comparison alone. An installed version ahead of the published one
 * (a snapshot, a release the registry has not caught up with) is up to date, not behind.
 */
function updatesOf(agent: AgentOnTheMachine, checked: boolean): string {
  if (agent.latest === null) return checked ? 'Could not check' : 'Checking…'
  const order = agent.version === null ? null : compareVersions(agent.version, agent.latest)
  if (order === null) return `Latest ${agent.latest}`
  return order < 0 ? `Update available ${agent.latest}` : 'Up to date'
}

/**
 * The version this agent could be moved to, or null when there is nothing to offer.
 *
 * Offered only where the published version is newer than the installed one, and only where the
 * tool that installed the command is one Hemera can place: an update run with the wrong tool is a
 * second installation rather than an update, a command from somewhere else is left exactly where
 * it is, and a published version behind the installed one would be a downgrade.
 */
function updateOf(agent: AgentOnTheMachine): string | null {
  if (!agent.found || agent.installer === 'unknown') return null
  if (agent.version === null || agent.latest === null) return null
  const order = compareVersions(agent.version, agent.latest)
  return order !== null && order < 0 ? agent.latest : null
}

/**
 * How two versions stand, segment by segment as numbers: negative when `installed` is behind,
 * zero when they are the same, positive when it is ahead — or null when either is not plain
 * dotted numbers, which is a version nothing here knows how to order.
 *
 * As numbers and not as strings: `2.0.10` is after `2.0.9`, and a missing segment counts as zero.
 */
function compareVersions(installed: string, published: string): number | null {
  const plain = /^\d+(?:\.\d+)*$/
  if (!plain.test(installed) || !plain.test(published)) return null
  const mine = installed.split('.').map(Number)
  const theirs = published.split('.').map(Number)
  for (let at = 0; at < Math.max(mine.length, theirs.length); at += 1) {
    const step = (mine[at] ?? 0) - (theirs[at] ?? 0)
    if (step !== 0) return step
  }
  return 0
}
