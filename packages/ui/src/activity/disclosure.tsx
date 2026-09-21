import { Collapsible } from '@base-ui/react/collapsible'
import { cn } from 'cn'
import { motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { IconChevronDown } from '../icons.ts'
import { arrival, useTransition } from '../motion.ts'

/**
 * What folds: a line that is read while it is closed, and what is inside once it is asked for
 * (design D17-05).
 *
 * Three of the blocks of a turn are the same shape — a thought, a tool call, the console of a
 * command — and the shape is what keeps a turn readable rather than what decorates it. An agent
 * writes twenty lines of reasoning and four tool calls to answer one question; a thread that
 * showed all of it would be a thread nobody finishes, and one that showed none of it would be a
 * thread nobody trusts. So each block says what it is in one line and waits.
 *
 * The heading is the trigger and the whole row is it: an 8 px chevron is a hard target, and the
 * pointer that lands anywhere on the row is a pointer that opens it. Base UI carries the state,
 * the `aria-expanded` and the `hidden` of the closed body; this adds the shape and the movement.
 *
 * The height is not animated, and that is deliberate rather than unfinished. The design system
 * only ever animates `transform`, `opacity`, `filter` and `clip-path` — a lint check refuses the
 * rest — and the one property a panel would want to ease is the one nobody may touch. So the row
 * carries the fold in its chevron, which turns on a transform, and the body arrives on a fade and
 * a short rise. The body is mounted when it opens, which is what makes that arrival possible: a
 * console re-reads its bottom when it is opened again, which is where a live console belongs.
 */

/** The row, which is the control: it answers the pointer anywhere on its width. */
const TRIGGER =
  'flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm outline-none select-none focus-ring hover:bg-accent'

/** The mark of the fold, at the end of the row where the eye ends up rather than where it starts. */
const CHEVRON = 'ml-auto flex shrink-0 items-center justify-center text-muted-foreground'

/** What is inside, indented under the line that announced it. */
const BODY = 'pt-1 pb-0.5 pl-8'

export interface DisclosureProps {
  /** The line read while the body is closed, handed over already drawn. */
  summary: ReactNode
  /** What the block holds; drawn only while it is open. */
  children: ReactNode
  /**
   * Whether it is open, when the caller decides instead of the reader.
   *
   * A tool call that is running is open because a call in flight is what the reader is waiting
   * on, and it is the caller that knows the call is in flight. Left out, the reader decides and
   * the block opens on `defaultOpen`.
   */
  open?: boolean | undefined
  /** Whether it starts open, for a block the reader is expected to want. */
  defaultOpen?: boolean | undefined
  /** What a fold or an unfold by the reader reports, for a caller that keeps the answer. */
  onOpenChange?: ((open: boolean) => void) | undefined
  /** Where the block sits; never how it looks. */
  className?: string | undefined
}

export function Disclosure({
  summary,
  children,
  open,
  defaultOpen = false,
  onOpenChange,
  className,
}: DisclosureProps): ReactNode {
  const [asked, setAsked] = useState(defaultOpen)
  const shown = open ?? asked
  const transition = useTransition(arrival)
  return (
    <Collapsible.Root
      open={shown}
      // A controlled block is the caller's answer: the reader's press is reported and the shown
      // state stays whatever the caller said, which is how a running call cannot be folded.
      onOpenChange={(next) => {
        setAsked(next)
        onOpenChange?.(next)
      }}
      className={cn('w-full', className)}
    >
      <Collapsible.Trigger className={TRIGGER}>
        {summary}
        <motion.span
          aria-hidden="true"
          className={CHEVRON}
          animate={{ rotate: shown ? 180 : 0 }}
          transition={transition}
        >
          <IconChevronDown size="sm" />
        </motion.span>
      </Collapsible.Trigger>
      <Collapsible.Panel className={BODY}>
        <motion.div
          key={shown ? 'open' : 'closed'}
          initial={{ y: -4 }}
          animate={{ y: 0 }}
          transition={transition}
        >
          {children}
        </motion.div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
