import { cn } from 'cn'
import { motion } from 'motion/react'
import type { PointerEvent as PointerPress, ReactNode } from 'react'
import { useRef, useState } from 'react'

import { IconBolt, IconChevronRight } from '../icons.ts'
import { instant, morph, useTransition } from '../motion.ts'
import { type EffortChoice, type EffortProps, steppedBy } from './agent-model-menu-shared.tsx'
import { FILLED, GLOW, HALO, MARK_DONE, TRACK, fractionAt, marksOf, share } from './effort-scale.ts'

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
 *
 * **Three looks, one control** (pass of 22 September 2026). The maintainer's verdict on the
 * first drawing was that it behaved and did not look like anything, so the same slider is drawn
 * three ways and `look` is which one. Nothing below the drawing changes with it: the same
 * props, the same role, the same `aria-valuetext`, the same drag, the same keys, and the same
 * geometry — one cell per notch, the rail half a cell in from each end — so the level a press
 * lands on is the level it lands on whichever look is on.
 *
 * - `instrument`, the one that ships: the track sunk into a pill-shaped well a surface below
 *   the panel, notch dots that light up in the accent as they are passed, a twenty-pixel thumb
 *   with a domed core and two layers of halo, and the short mark of the level in a chip that
 *   travels beside the thumb.
 * - `minimal`: a hairline track, notches at two pixels, a fourteen-pixel thumb and the level's
 *   name. Nothing else at all — what it is made of is the room around it.
 * - `card`: the shape the maintainer brought back from another application — a bolt at the top
 *   left, the level in the accent with a chevron after it, the model under it in the quiet
 *   colour, and the scale under that, the whole of it on a card that lifts under the hand.
 */

/** Which of the three drawings of the same scale is on. */
export type EffortLook = 'instrument' | 'minimal' | 'card'

/** What every look has in common: the role, the focus, the keys and the words being unselectable. */
const FRAME =
  'group flex shrink-0 select-none flex-col outline-none focus-ring aria-disabled:opacity-50'

/**
 * One cell with every word of the scale in it, which is what keeps the column still.
 *
 * A grid of a single cell: every child is put in row 1 and column 1, so the cell is as wide and
 * as tall as the widest and tallest of them, and which one is shown decides nothing.
 */
const STACK = 'grid shrink-0 justify-items-center'

/** The same cell, read from its left edge, which is where a card's header starts its line. */
const STACK_START = 'grid shrink-0 justify-items-start'

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

/** The same word where the whole look is one weight: the accent, and nothing else said about it. */
const LEVEL_PLAIN = 'text-xs whitespace-nowrap tabular-nums text-primary'

/** What the agent said that level is, under its name and quieter: its sentence, not Hemera's. */
const SAID = 'text-center text-xs text-balance text-muted-foreground'

/** A word of the stack that is not the one being shown: drawn, taking its room, unread. */
const UNSHOWN = 'invisible'

/** What the effort is being set for, under it and quieter, because it is not what is being set. */
const CAPTION = 'max-w-full truncate text-center text-xs text-muted-foreground'

/** The same, read from the left, which is where a card's second line starts. */
const CAPTION_START = 'max-w-full truncate text-xs text-muted-foreground'

/** The header of the card look: the bolt, and the two lines of type beside it. */
const HEAD = 'flex items-center gap-2'

/** The bolt, in a tile of the accent's own quiet fill so it reads as a mark and not as a glyph. */
const BOLT =
  'flex shrink-0 items-center justify-center rounded-sm bg-primary-muted p-1 text-primary-muted-foreground'

/** The two lines the bolt stands beside. */
const TITLES = 'flex min-w-0 flex-col'

/** The level and the chevron after it, which is what says the word is what the card sets. */
const TITLE = 'flex items-center gap-0.5 text-xs font-medium text-primary'

/** The chevron itself, in the accent the word beside it is in, at the far end of its line.
    `ml-auto`: the word is drawn in a cell as wide as the longest of them so that the header
    never changes width, and a chevron pinned to the end of a word of another length would be a
    chevron that moved every time the level did. */
const AFFORDANCE = 'ml-auto flex text-primary'

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

/**
 * The well of the instrument look: the groove the track is sunk into.
 *
 * It reaches past the column it is drawn in on all four sides rather than the column being made
 * wider, because the column's width is the width of a notch and the rail is measured off it:
 * a well that pushed the notches apart would move every level the pointer reads.
 */
const WELL =
  'pointer-events-none absolute -inset-x-1.5 -inset-y-1 rounded-full bg-surface-page track-well'

/** The room one notch is drawn in, which is one step of the scale and the same in every look. */
const CELL = 'relative flex size-4 shrink-0 items-center justify-center'

/** A notch, whichever side of the thumb it is on; each look says how wide and in what colour. */
const DOT = 'relative rounded-full'

/**
 * The length the thumb travels: the middle of the lowest notch to the middle of the highest,
 * which is half a cell in from each end. It is what a pointer is measured against, and it takes
 * none of them itself — the press belongs to the row around it.
 */
const RAIL = 'pointer-events-none absolute inset-x-0 inset-y-2'

/**
 * Where the thumb is hung: across the whole width of the column and centred in it.
 *
 * The thumb of a look may be wider than a notch — the instrument's is twenty pixels against a
 * sixteen-pixel cell — so what is positioned is a full-width row and the thumb is centred
 * inside it. A thumb pinned to the column's left edge would hang off to one side the moment it
 * stopped being exactly one cell wide.
 */
const THUMB = 'absolute inset-x-0 flex translate-y-1/2 justify-center'

/** The chip that travels with the thumb, carrying the short mark of the level it is on. */
const CHIP =
  'pointer-events-none absolute inset-y-0 left-full ml-2 flex items-center rounded-full bg-primary-muted px-1.5 text-xs font-medium tabular-nums whitespace-nowrap text-primary-muted-foreground'

/** What one look is: which pieces are drawn, and what each of the shared ones is drawn as. */
interface LookRules {
  /** The box around the whole control. */
  frame: string
  /** The marks and the track beside them, and what the pointer is read on. */
  row: string
  /** Whether the short marks stand in a column of their own down the side of the track. */
  marks: boolean
  /** Whether the agent's own sentence about the level is drawn under its name. */
  said: boolean
  /** Whether the level's short mark travels beside the thumb in a chip. */
  chip: boolean
  /** Whether the track is sunk into a well. */
  well: boolean
  /** Whether the halo carries its wide, blurred layer as well as its ring. */
  glow: boolean
  /** How thick the track is drawn, and whether it is drawn on a rim of its own. */
  track: string
  /** How large a notch ahead of the reader is drawn, and in what colour. */
  dot: string
  /**
   * And what one behind the reader is drawn in.
   *
   * A dot on the filled length has the accent underneath it, so a dot in the accent is not a
   * dot at all: the two looks that want their notches read all the way down the scale draw the
   * passed ones in what reads *on* the accent, which is the fill's own foreground role. The
   * minimal look wants the opposite — one weight, one length, no ticks in it — so its passed
   * notches disappear into the fill, which is what `MARK_DONE` is.
   */
  dotDone: string
  /** How large the thumb is drawn. */
  thumb: string
  /** What the thumb itself is: a surface, its rim, and what lights it. */
  knob: string
}

/** The thumb as every look but the minimal one draws it: a lighter core inside an accent rim. */
const DOMED =
  'thumb-motion relative block size-full rounded-full border-2 border-primary bg-card thumb-dome group-hover:scale-110 group-active:scale-95'

/** And as the minimal one does: the same surface, at a rim thin enough to belong to a hairline. */
const PLAIN =
  'thumb-motion relative block size-full rounded-full border border-primary bg-card shadow-sm group-hover:scale-110 group-active:scale-95'

const LOOKS: Record<EffortLook, LookRules> = {
  instrument: {
    frame: 'items-center gap-1.5 rounded-lg px-2 py-2',
    row: 'flex cursor-pointer touch-none items-stretch gap-3',
    marks: true,
    said: true,
    chip: true,
    well: true,
    glow: true,
    track: 'w-track ring-1 ring-border ring-inset',
    dot: 'size-1 bg-input',
    dotDone: 'bg-primary-foreground',
    thumb: 'relative size-thumb-lg shrink-0',
    knob: DOMED,
  },
  minimal: {
    frame: 'items-center gap-2 rounded-md px-2 py-2',
    row: 'flex cursor-pointer touch-none items-stretch',
    marks: false,
    said: false,
    chip: false,
    well: false,
    glow: false,
    // A hairline has no room for a rim: a one-pixel ring inside a two-pixel track is the track.
    track: 'w-track-hair',
    dot: 'size-1 bg-border',
    dotDone: MARK_DONE,
    thumb: 'relative size-thumb-sm shrink-0',
    knob: PLAIN,
  },
  card: {
    frame:
      'lift-motion items-stretch gap-3 rounded-lg border border-border bg-card p-3 shadow-sm hover:shadow-lg',
    row: 'flex cursor-pointer touch-none items-stretch self-center',
    marks: false,
    said: false,
    chip: false,
    well: false,
    glow: true,
    track: 'w-track ring-1 ring-border ring-inset',
    dot: 'size-1 bg-input',
    dotDone: 'bg-primary-foreground',
    thumb: 'relative size-thumb-lg shrink-0',
    knob: DOMED,
  },
}

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
  look = 'instrument',
}: EffortProps & { look?: EffortLook | undefined }): ReactNode {
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

  const drawn = LOOKS[look]
  const here = efforts.findIndex((one) => one.id === effort)
  const last = efforts.length - 1
  const current = efforts[here]
  const marks = marksOf(efforts.map((one) => one.label))
  const described = drawn.said && efforts.some((one) => one.description !== undefined)
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

  /** The word of the level that is on, drawn once per level so the column never changes width. */
  const words = (className: string, stack: string): ReactNode => (
    <span aria-hidden="true" className={stack}>
      {efforts.map((one) => (
        <span key={one.id} className={cn(LAID, className, one.id !== effort && UNSHOWN)}>
          {one.label}
        </span>
      ))}
      {/* Nothing set yet: the control says what it is for, in the room the words leave. */}
      <span className={cn(LAID, className, here !== -1 && UNSHOWN)}>Effort</span>
    </span>
  )

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
      data-look={look}
      className={cn(FRAME, drawn.frame)}
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
      {look === 'card' ? (
        <span data-testid="effort-head" className={HEAD}>
          <span aria-hidden="true" className={BOLT}>
            <IconBolt size="sm" weight="filled" />
          </span>
          <span className={TITLES}>
            <span className={TITLE}>
              {words(LEVEL, STACK_START)}
              <span aria-hidden="true" className={AFFORDANCE}>
                <IconChevronRight size="sm" />
              </span>
            </span>
            {/* The model the effort is being set for, on the line the reference gives it. */}
            {caption !== undefined && <span className={CAPTION_START}>{caption}</span>}
          </span>
        </span>
      ) : (
        words(look === 'minimal' ? LEVEL_PLAIN : LEVEL, STACK)
      )}

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
        className={cn(drawn.row, held !== null && HELD)}
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
        {drawn.marks && (
          <span data-testid="effort-marks" className={MARKS}>
            {efforts.map((one, index) => (
              <span key={one.id} className={cn(MARK_WORD, index <= here && MARK_WORD_DONE)}>
                {marks[index]}
              </span>
            ))}
          </span>
        )}

        <span className={COLUMN}>
          {drawn.well && <span data-testid="effort-well" className={WELL} />}
          {/* The track runs from the middle of the lowest notch to the middle of the highest,
              which is half a cell in from each end — so the fill ends on a notch, never past
              one. */}
          <span className={cn(TRACK, drawn.track, 'inset-x-0 inset-y-2 mx-auto')}>
            <motion.span
              className={cn(FILLED, 'bottom-0 left-0 w-full')}
              animate={{ height: share(at) }}
              transition={travel}
            />
          </span>
          {efforts.map((one, index) => (
            <span key={one.id} data-step={one.id} className={CELL}>
              <span className={cn(DOT, drawn.dot, index <= here && drawn.dotDone)} />
            </span>
          ))}
          <span ref={rail} className={RAIL}>
            <motion.span
              data-testid="effort-thumb"
              className={THUMB}
              animate={{ bottom: share(at) }}
              transition={travel}
            >
              <span data-testid="effort-knob" className={drawn.thumb}>
                {drawn.glow && <span className={GLOW} />}
                <span className={HALO} />
                <span className={drawn.knob} />
                {drawn.chip && current !== undefined && (
                  <span aria-hidden="true" data-testid="effort-chip" className={CHIP}>
                    {marks[here]}
                  </span>
                )}
              </span>
            </motion.span>
          </span>
        </span>
      </span>

      {/* Only where there is one, and never twice: the card already said it in its header. */}
      {caption !== undefined && look !== 'card' && <span className={CAPTION}>{caption}</span>}
    </div>
  )
}
