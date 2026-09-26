import { cn } from 'cn'
import { type ReactNode, useEffect, useId, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { Checkbox } from '../components/checkbox/checkbox.tsx'
import { Dialog } from '../components/dialog/dialog.tsx'
import { Textarea } from '../components/field/field.tsx'
import { IconCheck, IconPlayerSkipForward, IconUser } from '../icons.ts'
import { type BuildTaskView, TRIES, placeLabel } from './model.ts'
import { tryLabel } from './times.ts'

/**
 * A task that is the user's (D10-08, D10-03): a human task that became ready, or an agent's task
 * whose checks were red three times (D10-07). The build does not wait on it — the other ready
 * tasks go on — but the task and what depends on it do, until the user answers.
 *
 * Two answers. "Done" says the user did it: a human task done by hand, or the agent's task the
 * user finished in the Workspace. "Skip" asks why, and — when other tasks depend on it — whether
 * they may go on without it; left unticked, they wait, and the build cannot finish without them
 * (D10-03). The reason is kept with the build: a skipped task is never hidden.
 *
 * Drawn two ways. In the build view, the block says what is asked — the result and how it is
 * checked, or the three failures — and offers both answers. Above the composer of the chat, the
 * banner says it on one line, with the same answers and a way to the task in the view.
 */

const BLOCK = 'flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning-muted px-4 py-3'

const BANNER =
  'flex flex-wrap items-center gap-2 rounded-md border border-warning bg-warning-muted px-2 py-1'

const LEAD = 'flex items-center gap-2 text-sm font-medium text-warning-muted-foreground'

const BANNER_TEXT = 'min-w-0 flex-1 text-xs text-warning-muted-foreground'

const ASKED = 'flex flex-col gap-2 text-sm text-foreground'

const TERM = 'text-xs font-medium text-muted-foreground'

const FAILURES = 'flex flex-col gap-1 text-sm'

const FAILURE = 'flex min-w-0 flex-wrap items-baseline gap-x-2'

const FAILURE_TRY = 'shrink-0 font-medium text-foreground'

const FAILURE_DETAIL = 'font-mono text-xs text-destructive-muted-foreground'

const NOTE = 'text-sm text-muted-foreground'

const ACTIONS = 'flex flex-wrap items-center gap-2'

export interface YoursBlockProps {
  task: BuildTaskView
  /** In the build view, or as the banner above the chat's composer. */
  variant?: 'view' | 'banner' | undefined
  /** The labels of the tasks that depend on it, which Skip asks about. */
  dependants: readonly string[]
  /** The user did it. */
  onDone: () => void
  /** The user skips it, saying why, and whether its dependants go on (D10-03). */
  onSkip: (reason: string, unblock: boolean) => void
  /** Shows the task in the build view; the banner offers it when given. */
  onOpen?: (() => void) | undefined
  /** Where the block sits; never how it looks. */
  className?: string | undefined
}

/** The red checks of each of the last three tries, which is what came back to the user. */
function failuresOf(task: BuildTaskView): { number: number; said: string[] }[] {
  return task.attempts
    .filter((attempt) => attempt.result === 'red')
    .toSorted((one, other) => one.number - other.number)
    .slice(-TRIES)
    .map((attempt) => ({
      number: attempt.number,
      said: attempt.checks
        .filter((check) => check.verdict === 'red')
        .map((check) => `${check.name} on ${placeLabel(check.place)}: ${check.detail ?? 'red'}`),
    }))
}

export function YoursBlock({
  task,
  variant = 'view',
  dependants,
  onDone,
  onSkip,
  onOpen,
  className,
}: YoursBlockProps): ReactNode {
  const [skipping, setSkipping] = useState(false)
  const named = useId()
  // An agent's task is the user's only after three red tries (D10-07).
  const cameBack = task.executor === 'agent'
  const lead = cameBack
    ? `${task.label} came back to you after ${String(TRIES)} red tries`
    : `Yours: ${task.label} · ${task.title}`
  const answers = (
    <>
      <Button variant="primary" size="sm" onClick={onDone}>
        <IconCheck size="sm" />
        Done
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setSkipping(true)}>
        <IconPlayerSkipForward size="sm" />
        Skip…
      </Button>
    </>
  )
  const dialog = (
    <SkipDialog
      open={skipping}
      onOpenChange={setSkipping}
      label={task.label}
      dependants={dependants}
      onSkip={(reason, unblock) => {
        setSkipping(false)
        onSkip(reason, unblock)
      }}
    />
  )

  if (variant === 'banner') {
    return (
      <div role="group" aria-labelledby={named} className={cn(BANNER, className)}>
        <p id={named} className={BANNER_TEXT}>
          {lead}
        </p>
        {onOpen !== undefined && (
          <Button variant="ghost" size="sm" onClick={onOpen}>
            Open
          </Button>
        )}
        {answers}
        {dialog}
      </div>
    )
  }

  return (
    <div role="group" aria-labelledby={named} className={cn(BLOCK, className)}>
      <p id={named} className={LEAD}>
        <IconUser size="sm" aria-hidden="true" />
        {cameBack ? lead : 'Yours: the agent does not do this task'}
      </p>
      {cameBack ? (
        <ol aria-label={`Failures of ${task.label}`} className={FAILURES}>
          {failuresOf(task).map((failure) => (
            <li key={failure.number} className={FAILURE}>
              <span className={FAILURE_TRY}>{tryLabel(failure.number)}</span>
              {failure.said.map((said) => (
                <span key={said} className={FAILURE_DETAIL}>
                  {said}
                </span>
              ))}
            </li>
          ))}
        </ol>
      ) : (
        <div className={ASKED}>
          <p className={TERM}>What it delivers</p>
          <p>{task.result}</p>
          <p className={TERM}>How it is checked</p>
          <p>{task.criteria}</p>
        </div>
      )}
      <p className={NOTE}>
        {cameBack
          ? 'Fix it in the Workspace and mark it done, or skip it.'
          : 'Do it, then mark it done, or skip it.'}
      </p>
      <div className={ACTIONS}>{answers}</div>
      {dialog}
    </div>
  )
}

interface SkipDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The task skipped: `T4`. */
  label: string
  /** The labels of the tasks that depend on it; the question about them is asked only then. */
  dependants: readonly string[]
  onSkip: (reason: string, unblock: boolean) => void
}

/** Why a task is skipped, and whether what depends on it goes on (D10-03). */
function SkipDialog({ open, onOpenChange, label, dependants, onSkip }: SkipDialogProps): ReactNode {
  const [reason, setReason] = useState('')
  const [unblock, setUnblock] = useState(false)

  // Opened is opened anew: a reason typed and cancelled is not the next skip's.
  useEffect(() => {
    if (!open) return
    setReason('')
    setUnblock(false)
  }, [open])

  const waiting = dependants.join(', ')
  return (
    <Dialog
      title={`Skip ${label}?`}
      description="Say why: the reason stays with the build, and the task shows as skipped."
      open={open}
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={reason.trim() === ''}
            onClick={() => onSkip(reason.trim(), unblock)}
          >
            {`Skip ${label}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Textarea
          label="Reason"
          placeholder="Credit notes ship with the next Spec."
          rows={3}
          value={reason}
          onValueChange={setReason}
        />
        {dependants.length > 0 && (
          <Checkbox
            label={`Let ${waiting} go on without it`}
            description={`Left unticked, ${waiting} ${dependants.length === 1 ? 'waits' : 'wait'}, and the build cannot finish without ${dependants.length === 1 ? 'it' : 'them'}.`}
            checked={unblock}
            onCheckedChange={setUnblock}
          />
        )}
      </div>
    </Dialog>
  )
}
