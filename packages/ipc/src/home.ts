/**
 * What Home shows of coming back: what happened since the user last looked, the missions opened
 * last, and the last line of a mission's Journal. The cursor of "since you left" and the missions
 * opened are the engine's, so a second window would read the same Home.
 */

import { Ball } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { Mission, UnknownMission } from './missions.ts'
import { StorageFailed } from './profile.ts'
import { LastJournalLine } from './start.ts'

/** How an event reads in "Since you left": the mark that opens its line. */
export const SinceTone = Schema.Literals(['failed', 'done', 'ticket', 'lifted', 'answer', 'info'])
export type SinceTone = typeof SinceTone.Type

/** One event worth telling, in words and never in the engine's vocabulary. */
export const SinceEvent = Schema.Struct({
  /** The sequence of the domain event it comes from. */
  sequence: Schema.Number,
  tone: SinceTone,
  text: Schema.String,
  /** When it happened, ISO. */
  at: Schema.String,
})
export type SinceEvent = typeof SinceEvent.Type

/** The events of one mission, or of a Project itself when `missionId` is null. */
export const SinceGroup = Schema.Struct({
  projectId: Schema.String,
  /** Null: an event of the Project itself. */
  missionId: Schema.NullOr(Schema.String),
  missionKey: Schema.NullOr(Schema.String),
  /** The mission's title, or the Project's name. */
  title: Schema.String,
  ball: Schema.NullOr(Ball),
  /** Newest first. */
  events: Schema.Array(SinceEvent),
})
export type SinceGroup = typeof SinceGroup.Type

/** A page of "Since you left": a group per mission, ordered by its newest event. */
export const SincePage = Schema.Struct({
  groups: Schema.Array(SinceGroup),
  /** The cursor of the next, older page; null when there is no more. */
  before: Schema.NullOr(Schema.Number),
})
export type SincePage = typeof SincePage.Type

/** The last line of a mission's Journal, or null when it has none yet. */
export const JournalTail = Schema.Struct({
  missionId: Schema.String,
  line: Schema.NullOr(LastJournalLine),
})
export type JournalTail = typeof JournalTail.Type

const always = Schema.Union([StorageFailed, EngineGone])

/**
 * Home's reads. `home.sinceYouLeftChanged` answers the first page, then again after each event
 * worth telling; `home.looked` moves the cursor to the latest event; `home.recent` is at most
 * eight missions, the last opened first.
 */
export const HomeRpcs = RpcGroup.make(
  Rpc.make('home.sinceYouLeft', {
    payload: { before: Schema.NullOr(Schema.Number) },
    success: SincePage,
    error: always,
  }),
  Rpc.make('home.sinceYouLeftChanged', { success: SincePage, error: always, stream: true }),
  Rpc.make('home.looked', { success: Schema.Void, error: always }),
  Rpc.make('home.recent', { success: Schema.Array(Mission), error: always }),
  Rpc.make('home.opened', {
    payload: { missionId: Schema.String },
    success: Schema.Void,
    error: Schema.Union([StorageFailed, EngineGone, UnknownMission]),
  }),
  /** The last Journal line of each mission named, in one read. */
  Rpc.make('memory.journalTail', {
    payload: { missionIds: Schema.Array(Schema.String) },
    success: Schema.Array(JournalTail),
    error: always,
  }),
)
