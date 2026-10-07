/**
 * Starting a mission from the Project's field (#84): search first, create last.
 *
 * `start.search` answers a stream the window interrupts when the user types again: the Project's
 * own missions first (the one the text opens at the head), then the choice to create, then the
 * remote tickets as their providers answer. It never creates anything. `start.create` is the one
 * way the field creates a mission, under the idempotency key of the user's choice. The field's
 * screen is #102's.
 */

import { CanonicalTicket, TicketReference } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { InvalidMissionIdea, Mission, TicketAlreadyLinked, UnknownMission } from './missions.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'

/** A remote ticket a provider found, and the mission of this Project already linked to it. */
export const TicketHit = Schema.Struct({
  provider: Schema.String,
  reference: TicketReference,
  canonical: CanonicalTicket,
  key: Schema.String,
  title: Schema.String,
  url: Schema.String,
  updatedAt: Schema.String,
  /** The key of the mission of this Project linked to it; null when none is. */
  linkedMission: Schema.NullOr(Schema.String),
})
export type TicketHit = typeof TicketHit.Type

/** The last line of a mission's Journal: when, and in which words. */
export const LastJournalLine = Schema.Struct({ at: Schema.String, text: Schema.String })

/**
 * A mission of this Project. `open` is the one the text names (its key, or the ticket linked to
 * it): choosing the field opens it rather than listing it.
 */
export const MissionFound = Schema.TaggedStruct('MissionFound', {
  mission: Mission,
  open: Schema.Boolean,
  last: Schema.NullOr(LastJournalLine),
})

export const TicketFound = Schema.TaggedStruct('TicketFound', { hit: TicketHit })

/** Something the search says once, in words: no provider for a reference, a provider unread. */
export const SearchNotice = Schema.TaggedStruct('SearchNotice', { sentence: Schema.String })

/**
 * What "Create a mission" would create: its provisional title, and the ticket the text is when it
 * is a reference no mission links. Sent with the local results; drawn last, never the default.
 */
export const CreateChoice = Schema.TaggedStruct('CreateChoice', {
  title: Schema.String,
  ticket: Schema.NullOr(TicketReference),
})

export const StartResult = Schema.Union([MissionFound, TicketFound, SearchNotice, CreateChoice])
export type StartResult = typeof StartResult.Type

/** The ticket a mission is created from, with its title when a provider answered it. */
export const StartTicket = Schema.Struct({
  reference: TicketReference,
  title: Schema.optionalKey(Schema.String),
})
export type StartTicket = typeof StartTicket.Type

/** The user's explicit choice: a sentence, a ticket, or both, and the mission it starts from. */
export const StartCreate = Schema.Struct({
  projectId: Schema.String,
  text: Schema.optionalKey(Schema.String),
  ticket: Schema.optionalKey(StartTicket),
  /** The mission this one is started from ("Start a mission from this"); stored as a link. */
  origin: Schema.optionalKey(Schema.String),
  /** The same key twice (a double click) creates one mission. */
  idempotencyKey: Schema.String.check(Schema.isNonEmpty()),
})
export type StartCreate = typeof StartCreate.Type

export const StartRpcs = RpcGroup.make(
  Rpc.make('start.search', {
    payload: { projectId: Schema.String, text: Schema.String },
    success: StartResult,
    error: Schema.Union([StorageFailed, EngineGone, UnknownProject]),
    stream: true,
  }),
  Rpc.make('start.create', {
    payload: StartCreate,
    success: Mission,
    error: Schema.Union([
      StorageFailed,
      EngineGone,
      UnknownProject,
      UnknownMission,
      InvalidMissionIdea,
      TicketAlreadyLinked,
    ]),
  }),
)
