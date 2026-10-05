/**
 * Missions and needs, as they cross the links: the records, the human moves, the answers, and the
 * refusals a screen is shown.
 *
 * A mission is read whole: its stage and round, whether its Spec is frozen, its marks with their
 * sentences, who has the ball, and the needs it owns that wait on the user. Needs you is read
 * across the Profile, grouped by owner: the application's first, then each Project's.
 */

import {
  Ball,
  InvalidKeyPrefix,
  Mark,
  MissionType,
  MoveRefused,
  NeedAnswer,
  NeedAnswerRefused,
  NeedFields,
  NeedOwner,
  NeedState,
  PermissionChoice,
  Stage,
} from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'

export { InvalidKeyPrefix, MoveRefused, NeedAnswerRefused }

/** A remote ticket a mission is linked to. */
export const TicketLink = Schema.Struct({
  provider: Schema.String,
  key: Schema.String,
  url: Schema.String,
})
export type TicketLink = typeof TicketLink.Type

/** What a mission started from: a sentence, a ticket reference, or both. */
export const MissionIdea = Schema.Struct({
  sentence: Schema.NullOr(Schema.String),
  ticket: Schema.NullOr(Schema.String),
})
export type MissionIdea = typeof MissionIdea.Type

/** A mark on a mission, and the sentence the interface says it with. */
export const MissionMark = Schema.Struct({
  id: Schema.String,
  mark: Mark,
  sentence: Schema.String,
  setAt: Schema.String,
})
export type MissionMark = typeof MissionMark.Type

export const Need = Schema.Struct({
  id: Schema.String,
  owner: NeedOwner,
  fields: NeedFields,
  /** The choices a permission need offers; empty for the other kinds. */
  choices: Schema.Array(PermissionChoice),
  /** The role of the agent that asked for it, or null when Hemera did. */
  requestedBy: Schema.NullOr(Schema.String),
  state: NeedState,
  answer: Schema.NullOr(NeedAnswer),
  /** Why it expired or was withdrawn. */
  endedReason: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
})
export type Need = typeof Need.Type

/** What is left once a mission is cancelled: its work, kept until the user confirms the cleanup. */
export const Cleanup = Schema.Literals(['awaiting-confirmation'])

export const Mission = Schema.Struct({
  /** Internal and immutable: every reference to the mission uses it. */
  id: Schema.String,
  projectId: Schema.String,
  /** Given at creation and never changed: `ACME-12`. */
  key: Schema.String,
  title: Schema.String,
  idea: MissionIdea,
  /** Information only: Hemera behaves the same for every type. */
  type: MissionType,
  ticketLink: Schema.NullOr(TicketLink),
  stage: Stage,
  /** The last review round, 0 before the first: Building · round N. */
  round: Schema.Number,
  frozen: Schema.Boolean,
  marks: Schema.Array(MissionMark),
  /** Who has the ball; null once Done or Cancelled. */
  ball: Schema.NullOr(Ball),
  /** The needs it owns that wait on the user, oldest first. */
  needs: Schema.Array(Need),
  cleanup: Schema.NullOr(Cleanup),
  /** What a cancel could not stop yet, by stopper; tried again at each start. */
  unstopped: Schema.Array(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export type Mission = typeof Mission.Type

/** A mission to create, in Planning: the type is a feature unless said. */
export const NewMission = Schema.Struct({
  projectId: Schema.String,
  idea: MissionIdea,
  type: Schema.optionalKey(MissionType),
  ticketLink: Schema.optionalKey(Schema.NullOr(TicketLink)),
})
export type NewMission = typeof NewMission.Type

/** The needs of one owner in Needs you: the application's (`projectId` null), or a Project's. */
export const NeedGroup = Schema.Struct({
  projectId: Schema.NullOr(Schema.String),
  needs: Schema.Array(Need),
})
export type NeedGroup = typeof NeedGroup.Type

/** An answer, under the key that makes it apply once however often it is sent. */
export const NeedAnswerAsked = Schema.Struct({
  id: Schema.String,
  answer: NeedAnswer,
  key: Schema.String,
})
export type NeedAnswerAsked = typeof NeedAnswerAsked.Type

export const MissionChanged = Schema.TaggedStruct('MissionChanged', { mission: Mission })
export const NeedChanged = Schema.TaggedStruct('NeedChanged', { need: Need })

/** A change the window follows: a mission as it now stands, or a need. */
export const MissionsChange = Schema.Union([MissionChanged, NeedChanged])
export type MissionsChange = typeof MissionsChange.Type

export class UnknownMission extends Schema.TaggedError<UnknownMission>()('UnknownMission', {
  id: Schema.String,
}) {
  override get message(): string {
    return 'This mission no longer exists.'
  }
}

export class UnknownNeed extends Schema.TaggedError<UnknownNeed>()('UnknownNeed', {
  id: Schema.String,
}) {
  override get message(): string {
    return 'This need no longer exists.'
  }
}

/** A mission needs an idea to start from: a sentence or a ticket reference. */
export class InvalidMissionIdea extends Schema.TaggedError<InvalidMissionIdea>()(
  'InvalidMissionIdea',
  { reason: Schema.String },
) {
  override get message(): string {
    return `This mission cannot start: ${this.reason}.`
  }
}

/** A prefix another Project holds, or one keys of another Project's missions still carry. */
export class KeyPrefixTaken extends Schema.TaggedError<KeyPrefixTaken>()('KeyPrefixTaken', {
  prefix: Schema.String,
}) {
  override get message(): string {
    return `${this.prefix} is already the key prefix of another Project’s missions.`
  }
}

const always = [StorageFailed, EngineGone] as const

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const missionId = { id: Schema.String }

const humanMove = <const Name extends string>(name: Name) =>
  Rpc.make(name, {
    payload: missionId,
    success: Mission,
    error: failing(...always, UnknownMission, MoveRefused),
  })

/**
 * The missions of a Project, one mission, its creation, and the user's moves. `changes` is each
 * mission and each need as a committed change left it, for as long as the caller listens.
 */
export const MissionsRpcs = RpcGroup.make(
  Rpc.make('missions.list', {
    payload: { projectId: Schema.String },
    success: Schema.Array(Mission),
    error: failing(...always, UnknownProject),
  }),
  Rpc.make('missions.get', {
    payload: missionId,
    success: Mission,
    error: failing(...always, UnknownMission),
  }),
  Rpc.make('missions.create', {
    payload: NewMission,
    success: Mission,
    error: failing(...always, UnknownProject, InvalidMissionIdea),
  }),
  humanMove('missions.freeze'),
  /** The user chooses to update the Spec: it is unfrozen until the next Freeze. */
  humanMove('missions.backToPlanning'),
  humanMove('missions.launch'),
  humanMove('missions.fix'),
  humanMove('missions.ship'),
  /** Stops everything the mission runs and keeps its work until the cleanup is confirmed. */
  humanMove('missions.cancel'),
  Rpc.make('missions.changes', {
    success: MissionsChange,
    error: failing(...always),
    stream: true,
  }),
)

/** Needs you: every pending need of the Profile, one need, its answer, and Retry. */
export const NeedsRpcs = RpcGroup.make(
  Rpc.make('needs.list', { success: Schema.Array(NeedGroup), error: failing(...always) }),
  Rpc.make('needs.get', {
    payload: missionId,
    success: Need,
    error: failing(...always, UnknownNeed),
  }),
  /** Answers once: a need that is no longer pending answers as it ended, and nothing is written. */
  Rpc.make('needs.answer', {
    payload: NeedAnswerAsked,
    success: Need,
    error: failing(...always, UnknownNeed, NeedAnswerRefused),
  }),
  /** Checks an environment need again; it is withdrawn when what was missing is there now. */
  Rpc.make('needs.retry', {
    payload: missionId,
    success: Need,
    error: failing(...always, UnknownNeed, NeedAnswerRefused),
  }),
)
