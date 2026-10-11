/**
 * The setup agent's cards, as the new-Project screen and the Project settings read and decide
 * them (#44): list a Project's cards (pending first), accept one, decline one, accept all, ask for
 * a new proposal, read where the setup session stands, and follow every change. The screen is #53.
 */

import { SetupCardState, SetupChange, SetupProposal, SetupState } from '@hemera/core/domain'
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
  /** What the user asked to change, while the agent answers it; kept once it revised the card. */
  discussion: Schema.NullOr(Schema.String),
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

/** An edit the settings would refuse, with their reason: nothing changed. */
export class SetupEditRefused extends Schema.TaggedError<SetupEditRefused>()('SetupEditRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason
  }
}

/**
 * A change the user wrote in the editor of a card, `from` the card it was (null for a line added).
 * A variable written without a value keeps the one its card held.
 */
export const EditedChange = Schema.Struct({
  from: Schema.NullOr(Schema.String),
  proposal: SetupProposal,
})
export type EditedChange = typeof EditedChange.Type

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
  /**
   * Replaces pending cards by what the user wrote in their place, checked as the agent's changes
   * are; the cards replaced are revised. Answers the Project's cards.
   */
  Rpc.make('setup.edit', {
    payload: { cardIds: Schema.Array(Schema.String), changes: Schema.Array(EditedChange) },
    success: Schema.Array(SetupCard),
    error: Schema.Union([StorageFailed, EngineGone, UnknownSetupCard, SetupEditRefused]),
  }),
  /**
   * Sends the user's words on pending cards to the setup agent, started again when none works; it
   * answers by revising them or not.
   */
  Rpc.make('setup.discuss', {
    payload: { cardIds: Schema.Array(Schema.String), note: Schema.String },
    success: Schema.Void,
    error: Schema.Union([StorageFailed, EngineGone, UnknownSetupCard, SetupRefused]),
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
