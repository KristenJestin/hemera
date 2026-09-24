import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { Popover } from '../components/popover/popover.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import { IconFileText, IconListCheck, IconMessageQuestion, IconUser } from '../icons.ts'
import { FILL_STEP, crossfade, fill, instant, useTransition } from '../motion.ts'
import {
  PHASE_TITLES,
  SECTION_TITLES,
  type GateCheckView,
  type Mark,
  type PhaseName,
  type PhaseState,
  type ReadinessView,
  type SpecTarget,
  type SpecView,
  shapedSectionsOf,
} from './model.ts'
import { MARK_WORDS } from './part-head.tsx'

/**
 * The rail of the Spec panel: every part of the Spec, one quiet row each, grouped by the phase
 * that writes it, and at its foot how far the Spec is from `ready` (lot 19, brief revisions 3
 * and 4).
 *
 * The rows are words in normal case with no surface of their own, the state of each is a small
 * dot at its end, and what is on the stage says so with a thin rule of the one accent and nothing
 * else. A group's heading is a row like the others: it puts every part of its phase on the stage,
 * one under the other. The row of the part the agent is writing keeps breathing, whichever part
 * the reader is on.
 *
 * One stop of the tab order, and the arrows walk it: up and down, Home and End, Enter opens.
 *
 * Folded, it is the band the panel folds to beside the chat: the glyph of each part and its dot,
 * the dot of each phase, and the readiness said as `3/7`. The names leave the eye and stay the
 * accessible name and the tooltip.
 */

/** One row: where it leads, what it is called, its mark and, for a list, its count. */
export interface RailRow {
  target: SpecTarget
  label: string
  mark: Mark
  count?: number | undefined
}

/** A group of rows under the phase that writes them. */
export interface RailGroup {
  phase: PhaseName
  state: PhaseState
  rows: RailRow[]
}

/**
 * What the stage shows: one part, or every part of one phase's group. Two shapes, because a
 * phase and a part may share a name — `plan` is both.
 */
export type StageChoice = { part: SpecTarget } | { group: PhaseName }

/** The groups of a Spec: the type's shaped sections, the plan, and the three lists. */
export function railOf(spec: SpecView): RailGroup[] {
  const stateOf = (phase: PhaseName): PhaseState =>
    spec.phases.find((one) => one.name === phase)?.state ?? 'pending'
  const markOf = (target: SpecTarget): Mark =>
    spec.sections.find((section) => section.name === target)?.mark ?? 'empty'
  const decompose: RailRow[] = []
  // Stories are optional and mostly a `feature` matter (core.md, "Spec"): a Spec of another
  // type shows them only once it has one.
  if (spec.type === 'feature' || spec.stories.length > 0) {
    decompose.push({
      target: 'stories',
      label: 'Stories',
      mark: spec.storiesMark,
      count: spec.stories.length,
    })
  }
  decompose.push(
    { target: 'tasks', label: 'Tasks', mark: spec.tasksMark, count: spec.tasks.length },
    {
      target: 'questions',
      label: 'Questions',
      mark: spec.questionsMark,
      // The open ones: what the count says is what is left for somebody to answer.
      count: spec.questions.filter((question) => question.answer === null).length,
    },
  )
  return [
    {
      phase: 'shape',
      state: stateOf('shape'),
      rows: shapedSectionsOf(spec.type).map((name) => ({
        target: name,
        label: SECTION_TITLES[name],
        mark: markOf(name),
      })),
    },
    {
      phase: 'plan',
      state: stateOf('plan'),
      rows: [{ target: 'plan', label: SECTION_TITLES.plan, mark: markOf('plan') }],
    },
    { phase: 'decompose', state: stateOf('decompose'), rows: decompose },
  ]
}

/** The dot at the end of a row: the same six marks the parts wear in their margin. */
const DOTS: Record<Mark, string> = {
  empty: 'size-1.5 rounded-full border border-input',
  agent: 'size-1.5 rounded-full bg-muted-foreground',
  human: 'size-1.5 rounded-full bg-muted-foreground outline outline-offset-1 outline-primary',
  stale: 'size-1.5 rounded-full bg-warning',
  conflict: 'size-1.5 rounded-full bg-destructive',
  writing: 'size-1.5 rounded-full bg-primary',
}

/** The dot of a group heading, the state of its phase; the open one breathes. */
const PHASE_DOTS: Record<PhaseState, string> = {
  finished: 'size-1.5 shrink-0 rounded-full bg-muted-foreground',
  open: 'size-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-breathe',
  pending: 'size-1.5 shrink-0 rounded-full border border-input',
  stale: 'size-1.5 shrink-0 rounded-full bg-warning',
  unavailable: 'size-1.5 shrink-0 rounded-full border border-dashed border-input',
}

const PHASE_STATE_WORDS: Record<PhaseState, string> = {
  finished: 'finished',
  open: 'open',
  pending: 'pending',
  stale: 'stale after the rework',
  unavailable: 'unavailable',
}

/** The glyph a row is drawn as once the rail is folded: one per kind of part. */
function glyphOf(target: SpecTarget): ReactNode {
  if (target === 'stories') return <IconUser size="sm" />
  if (target === 'tasks') return <IconListCheck size="sm" />
  if (target === 'questions') return <IconMessageQuestion size="sm" />
  return <IconFileText size="sm" />
}

const RAIL = 'flex w-rail shrink-0 flex-col border-r border-border'

const RAIL_FOLDED = 'flex min-h-0 flex-1 flex-col'

const LIST = 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 py-3'

const LIST_FOLDED = 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 py-2'

/**
 * A row: words and no surface. The row on the stage is the foreground text and a 2-pixel rule of
 * the accent on its left; every other row is the muted text, brightening under the hand. Folded,
 * the glyph stands where the words were, its dot on its corner.
 */
const ROW =
  'relative flex h-control-sm w-full items-center gap-2 rounded-sm px-2 text-left text-sm outline-none focus-ring hover:text-foreground'

const ROW_FOLDED =
  'relative flex h-control-sm w-full items-center justify-center rounded-sm text-sm outline-none focus-ring hover:text-foreground'

/** A group's heading: a row of its own, in the small type of a label. */
const HEADING =
  'relative flex h-control-sm w-full items-center gap-2 rounded-sm px-2 text-left text-xs outline-none focus-ring hover:text-foreground'

const HEADING_FOLDED =
  'relative flex h-control-sm w-full items-center justify-center rounded-sm text-xs outline-none focus-ring hover:text-foreground'

const ROW_OFF = 'text-muted-foreground'

const ROW_ON =
  'text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'

const LABEL = 'min-w-0 flex-1 truncate'

const COUNT = 'text-xs text-muted-foreground tabular-nums'

/** The breath of the dot of the part the agent is writing, kept whichever part is shown. */
const BREATHE = 'motion-safe:animate-breathe'

const DOT_BOX = 'flex size-2 shrink-0 items-center justify-center'

const DOT_BOX_FOLDED = 'absolute top-1 right-1 flex size-2 items-center justify-center'

export interface SpecRailProps {
  /** What the rail is called: `Parts of ATL-7`. */
  label: string
  groups: RailGroup[]
  /** What is on the stage: a part, or a phase's group. */
  current: StageChoice
  /** The part the agent is writing, whose row keeps breathing. */
  following?: SpecTarget | undefined
  /** Puts a part on the stage: a row, or a thing left before ready. */
  onSelect: (target: SpecTarget) => void
  /** Puts every part of a phase on the stage. */
  onSelectGroup: (phase: PhaseName) => void
  /** The seven checks of the gate and what is left, which the foot says. */
  readiness: ReadinessView
  /** A frozen Spec says when it was frozen instead of what is left. */
  frozenOn?: string | undefined
  /** An older revision says which one replaced it. */
  replacedBy?: number | undefined
  /** The human click that freezes the Spec. */
  onMarkReady: () => void
  /** The band of glyphs the panel folds to, rather than the rail of words. */
  folded?: boolean | undefined
}

export function SpecRail({
  label,
  groups,
  current,
  following,
  onSelect,
  onSelectGroup,
  readiness,
  frozenOn,
  replacedBy,
  onMarkReady,
  folded = false,
}: SpecRailProps): ReactNode {
  const list = useRef<HTMLDivElement>(null)
  // The band stands at the window's right edge: what names a glyph opens away from it.
  const side = folded ? 'left' : 'right'

  /** Moves the keyboard to another row, without opening it: Enter does that. */
  function walk(event: KeyboardEvent<HTMLDivElement>): void {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('[data-row]') ?? [])]
    const at = buttons.findIndex((button) => button === document.activeElement)
    if (at === -1) return
    const last = buttons.length - 1
    const moves = new Map([
      ['ArrowDown', Math.min(at + 1, last)],
      ['ArrowUp', Math.max(at - 1, 0)],
      ['Home', 0],
      ['End', last],
    ])
    const next = moves.get(event.key)
    if (next === undefined) return
    event.preventDefault()
    buttons[next]?.focus()
  }

  return (
    <nav aria-label={label} className={folded ? RAIL_FOLDED : RAIL}>
      <div ref={list} className={folded ? LIST_FOLDED : LIST} onKeyDown={walk}>
        {groups.map((group) => {
          const title = PHASE_TITLES[group.phase]
          const whole = 'group' in current && current.group === group.phase
          return (
            <div key={group.phase} role="group" aria-label={title}>
              <Tooltip label={`All of ${title}`} side={side}>
                <button
                  type="button"
                  data-row
                  // One stop of the tab order: what is on the stage. The arrows do the rest.
                  tabIndex={whole ? 0 : -1}
                  aria-current={whole ? 'true' : undefined}
                  className={cn(folded ? HEADING_FOLDED : HEADING, whole ? ROW_ON : ROW_OFF)}
                  onClick={() => onSelectGroup(group.phase)}
                >
                  <span aria-hidden="true" className={PHASE_DOTS[group.state]} />
                  <span className={folded ? 'sr-only' : undefined}>{title}</span>
                  <span className="sr-only">{` phase, ${PHASE_STATE_WORDS[group.state]}`}</span>
                </button>
              </Tooltip>
              <ul className="flex flex-col">
                {group.rows.map((row) => {
                  const on = 'part' in current && current.part === row.target
                  const name =
                    row.count === undefined
                      ? `${row.label}, ${MARK_WORDS[row.mark]}`
                      : `${row.label}, ${row.count}, ${MARK_WORDS[row.mark]}`
                  const breathing = row.mark === 'writing' || row.target === following
                  return (
                    <li key={row.target}>
                      <Tooltip label={row.label} side={side}>
                        <button
                          type="button"
                          data-row
                          tabIndex={on ? 0 : -1}
                          aria-current={on ? 'true' : undefined}
                          aria-label={name}
                          className={cn(folded ? ROW_FOLDED : ROW, on ? ROW_ON : ROW_OFF)}
                          onClick={() => onSelect(row.target)}
                        >
                          {folded ? (
                            <span aria-hidden="true" className="flex shrink-0">
                              {glyphOf(row.target)}
                            </span>
                          ) : (
                            <>
                              <span className={LABEL}>{row.label}</span>
                              {row.count !== undefined && (
                                <span className={COUNT}>{row.count}</span>
                              )}
                            </>
                          )}
                          <span aria-hidden="true" className={folded ? DOT_BOX_FOLDED : DOT_BOX}>
                            <span className={cn(DOTS[row.mark], breathing && BREATHE)} />
                          </span>
                        </button>
                      </Tooltip>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
      {folded ? (
        <FoldedFoot readiness={readiness} />
      ) : (
        <ReadinessFoot
          readiness={readiness}
          frozenOn={frozenOn}
          replacedBy={replacedBy}
          onGoTo={onSelect}
          onMarkReady={onMarkReady}
        />
      )}
    </nav>
  )
}

/** How many checks pass, out of how many, and the words the measure is named by. */
interface Score {
  passed: number
  total: number
  name: string
}

function scoreOf(readiness: ReadinessView): Score {
  const passed = readiness.checks.filter((check) => check.passed).length
  const total = readiness.checks.length
  return { passed, total, name: `Readiness, ${passed} of ${total} checks pass` }
}

const FOLDED_FOOT = 'shrink-0 py-3 text-center font-mono text-xs text-muted-foreground'

/** The readiness in the band: `3/7`, and nothing to press — the band itself unfolds. */
function FoldedFoot({ readiness }: { readiness: ReadinessView }): ReactNode {
  const { passed, total, name } = scoreOf(readiness)
  return (
    <p role="img" aria-label={name} className={FOLDED_FOOT}>
      {`${passed}/${total}`}
    </p>
  )
}

const FOOT = 'flex shrink-0 flex-col gap-2 border-t border-border px-3 py-3'

const BAR = 'flex gap-0.5'

/** A segment: a thin track, and the fill inside it that grows from its left edge. */
const TRACK = 'relative h-0.5 flex-1 overflow-hidden rounded-full bg-accent'

const FILLED = 'absolute inset-0 origin-left rounded-full bg-success'

const SAY = 'text-xs text-muted-foreground'

const LINK =
  'rounded-sm text-left whitespace-nowrap text-foreground underline decoration-input underline-offset-4 outline-none focus-ring hover:decoration-primary'

const OK = 'font-semibold text-success-muted-foreground'

const REFUSED = 'text-xs text-destructive-muted-foreground'

interface ReadinessFootProps {
  readiness: ReadinessView
  frozenOn?: string | undefined
  replacedBy?: number | undefined
  onGoTo: (target: SpecTarget) => void
  onMarkReady: () => void
}

/**
 * How far the Spec is from `ready`, at the foot of the rail (D7-10).
 *
 * Not a list of errors: seven thin segments the width of the rail, one per check of the gate,
 * filled in the success colour where the check passes, and one line under them — `3/7 · 2 things
 * before ready`. The things left open a small popover that lists them, each a link that puts its
 * part on the stage.
 *
 * When every check passes the line becomes `Ready to freeze` and `Mark ready` sits under it. It
 * is never drawn disabled: a button that cannot be pressed is a question it does not answer, and
 * the line is the answer. Only the human's press freezes the Spec; the gate is checked again when
 * it arrives (D7-10, "An obsolete request is refused").
 */
function ReadinessFoot({
  readiness,
  frozenOn,
  replacedBy,
  onGoTo,
  onMarkReady,
}: ReadinessFootProps): ReactNode {
  const transition = useTransition(crossfade)
  const { passed, total, name } = scoreOf(readiness)
  const full = passed === total
  return (
    <div className={FOOT}>
      <div role="img" aria-label={name} className={BAR}>
        {readiness.checks.map((check, index) => (
          <Segment key={check.check} check={check} index={index} />
        ))}
      </div>
      <p className={SAY}>
        {frozenOn !== undefined ? (
          replacedBy === undefined ? (
            `Frozen on ${frozenOn} · nothing changes until you rework it`
          ) : (
            `Frozen on ${frozenOn} · read only, revision ${replacedBy} replaced it`
          )
        ) : full ? (
          <span className={OK}>Ready to freeze</span>
        ) : (
          // One line, which the rail is as wide as: the count and what is left read together.
          <span className="whitespace-nowrap">
            <span className="tabular-nums">{`${passed}/${total}`}</span>
            <span aria-hidden="true">{' · '}</span>
            <Left readiness={readiness} onGoTo={onGoTo} />
          </span>
        )}
      </p>
      <AnimatePresence initial={false}>
        {full && frozenOn === undefined && (
          <motion.div
            key="mark-ready"
            className="flex"
            initial={{ filter: 'opacity(0)' }}
            animate={{ filter: 'opacity(1)' }}
            exit={{ filter: 'opacity(0)' }}
            transition={transition}
          >
            <Button variant="primary" size="sm" onClick={onMarkReady}>
              Mark ready
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      {readiness.refused !== undefined && (
        <p role="alert" className={REFUSED}>
          {readiness.refused}
        </p>
      )}
    </div>
  )
}

/** One check: a thin track, filled from its left edge when it passes. */
function Segment({ check, index }: { check: GateCheckView; index: number }): ReactNode {
  const base = useTransition(fill)
  // Each segment a step behind the one before it, so a bar that fills at once sweeps from the
  // left; a system asking for less movement gets the bar filled, with nothing to wait on.
  const transition = base === instant ? base : { ...base, delay: index * FILL_STEP }
  return (
    <span className={TRACK}>
      {check.passed && (
        <motion.span
          className={FILLED}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={transition}
        />
      )}
    </span>
  )
}

/** `2 things before ready`, which opens the list of them, each a link to where it is fixed. */
function Left({
  readiness,
  onGoTo,
}: {
  readiness: ReadinessView
  onGoTo: (target: SpecTarget) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const { todo } = readiness
  return (
    <Popover
      label="Things before ready"
      side="top"
      align="start"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={LINK}>
          {`${todo.length} ${todo.length === 1 ? 'thing' : 'things'} before ready`}
        </button>
      }
    >
      <ul className="flex flex-col gap-1.5">
        {todo.map((item) => (
          <li key={item.label}>
            {item.target === undefined ? (
              <span className="text-muted-foreground">{item.label}</span>
            ) : (
              <button
                type="button"
                className={LINK}
                onClick={() => {
                  setOpen(false)
                  if (item.target !== undefined) onGoTo(item.target)
                }}
              >
                {item.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Popover>
  )
}
