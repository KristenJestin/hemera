import type { ReactNode } from 'react'

import { StageCard } from '../mission/stage-card.tsx'
import { LiveChip } from '../../components/live-chip/live-chip.tsx'
import { IconEye } from '../../icons.ts'
import type { Attention } from './attention.ts'
import type { PlanningData } from './planning-types.ts'
import { ProbeChip } from './probes.tsx'
import { PrototypeChip } from './prototypes.tsx'

export interface PlanningStageCardProps {
  attention: Attention
  data: PlanningData
  onOpenProbe: (id: string) => void
}

/**
 * Planning's stage card, at the top of the rail: the face, the line that says what happens or
 * what waits, where Planning stands, and the chips of what runs — the cold read, the Probes, the
 * Prototypers.
 */
export function PlanningStageCard({
  attention,
  data,
  onOpenProbe,
}: PlanningStageCardProps): ReactNode {
  const pass = data.passes.at(-1)
  const reading =
    pass !== undefined && (pass.state === 'running' || pass.state === 'waiting_for_slot')
  const probes = data.probes.filter(
    (probe) => probe.state === 'running' || probe.state === 'preparing',
  )
  const prototypes = data.prototypes.filter((prototype) => prototype.state === 'running')
  return (
    <StageCard
      stage="Planning"
      face={attention.face}
      line={attention.now}
      progress={attention.progress}
      running={
        reading || probes.length > 0 || prototypes.length > 0 ? (
          <>
            {reading && (
              <LiveChip
                name={`Cold read ${pass.label}`}
                icon={<IconEye size="sm" />}
                state={pass.stuck ? 'stuck' : 'running'}
                startedAt={pass.startedAt}
                endedAt={null}
                glance={{
                  kind: 'helper',
                  type: 'Cold read',
                  step:
                    pass.state === 'waiting_for_slot'
                      ? 'Waits for a free agent'
                      : 'A fresh reader goes through the Spec',
                }}
              />
            )}
            {probes.map((probe) => (
              <ProbeChip key={probe.id} probe={probe} onOpen={onOpenProbe} />
            ))}
            {prototypes.map((prototype) => (
              <PrototypeChip key={prototype.id} prototype={prototype} />
            ))}
          </>
        ) : undefined
      }
    />
  )
}
