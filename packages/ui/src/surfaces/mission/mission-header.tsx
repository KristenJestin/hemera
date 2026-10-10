import { cn } from 'cn'
import type { ReactNode } from 'react'

import { AlertDialog } from '../../components/alert-dialog/alert-dialog.tsx'
import { Button } from '../../components/button/button.tsx'
import {
  STAGE_DOT,
  STAGE_LIFE,
  type MissionMarkView,
  type MissionStage,
  SPELLED_MARKS,
  markWords,
  stageWords,
} from '../../blocks/mission/vocabulary.ts'
import { FrozenGlyph, MarkGlyph } from '../../blocks/mission/mission-marks.tsx'

/**
 * The pieces of a mission's header that are not a line of text: the stage as a track of the
 * stages of a mission's life, the marks with the one that opens a view, and Cancel with the
 * question it asks first. The frame lays them out.
 */
const TRACK = 'flex min-w-0 flex-wrap items-center gap-1 text-sm'

const STEP = 'flex items-center gap-1.5 rounded-md px-2 py-0.5'

const STEP_NOW = 'border border-border bg-card font-medium text-foreground'

const STEP_OTHER = 'text-muted-foreground'

const STEP_DOT_OFF = 'size-2 shrink-0 rounded-full border border-border'

export interface StageTrackProps {
  stage: MissionStage
  /** The last review round, 0 before the first. */
  round: number
  /** Whether the Spec is frozen: its lock stands on the Planning step. */
  frozen: boolean
}

/**
 * The stages of a mission's life, the current one lit and written with its round; the Spec's
 * lock on Planning once it is frozen. A cancelled mission has left the track: its one step is
 * the word.
 */
export function StageTrack({ stage, round, frozen }: StageTrackProps): ReactNode {
  if (stage === 'Cancelled') {
    return (
      <ol aria-label="Stage" className={TRACK}>
        <li className="flex items-center gap-1" aria-current="step">
          <span className={cn(STEP, STEP_NOW)}>
            <span aria-hidden="true" className={STAGE_DOT.Cancelled} />
            Cancelled
          </span>
        </li>
      </ol>
    )
  }
  const now = STAGE_LIFE.indexOf(stage)
  return (
    <ol aria-label="Stage" className={TRACK}>
      {STAGE_LIFE.map((step, index) => (
        <li
          key={step}
          className="flex items-center gap-1"
          aria-current={index === now ? 'step' : undefined}
        >
          {index > 0 && (
            <span aria-hidden="true" className="text-border">
              ─
            </span>
          )}
          <span className={cn(STEP, index === now ? STEP_NOW : STEP_OTHER)}>
            <span aria-hidden="true" className={index <= now ? STAGE_DOT[step] : STEP_DOT_OFF} />
            {index === now ? stageWords(stage, round) : step}
            {step === 'Planning' && frozen && <FrozenGlyph />}
          </span>
        </li>
      ))}
    </ol>
  )
}

export interface HeaderMarksProps {
  marks: readonly MissionMarkView[]
  /** Opens what moved: the outdated mark carries a way to it when this is given. */
  onOpenOutdated?: (() => void) | undefined
}

/** The marks after the ball: a glyph each, the causes written out; Outdated is followed by the way to what changed. */
export function HeaderMarks({ marks, onOpenOutdated }: HeaderMarksProps): ReactNode {
  if (marks.length === 0) return null
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      {marks.map((mark) => (
        <span key={markWords(mark)} className="flex min-w-0 items-center gap-1">
          <MarkGlyph mark={mark} spelled={SPELLED_MARKS.has(mark.kind)} />
          {mark.kind === 'outdated' && onOpenOutdated !== undefined && (
            <Button variant="link" size="sm" onClick={onOpenOutdated}>
              What changed
            </Button>
          )}
        </span>
      ))}
    </span>
  )
}

/** Cancel, and the question it asks first: what stops and what is kept. */
export function CancelMission({
  missionKey,
  onCancel,
}: {
  missionKey: string
  onCancel: () => void
}): ReactNode {
  return (
    <AlertDialog
      title={`Cancel ${missionKey}?`}
      description="Hemera stops its sessions, commands, services and delivery steps. The Workspace, the branches and the evidence stay until you confirm the cleanup."
      confirmLabel="Cancel the mission"
      cancelLabel="Keep it going"
      trigger={
        <Button variant="ghost" size="sm">
          Cancel
        </Button>
      }
      onConfirm={onCancel}
    />
  )
}
