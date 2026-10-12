/**
 * The helpers of a mission (#145), as the Building page reads them (#151), and its Prototypers as
 * the Planning page does (#222): each one's chip (a letter avatar with a stable colour, its name,
 * its state dot, whether it is stuck, its step), one helper whole (its brief and its result; its
 * hidden thread only for the developer settings), and the chips again at each change. There is no
 * stop: the system is autonomous. The one write is the user's verdict on a Prototyper's result,
 * before the Freeze.
 */

import { AvatarTone, HelperPlace, HelperState, PrototypeVerdict } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { UnknownMission } from './missions.ts'
import { PlanningRefused } from './planning.ts'
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
  /** While it runs, the title of its latest tool call (#206); null before its first, and once it ended. */
  step: Schema.NullOr(Schema.String),
  /** A Prototyper's result as the user judged it, or null until they do (#222). */
  verdict: Schema.NullOr(PrototypeVerdict),
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
  /** What the user said with their verdict, or null. */
  verdictNote: Schema.NullOr(Schema.String),
  judgedAt: Schema.NullOr(Schema.String),
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
  /**
   * The user's verdict on a Prototyper's result (#222), in Planning, once it handed it back; given
   * again, the latest stands. Refused for a free helper, a Prototyper still running or failed, and
   * outside Planning.
   */
  Rpc.make('helpers.judge', {
    payload: {
      helperId: Schema.String,
      verdict: PrototypeVerdict,
      note: Schema.NullOr(Schema.String),
    },
    success: Schema.Void,
    error: failing(...always, UnknownHelper, PlanningRefused),
  }),
  /** The mission's helpers now, then again at each change of one of them. */
  Rpc.make('helpers.changed', {
    payload: ofMission,
    success: Schema.Array(HelperChip),
    error: failing(...always, UnknownMission),
    stream: true,
  }),
)
