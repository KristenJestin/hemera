/**
 * What the Spec panel is handed to draw (lot 19, phase 0).
 *
 * View types only: the words, the counts and the states the panel shows, already decided. The
 * domain — the gate as a pure function, the protocol, the revisions — arrives with phase 1 in
 * `@hemera/core`, and the design system imports nothing of Hemera: the application turns the
 * one into the other. Nothing here computes a rule of the product; the two functions in this
 * file say which sections a type's document shows and in which words an answer reads.
 */

/** The three contracts a Spec can be written under (core.md, "Spec types"). */
export type SpecType = 'feature' | 'bug' | 'maintenance'

/**
 * The statuses a Spec is drawn with: core's own, all four (D8-13 draws the two a build makes of a
 * frozen Spec — `in_progress` once its build has started, `cancelled` when one was taken back).
 */
export type SpecStatus = 'draft' | 'ready' | 'in_progress' | 'cancelled'

/** The four phases of the `define` protocol, in their order; `prototype` is not drawn in v1. */
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

/**
 * A part of the document a link can lead to and the focus can rest on: one section, or one of
 * the three lists.
 */
export type SpecTarget = SectionName | 'stories' | 'tasks' | 'questions'

/**
 * The mark of a part: nothing written yet, written by the agent, written by you, out of date after
 * a rework, or being written right now.
 */
export type Mark = 'empty' | 'agent' | 'human' | 'stale' | 'writing'

/** Who wrote a section last. */
export type Author = 'agent' | 'human'

export interface SectionView {
  name: SectionName
  /** The Markdown body; empty while nothing is written. */
  body: string
  /** Who wrote it last; `null` while nothing is written. */
  author: Author | null
  mark: Mark
  /** The revision it was copied from, after a rework, while its phase is stale. */
  copiedFrom?: number | undefined
  /** A line under the text saying what the section is for, when the type says it. */
  note?: string | undefined
}

/** A story (core.md, "Spec"): one sentence of actor, need and benefit, and ordered criteria. */
export interface StoryView {
  /** The story itself, whatever its place. */
  id: string
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

/** One answer the agent offers to a question; one of them may be the one it recommends. */
export interface SpecQuestionOption {
  id: string
  label: string
  recommended?: boolean | undefined
}

/**
 * The answer given: one of the options, or words of the reader's own — "Something else…".
 */
export interface SpecAnswer {
  optionId?: string | undefined
  text?: string | undefined
}

/**
 * A question of the Spec (revision 2 of the brief): asked in the chat, where the answer is given,
 * and kept in the document as a register of what was asked and what was decided.
 */
export interface SpecQuestionView {
  id: string
  body: string
  blocking: boolean
  phase: PhaseName
  /** The answers the agent offers, one of them recommended, as `shape` asks it to. */
  options: readonly SpecQuestionOption[]
  /** The stories it bears on. */
  stories?: string[] | undefined
  /** The answer, or `null` while it is open. */
  answer: SpecAnswer | null
}

/** What an answer says, in words: the label of the option chosen, or the reader's own text. */
export function answerText(question: SpecQuestionView): string | null {
  const answer = question.answer
  if (answer === null) return null
  const chosen = question.options.find((option) => option.id === answer.optionId)
  return chosen?.label ?? answer.text ?? null
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
  /**
   * Whether the check is met: it passes, on something the Spec holds. A check the gate passes on
   * nothing — no task, so no broken link — is not met, and its segment stays empty (issue #130).
   */
  passed: boolean
  /** What fails, named under the pointer: `coverage · S2 has no task`. */
  detail?: string | undefined
}

/**
 * One thing left before ready, said as a link to where it is fixed.
 *
 * The attestation has no part in the document — it is the agent's to give, in the thread — so an
 * item may name no target, and is then said without a link.
 */
export interface ReadinessItem {
  label: string
  target?: SpecTarget | undefined
}

/**
 * The ready gate as the panel is handed it. Since issue #135 the panel draws none of it but what
 * `Mark ready` was refused with, which the application writes from the things left.
 */
export interface ReadinessView {
  checks: GateCheckView[]
  /** What is left, in the order the sentence says it. Empty when every check passes. */
  todo: ReadinessItem[]
  /**
   * What the last `Mark ready` was refused with: what the draft still lacks, or that the Spec
   * changed as it was pressed (D7-10, "An obsolete request is refused").
   */
  refused?: string | undefined
}

/** A revision as the picker lists it. */
export interface RevisionView {
  number: number
  /** What the picker says of it, in plain words: `Latest · ready`, `Marked ready 22 Sep · read only`. */
  detail: string
}

/** The same Spec opened from a Session that does not hold the write right (D7-11). */
export interface ReaderView {
  /** The Session that writes it. */
  writer: string
  /**
   * Why the write right cannot be taken over now — the writer is running a turn — or `null`
   * when it can (Decided 14).
   */
  takeOverRefused: string | null
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
  /** The state of each phase, which the group headings of the document wear. */
  phases: PhaseView[]
  /**
   * The one sentence under the head: `Plan · the agent is writing the plan`. Empty when there is
   * nothing to say beside the status: a `ready` Spec.
   */
  now: string
  /** Where the agent is writing now, which the document highlights and scrolls to. */
  focus?: SpecTarget | undefined
  /** The sections of the revision; the document draws the ones the type's contract names. */
  sections: SectionView[]
  stories: StoryView[]
  storiesMark: Mark
  tasks: TaskView[]
  tasksMark: Mark
  questions: SpecQuestionView[]
  questionsMark: Mark
  readiness: ReadinessView
  /**
   * The current revision, when the one shown is an older one (D7-05): it is read as it was
   * frozen, and it offers no Rework — only the current revision of a Spec can be reworked.
   */
  replacedBy?: number | undefined
}

/**
 * Where a launch of this Spec stands, in the words the domain uses for it (D8-13): its Workspace
 * still being prepared, the agent being started, started, refused with the cause it gave, or
 * cancelled by the Rework that took the Spec back. These are the names of `LAUNCH_STATES`, read
 * here as the panel says them: the design system imports nothing of Hemera, and the application
 * turns the one into the other.
 */
export type LaunchState = 'waiting' | 'starting' | 'started' | 'failed' | 'cancelled'

/** A Workspace a build may be started in: the `main` one, or one of the Project's own (D8-12). */
export interface LaunchWorkspace {
  id: string
  name: string
}

/** What a launch says of itself, and the one thing it offers from where it stands (D8-13). */
export type LaunchView =
  | {
      state: 'waiting'
      /** The preparation step running, as the Workspace names it (D8-05). */
      step?: string | undefined
    }
  | { state: 'starting' }
  | { state: 'started' }
  | {
      state: 'failed'
      /** What the start was refused with, in the engine's own words. */
      cause: string
    }
  | { state: 'cancelled' }

/** How each section is named in the document. */
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

/** How the phases are named on the group headings of the document. */
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
 * The sections `shape` writes, in order, for a type: the base, then the type's own.
 *
 * A section of another type is never drawn — a `bug` has no `Behaviour` — even when a type
 * change left one in the revision: D7-06 keeps it, folded and ignored, and folded here is gone.
 */
export function shapedSectionsOf(type: SpecType): SectionName[] {
  return [...BASE, OWN[type]]
}
