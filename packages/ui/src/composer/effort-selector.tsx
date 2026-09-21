import type { ReactNode } from 'react'

import { Select } from '../components/select/select.tsx'
import type { AgentChoice } from './agent-choice.ts'

/**
 * How hard the agent thinks before it answers (design D17-11).
 *
 * The levels are the agent's and they are not a scale Hemera knows: one agent offers three, one
 * offers five, one offers none, and the last one must not be given a control to guess with. The
 * effort is kept per session rather than per turn — a reader who asked for more thinking did not
 * ask for it once.
 */
export interface EffortSelectorProps {
  /** What the agent says it can think with; empty when it announced nothing. */
  efforts: readonly AgentChoice[]
  /** The effort the next turn will run at. */
  value: string
  onValueChange: (id: string) => void
  /** Where the control sits; never how it looks. */
  className?: string | undefined
}

export function EffortSelector({
  efforts,
  value,
  onValueChange,
  className,
}: EffortSelectorProps): ReactNode {
  if (efforts.length === 0) return null
  return (
    <Select
      label="Effort"
      items={efforts.map((effort) => ({ value: effort.id, label: effort.name }))}
      value={value}
      onValueChange={onValueChange}
      className={className}
    />
  )
}
