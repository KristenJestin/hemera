/**
 * What the Spec panel is handed to draw (lot 19, phase 0).
 *
 * View types only: the words, the counts and the states the panel shows, already decided. The
 * domain — the gate as a pure function, the protocol, the revisions — arrives with phase 1 in
 * `@hemera/core`, and the design system imports nothing of Hemera: the application turns the
 * one into the other. Nothing here computes a rule of the product; the one function in this
 * file is the order the outline reads a type's sections in, which is a question of layout.
 */

/** The three contracts a Spec can be written under (core.md, "Spec types"). */
export type SpecType = 'feature' | 'bug' | 'maintenance'

/** The two statuses this lot writes; the others are declared by the domain and never drawn yet. */
export type SpecStatus = 'draft' | 'ready'

/** The four phases of the `define` protocol, in the order the rail reads them. */
export type PhaseName = 'shape' | 'plan' | 'decompose' | 'prototype'

/**
 * Where a phase stands (D7-08): done, being worked, waiting on another, out of date after a
 * rework or a new shaping, or not offered at all — `prototype`, in this version.
 */
export type PhaseState = 'finished' | 'open' | 'pending' | 'stale' | 'unavailable'

export interface PhaseView {
  name: PhaseName
  state: PhaseState
}

/**
 * The rich sections of a revision, from the closed set of D7-01: the common base, the one
 * section each type adds, and the plan.
 */
export type SectionName =
  | 'problem'
  | 'expected_outcome'
  | 'scope'
  | 'verification'
  | 'behaviour'
  | 'reproduction'
  | 'invariants'
  | 'plan'

/** What the stage can show: one section, or one of the three lists. */
export type StageItem = SectionName | 'stories' | 'tasks' | 'questions'

/**
 * The mark an outline row wears: nothing written yet, written by the agent, edited by you, out
 * of date after a rework, in conflict with an unsaved text of yours, or being written right now.
 */
export type Mark = 'empty' | 'agent' | 'human' | 'stale' | 'conflict' | 'writing'

/** Who wrote a section last. */
export type Author = 'agent' | 'human'

/**
 * A text of yours that could not be saved, because the section moved under it (D7-12).
 *
 * It is kept whole: the editor holds `mine`, and `current` is what the section says now, for
 * the comparison.
 */
export interface ConflictView {
  /** The version the human's text was written on. */
  base: number
  /** The version the section is at now. */
  current: number
  /** The human's text, never lost. */
  mine: string
  /** What the section says at `current`, written by whoever wrote it. */
  theirs: string
}

export interface SectionView {
  name: SectionName
  /** The Markdown body; empty while nothing is written. */
  body: string
  /** The section's own version, which a save is checked against. */
  version: number
  /** Who wrote it last; `null` while nothing is written. */
  author: Author | null
  mark: Mark
  /** A human edit not yet handed to the agent: it goes with the next turn. */
  pendingForAgent?: boolean | undefined
  /** The revision it was copied from, after a rework, while its phase is stale. */
  copiedFrom?: number | undefined
  conflict?: ConflictView | undefined
  /** A line under the text saying what the section is for, when the type says it. */
  note?: string | undefined
}

/** A story (core.md, "Spec"): one sentence of actor, need and benefit, and ordered criteria. */
export interface StoryView {
  /** `S1`, `S2`: how tasks and questions point at it. */
  key: string
  title: string
  narrative: string
  criteria: string[]
}

/** Who runs a task: the build's agent, or you. */
export type Executor = 'agent' | 'human'

export interface TaskView {
  /** `T1`, `T2`: how the dependencies point at it. */
  key: string
  title: string
  /** What is true once it is done, which is how it is verified. */
  result: string
  /** The tasks it waits on. */
  after: string[]
  /** The stories it realises. */
  covers: string[]
  executor: Executor
}

export interface QuestionView {
  id: string
  body: string
  /** What the agent recommends, said with the question as `shape` asks it to. */
  recommendation?: string | undefined
  blocking: boolean
  phase: PhaseName
  /** The stories it bears on. */
  stories?: string[] | undefined
  /** The answer, once there is one: its words and who gave it when, already written. */
  answer?: { text: string; by: string } | undefined
}

/** The seven checks of the ready gate, in the order the bar draws them (D7-10). */
export type GateCheck =
  | 'contract'
  | 'references'
  | 'coverage'
  | 'cycle'
  | 'questions'
  | 'phases'
  | 'attestation'

export const GATE_CHECKS: readonly GateCheck[] = [
  'contract',
  'references',
  'coverage',
  'cycle',
  'questions',
  'phases',
  'attestation',
]

export interface GateCheckView {
  check: GateCheck
  passed: boolean
  /** What fails, named under the pointer: `coverage · S2 has no task`. */
  detail?: string | undefined
}

/**
 * One thing left before ready, said as a link to where it is fixed.
 *
 * The attestation has no place on the stage — it is the agent's to give, in the thread — so an
 * item may name no target, and is then said without a link.
 */
export interface ReadinessItem {
  label: string
  target?: StageItem | undefined
}

export interface ReadinessView {
  checks: GateCheckView[]
  /** What is left, in the order the sentence says it. Empty when every check passes. */
  todo: ReadinessItem[]
}

/** A revision as the picker lists it. */
export interface RevisionView {
  number: number
  /** What is said beside it: `current, frozen`, `read only · 22 Sep`. */
  detail: string
}

/** The same Spec opened from a Session that does not hold the write right (D7-11). */
export interface ReaderView {
  /** The Session that writes it. */
  writer: string
}

export interface SpecView {
  /** `ATL-7`. */
  key: string
  title: string
  type: SpecType
  status: SpecStatus
  /** The revision shown. */
  revision: number
  /** Every revision, newest first; the picker is drawn only when there is more than one. */
  revisions: RevisionView[]
  phases: PhaseView[]
  /** The one sentence under the rail: `Plan · the agent is writing the plan`. */
  now: string
  /** The sections of the revision; the outline draws the ones the type's contract names. */
  sections: SectionView[]
  stories: StoryView[]
  storiesMark: Mark
  tasks: TaskView[]
  tasksMark: Mark
  questions: QuestionView[]
  questionsMark: Mark
  readiness: ReadinessView
  /** When it was frozen, already written: `23 Sep`. Present on a `ready` Spec only. */
  frozenOn?: string | undefined
}

/** A draft of the Project, as the empty `define` Session offers it to join. */
export interface DraftSpecView {
  key: string
  title: string
  /** The Session that writes it. */
  writer: string
}

/** How each section is named on the outline and the stage. */
export const SECTION_TITLES: Record<SectionName, string> = {
  problem: 'Problem',
  expected_outcome: 'Expected outcome',
  scope: 'Scope',
  verification: 'Verification',
  behaviour: 'Behaviour',
  reproduction: 'Reproduction',
  invariants: 'Invariants',
  plan: 'Plan',
}

/** How the phases are named on the rail. */
export const PHASE_TITLES: Record<PhaseName, string> = {
  shape: 'Shape',
  plan: 'Plan',
  decompose: 'Decompose',
  prototype: 'Prototype',
}

/** The common base every type starts from (core.md, "Spec"). */
const BASE: readonly SectionName[] = ['problem', 'expected_outcome', 'scope', 'verification']

/** The section each type adds to it (core.md, "Spec types"; D7-06). */
const OWN: Record<SpecType, SectionName> = {
  feature: 'behaviour',
  bug: 'reproduction',
  maintenance: 'invariants',
}

/**
 * The sections the outline reads, in order, for a type: the base, the type's own, the plan.
 *
 * A section of another type is never drawn — a `bug` has no `Behaviour` row — even when a type
 * change left one in the revision: D7-06 keeps it, folded and ignored, and folded here is gone.
 */
export function sectionsOf(type: SpecType): SectionName[] {
  return [...BASE, OWN[type], 'plan']
}
