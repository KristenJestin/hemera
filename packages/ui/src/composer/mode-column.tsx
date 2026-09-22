import type { ReactNode } from 'react'

import { HEAD, type ModeProps } from './agent-model-menu-shared.tsx'
import { ModeList } from './mode-list.tsx'

/**
 * The mode as a titled section of a column — variant 2 of three (trial of 22 September 2026).
 *
 * The same list, with a word over it and a column to stand in. It is the variant that changes
 * the panel rather than the control: the model stage becomes two columns, the models on the
 * left where the scrolling is, the effort and the mode on the right where nothing scrolls. What
 * it buys is the height — a list of five modes under a list of models is a panel whose models
 * are four rows tall — and what it costs is the width the models had.
 *
 * The header is what makes it a section rather than a second list of models beside the first:
 * a column of rows with no word over it is a column nobody can tell the purpose of. It is quiet
 * on purpose — small, spaced, in the muted foreground, the same head the agent column wears —
 * because it names the control and is never one of its rows.
 *
 * The word is written and not announced a second time: the list under it is already a listbox
 * called "Mode", and a landmark around it with the same name is one control said twice to
 * whatever reads the page — which is a violation the catalogue's own check refuses, and rightly.
 */

/** The column's own section: a word, and the list under it. */
const SECTION = 'flex min-h-0 flex-col gap-1'

export function ModeColumn({ modes, mode, onModeChange, disabled }: ModeProps): ReactNode {
  if (modes.length === 0) return null
  return (
    <div className={SECTION}>
      <p aria-hidden="true" className={HEAD}>
        Mode
      </p>
      <ModeList modes={modes} mode={mode} onModeChange={onModeChange} disabled={disabled} />
    </div>
  )
}
