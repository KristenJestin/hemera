/**
 * The Freeze and what comes with it (#92), as the mission's head and the Planning and Ready pages
 * read them: whether Freeze is offered and every reason it is not, the Freeze itself on the version
 * the user read, the user's return to Planning, and the dependencies between missions, which only
 * the user accepts or rejects.
 */

import { DependencyState, MoveRefused, Stage } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { ColdReadFreshness } from './cold-read.ts'
import { EngineGone } from './gone.ts'
import { Mission, UnknownMission } from './missions.ts'
import { PlanningRefused } from './planning.ts'
import { StorageFailed } from './profile.ts'

/** One dependency, seen from either mission. */
export const DependencySeen = Schema.Struct({
  id: Schema.String,
  /** The mission that cannot be built before the other is delivered. */
  missionId: Schema.String,
  missionKey: Schema.String,
  /** The mission it depends on. */
  dependsOnId: Schema.String,
  dependsOnKey: Schema.String,
  dependsOnStage: Stage,
  reason: Schema.String,
  state: DependencyState,
  proposedAt: Schema.String,
  decidedAt: Schema.NullOr(Schema.String),
})
export type DependencySeen = typeof DependencySeen.Type

/** A mission's dependencies both ways: those it has, and the missions that depend on it. */
export const MissionDependencies = Schema.Struct({
  dependsOn: Schema.Array(DependencySeen),
  dependedOnBy: Schema.Array(DependencySeen),
})
export type MissionDependencies = typeof MissionDependencies.Type

/**
 * Whether Freeze is offered: ready, or every reason it is not, each in words. Shown beside it: what
 * the last cold read read against the Spec now (#91), and the mission's dependencies.
 */
export const FreezeReadiness = Schema.Struct({
  ready: Schema.Boolean,
  unsettled: Schema.Array(Schema.String),
  freshness: ColdReadFreshness,
  dependencies: Schema.Array(DependencySeen),
})
export type FreezeReadiness = typeof FreezeReadiness.Type

/** The Freeze was refused: the Spec changed since the version read, or something is not settled. */
export class FreezeRefused extends Schema.TaggedError<FreezeRefused>()('FreezeRefused', {
  reasons: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return this.reasons.join('\n')
  }
}

export class UnknownDependency extends Schema.TaggedError<UnknownDependency>()(
  'UnknownDependency',
  { id: Schema.String },
) {
  override get message(): string {
    return 'This dependency no longer exists.'
  }
}

const always = [StorageFailed, EngineGone] as const

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const ofMission = { id: Schema.String }

export const FreezeRpcs = RpcGroup.make(
  Rpc.make('missions.freezeReadiness', {
    payload: ofMission,
    success: FreezeReadiness,
    error: failing(...always, UnknownMission),
  }),
  /** The readiness now, then again at each change of the mission or its dependencies. */
  Rpc.make('missions.freezeReadinessChanged', {
    payload: ofMission,
    success: FreezeReadiness,
    error: failing(...always, UnknownMission),
    stream: true,
  }),
  /** Freezes the Spec at the version the user read, and moves the mission to Ready. */
  Rpc.make('missions.freeze', {
    payload: { ...ofMission, specVersion: Schema.Number },
    success: Mission,
    error: failing(...always, UnknownMission, FreezeRefused),
  }),
  /** The user sends a Ready mission back to Planning: the Spec is unfrozen until a new Freeze. */
  Rpc.make('missions.returnToPlanning', {
    payload: { ...ofMission, reason: Schema.NullOr(Schema.String) },
    success: Mission,
    error: failing(...always, UnknownMission, MoveRefused),
  }),
)

export const DependenciesRpcs = RpcGroup.make(
  Rpc.make('dependencies.list', {
    payload: { missionId: Schema.String },
    success: MissionDependencies,
    error: failing(...always, UnknownMission),
  }),
  /** The user accepts or rejects a proposed dependency, in Planning or Ready. */
  Rpc.make('dependencies.decide', {
    payload: { id: Schema.String, accept: Schema.Boolean },
    success: DependencySeen,
    error: failing(...always, UnknownDependency, UnknownMission, PlanningRefused),
  }),
)
