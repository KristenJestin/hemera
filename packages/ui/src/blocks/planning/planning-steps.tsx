import type { ReactNode } from 'react'

import { Frame, FrameHeader } from '../../components/frame/frame.tsx'
import { type MarkState, StatusMark } from '../../components/status-mark/status-mark.tsx'
import { IconListCheck } from '../../icons.ts'
import type { PlanningStep, PlanningTarget, StepState } from './planning-progress.ts'

const MARK: Record<StepState, MarkState> = {
  todo: 'todo',
  running: 'running',
  waiting: 'waiting',
  done: 'done',
  failed: 'failed',
}

const ROW = 'flex min-w-0 items-start gap-2.5 px-4 py-2.5'

const PRESS =
  'flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-sm text-left outline-none focus-ring hover-motion hover:text-primary'

/** What a step says: its title, where it stands, and the Planner's next step on the one under way. */
function StepWords({ step }: { step: PlanningStep }): ReactNode {
  const quiet = step.state === 'todo'
  return (
    <>
      <span className={quiet ? 'text-sm text-muted-foreground' : 'text-sm font-medium'}>
        {step.title}
      </span>
      {step.detail !== null && (
        <span className="text-xs break-words text-muted-foreground">{step.detail}</span>
      )}
    </>
  )
}

export interface PlanningStepsProps {
  steps: readonly PlanningStep[]
  /** Brings the user to where a step leads. */
  onGo: (target: PlanningTarget) => void
}

/**
 * Where Planning stands, at the top of the rail, the same from the first second to Freeze: the
 * four steps with their marks and where each stands in a few words; on the step under way, what
 * the Planner said it does next; while the Spec is written, the vision to give meanwhile. A step
 * that leads somewhere is a button.
 */
export function PlanningSteps({ steps, onGo }: PlanningStepsProps): ReactNode {
  return (
    <section
      id="planning-steps"
      tabIndex={-1}
      aria-label="Where Planning stands"
      className="rounded-xl outline-none focus-ring"
    >
      <Frame header={<FrameHeader icon={<IconListCheck size="md" />} title="Planning" />}>
        <ol className="flex flex-col divide-y divide-border">
          {steps.map((step) => (
            <li key={step.id} aria-label={step.title} className={ROW} data-step={step.state}>
              <span className="flex pt-0.5">
                <StatusMark state={MARK[step.state]} size="sm" legend />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {step.target === null ? (
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <StepWords step={step} />
                  </div>
                ) : (
                  <button
                    type="button"
                    className={PRESS}
                    onClick={() => step.target !== null && onGo(step.target)}
                  >
                    <StepWords step={step} />
                  </button>
                )}
                {step.next !== null && (
                  <p className="text-xs break-words">
                    <span className="text-muted-foreground">Next: </span>
                    {step.next.charAt(0).toLowerCase() + step.next.slice(1)}
                  </p>
                )}
                {step.id === 'spec' && step.state === 'running' && (
                  <button
                    type="button"
                    className="w-fit rounded-sm text-xs text-primary outline-none focus-ring hover-motion hover:underline"
                    onClick={() => onGo({ kind: 'vision' })}
                  >
                    Give your vision
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Frame>
    </section>
  )
}
