import type { ReactNode } from 'react'

import { Select } from '../components/select/select.tsx'
import { AgentMark } from './agent-mark.tsx'
import type { AgentChoice } from './agent-choice.ts'

/**
 * Which model answers (design D17-11).
 *
 * The models are the agent's, not Hemera's: a client that offered its own list would offer
 * models the agent behind it cannot run. What the agent announced is what is drawn, including
 * the case where it announced nothing — no control, rather than an empty one, because a selector
 * with nothing in it promises a choice that does not exist.
 *
 * The choice is the user's and it is not automatic: the agent opens on the model it was started
 * with, and nothing here moves that on its own. Changing it applies to the next turn, which is
 * what the protocol allows and what the thread can be read as.
 */
export interface ModelSelectorProps {
  /** The agent whose models these are, as the registry names it. */
  agent: string
  /** What the agent says it can run; empty when it announced nothing. */
  models: readonly AgentChoice[]
  /** The model the next turn will use. */
  value: string
  onValueChange: (id: string) => void
  /** Where the control sits; never how it looks. */
  className?: string | undefined
}

export function ModelSelector({
  agent,
  models,
  value,
  onValueChange,
  className,
}: ModelSelectorProps): ReactNode {
  if (models.length === 0) return null
  return (
    <Select
      label="Model"
      mark={<AgentMark agent={agent} />}
      items={models.map((model) => ({ value: model.id, label: model.name }))}
      value={value}
      onValueChange={onValueChange}
      className={className}
    />
  )
}
