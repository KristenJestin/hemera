import { cn } from 'cn'
import type { ReactNode } from 'react'

import { IconRestore, IconX } from '../icons.ts'
import { IconButton } from '../components/button/button.tsx'

/**
 * What is said when the agent could not take up its own session (design D17-18).
 *
 * An agent's session is a handle, and a handle outlives a process only when the agent keeps it:
 * after a restart, one agent resumes where it was and another has nothing to resume from. When
 * that happens Hemera can still rebuild the thread from what it kept itself, and the reader has
 * to be told which of the two they are looking at — a thread that was rebuilt looks exactly like
 * a thread that was resumed, and the difference matters the first time the agent refers to a file
 * it no longer remembers.
 *
 * So the banner names the agent, names the session, and says the bound: what is below it is what
 * Hemera had, not what the agent had.
 */
// The mark sits at the middle of the strip rather than at the top of it: the sentence is two
// lines at the width this banner is read at, and an icon hanging above them reads as a bullet
// the sentence has nothing to do with.
const BANNER = 'flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1.5'

const MARK = 'flex shrink-0 text-muted-foreground'

const TEXT = 'min-w-0 flex-1 text-xs text-muted-foreground'

const LEAD = 'font-medium text-foreground'

export interface ResumeFallbackBannerProps {
  /** The agent that could not take its session up again. */
  agent: string
  /** The session that was rebuilt, as the reader will see it named elsewhere. */
  session: string
  /** What was kept, said as a bound rather than as a promise. */
  kept?: string | undefined
  /** Dismisses the banner, when the reader has read it. */
  onDismiss?: (() => void) | undefined
  /** Where the banner sits; never how it looks. */
  className?: string | undefined
}

export function ResumeFallbackBanner({
  agent,
  session,
  kept,
  onDismiss,
  className,
}: ResumeFallbackBannerProps): ReactNode {
  return (
    <div role="status" className={cn(BANNER, className)}>
      <span aria-hidden="true" className={MARK}>
        <IconRestore size="sm" />
      </span>
      <p className={TEXT}>
        <span className={LEAD}>{`${agent} could not resume its own session.`}</span>
        {` This thread was rebuilt from what Hemera kept${
          kept === undefined ? '' : ` — ${kept}`
        }, and the agent does not remember it.`}
        <span className="sr-only">{` Session ${session}.`}</span>
      </p>
      {onDismiss === undefined ? null : (
        <IconButton
          variant="ghost"
          size="sm"
          icon={<IconX size="sm" />}
          aria-label="Dismiss"
          onClick={onDismiss}
        />
      )}
    </div>
  )
}
