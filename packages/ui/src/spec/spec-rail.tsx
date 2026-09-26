import type { ReactNode } from 'react'

import {
  type MissionRailGroup,
  type MissionRailItem,
  MissionRail,
  type RailAttention,
} from '../session/mission-rail.tsx'
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
import { SPEC_PART_ICONS, SPEC_PHASE_ICONS } from './spec-icons.ts'

/**
 * The rail of the Spec panel: every part of the Spec, grouped by the phase that writes it (lot 19,
 * brief revisions 3 and 4, and the maintainer's decisions on the rail's states).
 *
 * What it draws and how is the mission rail's (`session/mission-rail.tsx`): a row says only what
 * needs attention, by a tint or a fainter name, and says it in a sentence; the headers,
 * the hint, the rule of what is on the stage and the folded band are the same for every mission.
 * What is the Spec's is here: which parts a type has, under which phase, the glyph of each, what
 * each mark asks of the reader, and the sentences. How far the Spec is from `ready` is not drawn
 * (issue #135): what is missing is the agent's to say, and `Mark ready`'s to refuse with its
 * reasons.
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
  writing: 'The agent is writing this',
}

/** What each mark asks of the reader's attention, in the rail's own vocabulary. */
const ATTENTION: Record<Mark, RailAttention> = {
  empty: 'empty',
  agent: 'none',
  human: 'edited',
  stale: 'review',
  writing: 'writing',
}

/** The phase's state, said to a screen reader: the header draws none of it. */
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
  /** The band of glyphs the panel folds to, rather than the rail of words. */
  folded?: boolean | undefined
}

/**
 * The Spec's parts said in the mission rail's vocabulary: each phase a group, each part an item,
 * its mark the attention it asks for.
 */
export function SpecRail({
  label,
  groups,
  current,
  following,
  onSelect,
  onSelectGroup,
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
    />
  )
}
