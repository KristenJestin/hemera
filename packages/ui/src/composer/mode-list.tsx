import { cn } from 'cn'
import type { ReactNode } from 'react'

import { IconCheck } from '../icons.ts'
import { HEAD, type ModeProps } from './agent-model-menu-shared.tsx'
import { modeMark } from './mode-selector.tsx'

/**
 * What the next turn may do without asking: one line per mode, under a word that names them.
 *
 * A mode is a sentence and not a step of a scale: "Ask before edits" and "Bypass permissions"
 * are the agent's own words, and five of them read across a panel are five sentences cut short.
 * So they stand one per line, each with the mark its own words earned — asking is a shield,
 * editing a pencil, planning a page — and the current one checked. What an agent calls its
 * modes is the agent's business: the mark is read off the words and the words are never
 * shortened.
 *
 * **The head is what makes this a section** rather than a second list of models beside the
 * first, since the maintainer kept the two-column model stage on 22 September 2026: a column of
 * rows with no word over it is a column nobody can tell the purpose of. It is quiet on
 * purpose — small, spaced, in the muted foreground, the same head the model column wears —
 * because it names the control and is never one of its rows. It is written and not announced a
 * second time: the list under it is already a listbox called "Mode", and a landmark around it
 * with the same name is one control said twice to whatever reads the page.
 *
 * **The row that is on is tinted and not merely marked.** The check at its end is what a reader
 * finds when they go looking; the tint is what they read without looking, from the corner of
 * the eye, and it is the accent's own muted fill so that the row is the same colour as every
 * other thing in the window that means "this one". The pointer lights a row in the page's plain
 * `accent`, which is a different thing said in a different colour: one is what is set, the
 * other is what is under the hand.
 */

/** The word over the list, and the list under it. */
const SECTION = 'flex min-h-0 shrink-0 flex-col gap-1'

/** The modes, one per line, because a mode is a sentence and not a step of a scale. */
const MODES = 'flex shrink-0 flex-col gap-0.5'

/** One mode: its mark, its own words, and the room for a check at the end. */
const ROW =
  'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-ring hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent'

/** And the one that is on: the accent's muted fill, which the check is drawn in too. */
const ROW_ON = 'bg-primary-muted text-primary-muted-foreground hover:bg-primary-muted'

export function ModeList({ modes, mode, onModeChange, disabled }: ModeProps): ReactNode {
  if (modes.length === 0) return null
  return (
    <div className={SECTION}>
      <p aria-hidden="true" className={HEAD}>
        Mode
      </p>
      <div className={MODES} role="listbox" aria-label="Mode">
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
    </div>
  )
}
