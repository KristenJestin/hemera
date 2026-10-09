/**
 * The cold reads of a mission in Planning (#91), as the Planning page (#103) reads them: each pass
 * with the Spec version it read and its findings with their fate, the chip of the running pass,
 * what changed since the last pass read the Spec, and whether the cold read is settled (#92).
 * "Another pass" and "dismiss" are the user's only gestures.
 */

import { ColdReadAsker, ColdReadSeverity, ColdReadState, FindingFate } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { UnknownMission } from './missions.ts'
import { PlanningRefused, SpecChange } from './planning.ts'
import { StorageFailed } from './profile.ts'

/** A finding of a pass, with what became of it. */
export const ColdReadFindingSeen = Schema.Struct({
  /** `C1.F2`. */
  id: Schema.String,
  severity: ColdReadSeverity,
  /** The Spec items it names: section names, `R2`, `R2.S1`, `T3`. */
  where: Schema.Array(Schema.String),
  text: Schema.String,
  /** The question a developer would ask, for a blocking finding on the Spec. */
  question: Schema.NullOr(Schema.String),
  /** Every item it names is a task: it is never put to the user as a question. */
  tasksOnly: Schema.Boolean,
  fate: FindingFate,
  /** The question it was asked as, once asked. */
  questionId: Schema.NullOr(Schema.String),
  /** What the Planner changed, once fixed. */
  fixedWhat: Schema.NullOr(Schema.String),
})
export type ColdReadFindingSeen = typeof ColdReadFindingSeen.Type

/** One pass: its LiveChip's fields (id, state, stuck, started), the version it read, its findings. */
export const ColdReadPass = Schema.Struct({
  id: Schema.String,
  missionId: Schema.String,
  number: Schema.Number,
  /** `C2`. */
  label: Schema.String,
  /** The Planning cycle it ran in. */
  cycle: Schema.Number,
  /** The Spec version it read: its findings are about that version. */
  specVersion: Schema.Number,
  requestedBy: ColdReadAsker,
  state: ColdReadState,
  /** Its session gave no sign in a turn for the stuck bound (#40) and has not since. */
  stuck: Schema.Boolean,
  askedAt: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  endedAt: Schema.NullOr(Schema.String),
  /** Why it failed, in words, or null. */
  failure: Schema.NullOr(Schema.String),
  findings: Schema.Array(ColdReadFindingSeen),
})
export type ColdReadPass = typeof ColdReadPass.Type

/** What the last pass read against the Spec now: "read version n, the Spec is at version m". */
export const ColdReadFreshness = Schema.Struct({
  /** The version the last finished pass read, or null when none finished. */
  readVersion: Schema.NullOr(Schema.Number),
  specVersion: Schema.Number,
  /** What changed after the version it read, in order. */
  changes: Schema.Array(SpecChange),
})
export type ColdReadFreshness = typeof ColdReadFreshness.Type

/** Whether the cold read lets the Freeze appear, and every reason it does not. */
export const ColdReadSettled = Schema.Struct({
  settled: Schema.Boolean,
  reasons: Schema.Array(Schema.String),
})
export type ColdReadSettled = typeof ColdReadSettled.Type

const always = [StorageFailed, EngineGone] as const

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const ofMission = { missionId: Schema.String }

export const ColdReadRpcs = RpcGroup.make(
  /** A mission's passes, the first first, each with its findings. */
  Rpc.make('coldRead.list', {
    payload: ofMission,
    success: Schema.Array(ColdReadPass),
    error: failing(...always, UnknownMission),
  }),
  /** The user asks for another pass: refused while one waits or runs, or before the first. */
  Rpc.make('coldRead.again', {
    payload: ofMission,
    success: ColdReadPass,
    error: failing(...always, UnknownMission, PlanningRefused),
  }),
  /** The user dismisses a finding; a question asked from it is withdrawn. */
  Rpc.make('coldRead.dismiss', {
    payload: { ...ofMission, findingId: Schema.String },
    success: Schema.Void,
    error: failing(...always, UnknownMission, PlanningRefused),
  }),
  Rpc.make('coldRead.freshness', {
    payload: ofMission,
    success: ColdReadFreshness,
    error: failing(...always, UnknownMission),
  }),
  Rpc.make('coldRead.settled', {
    payload: ofMission,
    success: ColdReadSettled,
    error: failing(...always, UnknownMission),
  }),
  /** The mission's passes now, then again at each change of the mission. */
  Rpc.make('coldRead.changed', {
    payload: ofMission,
    success: Schema.Array(ColdReadPass),
    error: failing(...always, UnknownMission),
    stream: true,
  }),
)
