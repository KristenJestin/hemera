import type { ExploredMission } from '../coming-back/parts.tsx'

/**
 * What the Planning page reads, as plain values: the shapes of the Planning engine's read models
 * (`planning.spec`, `planning.waves`, `planning.inputs`, `discussions.list`, `probes.list`,
 * `coldRead.list`, `coldRead.freshness`, `missions.freezeReadiness`, `dependencies.list`), kept to
 * what the page shows. The design system holds no Schema: these mirror them by name.
 */

/** A section is empty, written, or being written while the Planner writes it. */
export type SectionState = 'empty' | 'written' | 'being_written'

export interface SpecSection {
  name: string
  title: string
  /** Markdown, empty until written: paragraphs, and lists of `- ` lines. */
  body: string
  state: SectionState
}

export interface Proof {
  mode: 'automated' | 'by_hand'
  actions: readonly string[]
  startingData: string
  expected: string
  /** The test that runs it: its repository and path. */
  test?: string | undefined
  command?: string | undefined
  /** A wrong behaviour that exists today: what a real run printed, and its key line. */
  seenToday: boolean
  observed?: string | undefined
  keyLine?: string | undefined
  /** The Probe whose report it comes from (`#1`). */
  fromProbe?: string | undefined
}

export interface Scenario {
  id: string
  when: string
  then: string
  proof: Proof | null
}

export type Delta = 'added' | 'modified' | 'removed'

export interface Requirement {
  id: string
  domain: string
  delta: Delta
  text: string
  /** The living requirement a modified or removed one changes, and its text. */
  living?: { ref: string; text: string; proposed: boolean } | undefined
  scenarios: readonly Scenario[]
}

export interface Task {
  id: string
  title: string
  result: string
  scenarios: readonly string[]
  targets: readonly { repository: string; path: string; intent: 'create' | 'change' }[]
  dependsOn: readonly string[]
}

/** Every human input of Planning: received, delivered to the Planner, integrated by it (CT-26). */
export type InputState = 'received' | 'delivered' | 'integrated' | 'superseded'

export interface AnswerVersion {
  version: number
  /** Exactly one of an option and a text of the user's own. */
  optionId: string | null
  text: string | null
  at: string
  inputState: InputState
}

export type QuestionState = 'open' | 'waiting' | 'answered' | 'withdrawn' | 'replaced' | 'moot'

export interface QuestionOption {
  id: string
  label: string
  detail: string
}

export interface Question {
  id: string
  wave: number
  text: string
  why: string
  options: readonly QuestionOption[]
  recommended: string
  recommendedReason: string
  /** The Spec item it concerns: a section, `R2`, `R2.S1`. */
  section: string | null
  /** The cold read finding it was asked from. */
  fromFinding: string | null
  replaces: string | null
  replacedBy: string | null
  state: QuestionState
  waitingNote: string | null
  retiredReason: string | null
  mootDecision: string | null
  /** Every version, oldest first. */
  answers: readonly AnswerVersion[]
  /** What the Planner drafted for the person it waits on: never sent by Hemera. */
  drafts: readonly { text: string; at: string }[]
}

export interface Wave {
  number: number
  askedAt: string
  questions: readonly Question[]
}

export interface DiscussionMessage {
  author: 'user' | 'agent'
  text: string
  /** The agent proposing a decision. */
  proposal: boolean
  at: string
}

export interface Discussion {
  id: string
  /** `#1`. */
  label: string
  item: { kind: 'question' | 'section' | 'requirement' | 'scenario' | 'decision'; id: string }
  state: 'open' | 'closed'
  outcome: 'decision' | 'no_decision' | null
  decision: string | null
  /** The agent's proposal, a decision in transit. */
  proposal: { text: string; at: string } | null
  waitsOn: 'user' | 'agent' | null
  messages: readonly DiscussionMessage[]
}

export type ProbeState = 'preparing' | 'running' | 'done' | 'failed' | 'interrupted'

export type ProbeOutcome = 'reproduced' | 'not_reproduced' | 'answered' | 'inconclusive'

export interface Probe {
  id: string
  /** `#2`. */
  label: string
  question: string
  scenario: string | null
  state: ProbeState
  stuck: boolean
  /** In milliseconds since the epoch. */
  startedAt: number
  endedAt: number | null
  outcome: ProbeOutcome | null
  /** What it is doing, in words, while it runs. */
  step?: string | undefined
  report?:
    | {
        answer: string
        actions: readonly string[]
        command?: string | undefined
        observed?: string | undefined
        keyLine?: string | undefined
        evidence: readonly string[]
      }
    | undefined
  failure?: string | undefined
}

export type Severity = 'blocking' | 'warning' | 'suggestion'

export type FindingFate = 'open' | 'asked' | 'fixed' | 'dismissed'

export interface Finding {
  /** `C1.F2`. */
  id: string
  severity: Severity
  where: readonly string[]
  text: string
  /** Every item it names is a task: never asked, fixed by the Planner. */
  tasksOnly: boolean
  fate: FindingFate
  questionId: string | null
  fixedWhat: string | null
}

export interface ColdReadPass {
  id: string
  /** `C1`. */
  label: string
  requestedBy: 'hemera' | 'user'
  state: 'waiting_for_slot' | 'running' | 'done' | 'failed'
  stuck: boolean
  startedAt: number
  endedAt: number | null
  failure: string | null
  findings: readonly Finding[]
}

/** One item a write changed: a section, `R2`, `R2.S1`, `T3`; its text before and after. */
export interface SpecChange {
  item: string
  before: string | null
  after: string | null
  at: string
}

/** What the last pass read against the Spec now: an earlier text, and what changed since. */
export interface Freshness {
  /** Whether the last finished pass read the text as it is now. */
  current: boolean
  changes: readonly SpecChange[]
}

export interface Dependency {
  id: string
  dependsOnKey: string
  dependsOnTitle: string
  dependsOnStage: ExploredMission['stage']
  reason: string
  state: 'proposed' | 'accepted' | 'rejected'
}

/** A vision the user gave, and where it stands. */
export interface Vision {
  text: string
  at: string
  inputState: InputState
}

/** The ticket's difference, once it changed after the freeze. */
export interface TicketChange {
  ticket: string
  when: string
  before: string
  after: string
}

/** The Planning page whole, at one moment. */
export interface PlanningState {
  mission: ExploredMission
  /** What the Planner does now, in words; null while nothing runs. */
  now: string | null
  /** A turn that ended without a word, said in words. */
  silent?: string | undefined
  sections: readonly SpecSection[]
  /** The state of the Requirements section, the eighth of the rail. */
  requirementsState: SectionState
  requirements: readonly Requirement[]
  tasks: readonly Task[]
  waves: readonly Wave[]
  discussions: readonly Discussion[]
  probes: readonly Probe[]
  passes: readonly ColdReadPass[]
  freshness: Freshness
  dependencies: readonly Dependency[]
  /** Whether Freeze is offered, and every reason it is not. */
  readiness: { ready: boolean; unsettled: readonly string[] }
  /** Freeze pressed and refused: every reason, each naming what blocks it. */
  refused?: readonly string[] | undefined
  /** What changed since the user last read the Spec. */
  changes: readonly SpecChange[]
  visions: readonly Vision[]
  outdated?: TicketChange | undefined
}

/** What the user can do on the page; the page acts at once, no second confirmation. */
export interface PlanningHandlers {
  onAnswer: (questionId: string, answer: { optionId: string } | { text: string }) => void
  onWaitOnSomeone: (questionId: string) => void
  onCopyDraft: (questionId: string) => void
  onDiscuss: (item: Discussion['item']) => void
  onSay: (discussionId: string, text: string) => void
  onAcceptProposal: (discussionId: string) => void
  onCloseDiscussion: (discussionId: string, decision: string | null) => void
  onDismissFinding: (findingId: string) => void
  onRunColdRead: () => void
  onDecideDependency: (id: string, accept: boolean) => void
  onGiveVision: (text: string) => void
  onMarkRead: () => void
  onFreeze: () => void
  onReturnToPlanning: () => void
  onCancel: () => void
}

/** What stands open over the page as it is drawn. */
export type Opened =
  | { kind: 'discussion'; id: string }
  | { kind: 'probe'; id: string }
  | { kind: 'spec'; section?: string | undefined }
  | { kind: 'vision' }

export interface PlanningProps extends PlanningHandlers {
  state: PlanningState
  opened?: Opened | undefined
}

/** The questions that still wait for the user or for someone. */
export function waiting(state: PlanningState): Question[] {
  return state.waves.flatMap((wave) =>
    wave.questions.filter((question) => question.state === 'open' || question.state === 'waiting'),
  )
}

/** The findings of the last pass the user can still settle. */
export function openFindings(state: PlanningState): Finding[] {
  return (state.passes.at(-1)?.findings ?? []).filter((finding) => finding.fate === 'open')
}

export function discussionOn(state: PlanningState, questionId: string): Discussion | undefined {
  return state.discussions.find(
    (discussion) => discussion.item.kind === 'question' && discussion.item.id === questionId,
  )
}
