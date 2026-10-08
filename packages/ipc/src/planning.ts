/**
 * Planning (#85): a mission's Spec as the Planning page reads it (#103), what changed since the
 * user last read it, the user's vision, keeping a mission the Planner triaged, and the Project's
 * Spec language. Nobody edits the Spec here: the Planner writes it through Hemera's tools.
 */

import {
  Delta,
  InputKind,
  InputState,
  MissionType,
  QuestionState,
  SpecSectionName,
  Stage,
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
})
export type SpecRequirement = typeof SpecRequirement.Type

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
