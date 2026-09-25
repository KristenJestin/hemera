import { AnimatePresence, type Transition, motion, useIsPresent } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { Popover } from '../components/popover/popover.tsx'
import { FILL_STEP, crossfade, fill, instant, useTransition } from '../motion.ts'
import {
  type MissionRailGroup,
  type MissionRailItem,
  MissionRail,
  type RailAttention,
} from '../session/mission-rail.tsx'
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
 * The rail of the Spec panel: every part of the Spec, grouped by the phase that writes it, and at
 * its foot how far the Spec is from `ready` (lot 19, brief revisions 3 and 4, and the
 * maintainer's decisions on the rail's states).
 *
 * What it draws and how is the mission rail's (`session/mission-rail.tsx`): a row says only what
 * needs attention, by a tint or a fainter name, and says it in a sentence; the headers,
 * the hint, the rule of what is on the stage and the folded band are the same for every mission.
 * What is the Spec's is here: which parts a type has, under which phase, the glyph of each, what
 * each mark asks of the reader, the sentences, and the readiness at the foot. The foot already
 * says what is done, so nothing of it is said twice on the rows.
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

/** What each mark asks of the reader's attention, in the rail's own vocabulary. */
const ATTENTION: Record<Mark, RailAttention> = {
  empty: 'empty',
  agent: 'none',
  human: 'edited',
  stale: 'review',
  conflict: 'conflict',
  writing: 'writing',
}

/** The phase's state, said to whoever cannot see the foot: the header draws none of it. */
const PHASE_STATE_WORDS: Record<PhaseState, string> = {
  finished: 'finished',
  open: 'open',
  pending: 'pending',
  stale: 'to review',
  unavailable: 'unavailable',
}

/** A row as the rail draws it: the part the agent is writing is that, whatever its mark says. */
function itemOf(row: RailRow, following: SpecTarget | undefined): MissionRailItem {
  const state: Mark = row.target === following ? 'writing' : row.mark
  // An edit of yours the agent has not read yet stays said beside what the row is now.
  const edited = row.mark === 'human' && state !== 'human'
  const said = [STATE_SENTENCES[state], edited ? STATE_SENTENCES.human : undefined].filter(
    (one) => one !== undefined,
  )
  return {
    id: row.target,
    icon: SPEC_PART_ICONS[row.target],
    label: row.label,
    count: row.count,
    attention: ATTENTION[state],
    description: said.length === 0 ? undefined : said.join('. '),
  }
}

/** A phase as the rail draws it: its header, and the warning tint when every part is to review. */
function groupOf(group: RailGroup, following: SpecTarget | undefined): MissionRailGroup {
  const title = PHASE_TITLES[group.phase]
  const review = group.rows.length > 0 && group.rows.every((row) => row.mark === 'stale')
  return {
    id: group.phase,
    icon: SPEC_PHASE_ICONS[group.phase],
    label: title,
    name: `${title} phase, ${PHASE_STATE_WORDS[group.state]}, show all its parts`,
    tooltip: review ? `${title} · ${STATE_SENTENCES.stale} · show all` : `${title} · show all`,
    attention: review ? 'review' : 'none',
    description: review ? STATE_SENTENCES.stale : undefined,
    items: group.rows.map((row) => itemOf(row, following)),
  }
}

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
  /**
   * The frozen Spec a build works from (D10-12): the foot says so, rather than that a rework
   * would change it — once a build started, nothing reworks it.
   */
  building?: boolean | undefined
  /** The human click that freezes the Spec. */
  onMarkReady: () => void
  /** The band of glyphs the panel folds to, rather than the rail of words. */
  folded?: boolean | undefined
}

/**
 * The Spec's parts said in the mission rail's vocabulary: each phase a group, each part an item,
 * its mark the attention it asks for, and at the foot how far the Spec is from `ready`.
 */
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
  building = false,
  onMarkReady,
  folded = false,
}: SpecRailProps): ReactNode {
  // The ids of the rail are the Spec's own names: a part's target, a phase's name.
  const parts = new Map<string, RailRow>(
    groups.flatMap((group) => group.rows.map((row) => [row.target, row])),
  )
  const phases = new Map<string, RailGroup>(groups.map((group) => [group.phase, group]))
  return (
    <MissionRail
      label={label}
      groups={groups.map((group) => groupOf(group, following))}
      current={'part' in current ? { item: current.part } : { group: current.group }}
      onSelect={(id) => {
        const row = parts.get(id)
        if (row !== undefined) onSelect(row.target)
      }}
      onSelectGroup={(id) => {
        const group = phases.get(id)
        if (group !== undefined) onSelectGroup(group.phase)
      }}
      folded={folded}
      foldedFoot={<FoldedFoot readiness={readiness} />}
      foot={
        <ReadinessFoot
          readiness={readiness}
          frozenOn={frozenOn}
          replacedBy={replacedBy}
          building={building}
          onGoTo={onSelect}
          onMarkReady={onMarkReady}
        />
      }
    />
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
  building: boolean
  onGoTo: (target: SpecTarget) => void
  onMarkReady: () => void
}

/**
 * `Mark ready`, which fades in when the gate fills and out when the Spec is frozen.
 *
 * While it fades out it is still in the page, and a button there is a button a second press
 * reaches: so the moment it starts leaving it is `inert` and hidden from assistive technology,
 * and what is on its way out can be neither pressed, focused nor read as offered.
 */
function MarkReady({
  transition,
  onMarkReady,
}: {
  transition: Transition
  onMarkReady: () => void
}): ReactNode {
  const present = useIsPresent()
  return (
    <motion.div
      className="flex"
      inert={!present}
      aria-hidden={present ? undefined : true}
      initial={{ filter: 'opacity(0)' }}
      animate={{ filter: 'opacity(1)' }}
      exit={{ filter: 'opacity(0)' }}
      transition={transition}
    >
      {/* A click dispatched by script is not stopped by `inert`: the handler goes with it. */}
      <Button variant="primary" size="sm" onClick={present ? onMarkReady : undefined}>
        Mark ready
      </Button>
    </motion.div>
  )
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
  building,
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
          building ? (
            `Frozen on ${frozenOn} · the build works from it`
          ) : replacedBy === undefined ? (
            `Frozen on ${frozenOn} · nothing changes until you rework it`
          ) : (
            `Frozen on ${frozenOn} · read only, a newer version replaced it`
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
          <MarkReady key="mark-ready" transition={transition} onMarkReady={onMarkReady} />
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
