/**
 * A mission's delivery (S1), as it crosses the links: from Ship to Done, the waves of its
 * participating repositories, each repository's status and each step's state, outcome and masked
 * message; Retry of a repository, Stop delivery, and the waits read again now. Only the window
 * asks them; no agent's tool reaches them. A click or an indeterminate step is answered through
 * the needs, like any need.
 *
 * `delivery.retry` was #464's already (a push's Retry): a repository of the delivery is retried
 * through `delivery.retryRepository`.
 */

import {
  DeliveryStatus,
  DeliveryStepState,
  RepositoryDeliveryStatus,
  StepMode,
} from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { ForgeCli } from './forge.ts'
import { EngineGone } from './gone.ts'
import { UnknownMission } from './missions.ts'
import { StorageFailed } from './profile.ts'

/** One step of a repository's delivery, as it stands. */
export const DeliveryStepView = Schema.Struct({
  /** Its id in the copy of the waves: stable for the whole delivery. */
  id: Schema.String,
  /** Its kind in the rules' catalogue: `merge`, `ci`, `command`… */
  kind: Schema.String,
  /** How it starts: a Confirm step always waits for a click, whatever its copy says. */
  mode: StepMode,
  state: DeliveryStepState,
  /** What it found or did once done: `#41`, `2.4.0`, `5 of 5 checks`. */
  outcome: Schema.NullOr(Schema.String),
  /** The remote's or Git's message verbatim, masked, when it failed or stopped. */
  message: Schema.NullOr(Schema.String),
  /** Why it waits, in words, while it waits; never a success. */
  reason: Schema.NullOr(Schema.String),
  /** The forge CLI it waits for while that CLI is missing or signed out (#253). */
  waitingFor: Schema.NullOr(ForgeCli),
  /** The need open on it: its click, its error, its indeterminate outcome, its question. */
  needId: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.String),
  endedAt: Schema.NullOr(Schema.String),
})
export type DeliveryStepView = typeof DeliveryStepView.Type

/** A repository that takes part in the delivery; a skipped one is never shown. */
export const DeliveryRepositoryView = Schema.Struct({
  repositoryId: Schema.String,
  /** Its path in the Workspace. */
  repository: Schema.String,
  wave: Schema.Number,
  /** It takes part only to bump what an upstream repository publishes. */
  bumpOnly: Schema.Boolean,
  status: RepositoryDeliveryStatus,
  steps: Schema.Array(DeliveryStepView),
})
export type DeliveryRepositoryView = typeof DeliveryRepositoryView.Type

/** A mission's delivery: the version of the waves it was planned from, its waves, its status. */
export const DeliveryView = Schema.Struct({
  missionId: Schema.String,
  wavesVersion: Schema.Number,
  status: DeliveryStatus,
  /** The waves in order, each its repositories by id. */
  waves: Schema.Array(Schema.Array(Schema.String)),
  repositories: Schema.Array(DeliveryRepositoryView),
  startedAt: Schema.String,
  stoppedAt: Schema.NullOr(Schema.String),
  deliveredAt: Schema.NullOr(Schema.String),
})
export type DeliveryView = typeof DeliveryView.Type

/** A Retry refused: the repository has nothing failed or stopped, or its wave waits on another. */
export class DeliveryRetryRefused extends Schema.TaggedError<DeliveryRetryRefused>()(
  'DeliveryRetryRefused',
  { repository: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return this.reason
  }
}

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const always = [StorageFailed, EngineGone] as const

export const DeliveryRunRpcs = RpcGroup.make(
  /** The mission's delivery; null before Ship, or when Ship marked it delivered (Local). */
  Rpc.make('delivery.get', {
    payload: { missionId: Schema.String },
    success: Schema.NullOr(DeliveryView),
    error: failing(...always, UnknownMission),
  }),
  /** The same now, then at every change, for as long as the caller listens. */
  Rpc.make('delivery.watch', {
    payload: { missionId: Schema.String },
    success: Schema.NullOr(DeliveryView),
    error: failing(...always, UnknownMission),
    stream: true,
  }),
  /**
   * Runs a failed or stopped repository again from its first step not done, each step first
   * checking what is already true: nothing is done twice.
   */
  Rpc.make('delivery.retryRepository', {
    payload: { missionId: Schema.String, repository: Schema.String },
    success: DeliveryView,
    error: failing(...always, UnknownMission, DeliveryRetryRefused),
  }),
  /**
   * Stop delivery, the user's alone: the remaining steps stop, what is done stays done, nothing is
   * sent to any remote. The mission stays in Shipping.
   */
  Rpc.make('delivery.stop', {
    payload: { missionId: Schema.String },
    success: Schema.NullOr(DeliveryView),
    error: failing(...always, UnknownMission),
  }),
  /** Every wait of every delivery read again now: what main asks when the window has the focus. */
  Rpc.make('delivery.refresh', {
    payload: {},
    success: Schema.Void,
    error: failing(...always),
  }),
)
