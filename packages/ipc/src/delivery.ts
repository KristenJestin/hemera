/**
 * A Project's delivery rules (#340), as they cross the links: the rules with each repository's
 * effective recipe and the dependencies proposed from its `package.json` (never saved until
 * accepted), a draft checked or saved on the version it was edited from, and the sections a
 * mission copied.
 *
 * The remote and the base branch of each repository stay the Project's fields (`projects.*`).
 */

import {
  DeliveryDependency,
  DeliveryProblem,
  DeliveryRules,
  DeliveryRulesDraft,
  EffectiveRepository,
  PreparationDifference,
  SectionCopy,
} from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { UnknownMission } from './missions.ts'
import { StaleVersion, StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'

export {
  DeliveryDependency,
  DeliveryProblem,
  DeliveryRules,
  DeliveryRulesDraft,
  EffectiveRepository,
  PreparationDifference,
  SectionCopy,
}

/** The rules of a Project, each repository resolved, and the dependencies its manifests propose. */
export const DeliveryRulesView = Schema.Struct({
  rules: DeliveryRules,
  /** In the Project's order. */
  repositories: Schema.Array(EffectiveRepository),
  /** Proposed from the repositories' `package.json` files; saved only once accepted. */
  proposedDependencies: Schema.Array(DeliveryDependency),
})
export type DeliveryRulesView = typeof DeliveryRulesView.Type

/** What changed in the Project's preparation since a mission copied it, for the Ship confirmation. */
export const PreparationChange = Schema.Struct({
  copiedVersion: Schema.Number,
  currentVersion: Schema.Number,
  /** None when the preparation reads the same, whatever its version. */
  differences: Schema.Array(PreparationDifference),
})
export type PreparationChange = typeof PreparationChange.Type

/** Rules refused at saving, with every reason. */
export class DeliveryRulesRefused extends Schema.TaggedError<DeliveryRulesRefused>()(
  'DeliveryRulesRefused',
  { problems: Schema.Array(DeliveryProblem) },
) {
  override get message(): string {
    return this.problems.map((problem) => problem.sentence).join(' ')
  }
}

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const always = [StorageFailed, EngineGone] as const

export const DeliveryRulesRpcs = RpcGroup.make(
  /** The Project's rules (its defaults when it never saved any), resolved per repository. */
  Rpc.make('deliveryRules.read', {
    payload: { projectId: Schema.String },
    success: DeliveryRulesView,
    error: failing(...always, UnknownProject),
  }),
  /** Every reason a draft would be refused; none when it can be saved. */
  Rpc.make('deliveryRules.validate', {
    payload: { projectId: Schema.String, draft: DeliveryRulesDraft },
    success: Schema.Array(DeliveryProblem),
    error: failing(...always, UnknownProject),
  }),
  /** Saves a draft edited from `version`: refused on a stale version, or with its reasons. */
  Rpc.make('deliveryRules.save', {
    payload: { projectId: Schema.String, draft: DeliveryRulesDraft, version: Schema.Number },
    success: DeliveryRulesView,
    error: failing(...always, UnknownProject, StaleVersion, DeliveryRulesRefused),
  }),
  /** Saves the dependencies the user accepted, each into its repository's delivers-after. */
  Rpc.make('deliveryRules.acceptDependencies', {
    payload: { projectId: Schema.String, edges: Schema.Array(DeliveryDependency) },
    success: DeliveryRulesView,
    error: failing(...always, UnknownProject, DeliveryRulesRefused),
  }),
  /** The sections a mission copied, each with the version of the rules it was copied at. */
  Rpc.make('deliveryRules.missionCopies', {
    payload: { missionId: Schema.String },
    success: Schema.Array(SectionCopy),
    error: failing(...always, UnknownMission),
  }),
  /**
   * Whether the Project's preparation differs from the mission's copy, with the differences; null
   * when the mission has not copied it yet.
   */
  Rpc.make('deliveryRules.preparationChangedSinceCopy', {
    payload: { missionId: Schema.String },
    success: Schema.NullOr(PreparationChange),
    error: failing(...always, UnknownMission, UnknownProject),
  }),
)
