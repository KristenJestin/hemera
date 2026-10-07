/**
 * Planning (#85): a mission's Spec as the Planning page reads it (#103), what changed since the
 * user last read it, the user's vision, keeping a mission the Planner triaged, and the Project's
 * Spec language. Nobody edits the Spec here: the Planner writes it through Hemera's tools.
 */

import { Delta, MissionType, SpecSectionName, Stage } from '@hemera/core/domain'
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
