import type { ReactNode } from 'react'

import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { type MarkState } from '../../components/status-mark/mark-legends.ts'
import { Legend } from '../../components/tooltip/legend.tsx'
import {
  IconAlertTriangle,
  IconHandStop,
  IconInfoCircle,
  IconMinus,
  IconPencil,
  IconPlus,
} from '../../icons.ts'
import type { Delta, SectionState, Severity } from './planning-types.ts'
import { type AnswerStep, INPUT_WORDS } from './answer-step.ts'

/**
 * The marks of the Planning page: a section's state, where an input stands, how bad a finding
 * is, what a requirement does to the living spec, and what changed since the last read. Each is a
 * glyph whose words are in its tooltip.
 */

const SECTION_WORDS: Record<SectionState, string> = {
  empty: 'Not written yet',
  written: 'Settled',
  being_written: 'Being written',
}

const SECTION_POSE: Record<SectionState, MarkState> = {
  empty: 'todo',
  written: 'done',
  being_written: 'running',
}

const questionsOpen = (open: number): string =>
  open === 1 ? '1 question open' : `${String(open)} questions open`

/**
 * A section's state as a glyph: a quiet ring, the running arc while written, the green check once
 * settled. Written while open questions will still change it, it is in progress: the waiting mark
 * and their count, never the check.
 */
export function SectionMark({
  state,
  open = 0,
}: {
  state: SectionState
  /** How many open questions touch it. */
  open?: number | undefined
}): ReactNode {
  if (state === 'written' && open > 0) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <Legend label={`Written · ${questionsOpen(open)}`}>
          <StatusMark state="waiting" size="sm" />
        </Legend>
        <span aria-hidden="true" className="text-xs text-warning tabular-nums">
          {open}
        </span>
      </span>
    )
  }
  return (
    <Legend label={SECTION_WORDS[state]}>
      <StatusMark state={SECTION_POSE[state]} size="sm" />
    </Legend>
  )
}

const INPUT_DOT: Record<AnswerStep, string> = {
  unanswered: 'size-2 shrink-0 rounded-full border border-warning hover-motion',
  received: 'size-2 shrink-0 rounded-full border border-info hover-motion',
  delivered: 'size-2 shrink-0 rounded-full bg-info hover-motion',
  integrated: 'size-2 shrink-0 rounded-full bg-success hover-motion',
  superseded: 'size-2 shrink-0 rounded-full border border-border hover-motion',
}

/**
 * Where an answer of the user stands: a warning ring unanswered, a ring sent, a blue dot with the
 * Planner, a green dot taken into account. It follows the answer alone, never anything else.
 */
export function InputDot({ state }: { state: AnswerStep }): ReactNode {
  return (
    <Legend label={INPUT_WORDS[state]}>
      <span aria-hidden="true" className="flex size-icon-sm items-center justify-center">
        <span className={INPUT_DOT[state]} data-input={state} />
      </span>
    </Legend>
  )
}

const SEVERITY_WORDS: Record<Severity, string> = {
  blocking: 'Blocking',
  warning: 'Warning',
  suggestion: 'Suggestion',
}

const SEVERITY_TONE: Record<Severity, string> = {
  blocking: 'flex text-destructive',
  warning: 'flex text-warning',
  suggestion: 'flex text-muted-foreground',
}

const SEVERITY_GLYPH: Record<Severity, ReactNode> = {
  blocking: <IconHandStop size="sm" />,
  warning: <IconAlertTriangle size="sm" />,
  suggestion: <IconInfoCircle size="sm" />,
}

/** How bad a finding is, as a glyph. */
export function SeverityMark({ severity }: { severity: Severity }): ReactNode {
  return (
    <Legend label={SEVERITY_WORDS[severity]}>
      <span aria-hidden="true" className={SEVERITY_TONE[severity]}>
        {SEVERITY_GLYPH[severity]}
      </span>
    </Legend>
  )
}

const DELTA_WORDS: Record<Delta, string> = {
  added: 'Added',
  modified: 'Modified',
  removed: 'Removed',
}

const DELTA_TONE: Record<Delta, string> = {
  added: 'flex text-success',
  modified: 'flex text-info',
  removed: 'flex text-muted-foreground',
}

const DELTA_GLYPH: Record<Delta, ReactNode> = {
  added: <IconPlus size="sm" />,
  modified: <IconPencil size="sm" />,
  removed: <IconMinus size="sm" />,
}

/** What a requirement does to the living spec, as a glyph. */
export function DeltaMark({ delta }: { delta: Delta }): ReactNode {
  return (
    <Legend label={DELTA_WORDS[delta]}>
      <span aria-hidden="true" className={DELTA_TONE[delta]}>
        {DELTA_GLYPH[delta]}
      </span>
    </Legend>
  )
}

/** Changed since the user last read the Spec: a dot in the info tone. */
export function ChangedMark(): ReactNode {
  return (
    <Legend label="Changed since your last read">
      <span aria-hidden="true" className="flex size-icon-sm items-center justify-center">
        <span className="size-1.5 rounded-full bg-info" />
      </span>
    </Legend>
  )
}
