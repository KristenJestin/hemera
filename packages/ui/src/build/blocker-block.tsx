import { cn } from 'cn'
import { type ReactNode, useId } from 'react'

import { Button } from '../components/button/button.tsx'
import { IconHandStop } from '../icons.ts'
import type { BuildBlockerView } from './model.ts'
import { StopBuild } from './stop-build.tsx'
import { ago } from './times.ts'

/**
 * The agent saying a task contradicts the Spec (D10-08): the task and the tasks that depend on it
 * are suspended, the others go on, and the build cannot finish until the user answers.
 *
 * Two answers, and no third: the Spec is frozen once a build started, so nothing here offers to
 * change it. "Dismiss" says the Spec stands — the task goes back to ready, and the agent is handed
 * it again. "Stop build" ends the build, which is how a Spec that is wrong goes back to being
 * written.
 *
 * Drawn two ways, like the user's tasks: in the build view with the agent's reason whole, and as
 * a banner above the chat's composer that says it on one line.
 */

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
  /** The Spec the build is of, which Stop names. */
  specKey: string
  /** The caller's now, which the time of the blocker is said from. */
  now: string
  /** In the build view, or as the banner above the chat's composer. */
  variant?: 'view' | 'banner' | undefined
  /** The labels of the tasks suspended with it, because they depend on it. */
  suspended: readonly string[]
  /** The Spec stands: the task goes back to ready. */
  onDismiss: () => void
  onStop: () => void
  /** Shows the task in the build view; the banner offers it when given. */
  onOpen?: (() => void) | undefined
  /** Where the block sits; never how it looks. */
  className?: string | undefined
}

export function BlockerBlock({
  blocker,
  specKey,
  now,
  variant = 'view',
  suspended,
  onDismiss,
  onStop,
  onOpen,
  className,
}: BlockerBlockProps): ReactNode {
  const named = useId()
  const dismiss = (
    <Button variant="secondary" size="sm" onClick={onDismiss}>
      Dismiss
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
        {dismiss}
        <StopBuild specKey={specKey} onStop={onStop} />
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
          ? 'The other tasks go on. Dismiss it if the Spec stands: the task goes back to ready.'
          : `${suspended.join(', ')} ${suspended.length === 1 ? 'waits' : 'wait'} with it; the other tasks go on. Dismiss it if the Spec stands: the task goes back to ready.`}
      </p>
      <div className={ACTIONS}>
        {dismiss}
        <StopBuild specKey={specKey} onStop={onStop} />
      </div>
    </div>
  )
}
