import type { ReactNode } from 'react'

import type { ModeProps } from './agent-model-menu-shared.tsx'
import { ModeSelector } from './mode-selector.tsx'

/**
 * The mode as the dropdown the composer used to carry — variant 3 of three.
 *
 * It is the selector of D17-12, unchanged, taking the menu's props instead of its own: one
 * line whatever the agent announced, which is the whole of the case for it — five modes and
 * five lines of the panel gone is what the list costs, and a panel is not made of spare lines.
 * The case against it is the one the list was written for: the mode that is on is read off a
 * trigger, and what the other four are is behind a second press.
 *
 * Nothing of the selector is re-drawn here. An agent announces `{ id, label }`; the selector
 * has said `{ id, name }` since it was written for the composer, and a mode set in two places
 * has to be the same mode — so this is the translation and not a second control.
 */
export function ModeSelect({ modes, mode, onModeChange }: ModeProps): ReactNode {
  if (modes.length === 0) return null
  return (
    <ModeSelector
      modes={modes.map((one) => ({ id: one.id, name: one.label }))}
      value={mode ?? ''}
      onValueChange={onModeChange}
    />
  )
}
