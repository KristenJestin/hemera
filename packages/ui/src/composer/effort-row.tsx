import { cn } from 'cn'
import type { ReactNode } from 'react'

import {
  type EffortProps,
  levelSaid,
  SEGMENT,
  SEGMENT_ITEM,
  SEGMENT_ON,
} from './agent-model-menu-shared.tsx'
import { ADVISED_DOT } from './effort-scale.ts'

/**
 * The effort as one row of steps — variant 1 of three (trial of 22 September 2026).
 *
 * A handful of steps read across is a scale, and a scale read down a menu is a list of
 * unrelated things. It is the narrowest of the three and the one that says the least: every
 * step is written out, so what is read is the whole scale at once and which of it is on.
 *
 * It costs width, and that is the whole of the case against it: six efforts across a panel the
 * width of a mention menu leaves each of them four characters, which is what the slider and the
 * dial beside it are here to answer.
 */
export function EffortRow({ efforts, effort, onEffortChange, disabled }: EffortProps): ReactNode {
  if (efforts.length === 0) return null
  return (
    <div className={SEGMENT} role="group" aria-label="Effort">
      {efforts.map((one) => (
        <button
          key={one.id}
          type="button"
          disabled={disabled}
          aria-pressed={one.id === effort}
          // The step is four characters wide at six levels: what the agent said about it, and
          // whether it is the one it advises, are said to whoever reads the page rather than
          // written into a button that has no room for them.
          aria-label={levelSaid(one)}
          className={cn(SEGMENT_ITEM, one.id === effort && SEGMENT_ON)}
          onClick={() => onEffortChange(one.id)}
        >
          {/* And drawn as the dot the two scales mark the same level with. */}
          {one.recommended === true && <span aria-hidden="true" className={ADVISED_DOT} />}
          {one.label}
        </button>
      ))}
    </div>
  )
}
