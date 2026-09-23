import { cn } from 'cn'
import { type KeyboardEvent, type ReactNode, useRef } from 'react'

import { IconButton } from '../components/button/button.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import {
  IconFileText,
  IconLayoutList,
  IconListCheck,
  IconMessageQuestion,
  IconUser,
} from '../icons.ts'
import {
  PHASE_TITLES,
  SECTION_TITLES,
  type Mark,
  type PhaseName,
  type PhaseState,
  type SpecTarget,
  type SpecView,
  shapedSectionsOf,
} from './model.ts'
import { MARK_WORDS } from './part-head.tsx'

/**
 * The rail of the Spec panel: every part of the Spec, one quiet row each, grouped by the phase
 * that writes it (lot 19, brief revision 3).
 *
 * The long document brought back the pain it was meant to cure — scrolling to find anything —
 * so the panel shows one part at a time again, and this is how the reader gets to the others.
 * It is not the outline of the first brief redrawn: the rows are words in normal case with no
 * surface of their own, the state of each is a small dot at its end, and the row on the stage
 * says so with a thin rule of the one accent and nothing else. The row of the part the agent is
 * writing keeps breathing, whichever part the reader is on.
 *
 * One stop of the tab order, and the arrows walk it: up and down, Home and End, Enter opens.
 * Above it, `Show all` turns the stage into the whole document, and the rail then only scrolls
 * it. Under 560 pixels of panel the rail folds to a column of glyphs — a question of the
 * panel's own width, answered by a container query and never measured.
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

/** The dot of a group label, the state of its phase; the open one breathes. */
const PHASE_DOTS: Record<PhaseState, string> = {
  finished: 'size-1.5 rounded-full bg-muted-foreground',
  open: 'size-1.5 rounded-full bg-primary motion-safe:animate-breathe',
  pending: 'size-1.5 rounded-full border border-input',
  stale: 'size-1.5 rounded-full bg-warning',
  unavailable: 'size-1.5 rounded-full border border-dashed border-input',
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

const RAIL =
  'flex w-rail shrink-0 flex-col gap-3 overflow-y-auto border-r border-border px-2 py-3 @max-spec-rail:w-rail-folded @max-spec-rail:px-1'

const TOP = 'flex justify-end @max-spec-rail:justify-center'

const GROUP_LABEL =
  'flex items-center gap-2 px-2 pb-1 text-xs text-muted-foreground @max-spec-rail:justify-center @max-spec-rail:px-0'

/**
 * A row: words and no surface. The row on the stage is the foreground text and a 2-pixel rule of
 * the accent on its left; every other row is the muted text, brightening under the hand.
 */
const ROW =
  'relative flex h-control-sm w-full items-center gap-2 rounded-sm px-2 text-left text-sm outline-none focus-ring hover:text-foreground @max-spec-rail:justify-center @max-spec-rail:px-0'

const ROW_OFF = 'text-muted-foreground'

const ROW_ON =
  'text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'

const GLYPH = 'hidden shrink-0 @max-spec-rail:flex'

const LABEL = 'min-w-0 flex-1 truncate @max-spec-rail:hidden'

const COUNT = 'text-xs text-muted-foreground tabular-nums @max-spec-rail:hidden'

/** The breath of the dot of the part the agent is writing, kept whichever part is shown. */
const BREATHE = 'motion-safe:animate-breathe'

const DOT_BOX =
  'flex size-2 shrink-0 items-center justify-center @max-spec-rail:absolute @max-spec-rail:top-1 @max-spec-rail:right-1'

export interface SpecRailProps {
  /** What the rail is called: `Parts of ATL-7`. */
  label: string
  groups: RailGroup[]
  /** The part on the stage, or scrolled to when the whole document is shown. */
  current: SpecTarget
  /** The part the agent is writing, whose row keeps breathing. */
  following?: SpecTarget | undefined
  onSelect: (target: SpecTarget) => void
  /** Whether the stage shows the whole document rather than one part. */
  showAll: boolean
  onShowAllChange: (showAll: boolean) => void
}

export function SpecRail({
  label,
  groups,
  current,
  following,
  onSelect,
  showAll,
  onShowAllChange,
}: SpecRailProps): ReactNode {
  const list = useRef<HTMLDivElement>(null)

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
    <nav aria-label={label} className={RAIL}>
      <div className={TOP}>
        <Tooltip label={showAll ? 'Show one part' : 'Show all'}>
          <IconButton
            variant="ghost"
            size="sm"
            icon={<IconLayoutList size="sm" />}
            aria-label="Show all"
            aria-pressed={showAll}
            onClick={() => onShowAllChange(!showAll)}
          />
        </Tooltip>
      </div>
      <div ref={list} className="flex flex-col gap-3" onKeyDown={walk}>
        {groups.map((group) => (
          <div key={group.phase} role="group" aria-label={PHASE_TITLES[group.phase]}>
            <p className={GROUP_LABEL}>
              <span aria-hidden="true" className={PHASE_DOTS[group.state]} />
              <span className="@max-spec-rail:sr-only">{PHASE_TITLES[group.phase]}</span>
              <span className="sr-only">{`, ${PHASE_STATE_WORDS[group.state]}`}</span>
            </p>
            <ul className="flex flex-col">
              {group.rows.map((row) => {
                const on = row.target === current
                const name =
                  row.count === undefined
                    ? `${row.label}, ${MARK_WORDS[row.mark]}`
                    : `${row.label}, ${row.count}, ${MARK_WORDS[row.mark]}`
                const breathing = row.mark === 'writing' || row.target === following
                return (
                  <li key={row.target}>
                    <Tooltip label={row.label} side="right">
                      <button
                        type="button"
                        data-row
                        // One stop of the tab order: the row on the stage. The arrows do the rest.
                        tabIndex={on ? 0 : -1}
                        aria-current={on ? 'true' : undefined}
                        aria-label={name}
                        className={cn(ROW, on ? ROW_ON : ROW_OFF)}
                        onClick={() => onSelect(row.target)}
                      >
                        <span aria-hidden="true" className={GLYPH}>
                          {glyphOf(row.target)}
                        </span>
                        <span className={LABEL}>{row.label}</span>
                        {row.count !== undefined && <span className={COUNT}>{row.count}</span>}
                        <span aria-hidden="true" className={DOT_BOX}>
                          <span className={cn(DOTS[row.mark], breathing && BREATHE)} />
                        </span>
                      </button>
                    </Tooltip>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  )
}
