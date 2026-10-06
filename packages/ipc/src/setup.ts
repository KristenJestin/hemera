/**
 * The setup agent's cards, as the new-Project screen and the Project settings read and decide
 * them (#44): list a Project's cards (pending first), accept one, decline one, accept all, ask for
 * a new proposal, read where the setup session stands, and follow every change. The screen is #53.
 */

import { SetupCardState, SetupChange, SetupState } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'

export const SetupCard = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  /** The changes proposed in one call share it. */
  batch: Schema.String,
  change: SetupChange,
  /** The words on the card, in the Journal and to the agent: never a variable's value. */
  title: Schema.String,
  details: Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.String })),
  state: SetupCardState,
  /** Why the last click was refused, by the settings' use case; null otherwise. */
  refusal: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  decidedAt: Schema.NullOr(Schema.String),
})
export type SetupCard = typeof SetupCard.Type

/** Where the Project's setup session stands, and what that says in words. */
export const SetupStanding = Schema.Struct({
  state: SetupState,
  sentence: Schema.NullOr(Schema.String),
})
export type SetupStanding = typeof SetupStanding.Type

export class UnknownSetupCard extends Schema.TaggedError<UnknownSetupCard>()('UnknownSetupCard', {
  id: Schema.String,
}) {
  override get message(): string {
    return 'This card no longer exists.'
  }
}

/** A setup proposal asked for while one is being made, or one its session could not open. */
export class SetupRefused extends Schema.TaggedError<SetupRefused>()('SetupRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return `No setup proposal was started: ${this.reason}.`
  }
}

const failing = Schema.Union([StorageFailed, EngineGone])
const failingProject = Schema.Union([StorageFailed, EngineGone, UnknownProject])
const failingCard = Schema.Union([StorageFailed, EngineGone, UnknownSetupCard])

export const SetupRpcs = RpcGroup.make(
  Rpc.make('setup.cards', {
    payload: { projectId: Schema.String },
    success: Schema.Array(SetupCard),
    error: failingProject,
  }),
  /** Applies a card through the settings' use case; refused at the click, it stays pending. */
  Rpc.make('setup.accept', {
    payload: { cardId: Schema.String },
    success: SetupCard,
    error: failingCard,
  }),
  Rpc.make('setup.decline', {
    payload: { cardId: Schema.String },
    success: SetupCard,
    error: failingCard,
  }),
  /** Accepts the pending cards in the order proposed, stopping at the first refusal. */
  Rpc.make('setup.acceptAll', {
    payload: { projectId: Schema.String },
    success: Schema.Array(SetupCard),
    error: failingProject,
  }),
  /** Starts a setup proposal: when the Project is added, or when the user asks for a new one. */
  Rpc.make('setup.propose', {
    payload: { projectId: Schema.String },
    success: Schema.Void,
    error: Schema.Union([StorageFailed, EngineGone, UnknownProject, SetupRefused]),
  }),
  Rpc.make('setup.standing', {
    payload: { projectId: Schema.String },
    success: SetupStanding,
    error: failing,
  }),
  /** The Project whose cards or setup session changed. */
  Rpc.make('setup.changes', {
    success: Schema.Struct({ projectId: Schema.String }),
    error: failing,
    stream: true,
  }),
)
