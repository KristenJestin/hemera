import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { IconCommand, IconFileText, IconShield } from '../icons.ts'

/**
 * What the agent is working from, and what Hemera has no say over (design D6-10).
 *
 * Since the agent runs bare, its context is no longer something to guess at: Hemera puts the
 * context in the prompt itself, so it can show what it put there. The view is three lists, and
 * the split between them is the honest part of it.
 *
 * What Hemera provides: the base, the `AGENTS.md` it reads natively — read here rather than
 * asked of the agent, with the fingerprint and the date it was read, so a file that changed
 * under the Session is visible as one — and the deliveries, each with its date, because a
 * context that arrived at a moment is a fact about the Session and not a permanent truth.
 *
 * What Hemera consults: the tools it lends, each with the bound it is held to, and the commands
 * the catalogue holds. A tool that is offered with a limit is a different promise from a tool
 * that is offered, which is why the limit is on the line and not in a document somewhere.
 *
 * What Hemera does not control: the agent's own sources — its personal instructions, its
 * memories, its plugins. Hemera can say they exist and cannot say what is in them, so each one
 * gets a sentence and no detail. A list that pretended otherwise would be a lie told quietly.
 */

/** What one thing Hemera provides is, and when it came. */
export interface ContextEntry {
  /** Which of the three it belongs to: the base, the file, or something delivered. */
  kind: 'base' | 'file' | 'delivery'
  /** What it is, in one line. */
  label: string
  /** What it says for itself: a path, a fingerprint, a source. */
  detail?: string | undefined
  /** When it was read or delivered, as the Session records it. */
  at?: string | undefined
}

/** A tool Hemera lends, with the bound it is held to. */
export interface ContextTool {
  /** The name the catalogue gives it. */
  name: string
  /** The limit it works within: a size, a number, a scope. */
  bound: string
}

/** A command the catalogue holds, which the agent may run. */
export interface ContextCommand {
  /** The name the Project gave it. */
  name: string
  /** The line it runs. */
  command: string
}

/** An agent this Session can run, and what Hemera cannot see of it. */
export interface ContextAgent {
  /** The agent, as the machine names it. */
  name: string
  /** One sentence about the sources Hemera does not read. */
  sentence: string
}

export interface ContextViewProps {
  /** What Hemera puts in front of the agent, in the order it went in. */
  provided: readonly ContextEntry[]
  /** The tools it lends it. */
  tools: readonly ContextTool[]
  /** The commands it may run. */
  commands: readonly ContextCommand[]
  /** The agents it may run, and what of them Hemera does not control. */
  agents: readonly ContextAgent[]
  /** Where the view sits; never how it looks. */
  className?: string | undefined
}

const VIEW = 'flex w-full flex-col gap-3'

const GROUP = 'flex flex-col gap-1'

const HEAD = 'flex items-center gap-2'

const MARK = 'flex shrink-0 text-muted-foreground'

const TITLE = 'text-sm text-foreground'

const LIST = 'flex flex-col gap-1'

const ROW = 'flex items-baseline gap-2 text-sm'

const LABEL = 'min-w-0 truncate text-foreground'

const DETAIL = 'min-w-0 truncate font-mono text-xs text-muted-foreground'

const AT = 'ml-auto shrink-0 font-mono text-xs text-muted-foreground'

const TOOL = 'min-w-0 shrink-0 font-mono text-sm text-foreground'

/** What a Session says when Hemera has provided nothing yet. */
const NOTHING = 'text-sm text-muted-foreground'

/** The sentence about an agent's own sources, which is all Hemera can honestly say. */
const SENTENCE = 'text-sm text-muted-foreground'

function Group({
  icon,
  title,
  count,
  children,
}: {
  icon: ReactNode
  title: string
  count: number
  children: ReactNode
}): ReactNode {
  return (
    <section className={GROUP}>
      <div className={HEAD}>
        <span aria-hidden="true" className={MARK}>
          {icon}
        </span>
        <span className={TITLE}>{title}</span>
        <Badge tone="neutral">{`${count}`}</Badge>
      </div>
      {children}
    </section>
  )
}

export function ContextView({
  provided,
  tools,
  commands,
  agents,
  className,
}: ContextViewProps): ReactNode {
  return (
    <div className={cn(VIEW, className)}>
      <Group icon={<IconFileText size="sm" />} title="Hemera provides" count={provided.length}>
        {provided.length === 0 ? (
          <p className={NOTHING}>Nothing has gone in yet.</p>
        ) : (
          <ul className={LIST}>
            {provided.map((entry, index) => (
              <li key={index} className={ROW}>
                <span className={LABEL}>{entry.label}</span>
                {entry.detail !== undefined && <span className={DETAIL}>{entry.detail}</span>}
                {entry.at !== undefined && <span className={AT}>{entry.at}</span>}
              </li>
            ))}
          </ul>
        )}
      </Group>
      <Group icon={<IconCommand size="sm" />} title="Hemera consults" count={tools.length}>
        {tools.length === 0 ? (
          <p className={NOTHING}>No tool is offered to this Session.</p>
        ) : (
          <ul className={LIST}>
            {tools.map((tool) => (
              <li key={tool.name} className={ROW}>
                <span className={TOOL}>{tool.name}</span>
                <span className={DETAIL}>{tool.bound}</span>
              </li>
            ))}
          </ul>
        )}
        {commands.length > 0 && (
          <ul className={LIST}>
            {commands.map((command) => (
              <li key={command.name} className={ROW}>
                <span className={LABEL}>{command.name}</span>
                <span className={DETAIL}>{command.command}</span>
              </li>
            ))}
          </ul>
        )}
      </Group>
      <Group icon={<IconShield size="sm" />} title="Hemera does not control" count={agents.length}>
        <ul className={LIST}>
          {agents.map((agent) => (
            <li key={agent.name} className={ROW}>
              <span className={SENTENCE}>{`${agent.name}: ${agent.sentence}`}</span>
            </li>
          ))}
        </ul>
      </Group>
    </div>
  )
}
