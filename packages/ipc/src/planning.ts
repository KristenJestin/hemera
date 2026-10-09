/**
 * Planning (#85): a mission's Spec as the Planning page reads it (#103), what changed since the
 * user last read it, the user's vision, keeping a mission the Planner triaged, and the Project's
 * Spec language. Nobody edits the Spec here: the Planner writes it through Hemera's tools.
 *
 * #90 adds each scenario's Proof (its support files by reference), the task graph with its
 * coverage, and the model recommended for Building.
 */

import {
  AgentProvider,
  Delta,
  InputKind,
  InputState,
  MissionType,
  ProofSeen,
  QuestionState,
  SpecSectionName,
  Stage,
  TaskTarget,
} from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { TriageAnswer, UnknownMission } from './missions.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'

/** A section is empty, written, or being written while a `spec_write_section` call runs. */
export const SectionState = Schema.Literals(['empty', 'written', 'being_written'])
export type SectionState = typeof SectionState.Type

export const SpecSection = Schema.Struct({
  name: SpecSectionName,
  title: Schema.String,
  /** Markdown, empty until written. */
  body: Schema.String,
  /** 0 until written. */
  version: Schema.Number,
  state: SectionState,
  writtenAt: Schema.NullOr(Schema.String),
})
export type SpecSection = typeof SpecSection.Type

export const SpecScenario = Schema.Struct({
  id: Schema.String,
  when: Schema.String,
  then: Schema.String,
  version: Schema.Number,
  /** Its Proof block (#90), its support files by reference; null until written. */
  proof: Schema.NullOr(ProofSeen),
  /** The version of its proof; 0 until written. */
  proofVersion: Schema.Number,
})
export type SpecScenario = typeof SpecScenario.Type

export const SpecRequirement = Schema.Struct({
  id: Schema.String,
  domain: Schema.String,
  delta: Delta,
  livingRef: Schema.NullOr(Schema.String),
  livingVersion: Schema.NullOr(Schema.Number),
  text: Schema.String,
  version: Schema.Number,
  removed: Schema.Boolean,
  /** Its live scenarios, in order. */
  scenarios: Schema.Array(SpecScenario),
  /** Its domain is not one of the living spec's yet (#93). */
  newDomain: Schema.Boolean,
  /** It modifies or removes a living requirement that is still proposed (#93). */
  againstProposed: Schema.Boolean,
  /** What it relies on in dependencies not delivered yet (#92): their key, requirement, version. */
  reliesOn: Schema.Array(
    Schema.Struct({
      dependency: Schema.String,
      requirement: Schema.String,
      version: Schema.Number,
    }),
  ),
})
export type SpecRequirement = typeof SpecRequirement.Type

/** A task of the graph the Builder follows (#90): never discussed with the user. */
export const SpecTask = Schema.Struct({
  /** `T1`, `T2`… per mission, kept by the task, never reused. */
  id: Schema.String,
  title: Schema.String,
  /** What is true once it is done. */
  result: Schema.String,
  requirements: Schema.Array(Schema.String),
  scenarios: Schema.Array(Schema.String),
  targets: Schema.Array(TaskTarget),
  dependsOn: Schema.Array(Schema.String),
})
export type SpecTask = typeof SpecTask.Type

/** The Planner's recommended setting for Building (#90), with its reason. */
export const ModelRecommendationSeen = Schema.Struct({
  agent: AgentProvider,
  model: Schema.String,
  effort: Schema.NullOr(Schema.String),
  reason: Schema.String,
  /** Whether the model and the effort were found among what the agent offers. */
  checked: Schema.Boolean,
  at: Schema.String,
})
export type ModelRecommendationSeen = typeof ModelRecommendationSeen.Type

/** The task graph with its coverage: for each live scenario, the tasks that cover it. */
export const TaskGraph = Schema.Struct({
  tasks: Schema.Array(SpecTask),
  coverage: Schema.Array(
    Schema.Struct({ scenario: Schema.String, tasks: Schema.Array(Schema.String) }),
  ),
})
export type TaskGraph = typeof TaskGraph.Type

/** A mission's Spec, read whole in one transaction. */
export const Spec = Schema.Struct({
  missionId: Schema.String,
  key: Schema.String,
  title: Schema.String,
  type: MissionType,
  stage: Stage,
  /** Its language, a BCP 47 tag, copied from the Project when the mission was created. */
  language: Schema.String,
  /** Bumped by every write. */
  version: Schema.Number,
  /** The version the Planner last declared complete, once Hemera's check passed. */
  declaredCompleteVersion: Schema.NullOr(Schema.Number),
  frozen: Schema.Boolean,
  /** The version the user last marked read; null before the first. */
  readVersion: Schema.NullOr(Schema.Number),
  /** The seven prose sections, in order. */
  sections: Schema.Array(SpecSection),
  /** In order, removed ones included and marked. */
  requirements: Schema.Array(SpecRequirement),
  triage: Schema.NullOr(TriageAnswer),
  /** The task graph (#90), in its order: folded on the page by default. */
  tasks: Schema.Array(SpecTask),
  /** The version of the task graph, what `tasks_write` names as its base. */
  tasksVersion: Schema.Number,
  /** The recommended model for Building (#90), once the Planner gave one. */
  recommendation: Schema.NullOr(ModelRecommendationSeen),
})
export type Spec = typeof Spec.Type

/** One item a write changed: its Spec version, the item, its text before and after. */
export const SpecChange = Schema.Struct({
  version: Schema.Number,
  /** A section's name, or a requirement's or a scenario's id. */
  item: Schema.String,
  before: Schema.NullOr(Schema.String),
  after: Schema.NullOr(Schema.String),
  at: Schema.String,
})
export type SpecChange = typeof SpecChange.Type

/** A Planning gesture refused: outside Planning, or with nothing to act on. */
export class PlanningRefused extends Schema.TaggedError<PlanningRefused>()('PlanningRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason
  }
}

export class InvalidSpecLanguage extends Schema.TaggedError<InvalidSpecLanguage>()(
  'InvalidSpecLanguage',
  { tag: Schema.String },
) {
  override get message(): string {
    return `“${this.tag}” is not a language tag: write one such as en, fr or pt-BR.`
  }
}

/** An option of a question: its letter, its label, what choosing it implies. */
export const QuestionOption = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  detail: Schema.String,
})
export type QuestionOption = typeof QuestionOption.Type

/** One version of an answer, with the state of the input it made (CT-26). */
export const AnswerVersion = Schema.Struct({
  version: Schema.Number,
  /** Exactly one of an option id and a text of the user's own. */
  optionId: Schema.NullOr(Schema.String),
  text: Schema.NullOr(Schema.String),
  author: Schema.String,
  at: Schema.String,
  /** The input it made, and where that input stands. */
  input: Schema.NullOr(Schema.String),
  inputState: Schema.NullOr(InputState),
})
export type AnswerVersion = typeof AnswerVersion.Type

/** A message the Planner drafted for a question that waits on someone: never sent by Hemera. */
export const QuestionDraft = Schema.Struct({ text: Schema.String, at: Schema.String })

/** Where an answer the Planner proposed from a ticket comment stands (#97). */
export const ProposalState = Schema.Literals(['proposed', 'accepted', 'dismissed', 'expired'])
export type ProposalState = typeof ProposalState.Type

/**
 * An answer the Planner proposed for a question that waits, from a comment of the mission's ticket
 * (#97): never a need, never applied until the user accepts it.
 */
export const ProposedAnswer = Schema.Struct({
  id: Schema.String,
  missionId: Schema.String,
  questionId: Schema.String,
  commentId: Schema.String,
  /** The comment's author; null for a deleted account. */
  commentAuthor: Schema.NullOr(Schema.String),
  /** The comment, masked. */
  comment: Schema.String,
  /** The answer the Planner proposes, in the user's words. */
  text: Schema.String,
  state: ProposalState,
  proposedAt: Schema.String,
  decidedAt: Schema.NullOr(Schema.String),
  /** Why it expired. */
  reason: Schema.NullOr(Schema.String),
})
export type ProposedAnswer = typeof ProposedAnswer.Type

/** A question of the Planner, with its answers and drafts; retired ones keep their reason. */
export const Question = Schema.Struct({
  id: Schema.String,
  wave: Schema.Number,
  text: Schema.String,
  why: Schema.String,
  options: Schema.Array(QuestionOption),
  /** The id of the option the Planner recommends, and why. */
  recommended: Schema.String,
  recommendedReason: Schema.String,
  /** The Spec item it concerns: a section name, `R2` or `R2.S1`. */
  section: Schema.NullOr(Schema.String),
  fromFinding: Schema.NullOr(Schema.String),
  replaces: Schema.NullOr(Schema.String),
  replacedBy: Schema.NullOr(Schema.String),
  state: QuestionState,
  /** The user's note when they said it waits on someone. */
  waitingNote: Schema.NullOr(Schema.String),
  retiredReason: Schema.NullOr(Schema.String),
  mootDecision: Schema.NullOr(Schema.String),
  askedAt: Schema.String,
  /** Every version, oldest first. */
  answers: Schema.Array(AnswerVersion),
  drafts: Schema.Array(QuestionDraft),
  /** The answers proposed from the ticket's comments (#97), every state, oldest first. */
  proposals: Schema.Array(ProposedAnswer),
})
export type Question = typeof Question.Type

/** A wave of questions, in the order asked. */
export const Wave = Schema.Struct({
  number: Schema.Number,
  askedAt: Schema.String,
  questions: Schema.Array(Question),
})
export type Wave = typeof Wave.Type

/** A human input of Planning and where it stands: received, delivered, integrated (CT-26). */
export const PlanningInput = Schema.Struct({
  id: Schema.String,
  kind: InputKind,
  /** What it refers to: a question, a vision, a decision, a finding. */
  item: Schema.String,
  itemVersion: Schema.NullOr(Schema.Number),
  state: InputState,
  receivedAt: Schema.String,
  deliveredAt: Schema.NullOr(Schema.String),
  integratedAt: Schema.NullOr(Schema.String),
  /** Where the Planner integrated it, or "no change: …". */
  where: Schema.NullOr(Schema.String),
  supersededBy: Schema.NullOr(Schema.String),
})
export type PlanningInput = typeof PlanningInput.Type

/** A question that waits for the user, as Home's Questions group lists it (#102). */
export const OpenQuestion = Schema.Struct({
  missionId: Schema.String,
  missionKey: Schema.String,
  projectId: Schema.String,
  projectName: Schema.String,
  wave: Schema.Number,
  questionId: Schema.String,
  text: Schema.String,
  recommended: QuestionOption,
  state: Schema.Literals(['open', 'waiting']),
  waitingNote: Schema.NullOr(Schema.String),
  /** When it was asked, or when it began to wait on someone. */
  since: Schema.String,
  /** The answers proposed from the ticket's comments still waiting for the user (#97). */
  proposals: Schema.Array(ProposedAnswer),
})
export type OpenQuestion = typeof OpenQuestion.Type

/** An answer refused: neither or both of an option and a text, or an option not offered. */
export class InvalidAnswer extends Schema.TaggedError<InvalidAnswer>()('InvalidAnswer', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason
  }
}

const always = [StorageFailed, EngineGone] as const

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const ofMission = { missionId: Schema.String }

export const PlanningRpcs = RpcGroup.make(
  Rpc.make('planning.spec', {
    payload: ofMission,
    success: Spec,
    error: failing(...always, UnknownMission),
  }),
  /** Every item changed after a version, in order. */
  Rpc.make('planning.changesSince', {
    payload: { ...ofMission, version: Schema.Number },
    success: Schema.Array(SpecChange),
    error: failing(...always, UnknownMission),
  }),
  /** The user read the Spec up to this version. */
  Rpc.make('planning.markRead', {
    payload: { ...ofMission, version: Schema.Number },
    success: Schema.Void,
    error: failing(...always, UnknownMission, PlanningRefused),
  }),
  /** The user's vision, at any time in Planning: stored, then delivered to the Planner. */
  Rpc.make('planning.addVision', {
    payload: { ...ofMission, text: Schema.String },
    success: Schema.Void,
    error: failing(...always, UnknownMission, PlanningRefused),
  }),
  /** The user keeps planning a mission the Planner triaged. */
  Rpc.make('planning.keepAfterTriage', {
    payload: ofMission,
    success: Schema.Void,
    error: failing(...always, UnknownMission, PlanningRefused),
  }),
  /** The Spec now, then again after each change, for as long as the caller listens. */
  Rpc.make('planning.changed', {
    payload: ofMission,
    success: Spec,
    error: failing(...always, UnknownMission),
    stream: true,
  }),
  /** The mission's waves, each with its questions, their answers and drafts. */
  Rpc.make('planning.waves', {
    payload: ofMission,
    success: Schema.Array(Wave),
    error: failing(...always, UnknownMission),
  }),
  /** The user answers a question: a new version when it was answered already. */
  Rpc.make('planning.answer', {
    payload: {
      ...ofMission,
      questionId: Schema.String,
      optionId: Schema.optionalKey(Schema.String),
      text: Schema.optionalKey(Schema.String),
    },
    success: Schema.Void,
    error: failing(...always, UnknownMission, PlanningRefused, InvalidAnswer),
  }),
  /** The question waits on someone, with an optional note. */
  Rpc.make('planning.waitOnSomeone', {
    payload: { ...ofMission, questionId: Schema.String, note: Schema.NullOr(Schema.String) },
    success: Schema.Void,
    error: failing(...always, UnknownMission, PlanningRefused),
  }),
  /** Every open or waiting question across the Projects, by mission then wave. */
  Rpc.make('planning.openQuestions', {
    payload: {},
    success: Schema.Array(OpenQuestion),
    error: failing(...always),
  }),
  /** The open questions now, then again after each change, for as long as the caller listens. */
  Rpc.make('planning.questionsChanged', {
    payload: {},
    success: Schema.Array(OpenQuestion),
    error: failing(...always),
    stream: true,
  }),
  /** The mission's human inputs and where each stands. */
  Rpc.make('planning.inputs', {
    payload: ofMission,
    success: Schema.Array(PlanningInput),
    error: failing(...always, UnknownMission),
  }),
  /**
   * The user accepts an answer the Planner proposed from a ticket comment (#97): it becomes their
   * answer, the proposed text or their own, delivered and integrated as any answer. Refused once
   * the question was answered or retired meanwhile: the proposal has expired.
   */
  Rpc.make('planning.acceptProposedAnswer', {
    payload: { proposalId: Schema.String, text: Schema.optionalKey(Schema.String) },
    success: Schema.Void,
    error: failing(...always, UnknownMission, PlanningRefused, InvalidAnswer),
  }),
  /** The user dismisses a proposed answer; the Planner is told, as information. */
  Rpc.make('planning.dismissProposedAnswer', {
    payload: { proposalId: Schema.String },
    success: Schema.Void,
    error: failing(...always, UnknownMission, PlanningRefused),
  }),
  /** The task graph with its targets and its coverage (#90). */
  Rpc.make('planning.tasks', {
    payload: ofMission,
    success: TaskGraph,
    error: failing(...always, UnknownMission),
  }),
  Rpc.make('planning.specLanguage', {
    payload: { projectId: Schema.String },
    success: Schema.String,
    error: failing(...always, UnknownProject),
  }),
  /** Sets the Project's Spec language for its next missions; answers the tag as kept. */
  Rpc.make('planning.setSpecLanguage', {
    payload: { projectId: Schema.String, language: Schema.String },
    success: Schema.String,
    error: failing(...always, UnknownProject, InvalidSpecLanguage),
  }),
)
