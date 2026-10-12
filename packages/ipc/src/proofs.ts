/**
 * Red first, then green (#144), as it crosses the links: the red-then-green data of a mission's
 * proofs that Review shows, and the user's verdict on a scenario verified by hand (CT-36). Served
 * apart, as the checks are, until a screen forwards them.
 */

import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { ProofRunView, ScenarioProofView } from './building.ts'
import { EngineGone } from './gone.ts'
import { UnknownMission } from './missions.ts'
import { StorageFailed } from './profile.ts'

/** A verdict on a proof the user cannot give, and why. */
export class ProofRefused extends Schema.TaggedError<ProofRefused>()('ProofRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason
  }
}

/** A final check of the end (#143) and whether its result is on the current tree (CT-38). */
export const FinalCheckFreshness = Schema.Struct({
  name: Schema.String,
  place: Schema.String,
  verdict: Schema.String,
  upToDate: Schema.Boolean,
})

/** What Review shows of the proofs: each scenario with every run, and the final checks. */
export const ProofsView = Schema.Struct({
  missionId: Schema.String,
  scenarios: Schema.Array(
    Schema.Struct({ ...ScenarioProofView.fields, runs: Schema.Array(ProofRunView) }),
  ),
  finalChecks: Schema.Array(FinalCheckFreshness),
})
export type ProofsView = typeof ProofsView.Type

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const always = [StorageFailed, EngineGone, UnknownMission] as const

export const ProofsRpcs = RpcGroup.make(
  /** The mission's proofs, red then green, as its latest Building has them; null before one. */
  Rpc.make('proofs.read', {
    payload: { missionId: Schema.String },
    success: Schema.NullOr(ProofsView),
    error: failing(...always),
  }),
  /** The user validates a scenario verified by hand, on the trees of now, with a note or none. */
  Rpc.make('proofs.validateManual', {
    payload: {
      missionId: Schema.String,
      scenarioId: Schema.String,
      note: Schema.NullOr(Schema.String),
    },
    success: ScenarioProofView,
    error: failing(...always, ProofRefused),
  }),
  /** The user refuses a scenario verified by hand, saying why. */
  Rpc.make('proofs.refuseManual', {
    payload: { missionId: Schema.String, scenarioId: Schema.String, note: Schema.String },
    success: ScenarioProofView,
    error: failing(...always, ProofRefused),
  }),
)
