import { cn } from 'cn'
import { motion } from 'motion/react'
import type { PointerEvent as PointerPress, ReactNode } from 'react'
import { useRef, useState } from 'react'

import { instant, morph, useTransition } from '../motion.ts'
import {
  DEFAULT_BESIDE,
  type EffortChoice,
  type EffortProps,
  levelSaid,
} from './agent-model-menu-shared.tsx'

/**
 * The effort, as the instrument the maintainer kept on 22 September 2026.
 *
 * A thin track sunk into a groove, one notch per level the agent announced, the part of it
 * under the thumb filled in the accent, a lit twenty-pixel thumb on the level that is on, the
 * agent's own word for that level over the top of it, and down the left of the track a short
 * mark per notch — `L M H XH Max` — so five dots are five levels rather than five dots.
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
 * **The model's own default is a rule across the track**, at that level's notch, and never a
 * notch of its own (decision of 22 September 2026). It is the level the model puts a Session on
 * by itself — `Xhigh` for Opus, `High` for Fable — handed over as `defaultId`, and it moves when
 * the model does; what the agent *advises* (`recommended`) is one generic level for every model
 * and draws nothing here (probe of 22 September 2026). A thin accent line laid across the scale
 * is read the way the red line on a dial is read — this is where it sits by itself — without
 * offering a value of its own; the word `default` is said beside the level's own name while
 * that level is the one standing, and in `aria-valuetext` for whoever cannot see the line. It
 * is also where the scale opens: handed nothing at all, it rests on the model's default,
 * because that is what the next turn would run at.
 *
 * **`Default` is not a notch.** An agent that never said which level its `Default` stands for
 * leaves it announced as a value like any other, and a scale cannot place a level whose meaning
 * nobody knows: the notches are the real levels alone, and where `Default` is what is set the
 * thumb sits at the foot of the track with the word above it reading `Default`, until a level
 * is chosen. Nothing is guessed here — resolving that value is the engine's business, and it
 * does it the moment the agent gives it the means.
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

/** The value an agent announces as its own stand-in, which is the engine's word for it too. */
const UNRESOLVED = 'default'

/** The box around the whole control: the role, the focus, the keys, the words unselectable. */
const FRAME =
  'group flex shrink-0 select-none flex-col items-center gap-1.5 rounded-lg px-2 py-2 outline-none focus-ring aria-disabled:opacity-50'

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

/**
 * And the word beside a level's name when it is the model's default: quiet, because the name is
 * what is being set and this is a thing said about it.
 */
const DEFAULT_WORD = 'text-muted-foreground'

/** The scale under the hand: the cursor says the thumb is being held rather than aimed at. */
const HELD = 'cursor-grabbing'

/**
 * What the pointer is read on: the notches, down — `col-reverse`, so the first level is lowest.
 *
 * **One geometry, and only one** (the trial of 22 September 2026). Each notch is one row holding
 * its mark and its dot, so a mark cannot stand at another height than its dot: there is one
 * column of rows and not two columns that happen to agree. The rows are one height and one gap
 * apart, so notch `i` is at `i / (n - 1)` of the rail from its foot, and the rail is the box
 * from the middle of the lowest row to the middle of the highest: the scale inset by half a row
 * at each end. The track, the fill and the thumb are all laid in that one box.
 */
const ROW = 'relative flex cursor-pointer touch-none flex-col-reverse gap-2'

/** One notch: its short mark, then its dot on the track, on one line. */
const NOTCH = 'flex items-center gap-3'

/** The room one mark is written in: one width for all of them, so the track never shifts. */
const MARK_WORD =
  'flex h-4 w-8 shrink-0 items-center justify-end text-xs tabular-nums text-muted-foreground'

/** The mark of a level behind the reader, in the accent the fill beside it is drawn in. */
const MARK_DONE = 'text-primary'

/**
 * The lane the track runs down: the column of dots, which is the last cell of every row and
 * exactly as wide as one (`w-4`, the `size-4` of `CELL`). It is drawn twice, once under the
 * rows for the groove and the track and once over them for the thumb, because the dots stand on
 * the track and the thumb stands on the dots.
 */
const LANE = 'pointer-events-none absolute inset-y-0 right-0 w-4'

/**
 * The rail: the middle of the lowest row to the middle of the highest, which is half a row
 * (`h-4`, so `inset-y-2`) in from each end of the lane. The track is this box and the thumb
 * travels this box, so a level is one fraction of one length for both of them.
 */
const RAIL_BOX = 'absolute inset-y-2'

/**
 * The groove the track is sunk into, which is what makes this an instrument rather than a form
 * control: a track drawn on the panel is a line somebody put there, and a track sunk into a
 * well is part of something.
 *
 * It reaches past the lane it is drawn in on all four sides rather than the lane being made
 * wider, because the lane's width is the width of a notch and the rail is measured off it:
 * a well that pushed the notches apart would move every level the pointer reads.
 */
const WELL = 'absolute -inset-x-1.5 -inset-y-1 rounded-full bg-surface-page track-well'

/** The track, on the rail: a thin line in the page's own muted surface, on a rim of its own. */
const TRACK =
  'inset-x-0 mx-auto w-track overflow-hidden rounded-full bg-muted ring-1 ring-border ring-inset'

/**
 * The part of it behind the reader: the accent, which is what says how much of the scale is on.
 * It is anchored at the foot of the track, because a fill growing downwards from the top would
 * read as a scale running backwards.
 */
const FILLED = 'absolute bottom-0 left-0 w-full rounded-full bg-primary'

/** The room one notch is drawn in, which is one step of the scale. */
const CELL = 'relative flex size-4 shrink-0 items-center justify-center'

/** A notch ahead of the reader: a dot a little wider than the track, so it reads as a mark on it. */
const DOT = 'relative size-1 rounded-full bg-input'

/**
 * And one behind them. A dot on the filled length has the accent underneath it, so a dot in the
 * accent is not a dot at all: it is drawn in what reads *on* the accent, which is the fill's
 * own foreground role.
 */
const DOT_DONE = 'bg-primary-foreground'

/**
 * The level the model defaults to: a rule drawn across the track at its notch.
 *
 * Wider than the notch it replaces and than the track it crosses, so it reads as a line laid
 * over the scale rather than as a fat dot — which is the whole difference between a mark and a
 * value. It is in the accent on both sides of the thumb: the fill runs under its middle and its
 * ends stand on the panel, and a rule that changed colour as the thumb passed it would read as
 * something the reader had set.
 */
const RULE = 'absolute h-0.5 w-8 rounded-full bg-primary'

/**
 * The length the thumb travels, which is the rail and nothing else. It is what a pointer is
 * measured against, and it takes none of them itself — the press belongs to the rows around it.
 */
const RAIL = 'inset-x-0'

/**
 * Where the thumb is hung: across the whole width of the lane and centred in it.
 *
 * The thumb is wider than a notch — twenty pixels against a sixteen-pixel cell — so what is
 * positioned is a full-width row and the thumb is centred inside it. A thumb pinned to the
 * lane's left edge would hang off to one side.
 */
const THUMB = 'absolute inset-x-0 flex translate-y-1/2 justify-center'

/** The room the thumb and its two halos are drawn in. */
const KNOB = 'relative size-thumb-lg shrink-0'

/**
 * The halo: the accent bleeding out of the thumb, which is what says the round thing on the
 * track is the thing the hand has hold of. It brightens under the hand and under the focus, on
 * the theme's own `thumb-motion` — a CSS transition, so a reader asking for less movement is
 * given the end of it and nothing on the way.
 *
 * `active` and not only `hover`: a thumb being dragged is held rather than pointed at, and a
 * halo that went back to its resting strength the moment the hand started moving would say the
 * control had been let go of.
 */
const HALO =
  'thumb-motion absolute inset-0 rounded-full halo group-hover:halo-strong group-focus-visible:halo-strong group-active:halo-strong'

/**
 * The wide, blurred layer under that ring: the light the thumb throws on the surface it sits
 * on, which is what makes a thumb read as lit rather than as drawn.
 */
const GLOW =
  'thumb-motion absolute inset-0 rounded-full halo-glow group-hover:halo-glow-strong group-focus-visible:halo-glow-strong group-active:halo-glow-strong'

/** The thumb itself: a domed core inside an accent rim, larger than the track it runs on. */
const DOMED =
  'thumb-motion relative block size-full rounded-full border-2 border-primary bg-card thumb-dome group-hover:scale-110 group-active:scale-95'

/**
 * Where a level sits along the track, between the foot of it and the head: 0 and 1.
 *
 * Measured between the middle of the first notch and the middle of the last, which is where the
 * track itself begins and ends: a fill measured edge to edge would stop short of the last notch
 * at the top of the scale and read as a scale that cannot be filled.
 */
function fractionAt(here: number, last: number): number {
  if (here <= 0) return 0
  if (last <= 0) return 1
  return here / last
}

/**
 * The same place as the length CSS draws it, which is what the fill and the thumb are given.
 *
 * Always a percentage, from the first frame on — which is why the two are mounted where they
 * stand (`initial={false}`) rather than carried there. `bottom` and `height` are lengths motion
 * converts by measuring the page when the unit it starts from is not the unit it is sent to, and
 * a thumb mounted with no `initial` starts from the pixels the page drew it at: in a panel still
 * being laid out, that measure was taken against a rail of another height, and the thumb
 * travelled in pixels to the wrong notch and stood there until the spring came to rest.
 */
function share(fraction: number): string {
  return `${fraction * 100}%`
}

/**
 * How far a page key goes: a third of the scale, and never less than an arrow's own step.
 *
 * A page has to be more than an arrow and less than End, and a fixed number of steps would be
 * one or the other depending on how many levels the agent announced — two steps is a page of
 * Claude's six and the whole of OpenCode's three.
 */
function pageOf(last: number): number {
  return Math.max(1, Math.round(last / 3))
}

/**
 * Where an arrow, a page key, Home or End take the scale, and `null` for any other key.
 *
 * Up and right go on, down and left come back, the page keys go the same way by more than one,
 * and Home and End are its two ends. It stops at either end rather than wrapping round: a scale
 * that came back to the top from the bottom is a scale nobody can hold the shape of.
 */
function steppedBy(key: string, here: number, last: number): number | null {
  if (key === 'ArrowUp' || key === 'ArrowRight') return Math.min(here + 1, last)
  if (key === 'ArrowDown' || key === 'ArrowLeft') return Math.max(here - 1, 0)
  if (key === 'PageUp') return Math.min(here + pageOf(last), last)
  if (key === 'PageDown') return Math.max(here - pageOf(last), 0)
  if (key === 'Home') return 0
  if (key === 'End') return last
  return null
}

/** How long a level's own word may be before it is worth shortening at all. */
const SHORT = 3

/**
 * The short mark every level of the scale is written beside its notch as.
 *
 * A vertical scale has no room for the agent's own words down its side, and a scale with no
 * words at all is five identical dots: the mark is the one letter that says which notch is
 * which without the panel growing a column of text. It is derived from the label and never
 * chosen here, because the levels are the agent's and not Hemera's.
 *
 * The rule is the initials, the label itself when it is short enough to stand as it is, and the
 * first two letters where two levels would otherwise carry the same letter: Claude's five come
 * out `L`, `M`, `H`, `XH` and `Max`. It is a set of marks and not a set of names — two levels
 * that still collide read the same, and the word above the track is what settles it.
 */
function marksOf(labels: readonly string[]): string[] {
  const marks: string[] = []
  for (const label of labels) marks.push(markOf(label, marks))
  return marks
}

/** One mark, kept out of the marks already given out. */
function markOf(label: string, taken: readonly string[]): string {
  const words = label.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '')
  // Two words are two initials: an agent that says "Very high" means both of them.
  if (words.length > 1) return words.map((word) => word.slice(0, 1).toUpperCase()).join('')
  const word = words[0] ?? label
  // `x` in front of a level is a prefix and not a word: `Xhigh` is an extra high, and reads XH.
  const first = /^x\p{L}/iu.test(word)
    ? `X${word.slice(1, 2).toUpperCase()}`
    : word.slice(0, 1).toUpperCase()
  if (!taken.includes(first)) return first
  // `Medium` took the M, so `Max` is written out rather than the two of them reading alike.
  return word.length <= SHORT ? word : word.slice(0, 2)
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

export function EffortSlider({
  efforts,
  effort,
  onEffortChange,
  defaultId = null,
  disabled,
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

  /** The notches: the levels the agent announced, less a `Default` it never resolved. */
  const levels = efforts.filter((one) => one.id !== UNRESOLVED)
  if (levels.length === 0) return null

  const last = levels.length - 1
  const here = levels.findIndex((one) => one.id === effort)
  /** The level whose word is over the track: what is set, `Default` included. */
  const shown: EffortChoice | undefined = efforts.find((one) => one.id === effort)
  /** The model's default, which is where the scale opens and where the rule is drawn. */
  const defaulted = levels.findIndex((one) => one.id === defaultId)
  /**
   * Which notch the thumb rests on: the level that is set, the model's default while nothing
   * is, and the foot of the track for an unresolved `Default` or a default nobody knows.
   */
  const standing = here === -1 && shown === undefined ? defaulted : here
  /** And what the scale reads as, which is the level that is set or the one it opened on. */
  const said: EffortChoice | undefined = shown ?? levels[standing]
  const marks = marksOf(levels.map((one) => one.label))
  const described = efforts.some((one) => one.description !== undefined)
  /** Where the thumb is drawn: under the hand while it is held, on its notch otherwise. */
  const at = held ?? fractionAt(standing, last)
  /** What the thumb and the fill travel on: nothing at all while a hand is moving them. */
  const travel = held === null ? glide : instant

  /** Sets the level at that index, and says nothing about one that is already set. */
  const set = (index: number): void => {
    const one = levels[index]
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
      aria-valuenow={standing === -1 ? 0 : standing}
      aria-valuetext={levelSaid(said, defaultId)}
      aria-disabled={disabled === true ? true : undefined}
      tabIndex={disabled === true ? -1 : 0}
      className={FRAME}
      onKeyDown={(event) => {
        if (disabled === true) return
        const next = steppedBy(event.key, standing === -1 ? 0 : standing, last)
        if (next === null) return
        event.preventDefault()
        set(next)
      }}
    >
      {/* The words are the value, and the value is announced once, by the role: read again as
          the text inside the control, it would be read twice. Every level the agent announced
          is drawn in the one cell — the unresolved `Default` among them, which has no notch of
          its own and is still what the scale is on while it is what is set. */}
      <span aria-hidden="true" className={STACK}>
        {efforts.map((one) => (
          <span key={one.id} className={cn(LAID, LEVEL, one.id !== said?.id && UNSHOWN)}>
            {one.label}
            {/* The model's default, said beside its name and quietly: a thing said about the
                level, never an entry of its own. */}
            {one.id === defaultId && <span className={DEFAULT_WORD}>{DEFAULT_BESIDE}</span>}
          </span>
        ))}
        {/* Nothing set and no default known: the control says what it is for, in the room the
            words leave. */}
        <span className={cn(LAID, LEVEL, said !== undefined && UNSHOWN)}>Effort</span>
      </span>

      {/* Only where the agent described its levels: an empty line under the name is a gap. */}
      {described && (
        <span aria-hidden="true" className={SAYINGS}>
          {efforts.map((one) => (
            <span key={one.id} className={cn(LAID, SAID, one.id !== said?.id && UNSHOWN)}>
              {one.description}
            </span>
          ))}
        </span>
      )}

      <span
        data-testid="effort-scale"
        className={cn(ROW, held !== null && HELD)}
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
        {/* Under the rows: the groove, and the track on the rail — so the fill ends on a notch,
            never past one. */}
        <span className={LANE}>
          <span data-testid="effort-well" className={WELL} />
          <span className={cn(RAIL_BOX, TRACK)}>
            <motion.span
              className={FILLED}
              initial={false}
              animate={{ height: share(at) }}
              transition={travel}
            />
          </span>
        </span>
        {levels.map((one, index) => (
          <span key={one.id} className={NOTCH}>
            <span data-mark={one.id} className={cn(MARK_WORD, index <= standing && MARK_DONE)}>
              {marks[index]}
            </span>
            <span data-step={one.id} className={CELL}>
              {one.id === defaultId ? (
                <span data-testid="effort-rule" className={RULE} />
              ) : (
                <span className={cn(DOT, index <= standing && DOT_DONE)} />
              )}
            </span>
          </span>
        ))}
        {/* Over the rows: the thumb, on the same rail as the track. */}
        <span className={LANE}>
          <span ref={rail} className={cn(RAIL_BOX, RAIL)}>
            <motion.span
              data-testid="effort-thumb"
              className={THUMB}
              initial={false}
              animate={{ bottom: share(at) }}
              transition={travel}
            >
              <span data-testid="effort-knob" className={KNOB}>
                <span className={GLOW} />
                <span className={HALO} />
                <span className={DOMED} />
              </span>
            </motion.span>
          </span>
        </span>
      </span>
    </div>
  )
}
