import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { Popover } from '../components/popover/popover.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
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
import { SPEC_PART_ICONS, SPEC_PHASE_ICONS } from './spec-icons.ts'

/**
 * The rail of the Spec panel: every part of the Spec, one quiet row each, grouped by the phase
 * that writes them, and at its foot how far the Spec is from `ready` (lot 19, brief revisions 3
 * and 4, and the maintainer's decisions on the rail's states).
 *
 * The foot already says what is done, so a row says only what needs attention, and says it with
 * the row itself rather than with a mark at its end. A part written and current carries nothing. A
 * part still empty has its name in a fainter text. The part the agent is writing is tinted in the
 * primary, the tint breathing; a part to review is tinted in the warning colour, one whose text
 * differs from yours in the destructive one. A part you edited, which the agent has not read yet,
 * wears an edge of the info colour on its left, which goes with a tint rather than replacing it.
 * Each row says its state in a sentence, in its tooltip and as its accessible description.
 *
 * What is on the stage says so with a thin rule of the one accent and nothing else. A group opens
 * on its heading, which reads as the header of a section and not as one more row: the phase's name
 * in the small type of a label, a hairline above every group but the first, the rows set in under
 * it. It wears no state of its own — the foot says how far the phases went — but the warning tint
 * when every part under it is to review. Pressed, it puts every part of its phase on the stage, and
 * the rule runs on the header and on every row under it. `Show all` shows at its end under the hand
 * and the keyboard, and only then.
 *
 * One stop of the tab order, and the arrows walk it: up and down, Home and End, Enter opens.
 *
 * Each phase and each part wears a glyph of its own, before its name. Folded, the rail is the
 * band the panel folds to beside the chat, and it keeps the hierarchy: each phase a block, its
 * glyph in a tinted square, the smaller glyphs of its parts right under it and set in, and a gap
 * and a hairline before the next phase. The tints of the rows land on the squares of the parts;
 * the names leave the eye and stay the accessible name and the tooltip, beside the state.
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

/**
 * Each state said in a sentence, in the tooltip and as the accessible description. A part
 * written and current says nothing: there is nothing to do about it.
 */
export const STATE_SENTENCES: Record<Mark, string | undefined> = {
  empty: 'Empty',
  agent: undefined,
  human: 'Edited by you',
  stale: 'To review',
  conflict: "Your text and the agent's differ",
  writing: 'The agent is writing this',
}

/** The state a row shows: the part the agent is writing is that, whatever its mark says. */
function rowStateOf(row: RailRow, following: SpecTarget | undefined): Mark {
  return row.target === following ? 'writing' : row.mark
}

/** What a row says of itself: its state, and an edit of yours the agent has not read yet. */
function sentenceOf(row: RailRow, state: Mark): string | undefined {
  const edited = row.mark === 'human' && state !== 'human' ? STATE_SENTENCES.human : undefined
  const said = [STATE_SENTENCES[state], edited].filter((one) => one !== undefined)
  return said.length === 0 ? undefined : said.join('. ')
}

/**
 * The tint behind a row that needs attention: a layer under its content, so that the one of the
 * part being written breathes without its text breathing with it. A soft step of the colour, light
 * enough that the text on it keeps its contrast in both themes.
 */
const TINT = 'pointer-events-none absolute inset-0 -z-10 rounded-sm'

const TINT_FOLDED = 'pointer-events-none absolute inset-0 -z-10 rounded-md'

const TINTS: Partial<Record<Mark, string>> = {
  writing: 'bg-primary/10 motion-safe:animate-breathe',
  stale: 'bg-warning/15',
  conflict: 'bg-destructive/15',
}

/** The edge of a part you edited, which the agent reads next turn: beside a tint, not instead. */
const EDITED = 'rounded-l-none border-l-2 border-info'

/**
 * The name of a part still empty, fainter than the others: as faint as small text goes on the
 * panel and still reads. A step further and the light theme falls under the contrast it needs.
 */
const EMPTY = 'text-muted-foreground/90'

/** Whether every part of a group is to review, which its header then says too. */
function allStale(group: RailGroup): boolean {
  return group.rows.length > 0 && group.rows.every((row) => row.mark === 'stale')
}

/** The phase's state, said to whoever cannot see the foot: the header draws none of it. */
const PHASE_STATE_WORDS: Record<PhaseState, string> = {
  finished: 'finished',
  open: 'open',
  pending: 'pending',
  stale: 'stale after the rework',
  unavailable: 'unavailable',
}

/** A glyph of the rail, named by `data-icon` so a play can tell one from another. */
function Glyph({
  icon: Icon,
  size = 'sm',
}: {
  icon: (typeof SPEC_PART_ICONS)[SpecTarget]
  size?: 'sm' | 'md' | undefined
}): ReactNode {
  return (
    <span aria-hidden="true" data-icon={Icon.displayName} className="flex shrink-0">
      <Icon size={size} />
    </span>
  )
}

/** The tint layer of a row or a header, when its state has one. */
function Tint({ state, folded }: { state: Mark; folded: boolean }): ReactNode {
  const tint = TINTS[state]
  if (tint === undefined) return null
  return (
    <span aria-hidden="true" data-tint={state} className={cn(folded ? TINT_FOLDED : TINT, tint)} />
  )
}

const RAIL = 'flex w-rail shrink-0 flex-col border-r border-border'

const RAIL_FOLDED = 'flex min-h-0 flex-1 flex-col'

const LIST = 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 py-3'

/** A group unfolded: a hairline above it but the first, more room above its header than under. */
const GROUP = 'flex flex-col gap-0.5 border-t border-border pt-3 first:border-t-0 first:pt-0'

/** The rows of a group, set in under its header. */
const ROWS = 'flex flex-col pl-3'

const LIST_FOLDED = 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 py-2'

/** A phase folded: a block, a hairline and a gap above it but the first. */
const GROUP_FOLDED =
  'flex flex-col items-start gap-0.5 border-t border-border pt-3 first:border-t-0 first:pt-0'

/** The parts of a phase folded: stacked tight, and set in under the phase's square. */
const ROWS_FOLDED = 'flex flex-col gap-0.5 pl-2'

/**
 * A row: its glyph and its words, and no surface but the tint of a state that needs attention.
 * The row on the stage is the foreground text and a 2-pixel rule of the accent on its left; every
 * other row is the muted text, brightening under the hand. Folded, the glyph stands alone in a
 * small square, which is what the tint fills.
 */
const ROW =
  'relative isolate flex h-control-sm w-full items-center gap-2 rounded-sm px-2 text-left text-sm outline-none focus-ring hover:text-foreground'

const ROW_FOLDED =
  'relative isolate flex size-6 items-center justify-center rounded-md outline-none focus-ring hover:text-foreground'

/**
 * A group's header: its phase's glyph and name in the small type of a label — smaller, heavier,
 * a little spaced, and muted even on the stage, where only the rule says so — and never cut.
 */
const HEADING =
  'group/head relative isolate flex h-6 w-full items-center gap-1.5 rounded-sm px-2 text-left text-xs font-medium tracking-wide whitespace-nowrap text-muted-foreground outline-none focus-ring'

/** A phase folded: its glyph in a tinted square, a step larger than the glyphs of its parts. */
const HEADING_FOLDED =
  'relative isolate flex size-control-sm items-center justify-center rounded-md bg-muted-foreground/15 text-muted-foreground outline-none focus-ring hover:text-foreground'

/** The same square when every part of the phase is to review: the warning tint instead. */
const HEADING_FOLDED_STALE =
  'relative isolate flex size-control-sm items-center justify-center rounded-md text-muted-foreground outline-none focus-ring hover:text-foreground'

const ROW_OFF = 'text-muted-foreground'

const ROW_CURRENT = 'text-foreground'

/** The rule of what is on the stage: a row, a header, or every row of a group on the stage. */
const RULE =
  'before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'

/** The same rule on a header, whose line is shorter. */
const HEADING_RULE =
  'before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'

/** Folded, the rule stands in the room left of the square rather than over its edge. */
const RULE_FOLDED =
  'before:absolute before:inset-y-1 before:-left-1 before:w-0.5 before:rounded-full before:bg-primary'

const HEADING_LABEL = 'flex-1'

/**
 * What pressing a header does, at its end: hidden until the hand or the keyboard is on it. The
 * hand is followed in state rather than by `:hover`, so that a play can drive it.
 */
const HINT = 'font-normal tracking-normal opacity-0 group-focus/head:opacity-100'

const HINT_SHOWN = 'font-normal tracking-normal opacity-100'

const LABEL = 'min-w-0 flex-1 truncate'

const COUNT = 'text-xs text-muted-foreground tabular-nums'

export interface SpecRailProps {
  /** What the rail is called: `Parts of ATL-7`. */
  label: string
  groups: RailGroup[]
  /** What is on the stage: a part, or a phase's group. */
  current: StageChoice
  /** The part the agent is writing, whose row is tinted and breathes. */
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
  const said = useId()
  // The header under the hand, whose hint shows.
  const [pointed, setPointed] = useState<PhaseName | null>(null)
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
          const stale = allStale(group)
          const headingSaid = `${said}-${group.phase}`
          return (
            <div
              key={group.phase}
              role="group"
              aria-label={title}
              className={folded ? GROUP_FOLDED : GROUP}
            >
              <Tooltip
                label={
                  stale ? `${title} · ${STATE_SENTENCES.stale} · show all` : `${title} · show all`
                }
                side={side}
              >
                <button
                  type="button"
                  data-row
                  data-heading
                  // One stop of the tab order: what is on the stage. The arrows do the rest.
                  tabIndex={whole ? 0 : -1}
                  aria-current={whole ? 'true' : undefined}
                  aria-label={`${title} phase, ${PHASE_STATE_WORDS[group.state]}, show all its parts`}
                  aria-describedby={stale ? headingSaid : undefined}
                  className={cn(
                    folded ? (stale ? HEADING_FOLDED_STALE : HEADING_FOLDED) : HEADING,
                    whole && (folded ? RULE_FOLDED : HEADING_RULE),
                  )}
                  onClick={() => onSelectGroup(group.phase)}
                  onPointerEnter={() => setPointed(group.phase)}
                  onPointerLeave={() => setPointed(null)}
                >
                  {stale && <Tint state="stale" folded={folded} />}
                  <Glyph icon={SPEC_PHASE_ICONS[group.phase]} size={folded ? 'md' : 'sm'} />
                  {!folded && (
                    <>
                      <span className={HEADING_LABEL}>{title}</span>
                      <span
                        aria-hidden="true"
                        data-hint
                        className={pointed === group.phase ? HINT_SHOWN : HINT}
                      >
                        Show all
                      </span>
                    </>
                  )}
                </button>
              </Tooltip>
              {stale && (
                <span id={headingSaid} hidden>
                  {STATE_SENTENCES.stale}
                </span>
              )}
              <ul className={folded ? ROWS_FOLDED : ROWS}>
                {group.rows.map((row) => {
                  const on = 'part' in current && current.part === row.target
                  const state = rowStateOf(row, following)
                  const sentence = sentenceOf(row, state)
                  const rowSaid = `${said}-${row.target}`
                  const name = row.count === undefined ? row.label : `${row.label}, ${row.count}`
                  const tip =
                    sentence === undefined
                      ? row.label
                      : folded
                        ? `${row.label} · ${sentence}`
                        : sentence
                  return (
                    <li key={row.target} className="flex">
                      <Tooltip label={tip} side={side}>
                        <button
                          type="button"
                          data-row
                          data-state={state}
                          tabIndex={on ? 0 : -1}
                          aria-current={on ? 'true' : undefined}
                          aria-label={name}
                          aria-describedby={sentence === undefined ? undefined : rowSaid}
                          className={cn(
                            folded ? ROW_FOLDED : ROW,
                            on ? ROW_CURRENT : state === 'empty' ? EMPTY : ROW_OFF,
                            (on || whole) && (folded ? RULE_FOLDED : RULE),
                            row.mark === 'human' && EDITED,
                          )}
                          onClick={() => onSelect(row.target)}
                        >
                          <Tint state={state} folded={folded} />
                          <Glyph icon={SPEC_PART_ICONS[row.target]} />
                          {!folded && (
                            <>
                              <span className={LABEL}>{row.label}</span>
                              {row.count !== undefined && (
                                <span className={COUNT}>{row.count}</span>
                              )}
                            </>
                          )}
                        </button>
                      </Tooltip>
                      {sentence !== undefined && (
                        <span id={rowSaid} hidden>
                          {sentence}
                        </span>
                      )}
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
