import { type VariantProps, cva } from 'class-variance-authority'
import { cn } from 'cn'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'

import { instant, ping, pinging, useTransition } from '../../motion.ts'

/**
 * Where something stands, said as a dot (design D17-04).
 *
 * A turn is a column of things that are queued, running, done, failed or cancelled, and saying
 * each of them in a word put five badges down one side of the thread: `Done` under `Done` under
 * `Done` is a column of labels that says nothing the reader did not already know, and it stole
 * the eye from the one line that had gone wrong. A dot says the same five things in the width of
 * a dot, and the colour is what is read rather than the word.
 *
 * The word is still there for whoever cannot see the colour: `label` is what a screen reader
 * hears, and without one the dot is decoration beside a line that already says what it is. That
 * is the honest default — a tool call names itself, and `Done` announced after the name is the
 * same sentence twice.
 *
 * Only `running` moves, and it moves twice: the dot breathes in opacity, and a ring leaves it
 * on the same beat — the `ping` kind of the preset. The breath is read once the eye is already
 * on the dot; the ring is what is read from the corner of the eye, which is where a reader
 * watching a thread actually is. Everything else is a state that has settled and does not move.
 *
 * Under reduced motion neither happens, and each is answered where it is written: `motion-safe`
 * leaves the breath out of the stylesheet, and `motion-reduce:hidden` takes the ring out of the
 * page — the same media query, answered by the browser, which is the only thing that can answer
 * it for a system preference. `useTransition` answers the other way of asking, a tree that said
 * `reducedMotion="always"`, by drawing no ring at all: a movement repeating for ever at no
 * duration is a ring stuck at full size.
 */
const dotVariants = cva('inline-block shrink-0 rounded-full', {
  variants: {
    status: {
      pending: 'bg-muted-foreground',
      running: 'bg-warning motion-safe:animate-breathe',
      success: 'bg-success',
      failure: 'bg-destructive',
      // Quieter than every other state, and on purpose: a call nobody ran is a line the eye is
      // meant to pass over, and the line of the window is exactly how loud that is.
      cancelled: 'bg-border',
    },
    size: {
      sm: 'size-1.5',
      md: 'size-2',
    },
  },
  defaultVariants: { status: 'pending', size: 'md' },
})

/**
 * The ring, behind the dot and exactly its size, so it travels out of the dot and not around
 * something else. `warning` because it is the running dot's own colour: a ring of any other
 * would be a second state announced beside the first.
 */
const RING = 'absolute inset-0 rounded-full bg-warning motion-reduce:hidden'

/** The room the ring travels in, which is the dot's own box and nothing more. */
const AROUND = 'relative inline-flex'

/** The five places a piece of work can be, and nothing in between. */
export type StatusTone = 'pending' | 'running' | 'success' | 'failure' | 'cancelled'

export interface StatusDotProps extends VariantProps<typeof dotVariants> {
  status: StatusTone
  /**
   * What whatever reads the page says about it.
   *
   * Left out, the dot is hidden from it: a dot beside a line that already names its own state is
   * a second voice saying the same thing.
   */
  label?: string | undefined
  /** Where the dot sits; never how it looks. */
  className?: string | undefined
}

export function StatusDot({ status, size, label, className }: StatusDotProps): ReactNode {
  const transition = useTransition(pinging)
  // No ring where there is nothing to wait on, and none where the reader asked for less
  // movement: `useTransition` hands back `instant` then, and a ring repeating at no duration is
  // a ring sitting at full size for ever.
  const ringing = status === 'running' && transition !== instant
  return (
    <span className={cn(AROUND, className)}>
      {/* Decoration, and nothing announced: an empty span with no role and no words is not
          something whatever reads the page has anything to say about. */}
      {ringing && <motion.span className={RING} animate={ping} transition={transition} />}
      <span
        role={label === undefined ? undefined : 'img'}
        aria-label={label}
        aria-hidden={label === undefined ? true : undefined}
        className={dotVariants({ status, size })}
      />
    </span>
  )
}
