/**
 * Review's feedback (#341, R1), as it crosses the links: the rounds of a mission with their
 * checkpoints, every feedback with its versions, images and anchor followed on the live diff, the
 * version a comment was written on, and what changes. Served apart, as the proofs are, until the
 * Review page (R10) forwards it.
 *
 * Every view is a list with what it is anchored on: a screen sorts it by round, state and place.
 */

import {
  AnchorAsked,
  AnchorSide,
  Delta,
  FeedbackKind,
  FeedbackState,
  LineRange,
  ProofMode,
  RoundPointKind,
  RoundState,
} from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { DiffSide } from './diff.ts'
import { EngineGone } from './gone.ts'
import { UnknownMission } from './missions.ts'
import { StaleVersion, StorageFailed } from './profile.ts'

/** Who wrote a feedback: the user, or (R8) a comment of the team on the forge. */
export const FeedbackUser = Schema.TaggedStruct('User', {})
export const FeedbackForge = Schema.TaggedStruct('Forge', { login: Schema.String })
export const FeedbackAuthor = Schema.Union([FeedbackUser, FeedbackForge])
export type FeedbackAuthor = typeof FeedbackAuthor.Type

/** The checkpoint of one repository: its tree, and the commit it stood on. */
export const ReviewCheckpointRepository = Schema.Struct({
  repository: Schema.String,
  head: Schema.NullOr(Schema.String),
  tree: Schema.String,
})

/** A Review checkpoint: on entering Review (round 0), or at the end of a round. */
export const ReviewCheckpointView = Schema.Struct({
  id: Schema.String,
  round: Schema.Number,
  kind: Schema.Literals(['review_entry', 'round_end']),
  takenAt: Schema.String,
  repositories: Schema.Array(ReviewCheckpointRepository),
})
export type ReviewCheckpointView = typeof ReviewCheckpointView.Type

export const RoundView = Schema.Struct({
  number: Schema.Number,
  state: RoundState,
  createdAt: Schema.String,
  movedAt: Schema.String,
})
export type RoundView = typeof RoundView.Type

/** The lines a code comment targets with their context, from the version it was written on. */
export const ExcerptView = Schema.Struct({
  before: Schema.Array(Schema.String),
  lines: Schema.Array(Schema.String),
  after: Schema.Array(Schema.String),
  start: Schema.Number,
})
export type ExcerptView = typeof ExcerptView.Type

/** Where a code comment stands on the live diff. */
export const AnchorCurrent = Schema.TaggedStruct('Current', {
  path: Schema.String,
  lines: Schema.NullOr(LineRange),
})
export const AnchorMoved = Schema.TaggedStruct('Moved', {
  path: Schema.String,
  lines: Schema.NullOr(LineRange),
})
export const AnchorOutdated = Schema.TaggedStruct('Outdated', { why: Schema.String })
/** The live Workspace could not be read (gone, or Git refused): the anchor stands as written. */
export const AnchorUnread = Schema.TaggedStruct('Unread', { why: Schema.String })
export const AnchorLive = Schema.Union([AnchorCurrent, AnchorMoved, AnchorOutdated, AnchorUnread])
export type AnchorLive = typeof AnchorLive.Type

export const CodeAnchorView = Schema.TaggedStruct('Code', {
  repository: Schema.String,
  path: Schema.String,
  side: AnchorSide,
  lines: Schema.NullOr(LineRange),
  /** The tree of the repository the comment was written on. */
  tree: Schema.String,
  /** Null for a whole-file comment, or a file whose content is withheld or binary. */
  excerpt: Schema.NullOr(ExcerptView),
  live: AnchorLive,
})
export const SpecAnchorView = Schema.TaggedStruct('Spec', { item: Schema.String })
export const AnchorView = Schema.Union([CodeAnchorView, SpecAnchorView])
export type AnchorView = typeof AnchorView.Type

export const FeedbackVersionView = Schema.Struct({
  version: Schema.Number,
  body: Schema.String,
  writtenAt: Schema.String,
})

/** An image of a feedback, kept in the mission's evidence. */
export const FeedbackImageView = Schema.Struct({
  evidenceId: Schema.String,
  name: Schema.String,
  sha256: Schema.String,
  size: Schema.Number,
  mediaType: Schema.String,
})

export const FeedbackView = Schema.Struct({
  id: Schema.String,
  missionId: Schema.String,
  round: Schema.Number,
  author: FeedbackAuthor,
  kind: FeedbackKind,
  state: FeedbackState,
  body: Schema.String,
  version: Schema.Number,
  /** Every version, the first first; the last is `body`. */
  versions: Schema.Array(FeedbackVersionView),
  images: Schema.Array(FeedbackImageView),
  anchor: Schema.NullOr(AnchorView),
  /** The feedback this one follows up, and those that follow it up. */
  followsUp: Schema.NullOr(Schema.String),
  followedBy: Schema.Array(Schema.String),
  /** The agent's answer, once addressed. */
  answer: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export type FeedbackView = typeof FeedbackView.Type

/** A mission's Review: its checkpoints, its rounds, its feedback, and whether one waits. */
export const ReviewStateView = Schema.Struct({
  missionId: Schema.String,
  /** The entry's (round 0), then each round's end, in order. */
  checkpoints: Schema.Array(ReviewCheckpointView),
  rounds: Schema.Array(RoundView),
  feedback: Schema.Array(FeedbackView),
  /** Whether feedback waits for a Fix: one `waiting`, not a question. */
  waits: Schema.Boolean,
})
export type ReviewStateView = typeof ReviewStateView.Type

/** A scenario of a round's point (#468): its proof's mode, and where its proof stands. */
export const RoundScenarioView = Schema.Struct({
  id: Schema.String,
  when: Schema.String,
  then: Schema.String,
  mode: ProofMode,
  /** The proof's state in the round's Building (`red_recorded`, `green`…); null before it. */
  proof: Schema.NullOr(Schema.String),
})
export type RoundScenarioView = typeof RoundScenarioView.Type

export const RoundDecisionView = Schema.Struct({
  kind: Schema.Literals(['behaviour', 'point', 'clarify']),
  point: Schema.NullOr(Schema.String),
  feedbackId: Schema.NullOr(Schema.String),
  choice: Schema.String,
  alternatives: Schema.Array(Schema.String),
  why: Schema.String,
})
export type RoundDecisionView = typeof RoundDecisionView.Type

/** A point of a round: a requirement, its classification, its sources, scenarios and decisions. */
export const RoundPointView = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  kind: RoundPointKind,
  delta: Schema.NullOr(
    Schema.Struct({ requirement: Schema.String, change: Delta, livingVersion: Schema.Number }),
  ),
  sources: Schema.Array(Schema.String),
  scenarios: Schema.Array(RoundScenarioView),
  decisions: Schema.Array(RoundDecisionView),
  removed: Schema.Boolean,
  removedReason: Schema.NullOr(Schema.String),
})
export type RoundPointView = typeof RoundPointView.Type

/** A task of a round, folded as Planning's are: the agent's translation of the points. */
export const RoundTaskView = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  result: Schema.String,
  points: Schema.Array(Schema.String),
  scenarios: Schema.Array(Schema.String),
  /** Its state in the round's Building; null before it. */
  state: Schema.NullOr(Schema.String),
})
export type RoundTaskView = typeof RoundTaskView.Type

/** One round as a small Spec (#468): its points, tasks, decisions, questions and progress. */
export const RoundDetailView = Schema.Struct({
  missionId: Schema.String,
  number: Schema.Number,
  state: RoundState,
  readyWhy: Schema.NullOr(Schema.String),
  points: Schema.Array(RoundPointView),
  tasks: Schema.Array(RoundTaskView),
  decisions: Schema.Array(RoundDecisionView),
  /** The ids of the questions its grilling asked. */
  questions: Schema.Array(Schema.String),
  progress: Schema.Struct({ done: Schema.Number, tasks: Schema.Number }),
})
export type RoundDetailView = typeof RoundDetailView.Type

/** What the start field opens with for "Start a mission from this" (#468): nothing is created. */
export const MissionFromSource = Schema.Struct({
  feedbackId: Schema.String,
  text: Schema.String,
  /** The mission it is started from, stored as a link on both once created. */
  origin: Schema.String,
  /** `Started from ACME-12, round 2`. */
  originSaid: Schema.String,
})
export type MissionFromSource = typeof MissionFromSource.Type

/** An image kept for a feedback. */
export const ImageAdded = Schema.Struct({
  evidenceId: Schema.String,
  sha256: Schema.String,
  size: Schema.Number,
  width: Schema.NullOr(Schema.Number),
  height: Schema.NullOr(Schema.Number),
})
export type ImageAdded = typeof ImageAdded.Type

/** The version of a file a code comment was written on, read from the database. */
export const CommentedVersion = Schema.Struct({
  feedbackId: Schema.String,
  repository: Schema.String,
  path: Schema.String,
  tree: Schema.String,
  excerpt: Schema.NullOr(ExcerptView),
  content: DiffSide,
})
export type CommentedVersion = typeof CommentedVersion.Type

/** The Review of a mission changed: read it again. */
export const ReviewChange = Schema.Struct({ missionId: Schema.String, sequence: Schema.Number })
export type ReviewChange = typeof ReviewChange.Type

export class UnknownFeedback extends Schema.TaggedError<UnknownFeedback>()('UnknownFeedback', {
  id: Schema.String,
}) {
  override get message(): string {
    return 'This feedback is not known to Hemera.'
  }
}

/** A feedback, an edit or a gesture on it refused, and why. */
export class FeedbackRefused extends Schema.TaggedError<FeedbackRefused>()('FeedbackRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason
  }
}

/** An image the evidence store refused, in its words. */
export class ImageRefused extends Schema.TaggedError<ImageRefused>()('ImageRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason
  }
}

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const always = [StorageFailed, EngineGone] as const
const onFeedback = [...always, UnknownFeedback, FeedbackRefused] as const

export const ReviewRpcs = RpcGroup.make(
  Rpc.make('review.state', {
    payload: { missionId: Schema.String },
    success: ReviewStateView,
    error: failing(...always, UnknownMission),
  }),
  Rpc.make('review.feedbackAdd', {
    payload: {
      missionId: Schema.String,
      kind: FeedbackKind,
      body: Schema.String,
      anchor: Schema.NullOr(AnchorAsked),
      images: Schema.Array(Schema.String),
    },
    success: FeedbackView,
    error: failing(...always, UnknownMission, FeedbackRefused),
  }),
  Rpc.make('review.feedbackEdit', {
    payload: { feedbackId: Schema.String, body: Schema.String, version: Schema.Number },
    success: FeedbackView,
    error: failing(...onFeedback, StaleVersion),
  }),
  Rpc.make('review.feedbackWithdraw', {
    payload: { feedbackId: Schema.String },
    success: FeedbackView,
    error: failing(...onFeedback),
  }),
  Rpc.make('review.feedbackResolve', {
    payload: { feedbackId: Schema.String },
    success: FeedbackView,
    error: failing(...onFeedback),
  }),
  Rpc.make('review.feedbackFollowUp', {
    payload: {
      feedbackId: Schema.String,
      body: Schema.String,
      images: Schema.Array(Schema.String),
    },
    success: FeedbackView,
    error: failing(...onFeedback),
  }),
  Rpc.make('review.imageAdd', {
    payload: { missionId: Schema.String, name: Schema.String, bytes: Schema.Uint8Array },
    success: ImageAdded,
    error: failing(...always, UnknownMission, ImageRefused),
  }),
  Rpc.make('review.commentedVersion', {
    payload: { feedbackId: Schema.String },
    success: CommentedVersion,
    error: failing(...onFeedback),
  }),
  Rpc.make('review.changes', {
    payload: { missionId: Schema.String },
    success: ReviewChange,
    error: failing(...always, UnknownMission),
    stream: true,
  }),
  Rpc.make('review.fix', {
    payload: { missionId: Schema.String },
    success: Schema.Void,
    error: failing(...always, UnknownMission, FeedbackRefused),
  }),
  Rpc.make('review.round', {
    payload: { missionId: Schema.String, number: Schema.Number },
    success: RoundDetailView,
    error: failing(...always, UnknownMission, FeedbackRefused),
  }),
  Rpc.make('review.startMissionFrom', {
    payload: { feedbackId: Schema.String },
    success: MissionFromSource,
    error: failing(...onFeedback),
  }),
)
