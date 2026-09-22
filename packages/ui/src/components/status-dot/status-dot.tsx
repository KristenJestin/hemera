import { type VariantProps, cva } from 'class-variance-authority'
import { cn } from 'cn'
import type { ReactNode } from 'react'

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
 * Only `running` moves, and it moves in opacity alone: a dot that is breathing is the one state
 * the reader is waiting on, and everything else is a state that has settled. Under reduced
 * motion `motion-safe` leaves the animation out of the stylesheet entirely, and the dot stays
 * exactly where and as it is.
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
  return (
    <span
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      className={cn(dotVariants({ status, size }), className)}
    />
  )
}
