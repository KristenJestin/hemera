import { cn } from 'cn'
import { motion } from 'motion/react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconChevronDown } from '../../icons.ts'
import { arrival, instant, press, useTransition } from '../../motion.ts'

/**
 * The scroller of a Session: the thread, the rail that says where in it the reader is, and the
 * pill that takes them back to the live edge (design D4b-09).
 *
 * A thread is read from the bottom: what was written last is what matters, and a Session opens
 * on it. So the scroller is the one thing in the page that scrolls, and everything around it —
 * the title, the composer — stays where it is.
 *
 * The rail is the other half of the same answer. Forty messages are a column with no landmarks,
 * and a scrollbar says only how much of it is out of sight. The rail says how many marks there
 * are, which one the reader is on, and what each one begins with. It is drawn only when the
 * thread does not fit: a rail over a thread that is entirely on screen is a map of nowhere.
 *
 * Nothing here measures text, nothing animates a layout property or a colour, and no spring is
 * written outside the presets — what answers the hand is on `press`, what arrives is on
 * `arrival`, and `useTransition` is what turns either into the end state for a reader who asked
 * for less movement.
 */

/**
 * How close to the end of the thread counts as being at it, in pixels.
 *
 * The ticket settles it at 56 px — three lines of the thread — which is a reader who scrolled to
 * the last message and stopped a line or two short of it. Past that, the pill offers to take
 * them back to an edge they can already see, which is the pill lying about where they are.
 */
const LIVE_EDGE = 56

/** How much of the thread has to be out of sight before the rail is worth drawing, in pixels. */
const OVERFLOW = 1

/**
 * How wide a mark is drawn, as a share of the mark itself.
 *
 * Twice as wide for the one being read and half again for the two beside it: the width is what
 * makes the rail a position rather than a cursor — one tick alone says where the reader is, and
 * a tick with its neighbours growing towards it says which way the thread goes from there.
 */
const WIDTH = { rest: 1, near: 1.5, active: 2 } as const

/** The row of the thread and its rail. The rail does not scroll with what it maps. */
const FRAME = 'flex h-full min-h-0 gap-3'

/** The thread's own column, which the pill floats over — centred on the thread, not the page. */
const COLUMN = 'relative flex min-w-0 flex-1 flex-col'

/**
 * The one thing that scrolls.
 *
 * A tab stop, because a region that scrolls and cannot be reached by the keyboard is a region
 * some readers cannot get to at all. It wears the theme's outline rather than the design
 * system's `focus-ring`, whose pseudo-element is laid against the scrolled content and would
 * travel with it — the same choice `ContentArea` makes, for the same reason. Being positioned
 * is what gives every entry a place in the column that `offsetTop` can be read from.
 *
 * No scrollbar is drawn, as on every other list of the design system that scrolls inside a
 * page: what says how much of the thread is out of sight is the rail, which says the same thing
 * in places rather than in a proportion, and a bar ruled down the reading column is chrome over
 * what is being read. It is the rail that is drawn only when it overflows, so the two never
 * disagree about whether there is anything below.
 */
const BOX =
  'scroll-quiet relative flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pt-4 pb-6 outline-none focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring'

/**
 * The pill's row, which covers the thread without taking it: the row is the full width of the
 * column and lets every press through it, and only the pill itself answers one.
 */
const PILL_ROW = 'pointer-events-none absolute inset-x-0 bottom-4 flex justify-center'

/** The rail: a column of marks, as tall as what it holds and never as tall as the thread. */
const RAIL = 'flex shrink-0 flex-col items-center gap-1 pt-3'

/**
 * A mark is drawn as a line, and pressed as a square.
 *
 * The line is six by two and the control around it is sixteen by twelve: a mark you cannot hit
 * is not a mark you can press, and the rail's rhythm is kept by the small size of what is
 * drawn, not by the size of what answers the hand.
 *
 * The resting line is the theme's `--input` — the weight a line of the window has, which is
 * what a mark is. That is under the three to one a control is asked for, and it is the one
 * thing about this component worth a second look in the gate: the marks are the only way back
 * into a long thread by name, and the only louder token available would put a column of
 * full-strength grey beside every message and read as loud as the text it maps.
 */
const TICK = 'group flex h-3 w-4 shrink-0 items-center justify-center outline-none focus-ring'

const BAR = 'block h-0.5 w-1.5 rounded-full'

/**
 * An entry of the thread, and the mark the rail draws for it when it asks for one.
 */
export interface ScrollerMessage {
  /** What identifies the entry, for React and for what a press on a mark goes to. */
  id: string
  /**
   * The beginning of what was written, already written for the platform — or nothing.
   *
   * It is what the rail says when the pointer rests on a mark, and what a screen reader reads
   * when the keyboard lands on one: a mark has nothing of its own to say, and the only thing
   * worth saying about it is where it goes. The two are the same words on purpose — what the
   * eye is shown and what is announced are one answer, not two of different lengths.
   *
   * Left out, the entry draws no mark at all and the rail's reading position steps over it, as
   * it steps over a day. That is the opt-in the trial of 22 September 2026 asked for: a rail
   * that ticked every block of a turn was forty ticks for one question, and the marks a reader
   * navigates a Session by are what *they* wrote. Everything the agent answered is read by
   * scrolling through it, which is how it was written.
   */
  mark?: string | undefined
  /** What the thread draws there, handed over already drawn. */
  content: ReactNode
  /** A message is never a day; the two are told apart by this and by nothing else. */
  day?: undefined
}

/**
 * A day in the thread: a heading between two runs of messages.
 *
 * It draws no mark on the rail, and the rail's reading position steps over it. The prototype
 * gives its rail a tick for a day as well, and that one was left out: a mark on a rail is
 * somewhere the reader can be taken to, and a day is a heading over what follows it — pressing
 * one would land the reader on a line, which is not what a rail is for.
 */
export interface ScrollerDay {
  id: string
  /** What tells a heading from a message, here and in the rail. */
  day: true
  /** What the thread draws there, handed over already drawn. */
  content: ReactNode
}

export type ScrollerEntry = ScrollerDay | ScrollerMessage

/**
 * Whether the rail draws a mark for an entry, which is the one question the rail asks of it.
 *
 * A day never does, and an entry that named no mark never does either. The same answer decides
 * the anchor the reading position is counted off and the tick that is drawn, so the two cannot
 * come apart: a rail whose active index counted one list and drew another would point at the
 * wrong message every time an unmarked entry went past.
 */
function isMarked(entry: ScrollerEntry): entry is ScrollerMessage & { mark: string } {
  return entry.day !== true && entry.mark !== undefined
}

/** How wide a mark is drawn: the one being read, the two beside it, and all the others. */
function widthOf(index: number, active: number): number {
  if (index === active) return WIDTH.active
  // Nothing is beside a position that has not been found yet: before the first mark is passed
  // there is no reading position, and a rail whose first mark was already growing would be
  // pointing at the top of the thread as though it were somewhere the reader had been.
  if (active >= 0 && Math.abs(index - active) === 1) return WIDTH.near
  return WIDTH.rest
}

export interface MessageScrollerProps {
  /** What the thread is called, said by the thread and by the rail that maps it. */
  label: string
  /** The thread, in the order it was written. */
  entries: readonly ScrollerEntry[]
  /** Where the scroller sits; never how it looks. */
  className?: string | undefined
}

export function MessageScroller({ label, entries, className }: MessageScrollerProps): ReactNode {
  const box = useRef<HTMLDivElement>(null)
  // Where each entry of the thread is, by index, and `null` for the ones the rail steps over.
  // Read off the elements themselves, which is a place in a column already laid out and not a
  // size taken off a string: `offsetTop` and a scroll position are the same axis, and the two
  // are what tells the rail where the reader is.
  const anchors = useRef<(HTMLElement | null)[]>([])
  const [active, setActive] = useState(-1)
  const [overflowing, setOverflowing] = useState(false)
  const [atEdge, setAtEdge] = useState(true)
  // The same answer, where an effect can read it without waiting for a render: whether the
  // reader was at the live edge is what decides whether a message arriving takes them with it.
  const wasAtEdge = useRef(true)
  const transition = useTransition(arrival)
  // `useTransition` hands back this very object for a reader who asked for less movement, and a
  // scroll that glides is movement: the end of the thread is worth arriving at, not travelling
  // to. The same question decides both of the ways there — the pill and a press on a mark.
  const still = transition === instant

  const look = useCallback(() => {
    const node = box.current
    if (node === null) return
    // The reading position is the middle of what is on screen and not its top: a message is
    // read when it is in front of the eye, and the line at the very top is the one being left.
    const middle = node.scrollTop + node.clientHeight / 2
    let mark = -1
    let seen = -1
    for (const anchor of anchors.current) {
      if (anchor === null) continue
      seen += 1
      if (anchor.offsetTop < middle) mark = seen
    }
    const edge = node.scrollHeight - node.scrollTop - node.clientHeight <= LIVE_EDGE
    // At the live edge the reading position is the last thing written, whatever the middle of
    // the screen holds: a last message shorter than half a window would otherwise leave the
    // rail pointing at the one before it while the reader is reading it — and being at the
    // live edge is the one position a thread read from the bottom always knows.
    setActive(edge ? seen : mark)
    setOverflowing(node.scrollHeight - node.clientHeight > OVERFLOW)
    setAtEdge(edge)
    wasAtEdge.current = edge
  }, [])

  // Bound once, and not once per render: this runs while the reader scrolls, and the answers it
  // keeps up with change for two reasons — the scroller being resized, and the thread growing
  // under it. The same two watchers as the strip of tabs, for the same two reasons.
  useEffect(() => {
    const node = box.current
    if (node === null) return
    // A Session opens on what was written last. Arriving at the top of a conversation and having
    // to find its end is the one thing a thread read from the bottom cannot ask for.
    node.scrollTop = node.scrollHeight
    look()
    const sized = new ResizeObserver(look)
    sized.observe(node)
    const grown = new MutationObserver(look)
    grown.observe(node, { childList: true, subtree: true, characterData: true })
    return () => {
      sized.disconnect()
      grown.disconnect()
    }
  }, [look])

  /**
   * A message arriving in a thread the reader is at the end of takes them with it.
   *
   * Only then: someone who scrolled up to check something is reading, and a column that jumped
   * under them would take them off the line they were on — that reader has the pill instead. The
   * mount is the other half of the same rule, and it is the one above: a Session opens on what
   * was written last.
   */
  useEffect(() => {
    const node = box.current
    if (node === null || !wasAtEdge.current) return
    node.scrollTop = node.scrollHeight
    look()
  }, [entries.length, look])

  const goToLatest = (): void => {
    const node = box.current
    if (node === null) return
    node.scrollTo({ top: node.scrollHeight, behavior: still ? 'auto' : 'smooth' })
  }

  const goToMark = (id: string): void => {
    const node = anchors.current[entries.findIndex((entry) => entry.id === id)]
    node?.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' })
  }

  const marks = entries.filter(isMarked).map((entry) => ({ id: entry.id, label: entry.mark }))

  return (
    <div className={cn(FRAME, className)}>
      <div className={COLUMN}>
        <div ref={box} tabIndex={0} role="log" aria-label={label} onScroll={look} className={BOX}>
          {entries.map((entry, index) => (
            <div
              key={entry.id}
              ref={(node) => {
                // A day registers as nothing, and so does an entry that asked for no mark: the
                // rail counts what it drew and only what it drew, so the walk above lands on
                // the same index the rail drew its marks with.
                anchors.current[index] = isMarked(entry) ? node : null
              }}
            >
              {entry.content}
            </div>
          ))}
        </div>
        {!atEdge && (
          <div className={PILL_ROW}>
            <LatestPill onGoToLatest={goToLatest} />
          </div>
        )}
      </div>
      {overflowing && (
        <NavigationRail
          label={`Marks of ${label}`}
          marks={marks}
          active={active}
          onSelect={goToMark}
        />
      )}
    </div>
  )
}

/** One mark of the rail: a message, which is somewhere the reader can be taken to. */
export interface NavigationMark {
  /** What identifies the mark, and what a press on it goes to. */
  id: string
  /** The beginning of what was written, already written for the platform. */
  label: string
}

export interface NavigationRailProps {
  /**
   * What the rail is called.
   *
   * It is a navigation, and a navigation with no name is a landmark a screen reader lists as
   * “navigation” — which says nothing about what is being navigated, in a window that already
   * holds a strip of Projects and a list of Sessions.
   */
  label: string
  /** The marks, in the order they were written. */
  marks: readonly NavigationMark[]
  /** Which mark the reading position is on, or `-1` before the first of them is passed. */
  active: number
  /** What a press on a mark does: the scroller is what knows where a mark is. */
  onSelect: (id: string) => void
}

/**
 * Where the reader is in a thread, and the way back to any part of it.
 *
 * A column of lines rather than a scrollbar: a scrollbar is a proportion, and a thread of
 * messages is a list of things somebody said. Each mark is the height of one line and the rail
 * is as tall as its marks — a rail stretched to the height of the thread would say that a
 * message's position in it is worth reading, which is the one thing a proportion cannot say.
 *
 * Every mark answers the pointer and the keyboard, and wears its preview in the design system's
 * tooltip: a mark is six pixels of line, and what it stands for is a sentence that has to be
 * read somewhere. The rail sits outside the thread's own column and never scrolls with it — a
 * map that travelled with the territory would move under the hand at the exact moment the hand
 * is on it.
 *
 * Every mark is its own tab stop, rather than one stop for the rail with the arrows moving
 * inside it: there are five to fifteen of them, they are the only way to a message by name, and
 * a group that has to be entered and left again is a keyboard of its own to learn for the sake
 * of a handful of presses.
 */
export function NavigationRail({ label, marks, active, onSelect }: NavigationRailProps): ReactNode {
  const transition = useTransition(press)
  return (
    <nav aria-label={label} className={RAIL}>
      {marks.map((mark, index) => (
        <Tooltip key={mark.id} label={mark.label} side="left">
          <button
            type="button"
            aria-label={mark.label}
            aria-current={index === active ? 'true' : undefined}
            onClick={() => onSelect(mark.id)}
            className={TICK}
          >
            <motion.span
              aria-hidden="true"
              className={cn(
                BAR,
                index === active
                  ? 'bg-primary'
                  : 'bg-input group-hover:bg-primary-muted-foreground',
              )}
              // Placed and not animated into place on the first render: a rail that grew its
              // marks one after another as it appeared would be a page still arriving, and what
              // is being shown is where the reader already is.
              initial={false}
              animate={{ scaleX: widthOf(index, active) }}
              transition={transition}
            />
          </button>
        </Tooltip>
      ))}
    </nav>
  )
}

export interface LatestPillProps {
  /** What a press does: back to the last thing written. */
  onGoToLatest: () => void
}

/**
 * What takes the reader back to the live edge, once they have left it.
 *
 * A reader who scrolled up to check something is reading, not lost, so nothing pulls them back
 * — and the moment they want the end of the thread again they are at the bottom of a column
 * with no idea how far. This says how to get there in one press and no scrolling, which is the
 * whole of what it is for; it is drawn by the scroller only while the reader is away from the
 * edge, so it is never a control that does nothing.
 *
 * It is a `Button`, with the round shape the design system keeps for what floats over what it
 * is about, and the arrow comes after the word: the press is what the pill says, and the mark
 * of where it goes is read second. It moves in and does not fade: a word climbing out of the
 * page's own background is a word that cannot be read while it arrives, which is the same
 * reason a message arrives on a transform.
 */
export function LatestPill({ onGoToLatest }: LatestPillProps): ReactNode {
  const transition = useTransition(arrival)
  return (
    <motion.div
      initial={{ y: 8, scale: 0.95 }}
      animate={{ y: 0, scale: 1 }}
      transition={transition}
    >
      <Button
        variant="secondary"
        shape="pill"
        size="sm"
        className="pointer-events-auto"
        onClick={onGoToLatest}
      >
        Latest
        <IconChevronDown size="sm" aria-hidden="true" />
      </Button>
    </motion.div>
  )
}
