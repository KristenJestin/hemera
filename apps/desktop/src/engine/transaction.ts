/**
 * The one way a change is written down (design D4-04).
 *
 * A mutation writes its state and the event that describes it, or it writes neither. That is not
 * a convention anybody has to remember: `mutate` takes a body that has to hand back both, so a
 * change without its provenance does not type, and the two go into the same transaction — a
 * failure anywhere inside leaves the data folder exactly as it was.
 *
 * Nothing outside the database happens in here. A folder is checked, a dialog is opened and a
 * command is run before `mutate` is called or after it has returned, never while a transaction
 * is held: a lock waiting on a human is a data folder nobody else can write to.
 */

import { Data, Effect } from 'effect'

import { type NewEvent, record } from './journal.ts'
import { Database, DatabaseError, type EngineTransaction } from './storage/database.ts'

/**
 * The change was made against a version of the entity that is no longer the current one.
 *
 * Refused rather than merged: two windows editing the same project both believed they started
 * from what was on screen, and the second one writing over the first would lose a change nobody
 * was told about.
 */
export class StaleVersionError extends Data.TaggedError('StaleVersionError')<{
  readonly entity: string
  readonly id: string
  readonly expected: number
}> {}

/** What a mutation hands back: what the caller asked for, and what the journal is to say. */
export interface Mutation<A> {
  readonly result: A
  readonly events: readonly NewEvent[]
}

/**
 * Runs a change and its events as one transaction.
 *
 * The events are written after the body, so they can name what the body has just decided — the
 * identifier of a project that did not exist when the transaction opened.
 */
export function mutate<A, E, R>(
  doing: string,
  body: (transaction: EngineTransaction) => Effect.Effect<Mutation<A>, E, R>,
): Effect.Effect<A, E | DatabaseError, R | Database> {
  return Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .transaction((transaction) =>
        Effect.gen(function* () {
          const mutation = yield* body(transaction)
          yield* record(transaction, mutation.events)
          return mutation.result
        }),
      )
      .pipe(
        // The driver's own failure becomes the one the engine speaks, so a caller sees a single
        // error for "the database refused". What the body raised — a stale version, a path
        // outside the root — is not caught here and arrives as itself.
        Effect.catchTag('SqlError', (cause) => Effect.fail(new DatabaseError({ doing, cause }))),
      )
  })
}
