/**
 * The automatic review at the end of a Building (#147), as it crosses the links: each reviewer's
 * pass, every finding with its fate, the files of the review's checkpoint, and what changed after
 * it. Review (R1, R10) reads it; served apart, as the proofs are, until a screen forwards it.
 */

import {
  ReviewFate,
  ReviewSeverity,
  ReviewPassState,
  Reviewer,
  TaskState,
} from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { UnknownMission } from './missions.ts'
import { StorageFailed } from './profile.ts'

/** One reviewer's pass: where it stands, and how many findings of each severity it reported. */
export const ReviewPassView = Schema.Struct({
  id: Schema.String,
  reviewer: Reviewer,
  state: ReviewPassState,
  startedAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
  failure: Schema.NullOr(Schema.String),
  counts: Schema.Struct({
    blocking: Schema.Number,
    warning: Schema.Number,
    suggestion: Schema.Number,
  }),
})
export type ReviewPassView = typeof ReviewPassView.Type

/**
 * A finding and its fate: a decision need (its answer once given), a special task (its state and
 * whether its checks verified it), recorded as a decision, or dismissed.
 */
export const ReviewFindingView = Schema.Struct({
  id: Schema.String,
  number: Schema.Number,
  reviewer: Reviewer,
  severity: ReviewSeverity,
  requirement: Schema.NullOr(Schema.String),
  scenario: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(Schema.String),
  path: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.Number),
  text: Schema.String,
  contradictsSpec: Schema.Boolean,
  evidence: Schema.NullOr(Schema.String),
  fate: Schema.NullOr(ReviewFate),
  needId: Schema.NullOr(Schema.String),
  answer: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Schema.String),
  taskState: Schema.NullOr(TaskState),
  verified: Schema.NullOr(Schema.Boolean),
})
export type ReviewFindingView = typeof ReviewFindingView.Type

/** A file of the review's checkpoint, from the merge base to the tree the reviewers read. */
export const ReviewCheckpointFile = Schema.Struct({
  repository: Schema.String,
  path: Schema.String,
  status: Schema.String,
  added: Schema.NullOr(Schema.Number),
  removed: Schema.NullOr(Schema.Number),
})

/** A file changed after the review, covered only by the checks, and who wrote it. */
export const ReviewChangedAfterView = Schema.Struct({
  repository: Schema.String,
  path: Schema.String,
  status: Schema.String,
  added: Schema.NullOr(Schema.Number),
  removed: Schema.NullOr(Schema.Number),
  /** The special task (`RV1`) or `documenter`; null when no writer is known. */
  by: Schema.NullOr(Schema.String),
})
export type ReviewChangedAfterView = typeof ReviewChangedAfterView.Type

/** The automatic review of a Building, as Review reads it. */
export const AutoReviewView = Schema.Struct({
  missionId: Schema.String,
  buildingId: Schema.String,
  /** The step of the end the Building is at (`review`, `special_tasks`, `ended`…). */
  phase: Schema.String,
  checkpoint: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      takenAt: Schema.String,
      files: Schema.Array(ReviewCheckpointFile),
    }),
  ),
  passes: Schema.Array(ReviewPassView),
  findings: Schema.Array(ReviewFindingView),
  changedAfter: Schema.Array(ReviewChangedAfterView),
})
export type AutoReviewView = typeof AutoReviewView.Type

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const always = [StorageFailed, EngineGone, UnknownMission] as const

export const AutoReviewRpcs = RpcGroup.make(
  /** The automatic review of a Building of the mission, its latest by default; null before one. */
  Rpc.make('autoReview.read', {
    payload: { missionId: Schema.String, buildingId: Schema.NullOr(Schema.String) },
    success: Schema.NullOr(AutoReviewView),
    error: failing(...always),
  }),
  /** The same, then again at each change of the mission. */
  Rpc.make('autoReview.changed', {
    payload: { missionId: Schema.String },
    success: Schema.NullOr(AutoReviewView),
    error: failing(...always),
    stream: true,
  }),
)
