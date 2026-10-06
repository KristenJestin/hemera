/**
 * What the role sessions hand the parts built below them, through ports those parts declared:
 *
 * - the gate's `SessionNotes`: a session's urgent notes, taken and marked sent in one go;
 * - the approvals' `Delivery` (#71): a request's result stored as a delivery to the session's
 *   lineage that asked, once per request, then the dispatch rung;
 * - the Memory's `SessionEpochs` and `RunningSessions` (#68), read from the sessions' rows.
 *
 * And the drain of the results #71 queued for its owners before the sessions existed.
 */

import { isLiveSession } from '@hemera/core/domain'
import { and, eq, gt, inArray } from 'drizzle-orm'
import { Effect, Layer } from 'effect'

import type { DomainEvents } from '../domain-events.ts'
import { RunningSessions, SessionEpochs } from '../memory/index.ts'
import type { Secrets } from '../secrets.ts'
import { Delivery, type HandedResult } from '../permissions/delivery.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { agentSessions, permissionRequests, queuedDeliveries } from '../storage/schema.ts'
import { SessionNotes } from '../tools/ports.ts'
import { mutate } from '../transaction.ts'
import { markSent, storeDelivery } from './deliveries.ts'
import { SessionPost } from './post.ts'
import { addToThread } from './thread.ts'
import { ownerOf, sessionOf, stateOf } from './store.ts'

/** The gate's notes: each taken once, marked sent to the session before the answer leaves. */
export const sessionNotesLayer = Layer.effect(
  SessionNotes,
  Effect.gen(function* () {
    const post = yield* SessionPost
    const context = yield* Effect.context<Database | DomainEvents | Secrets>()
    return {
      take: (sessionId) =>
        Effect.gen(function* () {
          const notes = yield* post.take(sessionId)
          if (notes.length === 0) return []
          const sent = yield* mutate('handing notes over', (transaction) =>
            Effect.map(
              markSent(
                transaction,
                notes.map((note) => note.deliveryId),
                sessionId,
              ),
              (ids) => ({ result: ids, events: [] }),
            ),
          )
          const handed = notes.filter((note) => sent.includes(note.deliveryId))
          yield* Effect.forEach(handed, (note) => addToThread(sessionId, 'note', note.text), {
            discard: true,
          })
          return handed.map((note) => note.text)
        }).pipe(
          Effect.provide(context),
          // A note that could not be handed stays queued: the end of the turn sends it.
          Effect.orElseSucceed(() => []),
        ),
    }
  }),
)

/** The lineage of the session that asked a request, or null when it is gone. */
const lineageOfSession = (sessionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .pipe(Effect.mapError(refusedWhile('reading a session')))
    return row === undefined ? null : sessionOf(row).lineage
  })

/** The kind an approval's result travels under. */
const APPROVAL = 'approval'

/** A result stored as a delivery to the lineage that asked, once per request. */
const storeResult = (result: HandedResult, lineage: string | null, role: string | null = null) =>
  storeDelivery({
    id: `approval-${result.requestId}`,
    owner:
      result.owner.kind === 'mission'
        ? { kind: 'mission', missionId: result.owner.missionId }
        : { kind: 'project', projectId: result.owner.projectId },
    // A result reaches the lineage that asked, whichever session holds it; with no session known,
    // the role that asked.
    target: lineage === null ? { role: role ?? 'unknown' } : { lineage },
    kind: APPROVAL,
    body: result.text,
  })

/** #71's `Delivery`: the result reaches the lineage that asked, between its turns. */
export const sessionsDelivery = Layer.effect(
  Delivery,
  Effect.gen(function* () {
    const post = yield* SessionPost
    const context = yield* Effect.context<Database | DomainEvents | Secrets>()
    return {
      deliver: (result) =>
        Effect.gen(function* () {
          const lineage = yield* lineageOfSession(result.sessionId)
          yield* storeResult(result, lineage).pipe(
            Effect.catchTag('DeliveryKindRefused', Effect.die),
          )
          yield* post.ring
        }).pipe(Effect.provide(context)),
    }
  }),
)

/**
 * The results #71 queued for their owners before the sessions existed: each becomes a delivery to
 * the lineage of the session that asked, and leaves the queue, once.
 */
export const drainQueuedResults = Effect.gen(function* () {
  const database = yield* Database
  const rows = yield* database
    .select({
      requestId: queuedDeliveries.requestId,
      ownerKind: queuedDeliveries.ownerKind,
      ownerId: queuedDeliveries.ownerId,
      taskId: queuedDeliveries.taskId,
      number: queuedDeliveries.number,
      text: queuedDeliveries.text,
      sessionId: permissionRequests.sessionId,
      role: permissionRequests.role,
    })
    .from(queuedDeliveries)
    .leftJoin(permissionRequests, eq(permissionRequests.id, queuedDeliveries.requestId))
    .pipe(Effect.mapError(refusedWhile('reading the queued results')))
  for (const row of rows) {
    const owner = ownerOf(row.ownerKind, row.ownerId)
    const lineage = row.sessionId === null ? null : yield* lineageOfSession(row.sessionId)
    yield* storeResult(
      {
        requestId: row.requestId,
        number: row.number,
        owner:
          owner.kind === 'mission'
            ? { kind: 'mission', missionId: owner.missionId, taskId: row.taskId }
            : owner,
        sessionId: row.sessionId ?? '',
        text: row.text,
      },
      lineage,
      row.role,
    ).pipe(Effect.catchTag('DeliveryKindRefused', Effect.die))
    yield* mutate('draining a queued result', (transaction) =>
      transaction
        .delete(queuedDeliveries)
        .where(eq(queuedDeliveries.requestId, row.requestId))
        .pipe(
          Effect.mapError(refusedWhile('draining a queued result')),
          Effect.as({ result: undefined, events: [] }),
        ),
    )
  }
  return rows.length
})

/** The Memory's epochs, from the sessions' rows: a session that ended writes nothing more. */
export const sessionEpochsLayer = Layer.effect(
  SessionEpochs,
  Effect.gen(function* () {
    const database = yield* Database
    const read = (sessionId: string) =>
      database
        .select({ epoch: agentSessions.epoch, state: agentSessions.state })
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId))
        .pipe(
          Effect.map(([row]) => row),
          Effect.orElseSucceed(() => undefined),
        )
    return {
      current: (sessionId) => Effect.map(read(sessionId), (row) => row?.epoch ?? 0),
      isCurrent: (sessionId, epoch) =>
        Effect.map(read(sessionId), (row) => {
          if (row === undefined) return true
          const state = stateOf(row.state)
          return (isLiveSession(state) || state === 'stuck') && row.epoch === epoch
        }),
    }
  }),
)

/** The sub-agents of a mission running now: its live sessions below another. */
export const runningSessionsLayer = Layer.effect(
  RunningSessions,
  Effect.gen(function* () {
    const database = yield* Database
    return (missionId) =>
      database
        .select({ id: agentSessions.id, role: agentSessions.role })
        .from(agentSessions)
        .where(
          and(
            eq(agentSessions.ownerKind, 'mission'),
            eq(agentSessions.ownerId, missionId),
            gt(agentSessions.depth, 0),
            inArray(agentSessions.state, ['starting', 'working', 'idle', 'stuck']),
          ),
        )
        .pipe(
          Effect.map((rows) => rows.map((row) => ({ sessionId: row.id, role: row.role }))),
          Effect.orElseSucceed(() => []),
        )
  }),
)
