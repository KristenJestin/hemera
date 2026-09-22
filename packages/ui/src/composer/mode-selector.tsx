import type { ReactNode } from 'react'

import { Select } from '../components/select/select.tsx'
import { IconFileText, IconPencil, IconSettings, IconShield } from '../icons.ts'
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
 *
 * Each mode carries a mark of its own. One shield over the whole list said "this control is
 * about permissions" three times over and never which of the three was chosen: a list where
 * every row wears the same icon is a list read on its words alone, and the trigger with it.
 * What an agent calls its modes is the agent's business, so the mark is read off the words —
 * asking, editing, planning — and anything the list does not recognise is drawn as a setting
 * rather than guessed at.
 */
const MARKS = [
  // "Ask before edits" is both an asking mode and an editing one; asking is what it is, so it
  // is looked for first.
  { words: ['ask'], icon: <IconShield size="sm" /> },
  { words: ['accept', 'edit', 'build'], icon: <IconPencil size="sm" /> },
  { words: ['plan'], icon: <IconFileText size="sm" /> },
] as const

/** What a mode nothing above recognised is drawn as: a setting of the agent, and no more. */
const UNKNOWN = <IconSettings size="sm" />

/**
 * The mark of one mode, read off the name the agent gave it.
 *
 * Exported because the mode is set in two places since the trial of 22 September 2026 — this
 * selector, which the catalogue still shows, and the row inside `AgentModelMenu`, which is where
 * the composer sets it — and a mode wearing a shield in one and a gear in the other would be two
 * controls disagreeing about what the agent said.
 */
export function modeMark(name: string): ReactNode {
  const asked = name.toLowerCase()
  const found = MARKS.find((mark) => mark.words.some((word) => asked.includes(word)))
  return found?.icon ?? UNKNOWN
}

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
  const current = modes.find((mode) => mode.id === value)
  return (
    <Select
      label="Mode"
      // The trigger wears the mark of the mode it is showing, not the mark of the control: what
      // is chosen is what the eye reads off it without opening anything.
      mark={current === undefined ? UNKNOWN : modeMark(current.name)}
      items={modes.map((mode) => ({
        value: mode.id,
        label: mode.name,
        icon: modeMark(mode.name),
      }))}
      value={value}
      onValueChange={onValueChange}
      className={className}
    />
  )
}
