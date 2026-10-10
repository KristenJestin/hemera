import type { ReactNode } from 'react'

import { type MarkState, StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import {
  IconAlertTriangle,
  IconHandStop,
  IconInfoCircle,
  IconMinus,
  IconPencil,
  IconPlus,
} from '../../icons.ts'
import type { Delta, InputState, SectionState, Severity } from './planning-types.ts'

/**
 * The marks of the Planning page: a section's state, where an input stands, how bad a finding
 * is, what a requirement does to the living spec, and what changed since the last read. Each is a
 * glyph whose words are in its tooltip.
 */

const SECTION_WORDS: Record<SectionState, string> = {
  empty: 'Not written yet',
  written: 'Written',
  being_written: 'Being written',
}

const SECTION_POSE: Record<SectionState, MarkState> = {
  empty: 'todo',
  written: 'done',
  being_written: 'running',
}

/** A section's state as a glyph: a quiet ring, a closed one, the running arc while written. */
export function SectionMark({ state }: { state: SectionState }): ReactNode {
  return (
    <Legend label={SECTION_WORDS[state]}>
      <StatusMark state={SECTION_POSE[state]} size="sm" />
    </Legend>
  )
}

export const INPUT_WORDS: Record<InputState, string> = {
  received: 'Received',
  delivered: 'Delivered to the Planner',
  integrated: 'Integrated in the Spec',
  superseded: 'Replaced by a later answer',
}

const INPUT_DOT: Record<InputState, string> = {
  received: 'size-2 shrink-0 rounded-full border border-muted-foreground hover-motion',
  delivered: 'size-2 shrink-0 rounded-full bg-info hover-motion',
  integrated: 'size-2 shrink-0 rounded-full bg-success hover-motion',
  superseded: 'size-2 shrink-0 rounded-full border border-border hover-motion',
}

/** Where an input of the user stands: a ring received, a dot delivered, a green dot integrated. */
export function InputDot({ state }: { state: InputState }): ReactNode {
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
