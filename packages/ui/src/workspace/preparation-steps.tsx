import { cn } from 'cn'
import type { FunctionComponent, ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'
import { Card } from '../components/card/card.tsx'
import {
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconCopy,
  IconGitFork,
  IconLink,
  IconLoader,
  IconPlayerPlay,
  IconPlayerSkipForward,
  type IconProps,
  IconRefresh,
} from '../icons.ts'
import type { PreparationStepLine, StepKind, StepState } from './model.ts'

/**
 * The preparation of a Workspace, one step under the other, in the order they run (D8-05).
 *
 * A worktree per repository, then the Project's recipe: each step says what it does, on what,
 * and where it stands, in a word and not only a colour. A failure stops the list where it is and
 * keeps what was done, so the failed step shows the message as Git, the disk or the command said
 * it, and the steps after it stay `pending`. Resuming re-checks what was done before it retries
 * anything, which the note under the button says, because it is what makes pressing it safe.
 *
 * A preparation Hemera was closed in the middle of has no failed step: the step that was running
 * is `pending` again, and the Workspace still says it is being prepared while nothing prepares it.
 * That is resumed the same way, and the list says why it stopped.
 */
const STEPS = 'flex flex-col'

const STEP = 'flex items-start gap-3 border-b border-border py-2 last:border-b-0'

const KIND = 'flex shrink-0 pt-0.5 text-muted-foreground'

const WHAT = 'flex min-w-0 flex-1 flex-col gap-1 text-sm'

const TARGET = 'font-mono'

/** The message of a failure, as it is: every line of it, wrapped rather than cut. */
const MESSAGE =
  'rounded-md border border-border bg-muted px-2 py-1.5 font-mono text-xs break-words whitespace-pre-wrap text-foreground'

const WHY = 'text-xs text-muted-foreground'

const NOTE = 'text-sm text-muted-foreground'

const KIND_ICONS: Record<StepKind, FunctionComponent<IconProps>> = {
  worktree: IconGitFork,
  copy: IconCopy,
  link: IconLink,
  run: IconPlayerPlay,
}

const STATES: Record<
  StepState,
  { word: string; icon: FunctionComponent<IconProps>; tone: string }
> = {
  pending: { word: 'Pending', icon: IconCircleDashed, tone: 'text-muted-foreground' },
  running: { word: 'Running', icon: IconLoader, tone: 'text-info-muted-foreground' },
  done: { word: 'Done', icon: IconCircleCheck, tone: 'text-success-muted-foreground' },
  failed: { word: 'Failed', icon: IconCircleX, tone: 'text-destructive-muted-foreground' },
  skipped: { word: 'Skipped', icon: IconPlayerSkipForward, tone: 'text-muted-foreground' },
}

const STATE = 'flex shrink-0 items-center gap-1 text-sm'

export interface PreparationStepsProps {
  /** The steps, in the order they run. */
  steps: readonly PreparationStepLine[]
  /**
   * Re-checks what was done and retries the failed step; offered once a step has failed, or when
   * the preparation was interrupted.
   */
  onResume?: (() => void) | undefined
  /**
   * Whether the preparation stopped before it ended with no step failed: Hemera was closed while
   * it ran, and nothing prepares the Workspace any more.
   */
  interrupted?: boolean | undefined
  /** Where the card sits; never how it looks. */
  className?: string | undefined
}

export function PreparationSteps({
  steps,
  onResume,
  interrupted = false,
  className,
}: PreparationStepsProps): ReactNode {
  const failed = steps.some((step) => step.state === 'failed')
  const resumable = (failed || interrupted) && onResume !== undefined
  return (
    <Card
      title="Preparation"
      description="One step after the other. A failure stops the list and keeps what was done."
      className={className}
      footer={
        resumable ? (
          <>
            <Button variant="primary" size="sm" onClick={onResume}>
              <IconRefresh size="sm" aria-hidden="true" />
              Resume
            </Button>
            <p className={NOTE}>
              {failed
                ? 'What was done is checked again against the disk before anything is retried.'
                : 'Hemera was closed before the preparation ended. What was done is checked again against the disk before it carries on.'}
            </p>
          </>
        ) : undefined
      }
    >
      <ul className={STEPS} aria-label="Steps">
        {steps.map((step) => {
          const Kind = KIND_ICONS[step.kind]
          const state = STATES[step.state]
          const State = state.icon
          return (
            <li key={step.id} className={STEP}>
              <span className={KIND}>
                <Kind size="sm" aria-hidden="true" />
              </span>
              <span className={WHAT}>
                <span>
                  {step.kind} <span className={TARGET}>{step.target}</span>
                </span>
                {step.message !== undefined &&
                  (step.state === 'failed' ? (
                    <pre className={MESSAGE}>{step.message}</pre>
                  ) : (
                    <span className={WHY}>{step.message}</span>
                  ))}
              </span>
              <span className={cn(STATE, state.tone)}>
                <State size="sm" aria-hidden="true" />
                {state.word}
              </span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
