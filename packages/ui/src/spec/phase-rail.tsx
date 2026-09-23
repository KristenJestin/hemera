import { cn } from 'cn'
import { Fragment, type ReactNode } from 'react'

import { PHASE_TITLES, type PhaseState, type PhaseView } from './model.ts'

/**
 * The phases of the `define` protocol, as four small steps in a row (lot 19, brief "Phase
 * rail"; D7-08).
 *
 * `Shape · Plan · Decompose · Prototype`, each a dot and a word, and nothing to press: the same
 * agent chains them, and none is launched by hand (core.md, "Mission protocols and phases").
 * Under the rail, one sentence says what is happening now — the whole of what a reader needs,
 * and no "Focus:" label in front of it.
 *
 * One accent for the phase being worked; amber for a phase a rework or a new shaping made stale,
 * with a small `rework` beside it; `prototype` struck through, because it is declared and not
 * offered in this version, and a phase drawn as merely pending would promise it.
 */

const DOT: Record<PhaseState, string> = {
  finished: 'size-2 rounded-full bg-muted-foreground',
  open: 'size-2 rounded-full border-2 border-primary halo',
  pending: 'size-2 rounded-full border border-input',
  stale: 'size-2 rounded-full border-2 border-warning',
  unavailable: 'size-2 rounded-full border border-dashed border-input',
}

const WORD: Record<PhaseState, string> = {
  finished: 'text-muted-foreground',
  open: 'font-semibold text-foreground',
  pending: 'text-muted-foreground',
  stale: 'text-warning-muted-foreground',
  unavailable: 'text-muted-foreground line-through',
}

/** What the state is called for whoever cannot see the dot. */
const STATE_WORDS: Record<PhaseState, string> = {
  finished: 'finished',
  open: 'open',
  pending: 'pending',
  stale: 'stale',
  unavailable: 'unavailable in this version',
}

const RAIL = 'flex flex-wrap items-center gap-y-1'

const STEP = 'flex items-center gap-2 text-xs whitespace-nowrap'

/** The line between two steps. */
const JOIN = 'mx-2.5 w-6 border-t border-border'

const HINT = 'text-xs font-medium'

const NOW = 'text-sm text-muted-foreground'

export interface PhaseRailProps {
  phases: PhaseView[]
  /** The sentence under the rail: `Plan · the agent is writing the plan`. */
  now: string
}

export function PhaseRail({ phases, now }: PhaseRailProps): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <ol aria-label="Phases" className={RAIL}>
        {phases.map((phase, index) => (
          <Fragment key={phase.name}>
            {index > 0 && <li aria-hidden="true" className={JOIN} />}
            <li className={STEP} aria-current={phase.state === 'open' ? 'step' : undefined}>
              <span aria-hidden="true" className={DOT[phase.state]} />
              <span className={WORD[phase.state]}>{PHASE_TITLES[phase.name]}</span>
              <span className="sr-only">{`, ${STATE_WORDS[phase.state]}`}</span>
              {phase.state === 'stale' && (
                <span aria-hidden="true" className={cn(HINT, WORD.stale)}>
                  rework
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
      <p className={NOW}>{now}</p>
    </div>
  )
}
