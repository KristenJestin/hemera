/**
 * The settings behind the model cascade, the cap and the budget (#41), and what a mission spent:
 * which agent, model and effort each role gets at the app, a Project and a mission, the user's
 * favourite and hidden models per agent, a Project's cap and budget, and a mission's budget and
 * usage. The screens are #50 (app), #53 (Project) and the mission's pages.
 */

import {
  AgentProvider,
  BudgetCounter,
  BudgetLimits,
  CapValue,
  ModelSettingValue,
  SettingLevel,
} from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { UnknownMission } from './missions.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'

/** A role's setting at each level, unset ones null, and the one its next session gets. */
export const RoleModels = Schema.Struct({
  role: Schema.String,
  /** As the screens name it: "the Builder". */
  displayName: Schema.String,
  app: Schema.NullOr(ModelSettingValue),
  project: Schema.NullOr(ModelSettingValue),
  mission: Schema.NullOr(ModelSettingValue),
  resolved: Schema.Struct({ ...ModelSettingValue.fields, level: SettingLevel }),
})
export type RoleModels = typeof RoleModels.Type

/** A model the user marked for an agent: a favourite, hidden from the picker, or both. */
export const ModelMark = Schema.Struct({
  agent: AgentProvider,
  model: Schema.String,
  favourite: Schema.Boolean,
  hidden: Schema.Boolean,
})
export type ModelMark = typeof ModelMark.Type

/** A Project's cap of simultaneous sub-agents, and the budget its new missions start with. */
export const ProjectLimits = Schema.Struct({ cap: CapValue, budget: BudgetLimits })
export type ProjectLimits = typeof ProjectLimits.Type

/** What a mission used, measured or estimated. */
export const MissionUsage = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cost: Schema.NullOr(Schema.Struct({ amount: Schema.Number, currency: Schema.String })),
  /** False: an estimate, shown marked as such. */
  measured: Schema.Boolean,
})
export type MissionUsage = typeof MissionUsage.Type

/** A mission's budget, counter by counter, and its usage: none when no session ran. */
export const MissionBudget = Schema.Struct({
  counters: Schema.Array(
    Schema.Struct({ counter: BudgetCounter, spent: Schema.Number, limit: Schema.Number }),
  ),
  usage: Schema.NullOr(MissionUsage),
})
export type MissionBudget = typeof MissionBudget.Type

/** A setting the cascade does not take: the app level unset, or a role no ticket registered. */
export class ModelSettingRefused extends Schema.TaggedError<ModelSettingRefused>()(
  'ModelSettingRefused',
  { reason: Schema.String },
) {
  override get message(): string {
    return `This setting was not saved: ${this.reason}.`
  }
}

const failing = Schema.Union([StorageFailed, EngineGone])

export const ModelsRpcs = RpcGroup.make(
  /** Every registered role's setting at each level, for the app, a Project or a mission. */
  Rpc.make('models.roles', {
    payload: { projectId: Schema.NullOr(Schema.String), missionId: Schema.NullOr(Schema.String) },
    success: Schema.Array(RoleModels),
    error: Schema.Union([StorageFailed, EngineGone, UnknownProject, UnknownMission]),
  }),
  /** Sets a role's setting at a level; null unsets a Project's or a mission's override. */
  Rpc.make('models.setRole', {
    payload: {
      level: SettingLevel,
      /** The Project's or the mission's id; null for the app. */
      scopeId: Schema.NullOr(Schema.String),
      role: Schema.String,
      setting: Schema.NullOr(ModelSettingValue),
    },
    success: Schema.Void,
    error: Schema.Union([StorageFailed, EngineGone, ModelSettingRefused]),
  }),
  /** The models the user marked, every agent. */
  Rpc.make('models.marks', { success: Schema.Array(ModelMark), error: failing }),
  /** Marks a model of an agent; neither favourite nor hidden forgets it. */
  Rpc.make('models.mark', { payload: ModelMark, success: Schema.Void, error: failing }),
  /** A Project's cap and budget. */
  Rpc.make('limits.project', {
    payload: { projectId: Schema.String },
    success: ProjectLimits,
    error: Schema.Union([StorageFailed, EngineGone, UnknownProject]),
  }),
  /** Sets a Project's cap and budget; a mission already made keeps the budget it started with. */
  Rpc.make('limits.setProject', {
    payload: { projectId: Schema.String, limits: ProjectLimits },
    success: ProjectLimits,
    error: Schema.Union([StorageFailed, EngineGone, UnknownProject]),
  }),
  /** A mission's budget and usage, for its pages. */
  Rpc.make('limits.mission', {
    payload: { missionId: Schema.String },
    success: MissionBudget,
    error: Schema.Union([StorageFailed, EngineGone, UnknownMission]),
  }),
)
