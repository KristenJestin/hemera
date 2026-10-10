/**
 * Who runs a piece of work (CT-11): a lease names the lineage, the session holding the work now
 * and the epoch it holds it at. Reassigning it is one transaction that raises the epoch and names
 * the new session; the old session's token is revoked right after, so a call carrying the old
 * token never gets past the server, and one carrying the old epoch is refused. Two sessions never
 * hold the same work. Tasks (B3) are the first users.
 */

import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { ToolAccess } from '../tools/access.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { runnerLeases } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import type { RoleSession } from './store.ts'

export interface Lease {
  readonly workItem: string
  readonly lineage: string
  readonly sessionId: string
  readonly epoch: number
}

/** The lease of a piece of work, or null when nobody runs it. */
export const leaseOf = (workItem: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(runnerLeases)
      .where(eq(runnerLeases.workItem, workItem))
      .pipe(Effect.mapError(refusedWhile('reading a lease')))
    return row === undefined
      ? null
      : ({
          workItem: row.workItem,
          lineage: row.lineage,
          sessionId: row.sessionId,
          epoch: row.epoch,
        } satisfies Lease)
  })

/**
 * Names the session that runs a piece of work, inside a transaction a caller holds: a first lease
 * at epoch 0, or a reassignment that raises the epoch. The session that held it is handed back
 * with the lease, for its caller to revoke once the transaction is written.
 */
export const assignWorkIn = (
  transaction: EngineTransaction,
  workItem: string,
  session: RoleSession,
) =>
  Effect.gen(function* () {
    const [held] = yield* transaction
      .select()
      .from(runnerLeases)
      .where(eq(runnerLeases.workItem, workItem))
      .pipe(Effect.mapError(refusedWhile('reading a lease')))
    const next: Lease = {
      workItem,
      lineage: session.lineage,
      sessionId: session.id,
      epoch: held === undefined ? 0 : held.epoch + 1,
    }
    yield* transaction
      .insert(runnerLeases)
      .values({ ...next, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: runnerLeases.workItem,
        set: {
          lineage: next.lineage,
          sessionId: next.sessionId,
          epoch: next.epoch,
          updatedAt: new Date().toISOString(),
        },
      })
      .pipe(Effect.mapError(refusedWhile('writing a lease')))
    return {
      result: { lease: next, before: held?.sessionId ?? null },
      events: [
        {
          type: 'work.assigned',
          entityKind: 'work',
          entityId: workItem,
          source: 'system' as const,
          author: 'hemera' as const,
          payload: { sessionId: session.id, lineage: session.lineage, epoch: next.epoch },
        },
      ],
    }
  })

/**
 * Names the session that runs a piece of work: a first lease at epoch 0, or a reassignment that
 * raises the epoch. The session that held it is revoked once the lease is written.
 */
export const assignWork = (workItem: string, session: RoleSession) =>
  Effect.gen(function* () {
    const lease = yield* mutate('assigning a piece of work', (transaction) =>
      assignWorkIn(transaction, workItem, session),
    )
    if (lease.before !== null && lease.before !== session.id) {
      yield* ToolAccess.use((access) => access.revoke(lease.before ?? ''))
    }
    return lease.lease
  })

/** Whether a session at this epoch still holds the work. */
export const holdsWork = (workItem: string, sessionId: string, epoch: number) =>
  Effect.map(
    leaseOf(workItem),
    (lease) => lease !== null && lease.sessionId === sessionId && lease.epoch === epoch,
  )
