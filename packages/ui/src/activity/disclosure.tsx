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

/**
 * The line: the control, and nothing below it ever moves it, which is why a press of the
 * block's own lives on it rather than beside the whole fold: a press centred on a block that
 * grows is a press that slides while it opens (trial of 23 September 2026).
 */
const LINE = 'flex w-full min-w-0 items-center gap-2'

/** The row, which is the control: it answers the pointer anywhere on its width. */
const TRIGGER =
  'flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm outline-none select-none focus-ring hover:bg-accent'

/** The line when there is nothing to open: the trigger's own box, with none of its answers. */
const FLAT = 'flex min-w-0 flex-1 items-center gap-2 px-1 py-0.5 text-sm'

/** The line of a summary that holds a press of its own: the control is laid under it. */
const HELD_LINE = 'relative flex w-full min-w-0 items-center'

/**
 * The control under such a line: the whole row, as wide and as tall as it, and named by the
 * summary drawn over it.
 */
const UNDER = 'absolute inset-0 rounded-md outline-none focus-ring hover:bg-accent'

/**
 * The summary drawn over the control: the pointer goes through it to the row underneath,
 * except on the one press it holds, which takes the pointer back for itself.
 */
const OVER =
  'pointer-events-none relative flex min-w-0 flex-1 items-center gap-2 px-1 py-0.5 text-left text-sm select-none'

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
  /**
   * Whether the summary holds a press of its own: the file a call is about, drawn where it is
   * read rather than at the end of the line (recette 3 of 23 September 2026).
   *
   * A control cannot hold a control: a button inside the fold's button is one the keyboard walks
   * over and a screen reader never announces, and a press on it would fold the block as well. So
   * such a summary is drawn *over* the row's control instead of inside it: the control is the
   * whole line underneath, named by the summary, and the pointer goes through the summary to it
   * everywhere but on the press, which the caller wraps in `pointer-events-auto`.
   */
  holdsPress?: boolean | undefined
  /**
   * What the block holds; drawn only while it is open.
   *
   * Left out, there is nothing to open: the line is then the row itself, with no chevron and
   * nothing to press, because a control that opens onto nothing is a control that lied about
   * what it had. The fold is drawn either way, so a block that gains a body arrives into the one
   * it was already wearing rather than into a second one built beside it.
   */
  children?: ReactNode | undefined
  /**
   * Whether it is open, when the caller decides instead of the reader.
   *
   * A tool card holds the reader's answer itself, so that it survives the entry being written
   * again. Left out, the fold holds it and opens on `defaultOpen`.
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
  holdsPress = false,
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
  const named = useId()
  // Named only while it is there: a reference that resolves to nothing is a broken one, and the
  // body is taken out of the page once it has finished folding.
  const controls = shown ? body : undefined
  // A controlled block is the caller's answer: the reader's press is reported and the shown state
  // stays whatever the caller said.
  const press = () => {
    setAsked(!shown)
    onOpenChange?.(!shown)
  }
  const chevron = (
    <motion.span
      aria-hidden="true"
      className={CHEVRON}
      animate={{ rotate: shown ? 180 : 0 }}
      transition={transition}
    >
      <IconChevronDown size="sm" />
    </motion.span>
  )
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
      {children === undefined ? (
        // Nothing to open, so nothing to press: the line is the row, drawn in the same fold a
        // block with a body wears.
        <div className={LINE}>
          <span className={FLAT}>{summary}</span>
        </div>
      ) : (
        <>
          {holdsPress ? (
            <div className={HELD_LINE}>
              <button
                type="button"
                className={UNDER}
                aria-expanded={shown}
                aria-controls={controls}
                aria-labelledby={named}
                onClick={press}
              />
              <span id={named} className={OVER}>
                {summary}
                {chevron}
              </span>
            </div>
          ) : (
            <div className={LINE}>
              <button
                type="button"
                className={TRIGGER}
                aria-expanded={shown}
                aria-controls={controls}
                onClick={press}
              >
                {summary}
                {chevron}
              </button>
            </div>
          )}
          {/*
            The room under the row, which is what opens and what closes. `AnimatePresence` is
            the whole of the fix of 22 September 2026: without it the body is taken out of the
            page the frame the state changes, and there is nothing left to play the opening
            backwards on.
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
        </>
      )}
    </motion.div>
  )
}
