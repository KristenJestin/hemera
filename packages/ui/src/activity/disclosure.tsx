import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useId, useState } from 'react'

import { IconChevronDown } from '../icons.ts'
import { arrival, collapse, expand, instant, morph, useTransition } from '../motion.ts'

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
 * pointer that lands anywhere on the row is a pointer that opens it.
 *
 * **The body grows and folds, and the fold is the growth played backwards** — the `expand` and
 * `collapse` kinds of the preset, on `morph`, which is the spring made for a dimension. Until
 * the trial of 22 September 2026 it opened with a `clip-path` walking down a body already laid
 * out at full height, and closed by vanishing: D0-06 forbade animating a height, so there was
 * no opening to play backwards, and Base UI's `Collapsible` took the body out of the page the
 * moment the state changed — a panel only stays mounted for it while a *CSS* animation is
 * running, and a spring driven in JavaScript is not one. Two things had to go for the close to
 * read: the missing `exit`, and the thing that unmounted the body before any exit could play.
 * So the fold carries its own state — a button with `aria-expanded` and the body it names —
 * and `AnimatePresence` holds the body in the page for exactly as long as it takes to fold.
 *
 * The body is mounted when it opens and gone once it has closed, which is what makes both ends
 * of that possible: a console re-reads its bottom when it is opened again, which is where a
 * live console belongs.
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

/**
 * What holds the height, and holds nothing else: the room the body is given, which is what
 * grows and folds. The padding is on the body inside it — a box eased down to no height with
 * its own padding still on it is a box that stops at the padding and never closes.
 */
const ROOM = 'overflow-hidden'

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
  // A dimension has a spring of its own: it arrives without ever turning round, and a body that
  // overshot its height would take the whole column below it along.
  const folding = useTransition(morph)
  // `useTransition` hands back this very object when the system asks for less movement, and a
  // block travelling to its new place is movement: the fold stops being a layout element at all
  // then, rather than being one with no time to move in.
  const still = transition === instant
  const body = useId()
  return (
    /*
      The fold is a layout element, and this is what makes the page below it move rather than
      jump: motion measures the tree the moment this re-renders — which is every time the block
      opens or closes — and carries whatever changed place to its new one. `position`, so the
      block's own box is never animated: what grows is the room under the row, and a box eased
      into a new size would stretch everything drawn inside it.
    */
    <motion.div
      layout={still ? false : 'position'}
      transition={transition}
      className={cn('w-full', className)}
    >
      <button
        type="button"
        className={TRIGGER}
        aria-expanded={shown}
        // Named only while it is there: a reference that resolves to nothing is a broken one,
        // and the body is taken out of the page once it has finished folding.
        aria-controls={shown ? body : undefined}
        // A controlled block is the caller's answer: the reader's press is reported and the
        // shown state stays whatever the caller said.
        onClick={() => {
          setAsked(!shown)
          onOpenChange?.(!shown)
        }}
      >
        {summary}
        <motion.span
          aria-hidden="true"
          className={CHEVRON}
          animate={{ rotate: shown ? 180 : 0 }}
          transition={transition}
        >
          <IconChevronDown size="sm" />
        </motion.span>
      </button>
      {/*
        The room under the row, which is what opens and what closes. `AnimatePresence` is the
        whole of the fix of 22 September 2026: without it the body is taken out of the page the
        frame the state changes, and there is nothing left to play the opening backwards on.
      */}
      <AnimatePresence initial={false}>
        {shown && (
          <motion.div
            id={body}
            className={ROOM}
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <div className={BODY}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
