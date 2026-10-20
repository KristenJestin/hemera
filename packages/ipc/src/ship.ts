/**
 * Ship (R9), as it crosses the links: what the confirmation shows before the user confirms, the
 * confirmation itself on the preview it was opened on, and where a Ship in progress stands. Only the
 * window asks them; no agent's tool reaches them.
 */

import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { PreparationChange } from './delivery.ts'
import { DiffLetter } from './diff.ts'
import { EngineGone } from './gone.ts'
import { UnknownMission } from './missions.ts'
import { StorageFailed } from './profile.ts'

/** A file that will leave with Ship, since the repository's base. */
export const ShipFile = Schema.Struct({
  path: Schema.String,
  letter: DiffLetter,
  /** Its current change was made outside Hemera. */
  changedOutside: Schema.Boolean,
})
export type ShipFile = typeof ShipFile.Type

/** The CI of a pull request, as its forge reports it now; null when it could not be read. */
export const PullRequestCi = Schema.Literals(['passing', 'failing', 'pending', 'none'])
export type PullRequestCi = typeof PullRequestCi.Type

/** One repository of the mission as Ship would freeze it. */
export const ShipRepository = Schema.Struct({
  repository: Schema.String,
  /** The Workspace's branch, null when the repository is detached. */
  branch: Schema.NullOr(Schema.String),
  files: Schema.Array(ShipFile),
  /**
   * The proofs (by scenario) and final checks (`name` or `name · place`) whose tree is no longer
   * this repository's: Hemera runs them again before anything is frozen.
   */
  toRedo: Schema.Struct({
    proofs: Schema.Array(Schema.String),
    checks: Schema.Array(Schema.String),
  }),
  pullRequest: Schema.NullOr(
    Schema.Struct({
      number: Schema.Number,
      url: Schema.String,
      ci: Schema.NullOr(PullRequestCi),
    }),
  ),
})
export type ShipRepository = typeof ShipRepository.Type

/** A scenario verified by hand that is not validated: listed, and Ship stays possible. */
export const ShipManualProof = Schema.Struct({
  scenario: Schema.String,
  state: Schema.Literals(['to_verify', 'refused']),
})
export type ShipManualProof = typeof ShipManualProof.Type

/** What the Ship confirmation shows, and whether Ship may be confirmed now. */
export const ShipPreview = Schema.Struct({
  missionId: Schema.String,
  /** The identity of everything below but the time: a confirmation names the preview it saw. */
  previewId: Schema.String,
  possible: Schema.Boolean,
  /** Every reason Ship is refused, in words; none when it is possible. */
  reasons: Schema.Array(Schema.String),
  repositories: Schema.Array(ShipRepository),
  manualProofs: Schema.Array(ShipManualProof),
  /** The pull request preparation as it changed in the Project since the mission copied it. */
  preparationChange: Schema.NullOr(PreparationChange),
  /** With the Local preset: Ship marks the mission delivered, at this time (now, when previewed). */
  delivered: Schema.NullOr(Schema.Struct({ at: Schema.String })),
})
export type ShipPreview = typeof ShipPreview.Type

/** A tree Ship froze. */
export const FrozenTree = Schema.Struct({ repository: Schema.String, tree: Schema.String })

/** What Ship did: the mission in Shipping, its frozen trees, and when it was marked delivered. */
export const Shipped = Schema.Struct({
  missionId: Schema.String,
  shippedAt: Schema.String,
  trees: Schema.Array(FrozenTree),
  deliveredAt: Schema.NullOr(Schema.String),
})
export type Shipped = typeof Shipped.Type

/** One proof or final check Ship runs again, and where it stands. */
export const ShipRerun = Schema.Struct({
  kind: Schema.Literals(['proof', 'check']),
  name: Schema.String,
  state: Schema.Literals(['waiting', 'running', 'green', 'red']),
})
export type ShipRerun = typeof ShipRerun.Type

/** Where a Ship in progress stands; `idle` when none runs. */
export const ShipProgress = Schema.Struct({
  missionId: Schema.String,
  step: Schema.Literals([
    'idle',
    'checking',
    'checkpoint',
    'rerunning',
    'freezing',
    'pushing',
    'shipped',
    'stopped',
  ]),
  reruns: Schema.Array(ShipRerun),
  /** Why it stopped, in words. */
  message: Schema.NullOr(Schema.String),
})
export type ShipProgress = typeof ShipProgress.Type

/** Ship refused or stopped, nothing frozen, with every reason. */
export class ShipRefused extends Schema.TaggedError<ShipRefused>()('ShipRefused', {
  reasons: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return this.reasons.join(' ')
  }
}

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const always = [StorageFailed, EngineGone] as const

export const ShipRpcs = RpcGroup.make(
  /** Whether Ship is possible now, every reason when not, and what the confirmation shows. */
  Rpc.make('ship.preview', {
    payload: { missionId: Schema.String },
    success: ShipPreview,
    error: failing(...always, UnknownMission),
  }),
  /** Ships on the preview the user saw: refused when anything changed since, or when it stops. */
  Rpc.make('ship.confirm', {
    payload: { missionId: Schema.String, previewId: Schema.String },
    success: Shipped,
    error: failing(...always, UnknownMission, ShipRefused),
  }),
  /** Where a Ship of the mission stands, then each change, for as long as the caller listens. */
  Rpc.make('ship.progress', {
    payload: { missionId: Schema.String },
    success: ShipProgress,
    error: failing(...always, UnknownMission),
    stream: true,
  }),
)
