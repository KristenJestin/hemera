import type { ReactNode } from 'react'

import { Select } from '../components/select/select.tsx'
import { AgentMark } from './agent-mark.tsx'

/**
 * Which agent a Session is started with (design D17-14).
 *
 * A Session is made with the agent it will run and keeps it, so this control only exists where
 * one is being started: the Home's composer picks an agent before there is anything to write in,
 * and the Session that follows opens on it. Inside a Session the agent is a fact about the
 * Session and not a control — nothing here is drawn there, and no control offers to change it.
 *
 * The list is what this machine has, said by the registry and never by Hemera: an agent that is
 * not installed is drawn and not offered, because a choice that would be refused after the fact
 * is a choice that lied. Nothing is checked here either — the page asks the engine, which is
 * where a version is read from a command rather than from a constant.
 */
export interface OfferedAgent<Value extends string = string> {
  /** What goes back over the wire when this agent is picked. */
  id: Value
  /** What the reader sees, in the registry's own words. */
  name: string
  /** Whether this machine has it. One that is not there can be read and not picked. */
  available: boolean
}

export interface AgentSelectorProps<Value extends string> {
  /** The agents that can be picked, in the order they are shown. */
  agents: readonly OfferedAgent<Value>[]
  /** The agent chosen so far, or null while none has been. */
  value: Value | null
  onValueChange: (id: Value) => void
  /** Whether the choice is waiting on something, which is what an agent being asked looks like. */
  disabled?: boolean | undefined
  /** Where the control sits; never how it looks. */
  className?: string | undefined
}

export function AgentSelector<Value extends string>({
  agents,
  value,
  onValueChange,
  disabled,
  className,
}: AgentSelectorProps<Value>): ReactNode {
  if (agents.length === 0) return null
  return (
    <Select
      label="Agent"
      mark={value === null ? undefined : <AgentMark agent={value} />}
      // The agent's own mark on every entry, out of the same catalogue as the one on the value:
      // an agent the catalogue does not have goes by its initials, here as everywhere.
      items={agents.map((agent) => ({
        value: agent.id,
        label: agent.name,
        icon: <AgentMark agent={agent.id} />,
        disabled: !agent.available,
      }))}
      value={value ?? undefined}
      placeholder="Choose an agent"
      onValueChange={onValueChange}
      disabled={disabled}
      className={className}
    />
  )
}
