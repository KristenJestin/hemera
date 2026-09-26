import type { ReactNode } from 'react'

import { UsageMeter, type UsageMeterProps } from '../composer/usage-meter.tsx'
import { ActivityRow, type ActivityRowProps } from './activity-row.tsx'

/**
 * The row above the box: what the turn is doing on the left, what it has spent on the right
 * (design D17-13, D17-14; trial of 22 September 2026).
 *
 * The two are one reading of one turn, so they share a row, and the row is drawn as soon as
 * either has something to say. The meter keeps its end of it whether or not a turn is running.
 *
 * The meter stands at the foot of the row, above the box, and nothing that opens beside it moves
 * it (recette of 26 September 2026, issue #134). The activity row opens the thought arriving now
 * under its line, and the row grows upwards from the box: centred, the meter rose by half of
 * every line the thought took; at the foot, it stays where the eye left it. Folded, the box it
 * stands in is as tall as the activity row's own line, so the two still read as one line.
 */
const ROW = 'flex items-end justify-between gap-3'

/** The meter's place: the height of the activity row's line, the meter centred in it. */
const METER = 'flex h-6 shrink-0 items-center'

export interface TurnLineProps {
  /** What the turn is doing, or `null` when no turn has run since the last message. */
  activity: ActivityRowProps | null
  /** What the Session has spent, or `null` when no agent has accounted for it yet (D5-20). */
  usage: UsageMeterProps | null
}

export function TurnLine({ activity, usage }: TurnLineProps): ReactNode {
  if (activity === null && usage === null) return null
  return (
    <div className={ROW}>
      {activity === null ? <span /> : <ActivityRow {...activity} />}
      {usage !== null && (
        <span className={METER}>
          <UsageMeter {...usage} />
        </span>
      )}
    </div>
  )
}
