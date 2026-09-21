import type { ReactNode } from 'react'

import { Select } from '../components/select/select.tsx'
import { IconShield } from '../icons.ts'
import type { AgentChoice } from './agent-choice.ts'

/**
 * What the agent may do without asking (design D17-12).
 *
 * The modes belong to the agent — "ask", "accept edits", "plan" are its words, not a scale of
 * Hemera's — and the one that is current is the agent's answer, not a local setting: when the
 * agent says it changed mode, the control follows, because a control that disagreed with the
 * agent would be a lie about what the next call may do.
 *
 * Changing the mode is a request, not an order. The next `current_mode_update` is what the
 * control shows, so a mode the agent refused to take is not drawn as taken.
 */
export interface ModeSelectorProps {
  /** What the agent says it can be told; empty when it announced nothing. */
  modes: readonly AgentChoice[]
  /** The mode the agent last reported. */
  value: string
  onValueChange: (id: string) => void
  /** Where the control sits; never how it looks. */
  className?: string | undefined
}

export function ModeSelector({
  modes,
  value,
  onValueChange,
  className,
}: ModeSelectorProps): ReactNode {
  if (modes.length === 0) return null
  return (
    <Select
      label="Mode"
      mark={<IconShield size="sm" />}
      // The mark is on the value and on every mode of the list: an option carrying nothing would
      // read as something other than the control it belongs to.
      items={modes.map((mode) => ({
        value: mode.id,
        label: mode.name,
        icon: <IconShield size="sm" />,
      }))}
      value={value}
      onValueChange={onValueChange}
      className={className}
    />
  )
}
