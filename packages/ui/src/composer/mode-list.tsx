import { cn } from 'cn'
import type { ReactNode } from 'react'

import { IconCheck } from '../icons.ts'
import { MODES_ACROSS, MODES_DOWN, type ModeProps } from './agent-model-menu-shared.tsx'
import { modeMark } from './mode-selector.tsx'

/**
 * The mode as a list, one per line — variant 1 of three (trial of 22 September 2026).
 *
 * A mode is a sentence and not a step of a scale: "Ask before edits" and "Bypass permissions"
 * are the agent's own words, and five of them read across a panel are five sentences cut short.
 * So they stand one per line, each with the mark its own words earned — asking is a shield,
 * editing a pencil, planning a page — and the current one checked.
 *
 * `across` is the same list folded two to a line, for the panel wide enough to read two of them
 * whole. It is never a label cut short: what an agent calls its modes is the agent's business,
 * so the mark is read off the words exactly as the mode selector reads them.
 *
 * **The row that is on is tinted and not merely marked.** The check at its end is what a reader
 * finds when they go looking; the tint is what they read without looking, from the corner of
 * the eye, and it is the accent's own muted fill so that the row is the same colour as every
 * other thing in the window that means "this one". The pointer lights a row in the page's plain
 * `accent`, which is a different thing said in a different colour: one is what is set, the
 * other is what is under the hand.
 */

/** One mode: its mark, its own words, and the room for a check at the end. */
const ROW =
  'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-ring hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent'

/** And the one that is on: the accent's muted fill, which the check is drawn in too. */
const ROW_ON = 'bg-primary-muted text-primary-muted-foreground hover:bg-primary-muted'
export function ModeList({ modes, mode, onModeChange, disabled, across }: ModeProps): ReactNode {
  if (modes.length === 0) return null
  return (
    <div className={across === true ? MODES_ACROSS : MODES_DOWN} role="listbox" aria-label="Mode">
      {modes.map((one) => (
        <button
          key={one.id}
          type="button"
          role="option"
          disabled={disabled}
          aria-selected={one.id === mode}
          className={cn(ROW, one.id === mode && ROW_ON)}
          onClick={() => onModeChange(one.id)}
        >
          {modeMark(one.label)}
          <span className="min-w-0 flex-1">{one.label}</span>
          {one.id === mode && <IconCheck size="sm" />}
        </button>
      ))}
    </div>
  )
}
