/**
 * A mission's Memory, as the mission pages read it: Now, a page of the Journal, the Notes, the
 * evidence, and each change of the Memory as it happens. Nothing here writes the Memory: the
 * user's own entries arrive as the domain events of the tickets that own them.
 */

import { Ball, Stage } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { UnknownMission } from './missions.ts'
import { StorageFailed } from './profile.ts'

/** Who wrote a line, a note or an evidence: Hemera, the user, or an agent's session. */
export const HemeraAuthor = Schema.TaggedStruct('Hemera', {})
export const UserAuthor = Schema.TaggedStruct('User', {})
export const AgentAuthor = Schema.TaggedStruct('Agent', {
  role: Schema.String,
  sessionId: Schema.String,
})
export const MemoryAuthor = Schema.Union([HemeraAuthor, UserAuthor, AgentAuthor])
export type MemoryAuthor = typeof MemoryAuthor.Type

/** The structured fields of a Journal line: flat, plain values, masked. */
export const JournalFields = Schema.Record(
  Schema.String,
  Schema.Union([
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(Schema.String),
  ]),
)
export type JournalFields = typeof JournalFields.Type

/** What a Journal line names, by identifier. */
export const JournalRefs = Schema.Struct({
  need: Schema.NullOr(Schema.String),
  task: Schema.NullOr(Schema.String),
  run: Schema.NullOr(Schema.String),
  evidence: Schema.NullOr(Schema.String),
  session: Schema.NullOr(Schema.String),
})
export type JournalRefs = typeof JournalRefs.Type

/** One line of a mission's Journal; `sequence` is the number of the event that produced it. */
export const JournalLine = Schema.Struct({
  sequence: Schema.Number,
  missionId: Schema.String,
  at: Schema.String,
  /** What the line is about: `stage`, `mark`, `need`, `note`, `evidence`, `agent`… */
  kind: Schema.String,
  author: MemoryAuthor,
  text: Schema.String,
  fields: JournalFields,
  refs: JournalRefs,
})
export type JournalLine = typeof JournalLine.Type

/** A page of the Journal, newest first, and the cursor of the page before it, if any. */
export const JournalPage = Schema.Struct({
  lines: Schema.Array(JournalLine),
  /** What to pass as `before` to read further back; null at the first line. */
  before: Schema.NullOr(Schema.Number),
})
export type JournalPage = typeof JournalPage.Type

/** A session's own line of Now: what it is doing. */
export const NowDoing = Schema.Struct({
  sessionId: Schema.String,
  role: Schema.String,
  text: Schema.String,
  /** Whether it is the stage's main session, whose line comes first. */
  main: Schema.Boolean,
  updatedAt: Schema.String,
})
export type NowDoing = typeof NowDoing.Type

/** The mission's next step, as its stage's main session set it. */
export const NowNext = Schema.Struct({
  sessionId: Schema.String,
  role: Schema.String,
  text: Schema.String,
  updatedAt: Schema.String,
})
export type NowNext = typeof NowNext.Type

/** Something the mission waits on: a need of the user, by kind and in a sentence. */
export const NowWaiting = Schema.Struct({
  needId: Schema.String,
  kind: Schema.String,
  sentence: Schema.String,
})
export type NowWaiting = typeof NowWaiting.Type

/** A sub-agent running for the mission. */
export const NowRunning = Schema.Struct({ sessionId: Schema.String, role: Schema.String })
export type NowRunning = typeof NowRunning.Type

/**
 * Where a mission stands. Hemera's fields (stage, marks, ball, what waits, what runs) are computed
 * and no agent writes them; `doing` holds one line per live session, the main session's first.
 */
export const Now = Schema.Struct({
  missionId: Schema.String,
  key: Schema.String,
  stage: Stage,
  round: Schema.Number,
  /** The marks, as their sentences. */
  marks: Schema.Array(Schema.String),
  ball: Schema.NullOr(Ball),
  waiting: Schema.Array(NowWaiting),
  running: Schema.Array(NowRunning),
  /** A Hemera phase waiting for a free slot of the Project's cap, said as Now says it (#41). */
  slotWait: Schema.NullOr(Schema.String),
  next: Schema.NullOr(NowNext),
  doing: Schema.Array(NowDoing),
})
export type Now = typeof Now.Type

/** A note: numbered in its mission, and the number of the note that replaced it, if one did. */
export const MemoryNote = Schema.Struct({
  number: Schema.Number,
  missionId: Schema.String,
  text: Schema.String,
  topic: Schema.NullOr(Schema.String),
  author: MemoryAuthor,
  at: Schema.String,
  replacedBy: Schema.NullOr(Schema.Number),
})
export type MemoryNote = typeof MemoryNote.Type

/** One reference to a piece of evidence; the same content referenced twice is one file. */
export const EvidenceItem = Schema.Struct({
  id: Schema.String,
  missionId: Schema.String,
  sha256: Schema.String,
  size: Schema.Number,
  mediaType: Schema.String,
  name: Schema.String,
  /** What it is evidence of: a scenario, a check, a run, a Probe, a feedback item. */
  about: Schema.NullOr(Schema.String),
  author: MemoryAuthor,
  at: Schema.String,
})
export type EvidenceItem = typeof EvidenceItem.Type

/** A piece of evidence and its bytes. */
export const EvidenceFile = Schema.Struct({ item: EvidenceItem, bytes: Schema.Uint8Array })
export type EvidenceFile = typeof EvidenceFile.Type

/** A change of a mission's Memory: Now as it stands, and the Journal lines it added. */
export const MemoryChanged = Schema.Struct({
  missionId: Schema.String,
  now: Now,
  added: Schema.Array(JournalLine),
})
export type MemoryChanged = typeof MemoryChanged.Type

export class UnknownEvidence extends Schema.TaggedError<UnknownEvidence>()('UnknownEvidence', {
  id: Schema.String,
}) {
  override get message(): string {
    return 'This evidence is not kept with this mission.'
  }
}

const failing = Schema.Union([StorageFailed, EngineGone, UnknownMission])
const missionId = { missionId: Schema.String }

/** What the mission pages read of a mission's Memory. */
export const MemoryRpcs = RpcGroup.make(
  Rpc.make('memory.now', { payload: missionId, success: Now, error: failing }),
  /** A page of the Journal, newest first; `before` is the cursor of the page before. */
  Rpc.make('memory.journal', {
    payload: { ...missionId, before: Schema.NullOr(Schema.Number) },
    success: JournalPage,
    error: failing,
  }),
  /** The current notes, or every note with `all`, the replaced ones included. */
  Rpc.make('memory.notes', {
    payload: { ...missionId, all: Schema.Boolean },
    success: Schema.Array(MemoryNote),
    error: failing,
  }),
  Rpc.make('memory.evidenceList', {
    payload: { ...missionId, about: Schema.NullOr(Schema.String) },
    success: Schema.Array(EvidenceItem),
    error: failing,
  }),
  Rpc.make('memory.evidence', {
    payload: { ...missionId, id: Schema.String },
    success: EvidenceFile,
    error: Schema.Union([StorageFailed, EngineGone, UnknownMission, UnknownEvidence]),
  }),
  /** Each change of the mission's Memory, for as long as the caller listens. */
  Rpc.make('memory.changes', {
    payload: missionId,
    success: MemoryChanged,
    error: failing,
    stream: true,
  }),
)
