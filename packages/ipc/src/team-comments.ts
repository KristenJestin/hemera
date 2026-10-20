/**
 * The team's comments from the forge (R8, CT-45), as they cross the links: every comment of a
 * mission's pull requests with its versions, the forge's state (resolved, removed), whether it is
 * the user's own, where it points, the agent's internal reading and reply draft, the user's take,
 * and the feedback it became. Served apart, as Ship is, until the Review page (#496) forwards it.
 *
 * Only the window asks for these: no agent's tool reaches them, and none of them writes anything
 * on the forge. Hemera never posts, edits, reacts to or resolves a comment there.
 */

import { AnchorSide, LineRange } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { AnchorLive, ExcerptView } from './feedback.ts'
import { ForgeName } from './forge.ts'
import { EngineGone } from './gone.ts'
import { UnknownMission } from './missions.ts'
import { StorageFailed } from './profile.ts'

/** Where a comment stands for the user: received, turned into feedback, or dismissed. */
export const TeamCommentState = Schema.Literals(['received', 'feedback', 'dismissed'])
export type TeamCommentState = typeof TeamCommentState.Type

/** What a comment is on the forge: inline on the code, general, or a review's summary. */
export const TeamCommentKind = Schema.Literals(['inline', 'general', 'review'])
export type TeamCommentKind = typeof TeamCommentKind.Type

/** Where an inline comment points, and whether Hemera knows the version it was made on. */
export const TeamCommentAnchor = Schema.Struct({
  /** The repository of the Workspace the pull request is of. */
  repository: Schema.String,
  path: Schema.String,
  side: AnchorSide,
  lines: Schema.NullOr(LineRange),
  /** The commit it was made on; null when the forge does not say. */
  commit: Schema.NullOr(Schema.String),
  /** False when that version is not one Hemera pushed: shown with its path and lines as given. */
  known: Schema.Boolean,
  /** Its lines on the version it was made on, when Hemera holds it. */
  excerpt: Schema.NullOr(ExcerptView),
  /** Where it stands on the live diff (#341); null on a version Hemera did not push. */
  live: Schema.NullOr(AnchorLive),
})
export type TeamCommentAnchor = typeof TeamCommentAnchor.Type

export const TeamCommentVersion = Schema.Struct({
  version: Schema.Number,
  body: Schema.String,
  /** When the forge says it was written or edited. */
  at: Schema.String,
})

export const TeamCommentView = Schema.Struct({
  id: Schema.String,
  missionId: Schema.String,
  repository: Schema.String,
  forge: ForgeName,
  host: Schema.String,
  /** The pull request's repository on its forge: `owner/repo`. */
  slug: Schema.String,
  number: Schema.Number,
  /** The forge's id of the comment. */
  commentId: Schema.String,
  kind: TeamCommentKind,
  /** A review's verdict: `approved`, `changes-requested` or `commented`; null for a comment. */
  review: Schema.NullOr(Schema.String),
  /** The forge's id of its thread's first comment. */
  thread: Schema.NullOr(Schema.String),
  author: Schema.String,
  /** Written by the account the forge's CLI says is signed in, as read at the fetch. */
  mine: Schema.Boolean,
  /** Its text as last read, masked. */
  body: Schema.String,
  version: Schema.Number,
  versions: Schema.Array(TeamCommentVersion),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  url: Schema.NullOr(Schema.String),
  anchor: Schema.NullOr(TeamCommentAnchor),
  /** The forge's state: its thread resolved there. Never resolves the feedback it became. */
  forgeResolved: Schema.Boolean,
  removedOnForge: Schema.Boolean,
  state: TeamCommentState,
  /** The stage the mission was in when it arrived. */
  arrivedIn: Schema.Literals(['review', 'shipping']),
  /** The agent's reading, in the user's language; internal. Null until drafted. */
  reading: Schema.NullOr(Schema.String),
  /** A reply the user may send themselves, in the comment's language; internal, never sent. */
  reply: Schema.NullOr(Schema.String),
  myTake: Schema.NullOr(Schema.String),
  /** The feedback it became (#341), in the collecting round. */
  feedbackId: Schema.NullOr(Schema.String),
  /** Edited on the forge after it became feedback: the round point drawn from it is older. */
  editedAfterIntegration: Schema.Boolean,
})
export type TeamCommentView = typeof TeamCommentView.Type

/** What the start field opens with for "Start a mission from this" during Shipping: nothing is created. */
export const TeamCommentSource = Schema.Struct({
  commentId: Schema.String,
  text: Schema.String,
  /** The mission it comes from, stored as a link on the new one once created. */
  origin: Schema.String,
  /** `Started from ACME-12, a team comment`. */
  originSaid: Schema.String,
  /** The comment on the forge. */
  url: Schema.NullOr(Schema.String),
})
export type TeamCommentSource = typeof TeamCommentSource.Type

/** The team comments of a mission changed: read them again. */
export const TeamCommentsChange = Schema.Struct({ missionId: Schema.String })
export type TeamCommentsChange = typeof TeamCommentsChange.Type

export class UnknownTeamComment extends Schema.TaggedError<UnknownTeamComment>()(
  'UnknownTeamComment',
  { id: Schema.String },
) {
  override get message(): string {
    return 'This team comment is not known to Hemera.'
  }
}

/** A gesture on a team comment refused, and why. */
export class TeamCommentRefused extends Schema.TaggedError<TeamCommentRefused>()(
  'TeamCommentRefused',
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason
  }
}

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const always = [StorageFailed, EngineGone] as const
const onComment = [...always, UnknownTeamComment, TeamCommentRefused] as const

export const TeamCommentsRpcs = RpcGroup.make(
  Rpc.make('teamComments.list', {
    payload: { missionId: Schema.String },
    success: Schema.Array(TeamCommentView),
    error: failing(...always, UnknownMission),
  }),
  /** The user's take on a comment of someone else's: their opinion, or a correction of the reading. */
  Rpc.make('teamComments.take', {
    payload: { commentId: Schema.String, myTake: Schema.String },
    success: TeamCommentView,
    error: failing(...onComment),
  }),
  /** The comment, with the user's take, becomes a feedback of the collecting round. */
  Rpc.make('teamComments.addToRound', {
    payload: { commentId: Schema.String },
    success: TeamCommentView,
    error: failing(...onComment),
  }),
  /** Kept, marked dismissed, readable. */
  Rpc.make('teamComments.dismiss', {
    payload: { commentId: Schema.String },
    success: TeamCommentView,
    error: failing(...onComment),
  }),
  /** "Start a mission from this": what the Project's start field opens with. */
  Rpc.make('teamComments.startMissionFrom', {
    payload: { commentId: Schema.String },
    success: TeamCommentSource,
    error: failing(...onComment),
  }),
  Rpc.make('teamComments.changes', {
    payload: { missionId: Schema.String },
    success: TeamCommentsChange,
    error: failing(...always, UnknownMission),
    stream: true,
  }),
)
