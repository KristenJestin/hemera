/**
 * What the Planning page draws, as plain values: the shapes of the Planning engine's read models
 * (`planning.spec`, `planning.waves`, `discussions.list`, `probes.list`, `coldRead.list`,
 * `coldRead.freshness`, `dependencies.list`, `tickets.events`), kept to what the page shows. The
 * design system holds no Schema: these mirror them by name, and the renderer maps one to the
 * other.
 */

import type { MissionStage } from '../mission/vocabulary.ts'

/** A section is empty, written, or being written while the Planner writes it. */
export type SectionState = 'empty' | 'written' | 'being_written'

export interface SpecSection {
  /** `why`, `goals`, `requirements`… */
  name: string
  title: string
  /** Markdown, empty until written: paragraphs, lists of `- ` lines, `code` in backticks. */
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
  /** The living requirement a modified or removed one changes, and its text once read. */
  living?: { ref: string; text: string | null; proposed: boolean } | undefined
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

/** An answer the Planner proposed from a comment of the mission's ticket: never applied unasked. */
export interface ProposedAnswer {
  id: string
  /** Who wrote the comment; null for a deleted account. */
  author: string | null
  comment: string
  /** The answer proposed, in the user's words. */
  text: string
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
  /** The answers proposed from the ticket that still wait for the user. */
  proposals: readonly ProposedAnswer[]
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

export type DiscussionItemKind = 'question' | 'section' | 'requirement' | 'scenario' | 'decision'

export interface DiscussionItem {
  kind: DiscussionItemKind
  id: string
}

export interface Discussion {
  id: string
  /** `#1`. */
  label: string
  item: DiscussionItem
  state: 'open' | 'closed'
  outcome: 'decision' | 'no_decision' | null
  decision: string | null
  /** The agent's proposal, a decision in transit. */
  proposal: { text: string; at: string } | null
  waitsOn: 'user' | 'agent' | null
  /** Why the Planner failed to answer, in words. */
  plannerFailed: string | null
  messages: readonly DiscussionMessage[]
}

export type ProbeState = 'preparing' | 'running' | 'done' | 'failed' | 'interrupted'

export type ProbeOutcome = 'reproduced' | 'not_reproduced' | 'answered' | 'inconclusive'

export interface ProbeFindings {
  answer: string
  actions: readonly string[]
  command?: string | undefined
  observed?: string | undefined
  keyLine?: string | undefined
  evidence: readonly string[]
}

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
}

/** A Probe whole, as its report opens over the page. */
export interface ProbeDetail extends Probe {
  report: ProbeFindings | null
  /** Why it failed, in words. */
  failure: string | null
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
  /** In milliseconds since the epoch. */
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
  /** Its title, once known. */
  dependsOnTitle: string | null
  dependsOnStage: MissionStage
  reason: string
  state: 'proposed' | 'accepted' | 'rejected'
}

/** A vision the user gave, and where it stands. */
export interface Vision {
  id: string
  text: string
  at: string
  inputState: InputState
}

/** The Planner's answer when what was asked is not new work. */
export interface Triage {
  kind: 'existing_mission' | 'delivered' | 'too_small'
  /** The mission it belongs to, by its key, for `existing_mission`. */
  ref: string | null
  text: string
  /** It rests on a living requirement that is still proposed. */
  basedOnProposed: boolean
}

/** A change of the mission's ticket, as the Planner receives it. */
export interface TicketChange {
  id: string
  /** What changed, in words: "A comment was added to the ticket". */
  what: string
  /** What moved: lines removed `- `, added `+ `. */
  difference: string
  at: string
  inputState: InputState
}

/** The Planning page whole, at one moment. */
export interface PlanningData {
  frozen: boolean
  /** The seven prose sections, in order. */
  sections: readonly SpecSection[]
  /** The state of the Requirements section, the fourth of the rail. */
  requirementsState: SectionState
  requirements: readonly Requirement[]
  tasks: readonly Task[]
  waves: readonly Wave[]
  discussions: readonly Discussion[]
  probes: readonly Probe[]
  passes: readonly ColdReadPass[]
  freshness: Freshness
  dependencies: readonly Dependency[]
  /** What changed since the user last read the Spec. */
  changes: readonly SpecChange[]
  visions: readonly Vision[]
  /** The Planner's triage answer, while it waits for the user. */
  triage: Triage | null
  /** What changed on the ticket and is not seen yet. */
  ticket: { key: string; changes: readonly TicketChange[] } | null
}

/**
 * What the user can do on the page; the page acts at once, no second confirmation. A handler that
 * returns a promise settles it once the engine has taken what was sent, or refused it.
 */
export interface PlanningHandlers {
  onAnswer: (questionId: string, answer: { optionId: string } | { text: string }) => Promise<void>
  onWaitOnSomeone: (questionId: string, note: string | null) => Promise<void>
  onCopyDraft: (text: string) => void
  onAcceptProposed: (proposalId: string, text: string | null) => Promise<void>
  onDismissProposed: (proposalId: string) => Promise<void>
  onDiscuss: (item: DiscussionItem) => void
  onOpenProbe: (probeId: string) => void
  onDismissFinding: (findingId: string) => Promise<void>
  onRunColdRead: () => Promise<void>
  onDecideDependency: (id: string, accept: boolean) => Promise<void>
  onGiveVision: (text: string) => Promise<void>
  onMarkRead: () => Promise<void>
  onKeepPlanning: () => Promise<void>
  onOpenMission: (key: string) => void
  onSeenTicketChange: (id: string) => Promise<void>
}

/** What a discussion's view can do. */
export interface DiscussionHandlers {
  /** The first message opens the discussion; the next ones are said in it. */
  onSay: (text: string) => Promise<void>
  onAccept: () => Promise<void>
  onClose: (decision: string | null) => Promise<void>
}

/** The questions that still wait for the user or for someone. */
export function waiting(waves: readonly Wave[]): Question[] {
  return waves.flatMap((wave) =>
    wave.questions.filter((question) => question.state === 'open' || question.state === 'waiting'),
  )
}

/** The latest answer of a question, the one that counts. */
export function latest(question: Question): AnswerVersion | undefined {
  return question.answers.at(-1)
}
