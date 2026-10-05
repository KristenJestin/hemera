/**
 * Now: where a mission stands.
 *
 * Hemera's fields (the stage, the marks, who has the ball, what waits on the user, the sub-agents
 * running) are computed from the records that own them and never stored as text an agent could
 * overwrite (CT-05). Each live session working on the mission owns one "doing" line, written by
 * that session alone at its current epoch and removed in the transaction that records its stop;
 * "next" is the stage's main session's alone. A write is the event `memory.now_set`, kept for its
 * history, which the Journal leaves out.
 */

import { type Masked, type NeedFields, ROLE_NAMES, mainRoleOf } from '@hemera/core/domain'
import type { Mission, Need, Now } from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Match } from 'effect'

import type { EventPayload, NewEvent } from '../journal.ts'
import { getMission } from '../missions.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { memoryNext, memoryNowLines } from '../storage/schema.ts'
import { RunningSessions } from './ports.ts'

/** What a need waits on, in one sentence of its own fields. */
export const needSentence = (need: Need): string =>
  Match.value(need.fields).pipe(
    Match.tagsExhaustive({
      Decision: (fields) => fields.question,
      Environment: (fields) => fields.missing,
      Error: (fields) => fields.failed,
      Permission: (fields) => fields.call,
    }),
  )

const needKind = Match.type<NeedFields>().pipe(
  Match.tagsExhaustive({
    Decision: () => 'decision',
    Environment: () => 'environment',
    Error: () => 'error',
    Permission: () => 'permission',
  }),
)

/** Now, as the mission and its sessions' lines stand. */
export const nowOf = (mission: Mission) =>
  Effect.gen(function* () {
    const database = yield* Database
    const lines = yield* database
      .select()
      .from(memoryNowLines)
      .where(eq(memoryNowLines.missionId, mission.id))
      .orderBy(asc(memoryNowLines.updatedAt))
      .pipe(Effect.mapError(refusedWhile('reading Now')))
    const [next] = yield* database
      .select()
      .from(memoryNext)
      .where(eq(memoryNext.missionId, mission.id))
      .pipe(Effect.mapError(refusedWhile('reading Now')))
    const running = yield* RunningSessions.use((sessions) => sessions(mission.id))
    const main = mainRoleOf(mission.stage)
    const doing = lines.map((line) => ({
      sessionId: line.sessionId,
      role: line.role,
      text: line.doing,
      main: line.role === main,
      updatedAt: line.updatedAt,
    }))
    return {
      missionId: mission.id,
      key: mission.key,
      stage: mission.stage,
      round: mission.round,
      marks: mission.marks.map((mark) => mark.sentence),
      ball: mission.ball,
      waiting: mission.needs.map((need) => ({
        needId: need.id,
        kind: needKind(need.fields),
        sentence: needSentence(need),
      })),
      running: running.map((session) => ({ sessionId: session.sessionId, role: session.role })),
      next:
        next === undefined
          ? null
          : {
              sessionId: next.sessionId,
              role: next.role,
              text: next.text,
              updatedAt: next.updatedAt,
            },
      // The main session's line first, then the others in the order they were written.
      doing: [...doing.filter((line) => line.main), ...doing.filter((line) => !line.main)],
    } satisfies Now
  })

export const readNow = (missionId: string) => Effect.flatMap(getMission(missionId), nowOf)

/** Who may set the next step of a mission now; the refusal of anyone else, in words. */
export const nextRefusal = (mission: Mission, role: string): string | null => {
  const main = mainRoleOf(mission.stage)
  if (main === null) {
    return `no session sets the next step of this mission while it is in ${mission.stage}`
  }
  return role === main ? null : `only ${ROLE_NAMES[main]} sets the next step of this mission`
}

export const capitalised = (text: string): string =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/** A session's write of Now, masked. */
export interface NowWrite {
  readonly missionId: string
  readonly sessionId: string
  readonly role: string
  readonly epoch: number
  readonly doing: Masked<string> | null
  readonly next: Masked<string> | null
}

/** Writes a session's own line and, when it is the main session, the next step. */
export const writeNow = (transaction: EngineTransaction, write: NowWrite) =>
  Effect.gen(function* () {
    const at = new Date().toISOString()
    if (write.doing !== null) {
      const line = {
        role: write.role,
        epoch: write.epoch,
        doing: write.doing,
        updatedAt: at,
      }
      yield* transaction
        .insert(memoryNowLines)
        .values({ missionId: write.missionId, sessionId: write.sessionId, ...line })
        .onConflictDoUpdate({
          target: [memoryNowLines.missionId, memoryNowLines.sessionId],
          set: line,
        })
        .pipe(Effect.mapError(refusedWhile('writing Now')))
    }
    if (write.next !== null) {
      const next = {
        sessionId: write.sessionId,
        role: write.role,
        epoch: write.epoch,
        text: write.next,
        updatedAt: at,
      }
      yield* transaction
        .insert(memoryNext)
        .values({ missionId: write.missionId, ...next })
        .onConflictDoUpdate({ target: memoryNext.missionId, set: next })
        .pipe(Effect.mapError(refusedWhile('writing Now')))
    }
    const payload: EventPayload = {
      sessionId: write.sessionId,
      role: write.role,
      epoch: write.epoch,
      doing: write.doing,
      next: write.next,
    }
    const event: NewEvent = {
      type: 'memory.now_set',
      entityKind: 'mission',
      entityId: write.missionId,
      source: 'system',
      author: 'agent',
      payload,
    }
    return event
  })

/**
 * A session stopped: its "doing" lines go, in the transaction that records the stop. The role
 * sessions (#40) call this in their own transaction; it answers the missions whose Now changed.
 */
export const dropSessionLines = (transaction: EngineTransaction, sessionId: string) =>
  transaction
    .delete(memoryNowLines)
    .where(and(eq(memoryNowLines.sessionId, sessionId)))
    .returning({ missionId: memoryNowLines.missionId })
    .pipe(
      Effect.mapError(refusedWhile('removing a session from Now')),
      Effect.map((rows) => Array.from(new Set(rows.map((row) => row.missionId)))),
    )
