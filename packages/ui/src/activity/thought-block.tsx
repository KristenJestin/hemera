import type { ReactNode } from 'react'

import { IconSparkles } from '../icons.ts'
import { Disclosure } from './disclosure.tsx'

/**
 * What the agent thought before it acted (design D17-05).
 *
 * Reasoning is the one part of a turn that is worth keeping and not worth showing. It is kept
 * because a turn that answered poorly is best explained by what it was thinking, and it is
 * folded because twenty lines of it in front of every answer would push the answer itself off
 * the screen. What stays on the line is how long it took, which is the only fact about a thought
 * that can be read at a glance without reading it.
 *
 * It has no summary of its own to make: an agent's thinking is not a title anyone can write, and
 * a component that invented one would be putting words in the agent's mouth. The duration it
 * takes from the notification, and nothing else.
 */
export interface ThoughtBlockProps {
  /** How long the agent thought, in seconds, as the notification reports it. */
  seconds: number
  /** What it thought, handed over already written. */
  children: ReactNode
  /** Whether it starts open, for a story or for a reader who always reads it. */
  defaultOpen?: boolean | undefined
  /** Where the block sits; never how it looks. */
  className?: string | undefined
}

/** The line that is read: the mark, then how long it was. */
const SUMMARY = 'flex min-w-0 items-center gap-2'

/** The thought itself, quieter than the answer it produced. */
const TEXT = 'text-sm whitespace-pre-wrap text-muted-foreground'

export function ThoughtBlock({
  seconds,
  children,
  defaultOpen = false,
  className,
}: ThoughtBlockProps): ReactNode {
  return (
    <Disclosure
      className={className}
      defaultOpen={defaultOpen}
      summary={
        <span className={SUMMARY}>
          <span className="flex shrink-0 text-muted-foreground">
            <IconSparkles size="sm" aria-hidden="true" />
          </span>
          <span className="text-muted-foreground">Thought for {seconds}s</span>
        </span>
      }
    >
      <p className={TEXT}>{children}</p>
    </Disclosure>
  )
}
