import { cn } from 'cn'
import { motion } from 'motion/react'
import type { PointerEvent as PointerPress, ReactNode } from 'react'
import { useRef, useState } from 'react'

import { instant, morph, useTransition } from '../motion.ts'
import { type EffortChoice, type EffortProps, steppedBy } from './agent-model-menu-shared.tsx'
import {
  FILLED,
  HALO,
  KNOB,
  MARK,
  MARK_DONE,
  SCALE,
  TRACK,
  fractionAt,
  marksOf,
  share,
} from './effort-scale.ts'

/**
 * The effort as a vertical slider — the control the maintainer kept on 22 September 2026.
 *
 * A thin track with a notch on every level the agent announced, the part of it under the thumb
 * filled in the accent, a round thumb on the level that is on, the agent's own word for that
 * level over the top of it and what it is being set for under the bottom. Down the side of the
 * track, one short mark per notch, so six dots are six levels rather than six dots.
 *
 * **Why down and not across.** A scale of six levels read across a narrow panel gives each of
 * them four characters and reads as six buttons; read down, it reads as what it is — more of
 * something at the top, less of it at the bottom — and the panel has height to spare where it
 * has no width at all. The highest effort is at the top, which is the one thing a vertical
 * scale is not allowed to get wrong: the fill grows up from the foot of the track.
 *
 * **It is dragged, and not only pressed.** The scale takes the pointer on the way down —
 * `setPointerCapture`, so a hand that leaves the track sideways goes on moving the thumb — the
 * thumb follows that hand rather than jumping between notches, and the level under it is set as
 * it is passed. Letting go drops the thumb onto the nearest notch. A press anywhere on the
 * track, notch or no notch, is that same movement with no movement in it: the nearest notch.
 * Touch is the same events and so the same control, and the track claims the gesture
 * (`touch-none`) rather than letting the column it sits in scroll under the finger.
 *
 * The wheel is deliberately *not* read. This control stands in a column that scrolls, and a
 * wheel that set a level instead of scrolling that column would take a gesture the reader
 * aimed past it — a level is not worth a scroll nobody gets back.
 *
 * **One control, not a list of them.** It is a `slider`: it takes the focus once, says where it
 * stands in the agent's own word through `aria-valuetext` — "High", not "4 of 6" — and the keys
 * walk it, the arrows by one, the page keys by a third of the scale, Home and End at the two
 * ends. The notches are marks and answer the pointer through the scale itself, because a notch
 * that took the focus would be a second control inside a control that already has a role.
 *
 * **Nothing moves when the level does.** Every word of the scale is drawn in the same cell of a
 * grid and all but the one that is on are `invisible`: the column is as wide as the longest
 * word the agent announced, whichever word is being shown. Nothing is measured and nothing is
 * laid out twice. The description under it, where the agent gives one, is the same stack — so a
 * level explained in eight words does not push the panel taller than one explained in three —
 * and the marks stand in a column one width wide, so the track never shifts sideways either.
 *
 * **What moves** is the thumb and the fill, on `morph` where they are travelling on their own
 * and on `instant` while a hand is holding them: a spring under the finger is a thumb lagging
 * behind the hand dragging it. `morph` is the spring that arrives without turning round — a
 * thumb that overshot its notch and came back would read as a value set and then changed — and
 * `useTransition` answers a reader asking for less movement with the notch and no glide at all.
 * Under the hand and under the focus the halo brightens and the thumb grows, which is CSS and
 * stops on its own where less movement was asked for.
 */

/** The whole control: the word, the scale, and what the effort is being set for. */
const FRAME =
  'group flex shrink-0 select-none flex-col items-center gap-1 rounded-md px-2 py-1.5 outline-none focus-ring aria-disabled:opacity-50'

/**
 * One cell with every word of the scale in it, which is what keeps the column still.
 *
 * A grid of a single cell: every child is put in row 1 and column 1, so the cell is as wide and
 * as tall as the widest and tallest of them, and which one is shown decides nothing.
 */
const STACK = 'grid shrink-0 justify-items-center'

/**
 * The same stack for the descriptions, at one width rather than at the width of the longest.
 *
 * A level's name is a word and the column is as wide as the longest of them; a description is a
 * sentence, and a column as wide as the longest sentence is a panel the agent decides the width
 * of. It is given the room it has and wraps inside it, and the stack is what keeps the tallest
 * of them from being the only one that fits.
 */
const SAYINGS = 'grid w-24 shrink-0'

/** Where every word is laid: the one cell of the stack, shown or not. */
const LAID = 'col-start-1 row-start-1'

/** Where it stands, in the agent's own word, over the top of the track and in the accent. */
const LEVEL = 'text-xs font-medium whitespace-nowrap tabular-nums text-primary'

/** What the agent said that level is, under its name and quieter: its sentence, not Hemera's. */
const SAID = 'text-center text-xs text-balance text-muted-foreground'

/** A word of the stack that is not the one being shown: drawn, taking its room, unread. */
const UNSHOWN = 'invisible'

/** What the effort is being set for, under it and quieter, because it is not what is being set. */
const CAPTION = 'max-w-full truncate text-xs text-muted-foreground'

/** The marks and the track beside them, and what the pointer is read on. */
const SCALE_ROW = 'flex cursor-pointer touch-none items-stretch gap-1.5'

/** The scale under the hand: the cursor says the thumb is being held rather than aimed at. */
const HELD = 'cursor-grabbing'

/** The short marks, one per notch and down — `col-reverse`, so the first level is lowest. */
const MARKS = 'flex flex-col-reverse justify-between gap-2'

/**
 * The room one mark is written in: as tall as a notch, so the two columns line up row for row,
 * and one width for all of them, so the track sits in the same place whatever is on.
 */
const MARK_WORD =
  'flex h-4 w-8 shrink-0 items-center justify-end text-xs tabular-nums text-muted-foreground'

/** The mark of a level behind the reader, in the accent the fill beside it is drawn in. */
const MARK_WORD_DONE = 'text-primary'

/** The notches and the track they sit on, down and in the same order as the marks. */
const COLUMN = 'relative flex flex-col-reverse items-center justify-between gap-2'

/** The room one notch is drawn in, which is the thumb's own size. */
const CELL = 'relative flex size-4 shrink-0 items-center justify-center'

/**
 * The length the thumb travels: the middle of the lowest notch to the middle of the highest,
 * which is half a cell in from each end. It is what a pointer is measured against, and it takes
 * none of them itself — the press belongs to the row around it.
 */
const RAIL = 'pointer-events-none absolute inset-x-0 inset-y-2'

/** The thumb: the level that is on, as a round surface sitting on the rail at its own share. */
const THUMB = 'absolute left-0 size-4 translate-y-1/2'

/**
 * Takes the pointer, so the thumb goes on following a hand that has left the track.
 *
 * A pointer the browser is not driving — the one a story dispatches — cannot be taken, and not
 * taking it is not a failure of the drag: the events go on arriving at the element they were
 * dispatched on, which is the element that would have captured them.
 */
function hold(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // A pointer that is nobody's: there is nothing to take, and nothing that needed taking.
  }
}

/** And gives it back, where there was one to take. */
function letGo(element: Element, pointerId: number): void {
  if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
}

/** What the control says it is on: the agent's word for the level, and its own word about it. */
function saying(level: EffortChoice | undefined): string {
  if (level === undefined) return 'Not set'
  if (level.description === undefined) return level.label
  return `${level.label}, ${level.description}`
}

export function EffortSlider({
  efforts,
  effort,
  onEffortChange,
  disabled,
  caption,
}: EffortProps): ReactNode {
  const frame = useRef<HTMLDivElement>(null)
  const rail = useRef<HTMLSpanElement>(null)
  /**
   * Whether a hand is on the thumb. A ref and not a state, for the reason the sidebar's own
   * separator gives: a pointer that has already moved cannot wait for a render to be answered,
   * and a move arriving before React has drawn the press would be a move read as nothing.
   */
  const holding = useRef(false)
  /** Where that hand is along the track, and `null` when there is none: what is drawn. */
  const [held, setHeld] = useState<number | null>(null)
  const glide = useTransition(morph)
  if (efforts.length === 0) return null

  const here = efforts.findIndex((one) => one.id === effort)
  const last = efforts.length - 1
  const current = efforts[here]
  const marks = marksOf(efforts.map((one) => one.label))
  const described = efforts.some((one) => one.description !== undefined)
  /** Where the thumb is drawn: under the hand while it is held, on its own notch otherwise. */
  const at = held ?? fractionAt(here, last)
  /** What the thumb and the fill travel on: nothing at all while a hand is moving them. */
  const travel = held === null ? glide : instant

  /** Sets the level at that index, and says nothing about one that is already set. */
  const set = (index: number): void => {
    const one = efforts[index]
    if (one !== undefined && one.id !== effort) onEffortChange(one.id)
  }

  /** Where along the track a pointer is: 0 at the lowest notch, 1 at the highest. */
  const reached = (clientY: number): number => {
    const box = rail.current?.getBoundingClientRect()
    if (box === undefined || box.height === 0) return 0
    return Math.min(1, Math.max(0, (box.bottom - clientY) / box.height))
  }

  /** The thumb goes where the hand is, and the level it is nearest is the one that is set. */
  const follow = (event: PointerPress<HTMLSpanElement>): void => {
    const reach = reached(event.clientY)
    setHeld(reach)
    set(Math.round(reach * last))
  }

  /** The hand lets go: the thumb drops onto the notch it is nearest. */
  const drop = (event: PointerPress<HTMLSpanElement>): void => {
    letGo(event.currentTarget, event.pointerId)
    holding.current = false
    setHeld(null)
  }

  return (
    /*
      One element with the role, the focus and the keys. `aria-disabled` and not `disabled`,
      which a div has no notion of: what is off is still read, and still says where it stands.
    */
    <div
      ref={frame}
      role="slider"
      aria-label="Effort"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={here === -1 ? 0 : here}
      aria-valuetext={saying(current)}
      aria-disabled={disabled === true ? true : undefined}
      tabIndex={disabled === true ? -1 : 0}
      className={FRAME}
      onKeyDown={(event) => {
        if (disabled === true) return
        const next = steppedBy(event.key, here === -1 ? 0 : here, last)
        if (next === null) return
        event.preventDefault()
        set(next)
      }}
    >
      {/* The words are the value, and the value is announced once, by the role: read again as
          the text inside the control, it would be read twice. */}
      <span aria-hidden="true" className={STACK}>
        {efforts.map((one) => (
          <span key={one.id} className={cn(LAID, LEVEL, one.id !== effort && UNSHOWN)}>
            {one.label}
          </span>
        ))}
        {/* Nothing set yet: the control says what it is for, in the room the words leave. */}
        <span className={cn(LAID, LEVEL, here !== -1 && UNSHOWN)}>Effort</span>
      </span>

      {/* Only where the agent described its levels: an empty line under the name is a gap. */}
      {described && (
        <span aria-hidden="true" className={SAYINGS}>
          {efforts.map((one) => (
            <span key={one.id} className={cn(LAID, SAID, one.id !== effort && UNSHOWN)}>
              {one.description}
            </span>
          ))}
        </span>
      )}

      <span
        data-testid="effort-scale"
        className={cn(SCALE_ROW, held !== null && HELD)}
        onPointerDown={(event) => {
          if (disabled === true) return
          // The press is refused so that dragging does not select the words around the track —
          // and a refused press focuses nothing, so the control takes the focus itself.
          event.preventDefault()
          frame.current?.focus()
          hold(event.currentTarget, event.pointerId)
          holding.current = true
          follow(event)
        }}
        onPointerMove={(event) => {
          if (holding.current) follow(event)
        }}
        onPointerUp={drop}
        onPointerCancel={drop}
      >
        <span data-testid="effort-marks" className={MARKS}>
          {efforts.map((one, index) => (
            <span key={one.id} className={cn(MARK_WORD, index <= here && MARK_WORD_DONE)}>
              {marks[index]}
            </span>
          ))}
        </span>

        <span className={COLUMN}>
          {/* The track runs from the middle of the lowest notch to the middle of the highest,
              which is half a cell in from each end — so the fill ends on a notch, never past
              one. */}
          <span className={cn(TRACK, SCALE, 'inset-x-0 inset-y-2 mx-auto w-track')}>
            <motion.span
              className={cn(FILLED, 'bottom-0 left-0 w-full')}
              animate={{ height: share(at) }}
              transition={travel}
            />
          </span>
          {efforts.map((one, index) => (
            <span key={one.id} data-step={one.id} className={CELL}>
              <span className={cn(MARK, index <= here && MARK_DONE)} />
            </span>
          ))}
          <span ref={rail} className={RAIL}>
            <motion.span
              data-testid="effort-thumb"
              className={THUMB}
              animate={{ bottom: share(at) }}
              transition={travel}
            >
              <span className={HALO} />
              <span className={KNOB} />
            </motion.span>
          </span>
        </span>
      </span>

      {/* Only where there is one: a caption drawn empty is a line of nothing under a control. */}
      {caption !== undefined && <span className={CAPTION}>{caption}</span>}
    </div>
  )
}
