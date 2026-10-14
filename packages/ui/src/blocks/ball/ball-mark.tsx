import type { ReactNode } from 'react'

import { Face } from '../../components/face/face.tsx'
import { type MarkState, StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { type Ball, BALL_LEGENDS } from './ball-legends.ts'

/** The status mark each state that is not the agent's is said by. */
const MARKS: Record<Ball, MarkState> = {
  agent: 'running',
  you: 'waiting',
  someone: 'todo',
  blocked: 'blocked',
  idle: 'idle',
}

export interface BallMarkProps {
  ball: Ball
  /** Whether its state is said in a tooltip on the mark; left out, it is decoration. */
  legend?: boolean | undefined
  /** Whether the agent at work is Hemera's face rather than the running arc: the mission's header only. */
  face?: boolean | undefined
}

export function BallMark({ ball, legend = false, face = false }: BallMarkProps): ReactNode {
  if (ball === 'agent' && face) {
    return legend ? (
      <Face state="thinking" size="icon" label={BALL_LEGENDS.agent} legend />
    ) : (
      <span aria-hidden="true" className="inline-flex shrink-0" data-ball="agent">
        <Face state="thinking" size="icon" label={BALL_LEGENDS.agent} />
      </span>
    )
  }
  const mark = (
    <span aria-hidden="true" className="inline-flex shrink-0" data-ball={ball}>
      <StatusMark state={MARKS[ball]} size="sm" />
    </span>
  )
  if (!legend) return mark
  return <Legend label={BALL_LEGENDS[ball]}>{mark}</Legend>
}
