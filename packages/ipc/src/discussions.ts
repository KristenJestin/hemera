/**
 * The Discuss conversations of Planning (#87): the user and the Planner on one item of the Spec,
 * opened and closed by the user only, read later from the item and from the Decisions entry that
 * links it. The Planning page (#103) reads them here; nothing here is a screen.
 */

import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { UnknownMission } from './missions.ts'
import { PlanningRefused } from './planning.ts'
import { StorageFailed } from './profile.ts'

/** What a discussion can be on: a question (#86), a section, a requirement, a scenario, a decision. */
export const DISCUSSION_ITEM_KINDS = [
  'question',
  'section',
  'requirement',
  'scenario',
  'decision',
] as const

/** The item a discussion is on: a section by its name, the others by their id (`R3`, `R3.S1`). */
export const DiscussionItem = Schema.Struct({
  kind: Schema.Literals(DISCUSSION_ITEM_KINDS),
  id: Schema.String,
})
export type DiscussionItem = typeof DiscussionItem.Type

export const DiscussionMessage = Schema.Struct({
  author: Schema.Literals(['user', 'agent']),
  text: Schema.String,
  /** Whether it is the agent proposing a decision. */
  proposal: Schema.Boolean,
  at: Schema.String,
})
export type DiscussionMessage = typeof DiscussionMessage.Type

export const Discussion = Schema.Struct({
  id: Schema.String,
  missionId: Schema.String,
  number: Schema.Number,
  /** `#12`: what the user and the Planner call it. */
  label: Schema.String,
  item: DiscussionItem,
  state: Schema.Literals(['open', 'closed']),
  outcome: Schema.NullOr(Schema.Literals(['decision', 'no_decision'])),
  decision: Schema.NullOr(Schema.String),
  /** The agent's pending proposal, a decision in transit; none once closed. */
  proposal: Schema.NullOr(Schema.Struct({ text: Schema.String, at: Schema.String })),
  closedBy: Schema.NullOr(Schema.Literal('user')),
  closedAt: Schema.NullOr(Schema.String),
  openedAt: Schema.String,
  /** Who an open discussion waits on (the ball); null once closed. */
  waitsOn: Schema.NullOr(Schema.Literals(['user', 'agent'])),
  /**
   * Why the Planner failed, when the user spoke last and the last Planner failed with none live
   * since: the discussion then waits on the user, not on an agent at work.
   */
  plannerFailed: Schema.NullOr(Schema.String),
  /** Every message, oldest first. */
  messages: Schema.Array(DiscussionMessage),
})
export type Discussion = typeof Discussion.Type

/** How the user closes a discussion: on a decision they write, or without one. */
export const DiscussionClosing = Schema.Union([
  Schema.Struct({ decision: Schema.String }),
  Schema.Struct({ noDecision: Schema.Literal(true) }),
])
export type DiscussionClosing = typeof DiscussionClosing.Type

export class UnknownDiscussion extends Schema.TaggedError<UnknownDiscussion>()(
  'UnknownDiscussion',
  { id: Schema.String },
) {
  override get message(): string {
    return 'This discussion no longer exists.'
  }
}

const always = [StorageFailed, EngineGone] as const

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const ofDiscussion = { discussionId: Schema.String }

export const DiscussionsRpcs = RpcGroup.make(
  /** A mission's discussions, open and closed, in the order opened. */
  Rpc.make('discussions.list', {
    payload: { missionId: Schema.String },
    success: Schema.Array(Discussion),
    error: failing(...always, UnknownMission),
  }),
  Rpc.make('discussions.read', {
    payload: ofDiscussion,
    success: Discussion,
    error: failing(...always, UnknownDiscussion),
  }),
  /** Opens a discussion on an item with the user's first message, delivered to the Planner. */
  Rpc.make('discussions.open', {
    payload: { missionId: Schema.String, item: DiscussionItem, text: Schema.String },
    success: Discussion,
    error: failing(...always, UnknownMission, PlanningRefused),
  }),
  /** The user's next message, delivered to the Planner. */
  Rpc.make('discussions.say', {
    payload: { ...ofDiscussion, text: Schema.String },
    success: Discussion,
    error: failing(...always, UnknownDiscussion, UnknownMission, PlanningRefused),
  }),
  /**
   * Closes it on the agent's pending proposal, as written: the one the user read, named by when it
   * was proposed; refused when another was proposed since.
   */
  Rpc.make('discussions.accept', {
    payload: { ...ofDiscussion, proposedAt: Schema.String },
    success: Discussion,
    error: failing(...always, UnknownDiscussion, UnknownMission, PlanningRefused),
  }),
  /** Closes it on a decision the user writes, or without a decision. */
  Rpc.make('discussions.close', {
    payload: { ...ofDiscussion, closing: DiscussionClosing },
    success: Discussion,
    error: failing(...always, UnknownDiscussion, UnknownMission, PlanningRefused),
  }),
  /** The mission's discussions now, then again after each change, while the caller listens. */
  Rpc.make('discussions.changed', {
    payload: { missionId: Schema.String },
    success: Schema.Array(Discussion),
    error: failing(...always, UnknownMission),
    stream: true,
  }),
)
