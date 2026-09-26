import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'
import { IconMessage } from '../icons.ts'

const CARD = 'flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3'
const WORDS = 'text-sm text-muted-foreground'
const ACTIONS = 'flex flex-wrap items-center gap-2'

export interface ReviewCardProps {
  /** Opens the chat, where the review is written: the build waits for it (issue #117). */
  onOpenChat: () => void
  /** Where the card sits; never how it looks. */
  className?: string
}

/**
 * The last step of a build is the user's: every story is done and the final checks are green, so
 * what is left is the review. It is written in the chat, as the user would say it, and sending it
 * hands it to the agent and sends the build back to work (D10-07, issue #117). Accept stays where
 * the head put it, and is refused while that work runs.
 */
export function ReviewCard({ onOpenChat, className }: ReviewCardProps): ReactNode {
  return (
    <div className={cn(CARD, className)}>
      <p className="font-medium">Every story is done. Your review is next.</p>
      <p className={WORDS}>
        Write what to change in the chat, as you would say it: bullets, pasted screenshots. The
        build goes back to work on it, and its final checks run again before Accept.
      </p>
      <div className={ACTIONS}>
        <Button variant="secondary" size="sm" onClick={onOpenChat}>
          <IconMessage size="sm" aria-hidden="true" />
          Write your review in the chat
        </Button>
      </div>
    </div>
  )
}
