/**
 * The `Delivery` port: how the result of a request the user answered reaches the agent. It is
 * handed each result with its request number, keyed by the request, and must take the same request
 * once however often it is handed (an engine that stopped between the hand-over and its record
 * hands it again).
 *
 * The delivery into the live session of the task, or waking the session that ended its turn
 * waiting, is #40's. Until then the default keeps each result queued for its owner, once per
 * request, and #40 drains the queue. A replacement session reads the result in the Memory, from
 * the mission's `permission.result` event, whatever the delivery does.
 */

import { Context, Effect, Layer } from 'effect'

import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import { queuedDeliveries } from '../storage/schema.ts'
import type { Masked } from '@hemera/core/domain'

/** One result, as it is handed over. */
export interface HandedResult {
  readonly requestId: string
  readonly number: number
  readonly owner:
    | { readonly kind: 'mission'; readonly missionId: string; readonly taskId: string | null }
    | { readonly kind: 'project'; readonly projectId: string }
  /** The session that asked, for the record: a replacement session may take it instead. */
  readonly sessionId: string
  /** What the agent reads, masked. */
  readonly text: Masked<string>
}

export class Delivery extends Context.Service<
  Delivery,
  { readonly deliver: (result: HandedResult) => Effect.Effect<void, DatabaseError> }
>()('Delivery') {}

/** Until #40: the result waits in the queue of its owner, once per request. */
export const queuedDelivery = Layer.effect(
  Delivery,
  Effect.gen(function* () {
    const database = yield* Database
    return {
      deliver: (result) =>
        database
          .insert(queuedDeliveries)
          .values({
            requestId: result.requestId,
            ownerKind: result.owner.kind,
            ownerId:
              result.owner.kind === 'mission' ? result.owner.missionId : result.owner.projectId,
            taskId: result.owner.kind === 'mission' ? result.owner.taskId : null,
            number: result.number,
            text: result.text,
            queuedAt: new Date().toISOString(),
          })
          .onConflictDoNothing()
          .pipe(Effect.mapError(refusedWhile('queuing a result')), Effect.asVoid),
    }
  }),
)
