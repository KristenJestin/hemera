/**
 * The role sessions as a window may read them, for diagnosis only: an owner's sessions, a
 * session's hidden thread, and, for a Project's settings, which instruction files each repository
 * holds and what each agent does with them. Nothing here writes, and no RPC of the engine sends
 * text to a mission's session (#40): the user speaks to a mission through its stages.
 */

import { AgentProvider, SessionState } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'

/** A session as its owner's list shows it. */
export const SessionSummary = Schema.Struct({
  id: Schema.String,
  provider: AgentProvider,
  role: Schema.String,
  lineage: Schema.String,
  /** The lineage of the session that started it, for a child. */
  parent: Schema.NullOr(Schema.String),
  depth: Schema.Number,
  epoch: Schema.Number,
  state: SessionState,
  /** Why it stuck, ended, was replaced or failed; masked. */
  stateReason: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
})
export type SessionSummary = typeof SessionSummary.Type

/** A line of a session's hidden thread, masked. */
export const ThreadLine = Schema.Struct({
  at: Schema.String,
  kind: Schema.Literals(['instructions', 'sent', 'said', 'tool', 'note', 'state']),
  text: Schema.String,
})
export type ThreadLine = typeof ThreadLine.Type

const InstructionFileName = Schema.Literals(['CLAUDE.md', 'AGENTS.md'])

/** A repository's instruction files, and what each agent does with them run bare. */
export const RepositoryInstructions = Schema.Struct({
  repository: Schema.String,
  files: Schema.Array(InstructionFileName),
  agents: Schema.Array(
    Schema.Struct({
      agent: AgentProvider,
      /** `itself`: it reads its file natively; `sent`: Hemera sends one; `none`: neither. */
      how: Schema.Literals(['itself', 'sent', 'none']),
      file: Schema.NullOr(InstructionFileName),
    }),
  ),
})
export type RepositoryInstructions = typeof RepositoryInstructions.Type

const failing = Schema.Union([StorageFailed, EngineGone])

export const SessionsRpcs = RpcGroup.make(
  /** An owner's sessions, every state, parents before their children. */
  Rpc.make('sessions.list', {
    payload: { ownerKind: Schema.Literals(['mission', 'project']), ownerId: Schema.String },
    success: Schema.Array(SessionSummary),
    error: failing,
  }),
  /** A session's hidden thread, oldest first: for diagnosis, never a conversation. */
  Rpc.make('sessions.thread', {
    payload: { id: Schema.String },
    success: Schema.Array(ThreadLine),
    error: failing,
  }),
  /** For a Project's settings: each repository's instruction files and each agent's way. */
  Rpc.make('sessions.instructionFiles', {
    payload: { projectId: Schema.String },
    success: Schema.Array(RepositoryInstructions),
    error: Schema.Union([StorageFailed, EngineGone, UnknownProject]),
  }),
)
