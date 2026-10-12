/**
 * The helpers of a mission's Building (#145), as the Building page reads them (#151): each one's
 * chip (a letter avatar with a stable colour, its name, its state dot, whether it is stuck), one
 * helper whole (its brief and its result; its hidden thread only for the developer settings), and
 * the chips again at each change. There is no stop and no write: the system is autonomous.
 */

import { AvatarTone, HelperPlace, HelperState } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { UnknownMission } from './missions.ts'
import { StorageFailed } from './profile.ts'

/** A helper as its chip shows it. */
export const HelperChip = Schema.Struct({
  id: Schema.String,
  missionId: Schema.String,
  number: Schema.Number,
  /** `H2`. */
  label: Schema.String,
  /** The defined helper's name (`Prototyper`), or `Helper`. */
  name: Schema.String,
  /** The defined helper it runs, by its id, or null for a free one. */
  definition: Schema.NullOr(Schema.String),
  icon: Schema.String,
  /** The letter of its avatar. */
  letter: Schema.String,
  /** Its avatar's tone: the definition's, or read from its label for a free one. */
  tone: AvatarTone,
  depth: Schema.Number,
  /** The task it is tied to, or null. */
  task: Schema.NullOr(Schema.String),
  state: HelperState,
  /** Its session gave no sign in a turn for the stuck bound (#40) and has not since. */
  stuck: Schema.Boolean,
  startedAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
})
export type HelperChip = typeof HelperChip.Type

/** One line of a helper's hidden thread. */
export const HelperThreadLine = Schema.Struct({
  at: Schema.String,
  kind: Schema.String,
  text: Schema.String,
})

/** One helper whole. */
export const HelperDetail = Schema.Struct({
  ...HelperChip.fields,
  brief: Schema.String,
  place: HelperPlace,
  folder: Schema.String,
  writes: Schema.Boolean,
  /** Its result as its parent read it, once it is done. */
  result: Schema.NullOr(Schema.String),
  /** Why it failed, in words, or null. */
  failure: Schema.NullOr(Schema.String),
  /** Its sessions' hidden thread, oldest first: only when asked, from the developer settings. */
  thread: Schema.NullOr(Schema.Array(HelperThreadLine)),
})
export type HelperDetail = typeof HelperDetail.Type

export class UnknownHelper extends Schema.TaggedError<UnknownHelper>()('UnknownHelper', {
  id: Schema.String,
}) {
  override get message(): string {
    return 'This helper does not exist.'
  }
}

const always = [StorageFailed, EngineGone] as const

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const ofMission = { missionId: Schema.String }

export const HelpersRpcs = RpcGroup.make(
  /** A mission's helpers, the first launched first. */
  Rpc.make('helpers.list', {
    payload: ofMission,
    success: Schema.Array(HelperChip),
    error: failing(...always, UnknownMission),
  }),
  /** One helper; `thread` asks for its hidden thread too (the developer settings). */
  Rpc.make('helpers.read', {
    payload: { helperId: Schema.String, thread: Schema.Boolean },
    success: HelperDetail,
    error: failing(...always, UnknownHelper),
  }),
  /** The mission's helpers now, then again at each change of one of them. */
  Rpc.make('helpers.changed', {
    payload: ofMission,
    success: Schema.Array(HelperChip),
    error: failing(...always, UnknownMission),
    stream: true,
  }),
)
