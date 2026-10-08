/**
 * The Probes of a mission in Planning (#89), as the Planning page reads them (#103): each one's
 * LiveChip (its number, its question, where it stands, whether it is stuck, when it started and
 * ended, what it found), one Probe whole (its report, what it captured, its evidence), and the
 * chips again at each change. There is no stop: a Probe ends on its own, and its mission's
 * leaving Planning wipes it.
 */

import { ProbeOutcome, ProbeReport, ProbeState } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { UnknownMission } from './missions.ts'
import { StorageFailed } from './profile.ts'
import { BaseFreshness } from './projects.ts'

/** A Probe as its LiveChip shows it. */
export const ProbeChip = Schema.Struct({
  id: Schema.String,
  missionId: Schema.String,
  number: Schema.Number,
  /** `#3`. */
  label: Schema.String,
  question: Schema.String,
  /** The scenario it serves (`R1.S2`), or null. */
  scenario: Schema.NullOr(Schema.String),
  state: ProbeState,
  /** Its session gave no sign in a turn for the stuck bound (#40) and has not since. */
  stuck: Schema.Boolean,
  startedAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(ProbeOutcome),
})
export type ProbeChip = typeof ProbeChip.Type

/** The commit a repository's worktree of a Probe was made from. */
export const ProbeBase = Schema.Struct({
  repository: Schema.String,
  commit: Schema.String,
  ref: Schema.String,
  freshness: BaseFreshness,
})
export type ProbeBase = typeof ProbeBase.Type

/**
 * A file the Probe created (`new`) or modified in its worktree, as it was at its report: its
 * content, masked, and its patch against the Probe's commit for a modified one. A file of a
 * sensitive place, or a binary one, keeps only its path and hash, with why its content was withheld.
 */
export const ProbeFile = Schema.Struct({
  repository: Schema.String,
  path: Schema.String,
  status: Schema.Literals(['new', 'modified', 'deleted']),
  sha256: Schema.String,
  content: Schema.NullOr(Schema.String),
  patch: Schema.NullOr(Schema.String),
  withheld: Schema.NullOr(Schema.String),
})
export type ProbeFile = typeof ProbeFile.Type

/** One Probe whole. */
export const ProbeDetail = Schema.Struct({
  ...ProbeChip.fields,
  brief: Schema.String,
  folder: Schema.String,
  bases: Schema.Array(ProbeBase),
  answer: Schema.NullOr(Schema.String),
  report: Schema.NullOr(ProbeReport),
  files: Schema.Array(ProbeFile),
  /** The evidence its report names. */
  evidence: Schema.Array(Schema.String),
  /** Why it failed, in words, or null. */
  failure: Schema.NullOr(Schema.String),
  /** Why its last wipe did not succeed, or null. */
  wipeError: Schema.NullOr(Schema.String),
})
export type ProbeDetail = typeof ProbeDetail.Type

export class UnknownProbe extends Schema.TaggedError<UnknownProbe>()('UnknownProbe', {
  id: Schema.String,
}) {
  override get message(): string {
    return 'This Probe does not exist.'
  }
}

const always = [StorageFailed, EngineGone] as const

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const ofMission = { missionId: Schema.String }

export const ProbesRpcs = RpcGroup.make(
  /** A mission's Probes, the first launched first. */
  Rpc.make('probes.list', {
    payload: ofMission,
    success: Schema.Array(ProbeChip),
    error: failing(...always, UnknownMission),
  }),
  Rpc.make('probes.read', {
    payload: { probeId: Schema.String },
    success: ProbeDetail,
    error: failing(...always, UnknownProbe),
  }),
  /** The mission's Probes now, then again at each change of one of them. */
  Rpc.make('probes.changed', {
    payload: ofMission,
    success: Schema.Array(ProbeChip),
    error: failing(...always, UnknownMission),
    stream: true,
  }),
)
