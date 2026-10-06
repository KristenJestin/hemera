/**
 * The role sessions as the database keeps them: one row each in `agent_sessions`, with the
 * lineage it belongs to, the lineage of its parent for a child, its depth, its epoch and its
 * state. Opening and ending one are transactions that write their event; ending one removes its
 * line from Now in the same transaction (#68), and its event carries the mission so the mission's
 * Memory files are written again.
 */

import {
  AGENT_PROVIDERS,
  type AgentProvider,
  SESSION_STATES,
  SETTING_LEVELS,
  type SessionState,
  type SettingLevel,
} from '@hemera/core/domain'
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import { dropSessionLines } from '../memory/index.ts'
import { Secrets } from '../secrets.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { agentSessions } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import type { ModelSetting } from './ports.ts'
import type { SessionOwner } from './roles.ts'

export interface RoleSession {
  readonly id: string
  readonly provider: AgentProvider
  readonly owner: SessionOwner
  readonly role: string
  readonly folder: string
  /** The same across the replacements of a session. */
  readonly lineage: string
  /** The lineage of the session that started this one, for a child; null otherwise. */
  readonly parent: string | null
  readonly depth: number
  readonly epoch: number
  readonly state: SessionState
  readonly stateReason: string | null
  readonly createdAt: string
  /** When its row last changed: for a session an engine left, about when it stopped. */
  readonly updatedAt: string
  readonly endedAt: string | null
  readonly chosen: {
    readonly model: string | null
    readonly effort: string | null
    readonly mode: string | null
  }
  /** The level of the cascade its agent and model came from; null when its opener named them. */
  readonly modelLevel: SettingLevel | null
}

/** The session asked for is not one Hemera knows. */
export class UnknownSession extends Schema.TaggedError<UnknownSession>()('UnknownSession', {
  id: Schema.String,
}) {
  override get message(): string {
    return 'This session no longer exists.'
  }
}

type Row = typeof agentSessions.$inferSelect

/** A state as the row keeps it; one this version does not know reads as failed. */
export const stateOf = (state: string): SessionState =>
  SESSION_STATES.find((one) => one === state) ?? 'failed'

export const ownerOf = (kind: string, id: string): SessionOwner =>
  kind === 'project' ? { kind: 'project', projectId: id } : { kind: 'mission', missionId: id }

export const ownerId = (owner: SessionOwner): string =>
  owner.kind === 'mission' ? owner.missionId : owner.projectId

export const sessionOf = (row: Row): RoleSession => ({
  id: row.id,
  provider: AGENT_PROVIDERS.find((one) => one === row.provider) ?? 'claude',
  owner: ownerOf(row.ownerKind, row.ownerId),
  role: row.role,
  folder: row.folder,
  lineage: row.lineage ?? row.id,
  parent: row.parentId,
  depth: row.depth,
  epoch: row.epoch,
  state: stateOf(row.state),
  stateReason: row.stateReason,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  endedAt: row.endedAt,
  chosen: { model: row.chosenModel, effort: row.chosenEffort, mode: row.chosenMode },
  modelLevel: SETTING_LEVELS.find((level) => level === row.modelLevel) ?? null,
})

const now = (): string => new Date().toISOString()

/** The mission a session's event names, so its Memory files are written again. */
const missionOf = (owner: SessionOwner): string | null =>
  owner.kind === 'mission' ? owner.missionId : null

/** An event of a session, carrying its mission and its role. */
export const sessionEvent = (
  type: string,
  session: Pick<RoleSession, 'id' | 'owner' | 'role' | 'lineage'>,
  more: Record<string, string | number | null> = {},
) => ({
  type,
  entityKind: 'session',
  entityId: session.id,
  source: 'system' as const,
  author: 'hemera' as const,
  payload: {
    missionId: missionOf(session.owner),
    projectId: session.owner.kind === 'project' ? session.owner.projectId : null,
    role: session.role,
    lineage: session.lineage,
    ...more,
  },
})

export interface SessionAsked {
  /** Its id, when its opener needed it before it was written; a new one otherwise. */
  readonly id?: string
  readonly provider: AgentProvider
  readonly owner: SessionOwner
  readonly role: string
  readonly folder: string
  /** The parent's lineage, for a child session. */
  readonly parent: { readonly lineage: string; readonly depth: number } | null
  /** The lineage it takes over, for a replacement; a new one otherwise. */
  readonly lineage?: string
  readonly epoch?: number
  readonly chosen?: RoleSession['chosen']
  readonly modelLevel?: SettingLevel | null
}

/** The row a new session is written as, inside a transaction. */
export const insertSession = (transaction: EngineTransaction, asked: SessionAsked) =>
  Effect.gen(function* () {
    // A UUID: the session's trace file is named after it, so it must be safe as a file name.
    const id = asked.id ?? crypto.randomUUID()
    const at = now()
    const [row] = yield* transaction
      .insert(agentSessions)
      .values({
        id,
        provider: asked.provider,
        ownerKind: asked.owner.kind,
        ownerId: ownerId(asked.owner),
        role: asked.role,
        folder: asked.folder,
        lineage: asked.lineage ?? id,
        parentId: asked.parent?.lineage ?? null,
        depth: asked.parent === null ? 0 : asked.parent.depth + 1,
        epoch: asked.epoch ?? 0,
        state: 'starting',
        chosenModel: asked.chosen?.model ?? null,
        chosenEffort: asked.chosen?.effort ?? null,
        chosenMode: asked.chosen?.mode ?? null,
        modelLevel: asked.modelLevel ?? null,
        createdAt: at,
        updatedAt: at,
      })
      .returning()
      .pipe(Effect.mapError(refusedWhile('opening a session')))
    if (row === undefined) return yield* Effect.die(new Error('the session was not written'))
    return sessionOf(row)
  })

/** A new session of a role, with its `session.opened` event. */
export const openSession = (asked: SessionAsked) =>
  mutate('opening a session', (transaction) =>
    Effect.map(insertSession(transaction, asked), (session) => ({
      result: session,
      events: [sessionEvent('session.opened', session, { parent: session.parent })],
    })),
  )

export const getSession = (id: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, id))
      .pipe(Effect.mapError(refusedWhile('reading a session')))
    if (row === undefined) return yield* new UnknownSession({ id })
    return sessionOf(row)
  })

/** Every session in one of these states, by depth then age: parents before their children. */
export const sessionsIn = (states: ReadonlyArray<SessionState>, owner?: SessionOwner) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(agentSessions)
      .where(
        and(
          inArray(agentSessions.state, [...states]),
          owner === undefined ? undefined : eq(agentSessions.ownerKind, owner.kind),
          owner === undefined ? undefined : eq(agentSessions.ownerId, ownerId(owner)),
        ),
      )
      .orderBy(asc(agentSessions.depth), asc(agentSessions.createdAt))
      .pipe(Effect.mapError(refusedWhile('reading the sessions')))
    return rows.map(sessionOf)
  })

/**
 * The agent, model and effort the cascade gives a session that has not started its agent yet,
 * with the level they came from: what a successor of its lineage starts on.
 */
export const applySetting = (sessionId: string, setting: ModelSetting) =>
  mutate('writing a session’s model', (transaction) =>
    transaction
      .update(agentSessions)
      .set({
        provider: setting.agent,
        chosenModel: setting.model,
        chosenEffort: setting.effort,
        modelLevel: setting.level,
        updatedAt: now(),
      })
      .where(eq(agentSessions.id, sessionId))
      .returning()
      .pipe(
        Effect.mapError(refusedWhile('writing a session’s model')),
        // Read a moment ago by its start: a session not there now is a defect.
        Effect.flatMap(([row]) =>
          row === undefined
            ? Effect.die(new UnknownSession({ id: sessionId }))
            : Effect.succeed({ result: sessionOf(row), events: [] }),
        ),
      ),
  )

/** The states a session never leaves. */
const FINAL_STATES = ['ended', 'replaced', 'failed'] as const

/** Writes a session's state, and why, masked; a session that ended keeps its end. */
export const writeState = (
  transaction: EngineTransaction,
  sessionId: string,
  state: SessionState,
  reason: string | null,
) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const ending = FINAL_STATES.some((one) => one === state)
    yield* transaction
      .update(agentSessions)
      .set({
        state,
        stateReason: reason === null ? null : secrets.mask(reason),
        // Left as it was unless the session ends now.
        endedAt: ending ? now() : undefined,
        updatedAt: now(),
      })
      .where(
        and(eq(agentSessions.id, sessionId), notInArray(agentSessions.state, [...FINAL_STATES])),
      )
      .pipe(Effect.mapError(refusedWhile('writing a session’s state')))
  })

/** A session's state outside any other change: `working`, `idle`, `stuck`. */
export const setState = (sessionId: string, state: SessionState, reason: string | null = null) =>
  mutate('writing a session’s state', (transaction) =>
    Effect.as(writeState(transaction, sessionId, state, reason), { result: undefined, events: [] }),
  )

/**
 * Ends a session inside a transaction: its state, its line in Now removed, and the
 * `session.stopped` event naming its mission, so the mission's Memory files are written again.
 */
export const endSession = (
  transaction: EngineTransaction,
  session: RoleSession,
  state: 'ended' | 'replaced' | 'failed',
  reason: string,
) =>
  Effect.gen(function* () {
    yield* writeState(transaction, session.id, state, reason)
    yield* dropSessionLines(transaction, session.id)
    return sessionEvent('session.stopped', session, { state, reason })
  })
