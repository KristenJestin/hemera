import { cn } from 'cn'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react'

import { IconChevronDown } from '../icons.ts'
import { arrival, collapse, expand, fold, instant, useTransition } from '../motion.ts'

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
 * `collapse` kinds of the preset, on the `fold` kind: `morph`, the spring made for a dimension,
 * with no speed to carry, so a press that catches the body still opening turns it round where it
 * is rather than on the frame after it (issue #64). Until the trial of 22 September 2026 it
 * opened with a `clip-path` walking down a body already laid out at full height, and closed by
 * vanishing: D0-06 forbade animating a height, so there was
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
 * A body on its way out is still in the page, and it is no longer the reader's: from the press
 * that closes it the body is `inert`, so the keyboard does not walk into what has just been closed
 * and nothing it holds is announced (issue #69). The row goes on naming it until it has left — a
 * reference that resolves to nothing is a broken one — and the end of the exit is what says when
 * that is, where a timer would be a guess at the length of a spring. A focus that was inside the
 * body when it stopped being the reader's — at the press, or at a caller that lets go of `open` —
 * goes back to the row rather than being dropped on the document the moment the browser reaches it
 * (issue #78).
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

/**
 * The body, which knows that it is on its way out.
 *
 * `inert` takes it out of the keyboard's reach and out of what a screen reader announces, from the
 * press that closes the fold: what has just been closed is not a place the reader can still walk
 * into, or land on a second press from (issue #69). It cannot be read off the fold's own state
 * here — `AnimatePresence` renders the body it is taking out of the page from the props that body
 * was last given, which are the ones of the render that still had it open, and the attribute is
 * therefore never on it — but the presence motion hands a child on its way out arrives after those
 * props, and is what the body can read. `useIsPresent` and not `usePresence`: the second one tells
 * motion to wait for this body before taking the room out of the page, which is the room's own
 * business, and a body that never says it is safe to remove keeps the fold in the page for good.
 */
function FoldingBody({ children }: { children: ReactNode }): ReactNode {
  const present = useIsPresent()
  return (
    <div className={BODY} inert={!present}>
      {children}
    </div>
  )
}

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
   * again. Left out, the fold holds it and opens on `defaultOpen`; let go after being held, it
   * goes back to `defaultOpen`, folding on the way when that is closed: a call held open while it
   * ran folds once it is done.
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
  const [asked, setAsked] = useState(open ?? defaultOpen)
  const [held, setHeld] = useState(open)
  const shown = open ?? asked
  const transition = useTransition(arrival)
  // A dimension has a spring of its own: it arrives without ever turning round, and a body that
  // overshot its height would take the whole column below it along. The fold's own kind is that
  // spring with no speed to carry, so a press that catches it still opening turns it round where
  // it is rather than from wherever the opening got to by the end of the frame (issue #64).
  const folding = useTransition(fold)
  // `useTransition` hands back this very object when the system asks for less movement, and a
  // block travelling to its new place is movement: the fold stops being a layout element at all
  // then, rather than being one with no time to move in.
  const still = transition === instant
  const body = useId()
  const named = useId()
  // The row, and the room the body is given: where a focus inside the body goes back to, and what
  // the body is taken out of the page through.
  const row = useRef<HTMLButtonElement>(null)
  const room = useRef<HTMLDivElement>(null)
  /**
   * Whether the focus is inside the room the body is given, read off the page.
   *
   * What the focus is in is not what the fold decided, so it is not read off the fold's own state:
   * where the reader is, only the page knows.
   */
  const holdsTheFocus = (): boolean => {
    const holding = room.current
    return holding !== null && holding.contains(holding.ownerDocument.activeElement)
  }
  /** Whether a focus the body held still has to go back to the row once the page has taken it. */
  const handed = useRef(false)
  // A caller that lets go hands the fold back to where it starts: a block held open while it ran
  // folds the moment it ends well, and stays open when it ends on something the reader has to
  // read — which is the caller's `defaultOpen` (recette 5 of 24 September 2026). The fold plays on
  // the same `collapse` a press plays: nothing snaps shut. Kept in step while rendering, so the
  // hand-over is never a frame late. A close the reader never pressed for is read here too: this
  // render is the last one where a focus inside the body is still the body's, and the commit that
  // follows is what makes the body `inert` (issue #78).
  if (held !== open) {
    if (shown && !(open ?? defaultOpen) && holdsTheFocus()) handed.current = true
    setHeld(open)
    setAsked(open ?? defaultOpen)
  }
  // Named only while it is there, and it is there for the whole of the exit: the fold is the
  // opening played backwards, so the body outlives the state that closed it. What says it has
  // left is the end of the exit and nothing else — a timer would be a guess at the length of a
  // spring — and a reference that resolves to nothing is a broken one (issue #69). Kept in step
  // while rendering, so opening it again names the body on the frame it comes back. Only a body
  // that is there counts: shown with nothing to show, there is no room and so no exit to end.
  const present = shown && children !== undefined
  const [left, setLeft] = useState(!present)
  if (present && left) setLeft(false)
  // A body taken away where it stands leaves with no fold to play: the block is drawn with nothing
  // to open the moment its children go, so there is no exit, and the end of an exit is the only
  // thing that says a room has left. Counted as still there, a block that was then closed and
  // handed a body again named, while it was closed, a room that was never in the page (issue #78).
  if (children === undefined && !left) setLeft(true)
  const controls = left ? undefined : body
  // Where a focus the body held goes once the page has taken the body away: back to the row, which
  // is where the reading was happening. A body that is `inert` drops what it holds on the document,
  // and the fold hears no press for a caller that lets go (issue #78).
  useLayoutEffect(() => {
    if (!handed.current) return
    handed.current = false
    row.current?.focus()
  }, [shown])
  // A controlled block is the caller's answer: the reader's press is reported and the shown state
  // stays whatever the caller said.
  const press = () => {
    // A focus inside the body has nowhere to live once the body is `inert`: the browser drops it
    // on the document. It goes back to the row, which is where the reading was happening.
    if (shown && holdsTheFocus()) row.current?.focus()
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
                ref={row}
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
                ref={row}
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
          <AnimatePresence initial={false} onExitComplete={() => setLeft(true)}>
            {shown && (
              <motion.div
                id={body}
                ref={room}
                className={ROOM}
                initial={collapse}
                animate={expand}
                exit={collapse}
                transition={folding}
              >
                <FoldingBody>{children}</FoldingBody>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  )
}
