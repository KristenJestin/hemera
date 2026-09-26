import { cn } from 'cn'
import { type ReactNode, useId, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { Textarea } from '../components/field/field.tsx'
import { IconHandStop } from '../icons.ts'
import type { BuildBlockerView } from './model.ts'
import { ago } from './times.ts'

const BLOCK =
  'flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive-muted px-4 py-3'

const BANNER =
  'flex flex-wrap items-center gap-2 rounded-md border border-destructive bg-destructive-muted px-2 py-1'

const LEAD = 'flex items-center gap-2 text-sm font-medium text-destructive-muted-foreground'

const WHEN = 'font-normal text-muted-foreground'

const BANNER_TEXT = 'min-w-0 flex-1 text-xs text-destructive-muted-foreground'

const REASON = 'border-l-2 border-destructive/40 pl-3 text-sm text-foreground'

const NOTE = 'text-sm text-muted-foreground'

const ACTIONS = 'flex flex-wrap items-center gap-2'

export interface BlockerBlockProps {
  blocker: BuildBlockerView
  /** The caller's now, which the time of the blocker is said from. */
  now: string
  /** In the build view, or as the banner above the chat's composer. */
  variant?: 'view' | 'banner' | undefined
  /** The labels of the tasks suspended with it, because they depend on it. */
  suspended: readonly string[]
  /**
   * The Spec stands: the task goes back to ready, with the note the user wrote beside the
   * dismissal (issue #117) or nothing when they wrote none.
   */
  onDismiss: (note: string | null) => void
  /** Shows the task in the build view; the banner offers it when given. */
  onOpen?: (() => void) | undefined
  /** Where the block sits; never how it looks. */
  className?: string | undefined
}

export function BlockerBlock({
  blocker,
  now,
  variant = 'view',
  suspended,
  onDismiss,
  onOpen,
  className,
}: BlockerBlockProps): ReactNode {
  const named = useId()
  const [note, setNote] = useState('')
  const written = note.trim()
  /** Dismissed with what the user wrote, or with nothing when they wrote none. */
  const dismiss = (added: string | null) => (
    <Button variant="secondary" size="sm" onClick={() => onDismiss(added)}>
      The Spec stands
    </Button>
  )

  if (variant === 'banner') {
    return (
      <div role="group" aria-labelledby={named} className={cn(BANNER, className)}>
        <p id={named} className={BANNER_TEXT}>
          {`${blocker.label}: the agent says this task contradicts the Spec`}
        </p>
        {onOpen !== undefined && (
          <Button variant="ghost" size="sm" onClick={onOpen}>
            Open
          </Button>
        )}
        {dismiss(null)}
      </div>
    )
  }

  return (
    <div role="group" aria-labelledby={named} className={cn(BLOCK, className)}>
      <p className={LEAD}>
        <IconHandStop size="sm" aria-hidden="true" />
        <span id={named}>The agent says this task contradicts the Spec</span>
        <span className={WHEN}>{ago(blocker.raisedAt, now)}</span>
      </p>
      <blockquote className={REASON}>{blocker.reason}</blockquote>
      <p className={NOTE}>
        {suspended.length === 0
          ? 'The other tasks go on. If the Spec stands, say so: the task goes back to ready.'
          : `${suspended.join(', ')} ${suspended.length === 1 ? 'waits' : 'wait'} with it; the other tasks go on. If the Spec stands, say so: the task goes back to ready.`}
      </p>
      <Textarea
        label="A note for the agent"
        description="Optional: it goes to the agent with your answer."
        placeholder="The Spec stands, and the refund ships in the next one."
        rows={2}
        value={note}
        onValueChange={setNote}
      />
      <div className={ACTIONS}>{dismiss(written === '' ? null : written)}</div>
    </div>
  )
}
