import { type ReactNode, useState } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { IconButton } from '../components/button/button.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import { IconLock, IconX } from '../icons.ts'
import { MissionPanel } from '../session/mission-panel.tsx'
import type { PhaseName, SpecTarget, SpecView } from '../spec/model.ts'
import { SpecStage } from '../spec/spec-panel.tsx'
import { SpecRail, type StageChoice, railOf } from '../spec/spec-rail.tsx'

/**
 * The frozen Spec, opened from a build (D10-12; scenario "The Spec is read only in a build").
 *
 * The Spec panel's own parts — its rail and its stage — on the revision the build works from,
 * with no edit control anywhere: a frozen Spec edits nothing, and once a build started nothing
 * reworks it either, so neither Rework nor Mark ready is drawn, and the rail's foot says the build
 * works from it. It opens beside the build view, in the mission panel's shell, and it is closed
 * rather than folded: it is one of the views around the build, closable and never open with the
 * chat (core.md, "Session view").
 */

const HEAD = 'flex flex-col gap-1.5 border-b border-border px-5 pt-4 pb-3'

const HEAD_LINE = 'flex min-h-control-sm items-center gap-2.5'

const KEY = 'shrink-0 font-mono text-xs text-muted-foreground'

const TITLE = 'min-w-0 truncate text-base font-semibold'

const FROZEN = 'flex shrink-0 items-center gap-1 text-xs text-muted-foreground'

const NOW = 'text-sm text-muted-foreground'

const END = 'ml-auto flex shrink-0 items-center'

/** Nothing to hand back: the parts are read only, so none of their edits can happen. */
function nothing(): void {}

export interface BuildSpecPanelProps {
  /** The revision the build works from, frozen. */
  spec: SpecView
  /** Closes the panel. */
  onClose: () => void
}

export function BuildSpecPanel({ spec, onClose }: BuildSpecPanelProps): ReactNode {
  const [shown, setShown] = useState<StageChoice>({ part: 'problem' })
  const groups = railOf(spec)
  return (
    <MissionPanel
      label={`Spec ${spec.key}`}
      noun="Spec"
      defaultFolded={false}
      head={() => (
        <header className={HEAD}>
          <div className={HEAD_LINE}>
            <span className={KEY}>{spec.key}</span>
            <h2 className={TITLE}>{spec.title}</h2>
            <Badge>{spec.type}</Badge>
            <span className={FROZEN}>
              <IconLock size="sm" aria-hidden="true" />
              read only
            </span>
            <span className={END}>
              <Tooltip label="Close the Spec">
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={<IconX size="sm" />}
                  aria-label="Close the Spec"
                  data-fold
                  onClick={onClose}
                />
              </Tooltip>
            </span>
          </div>
          <p className={NOW}>The version the build works from. Nothing changes it while it runs.</p>
        </header>
      )}
      rail={
        <SpecRail
          label={`Parts of ${spec.key}`}
          groups={groups}
          current={shown}
          onSelect={(target: SpecTarget) => setShown({ part: target })}
          onSelectGroup={(phase: PhaseName) => setShown({ group: phase })}
          readiness={spec.readiness}
          frozenOn={spec.frozenOn}
          building
          onMarkReady={nothing}
        />
      }
      stage={
        <SpecStage
          spec={spec}
          shown={shown}
          groups={groups}
          reading={false}
          onSaveSection={nothing}
          onApplyMine={nothing}
          onDiscardMine={nothing}
          onSaveStory={nothing}
          onGoToQuestion={nothing}
        />
      }
      band={null}
    />
  )
}
