import { Collapsible } from '@base-ui/react/collapsible'
import { cn } from 'cn'
import { motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { IconChevronDown } from '../icons.ts'
import { arrival, instant, useTransition } from '../motion.ts'

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
 * carries the fold in its chevron, which turns on a transform, and the body is uncovered: it is
 * in place at its full height from the first frame, and a `clip-path` walks down it while it
 * fades in, which is a wipe rather than a box being resized. The body is mounted when it opens,
 * which is what makes that arrival possible: a console re-reads its bottom when it is opened
 * again, which is where a live console belongs.
 *
 * What the fold moves is not this component's business, and is not teleported either: whatever
 * holds a column of folds — the thread, in `message/scroller` — carries the blocks under it on
 * `layout`, so the page below travels instead of arriving already somewhere else (trial of
 * 22 September 2026).
 */

/** The row, which is the control: it answers the pointer anywhere on its width. */
const TRIGGER =
  'flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm outline-none select-none focus-ring hover:bg-accent'

/** The mark of the fold, at the end of the row where the eye ends up rather than where it starts. */
const CHEVRON = 'ml-auto flex shrink-0 items-center justify-center text-muted-foreground'

/** What is inside, indented under the line that announced it. */
const BODY = 'pt-1 pb-0.5 pl-8'

/** The body before it is uncovered: nothing of it showing, cut from the bottom edge up. */
const UNCOVERED = 'inset(0% 0% 100% 0%)'

/** And the whole of it, which is what the wipe walks down to. */
const WHOLE = 'inset(0% 0% 0% 0%)'

/** The fade that goes with the wipe, as a filter rather than an opacity. */
const FADED = 'opacity(0)'

const SHOWN = 'opacity(1)'

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
  // `useTransition` hands back this very object when the system asks for less movement, and a
  // block travelling to its new place is movement: the fold stops being a layout element at all
  // then, rather than being one with no time to move in.
  const still = transition === instant
  return (
    /*
      The fold is a layout element, and this is what makes the page below it move rather than
      jump: motion measures the tree the moment this re-renders — which is every time the block
      opens or closes — and carries whatever changed place to its new one. `position`, so the
      block's own box is never animated: what grows is a body appearing at its full height, and
      a box eased into a new size would stretch everything drawn inside it.
    */
    <motion.div layout={still ? false : 'position'} transition={transition} className="w-full">
      <Collapsible.Root
        open={shown}
        // A controlled block is the caller's answer: the reader's press is reported and the
        // shown state stays whatever the caller said.
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
          {/*
            The wipe: the body is laid out at its full height at once and uncovered from the top
            down. A `clip-path` and a `filter` are the two of it, and the fade is a filter rather
            than an `opacity` for the reason the foot of a message gives — the accessibility
            check of the catalogue measures a text's contrast through an opacity and refuses the
            value it would read mid-flight, while a filter is not part of what it measures.
          */}
          <motion.div
            key={shown ? 'open' : 'closed'}
            initial={{ filter: FADED, clipPath: UNCOVERED }}
            animate={{ filter: SHOWN, clipPath: WHOLE }}
            transition={transition}
          >
            {children}
          </motion.div>
        </Collapsible.Panel>
      </Collapsible.Root>
    </motion.div>
  )
}
