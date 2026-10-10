/**
 * The pre-launch check and the launch (#139), as the Ready page and the preparation's progress read
 * them: the check of a Ready mission against the code of today (what moved since the Freeze, what
 * the agent of the check said, the Builder's model), the user's launch on a valid check, the
 * return to Planning with the check's report, and the steps of the Workspace being prepared.
 */

import {
  AgentProvider,
  CheckState,
  HandedKind,
  LaunchChoice,
  LaunchState,
  ModelSettingValue,
  TaskOrigin,
  TaskState,
  TaskTarget,
  MoveRefused,
  PrelaunchAction,
  SettingLevel,
  Stage,
} from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { Mission, UnknownMission } from './missions.ts'
import { StorageFailed } from './profile.ts'
import { BaseFreshness } from './projects.ts'
import { PreparationStep } from './workspaces.ts'

/** The steps of a check, in their order. */
export const CHECK_STEPS = ['dependencies', 'base', 'moved', 'handed', 'agent', 'model'] as const
export const CheckStepName = Schema.Literals(CHECK_STEPS)

/** One step of a check, with its result in plain words. */
export const CheckStep = Schema.Struct({
  step: CheckStepName,
  state: Schema.Literals(['done', 'running', 'waiting', 'skipped', 'failed']),
  said: Schema.String,
})
export type CheckStep = typeof CheckStep.Type

/** An accepted dependency as the check saw it. */
export const CheckedDependency = Schema.Struct({
  key: Schema.String,
  stage: Stage,
  done: Schema.Boolean,
})
export type CheckedDependency = typeof CheckedDependency.Type

/** A repository the check read: its commit at the Freeze, and its base now (CT-24). */
export const CheckedBase = Schema.Struct({
  repositoryId: Schema.String,
  repository: Schema.String,
  /** The base commit the Freeze recorded; null for a repository it did not record. */
  frozen: Schema.NullOr(Schema.String),
  commit: Schema.String,
  ref: Schema.String,
  freshness: BaseFreshness,
})
export type CheckedBase = typeof CheckedBase.Type

/** What moved, computed by Hemera from Git and the database (CT-25, second bullet). */
export const MOVED_KINDS = [
  'target',
  'proof',
  'requirement',
  'relied',
  'ticket',
  'dirty',
  'agent',
] as const
export const MovedKind = Schema.Literals(MOVED_KINDS)
export type MovedKind = typeof MovedKind.Type

export const MovedItem = Schema.Struct({
  kind: MovedKind,
  repository: Schema.NullOr(Schema.String),
  path: Schema.NullOr(Schema.String),
  /** Git's status letter (`M`, `A`, `D`…), for a file. */
  status: Schema.NullOr(Schema.String),
  added: Schema.NullOr(Schema.Number),
  removed: Schema.NullOr(Schema.Number),
  said: Schema.String,
})
export type MovedItem = typeof MovedItem.Type

/** A file handed to the agent of the check, and its answer once it gave one. */
export const HandedItem = Schema.Struct({
  repository: Schema.String,
  path: Schema.String,
  kind: HandedKind,
  status: Schema.String,
  /** Null while unanswered, and for good when the agent did not answer: unchecked. */
  answer: Schema.NullOr(Schema.Struct({ matters: Schema.Boolean, why: Schema.String })),
})
export type HandedItem = typeof HandedItem.Type

export const AGENT_STEP_STATES = [
  'skipped',
  'waiting_for_slot',
  'running',
  'reported',
  'unanswered',
  'failed',
] as const
export const AgentStepState = Schema.Literals(AGENT_STEP_STATES)
export type AgentStepState = typeof AgentStepState.Type

/** The agent of the check: where it stands, and its summary once it reported. */
export const CheckAgent = Schema.Struct({
  state: AgentStepState,
  summary: Schema.NullOr(Schema.String),
  said: Schema.String,
})
export type CheckAgent = typeof CheckAgent.Type

/** The Planner's recommendation for Building, with its reason. */
export const CheckRecommendation = Schema.Struct({
  agent: AgentProvider,
  model: Schema.String,
  effort: Schema.NullOr(Schema.String),
  reason: Schema.String,
})

/** The Builder's model as the cascade resolves it, and the Planner's recommendation beside it. */
export const CheckModel = Schema.Struct({
  setting: ModelSettingValue,
  level: SettingLevel,
  recommendation: Schema.NullOr(CheckRecommendation),
})
export type CheckModel = typeof CheckModel.Type

export const CheckVerdict = Schema.Struct({
  outdated: Schema.Boolean,
  /** The keys of the dependencies not Done yet. */
  blockedBy: Schema.Array(Schema.String),
  actions: Schema.Array(PrelaunchAction),
  said: Schema.String,
})
export type CheckVerdict = typeof CheckVerdict.Type

/**
 * A pre-launch check: `full` when the user asked for it, `mechanical` when a dependency reaching
 * Done ran its first three steps (it never launches).
 */
export const PrelaunchView = Schema.Struct({
  id: Schema.String,
  missionId: Schema.String,
  missionKey: Schema.String,
  kind: Schema.Literals(['full', 'mechanical']),
  state: CheckState,
  startedAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
  steps: Schema.Array(CheckStep),
  dependencies: Schema.Array(CheckedDependency),
  bases: Schema.Array(CheckedBase),
  moved: Schema.Array(MovedItem),
  handed: Schema.Array(HandedItem),
  agent: CheckAgent,
  model: CheckModel,
  verdict: CheckVerdict,
})
export type PrelaunchView = typeof PrelaunchView.Type

/** A launch's Workspace being prepared, step by step, until the mission moves to Building. */
export const BuildingPreparation = Schema.Struct({
  missionId: Schema.String,
  launchId: Schema.String,
  state: LaunchState,
  workspaceId: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  steps: Schema.Array(PreparationStep),
  /** The environment need a failed step opened, with Retry. */
  needId: Schema.NullOr(Schema.String),
  /** Where it stands, as Now says it: "Preparing the Workspace (step 3 of 6)". */
  now: Schema.String,
})
export type BuildingPreparation = typeof BuildingPreparation.Type

export const CheckChanged = Schema.TaggedStruct('CheckChanged', { check: PrelaunchView })
export const PreparationChanged = Schema.TaggedStruct('PreparationChanged', {
  preparation: BuildingPreparation,
})
export const BuildingChange = Schema.Union([CheckChanged, PreparationChanged])
export type BuildingChange = typeof BuildingChange.Type

/** A gesture of Building was refused: each reason in words. */
export class BuildingRefused extends Schema.TaggedError<BuildingRefused>()('BuildingRefused', {
  reasons: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return this.reasons.join('\n')
  }
}

export class UnknownCheck extends Schema.TaggedError<UnknownCheck>()('UnknownCheck', {
  id: Schema.String,
}) {
  override get message(): string {
    return 'This check no longer exists.'
  }
}

/** A tree of one repository a snapshot took (#140). */
export const BuildingTree = Schema.Struct({ repository: Schema.String, tree: Schema.String })
export type BuildingTree = typeof BuildingTree.Type

/** One attempt at a task: its snapshots, how it ended, and the paths changed outside its targets. */
export const BuildingAttemptView = Schema.Struct({
  number: Schema.Number,
  runner: Schema.String,
  startedAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(Schema.String),
  summary: Schema.NullOr(Schema.String),
  starts: Schema.Array(BuildingTree),
  ends: Schema.NullOr(Schema.Array(BuildingTree)),
  outside: Schema.Array(Schema.String),
})
export type BuildingAttemptView = typeof BuildingAttemptView.Type

/** A task of the effective plan as the Building page reads it. */
export const BuildingTaskView = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  result: Schema.String,
  origin: TaskOrigin,
  requirements: Schema.Array(Schema.String),
  scenarios: Schema.Array(Schema.String),
  targets: Schema.Array(TaskTarget),
  dependsOn: Schema.Array(Schema.String),
  state: TaskState,
  /** For a done task: whether a check verified it. Null before. */
  verified: Schema.NullOr(Schema.Boolean),
  /** The session lineage that runs it, or null. */
  runner: Schema.NullOr(Schema.String),
  /** Why it is blocked, in words: the need, or the task it depends on. */
  blockedBy: Schema.NullOr(Schema.String),
  skippedReason: Schema.NullOr(Schema.String),
  replacedBy: Schema.Array(Schema.String),
  /** The decision that brought it, for a task of an amendment. */
  decisionId: Schema.NullOr(Schema.String),
  attempts: Schema.Array(BuildingAttemptView),
  /** Each state it took, dated. */
  changes: Schema.Array(Schema.Struct({ state: TaskState, at: Schema.String })),
})
export type BuildingTaskView = typeof BuildingTaskView.Type

/** A decision taken during Building, with the amendment it carries in words. */
export const BuildingDecisionView = Schema.Struct({
  id: Schema.String,
  needId: Schema.String,
  kind: Schema.String,
  tasks: Schema.Array(Schema.String),
  question: Schema.String,
  options: Schema.Array(Schema.String),
  recommended: Schema.NullOr(Schema.String),
  amendment: Schema.NullOr(Schema.String),
  state: Schema.String,
  answer: Schema.NullOr(Schema.String),
  applied: Schema.Boolean,
  requestedAt: Schema.String,
  answeredAt: Schema.NullOr(Schema.String),
})
export type BuildingDecisionView = typeof BuildingDecisionView.Type

/** A requirement of the Spec, with the tasks that cover it. */
export const BuildingRequirementView = Schema.Struct({
  id: Schema.String,
  done: Schema.Boolean,
  tasks: Schema.Array(Schema.String),
})

/** A repository of the Building's Workspace. */
export const BuildingRepository = Schema.Struct({
  name: Schema.String,
  folder: Schema.String,
  branch: Schema.NullOr(Schema.String),
  baseCommit: Schema.String,
})

/** A Building as its page reads it: the head, the plan, the decisions, the phase. */
export const BuildingView = Schema.Struct({
  missionId: Schema.String,
  buildingId: Schema.String,
  /** `Building`, or `Building · round N` once rounds exist. */
  label: Schema.String,
  /** The round, its number and points: always null until rounds (R2). */
  round: Schema.NullOr(
    Schema.Struct({ number: Schema.Number, points: Schema.Array(Schema.String) }),
  ),
  state: Schema.Literals(['active', 'ended', 'cancelled']),
  phase: Schema.String,
  /** Open question 24: done and skipped tasks over the effective plan, in %. */
  percent: Schema.Number,
  /** The special tasks, counted apart (CT-41): none until the end sequence adds them. */
  special: Schema.Struct({ done: Schema.Number, total: Schema.Number }),
  /** Open question 28: the time the engine ran since the start, in seconds. */
  elapsedSeconds: Schema.Number,
  startedAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
  repositories: Schema.Array(BuildingRepository),
  requirements: Schema.Array(BuildingRequirementView),
  tasks: Schema.Array(BuildingTaskView),
  decisions: Schema.Array(BuildingDecisionView),
  summary: Schema.NullOr(Schema.String),
})
export type BuildingView = typeof BuildingView.Type

export class UnknownBuildingTask extends Schema.TaggedError<UnknownBuildingTask>()(
  'UnknownBuildingTask',
  { id: Schema.String },
) {
  override get message(): string {
    return `The Building has no task ${this.id}.`
  }
}

const always = [StorageFailed, EngineGone] as const

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const ofMission = { missionId: Schema.String }

export const BuildingRpcs = RpcGroup.make(
  /** The user's Build button: a check of a Ready mission against the code of today. */
  Rpc.make('building.check', {
    payload: ofMission,
    success: PrelaunchView,
    error: failing(...always, UnknownMission, BuildingRefused),
  }),
  Rpc.make('building.checkView', {
    payload: { checkId: Schema.String },
    success: PrelaunchView,
    error: failing(...always, UnknownCheck),
  }),
  /** The user launches on a valid check: the Workspace is prepared, then the mission builds. */
  Rpc.make('building.launch', {
    payload: { ...ofMission, checkId: Schema.String, choice: LaunchChoice },
    success: BuildingPreparation,
    error: failing(...always, UnknownMission, UnknownCheck, BuildingRefused),
  }),
  /** The user sends the mission back to Planning, the check's report as the reason. */
  Rpc.make('building.backToPlanning', {
    payload: { ...ofMission, checkId: Schema.String },
    success: Mission,
    error: failing(...always, UnknownMission, UnknownCheck, BuildingRefused, MoveRefused),
  }),
  /** The steps of the mission's launch being prepared, or null when none was asked. */
  Rpc.make('building.preparation', {
    payload: ofMission,
    success: Schema.NullOr(BuildingPreparation),
    error: failing(...always, UnknownMission),
  }),
  /** The Builder's model for this mission: the mission-level override, or null to inherit. */
  Rpc.make('building.chooseModel', {
    payload: { ...ofMission, setting: Schema.NullOr(ModelSettingValue) },
    success: CheckModel,
    error: failing(...always, UnknownMission, BuildingRefused),
  }),
  /** The mission's last check and its preparation, then again at each change. */
  Rpc.make('building.changed', {
    payload: ofMission,
    success: BuildingChange,
    error: failing(...always, UnknownMission),
    stream: true,
  }),
)
