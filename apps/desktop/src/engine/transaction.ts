/**
 * The one way a change is written down.
 *
 * A mutation writes its state and the events that describe it, or neither: `mutate` takes a body
 * that hands back both, and they go into the same transaction. Once it has committed, the events
 * are told to whoever follows them, in sequence order.
 *
 * Nothing outside the database happens in a transaction: no agent, Git, shell or network call.
 * Such a call goes through `outsideTransaction`, which refuses to run inside one, so the
 * transaction is rolled back rather than held open on the world.
 */

import { StaleVersion } from '@hemera/ipc'
import { Context, Effect, Predicate, Schema, Semaphore } from 'effect'

import { DomainEvents } from './domain-events.ts'
import { type DomainEvent, type NewEvent, record } from './journal.ts'
import {
  Database,
  type DatabaseError,
  type EngineTransaction,
  refusedWhile,
} from './storage/database.ts'

/** Defined with the links, so a refused edit reaches a screen as itself. */
export { StaleVersion }

/** Something that leaves the database was asked for while a transaction was open. */
export class SideEffectInTransaction extends Schema.TaggedError<SideEffectInTransaction>()(
  'SideEffectInTransaction',
  { what: Schema.String },
) {
  override get message(): string {
    return `Hemera refused to ${this.what} while it was writing to the data folder.`
  }
}

/** Whether the fiber is inside the body of a `mutate`. */
const InTransaction = Context.Reference<boolean>('InTransaction', { defaultValue: () => false })

/**
 * A call that leaves the database (an agent, Git, a shell, the network), refused inside a
 * transaction. `what` says what it is, as a verb: "start an agent".
 */
export const outsideTransaction = <A, E, R>(
  what: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | SideEffectInTransaction, R> =>
  Effect.gen(function* () {
    if (yield* InTransaction) return yield* new SideEffectInTransaction({ what })
    return yield* effect
  })

/** A failure of the client or of the query builder, rather than one the body raised. */
const isDriverFailure = <E>(error: E): boolean =>
  Predicate.isTagged(error, 'SqlError') || Predicate.isTagged(error, 'EffectDrizzleQueryError')

/** What a mutation hands back: what the caller asked for, and what the journal is to say. */
export interface Mutation<A> {
  readonly result: A
  readonly events: ReadonlyArray<NewEvent>
}

/**
 * One transaction and its publication at a time: two mutations that commit one after the other
 * are told in that order, which is the order of their sequences.
 */
const writing = Semaphore.makeUnsafe(1)

/**
 * Runs what must not overlap a transaction, such as the copy of the database a backup takes:
 * between two mutations, never during one.
 */
export const betweenMutations = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Semaphore.withPermits(writing, 1)(effect)

/**
 * Runs a change and its events as one transaction, then tells the events. The events are written
 * after the body, so they can name what the body has just decided.
 */
export function mutate<A, E, R>(
  doing: string,
  body: (transaction: EngineTransaction) => Effect.Effect<Mutation<A>, E, R>,
): Effect.Effect<A, E | DatabaseError, R | Database | DomainEvents> {
  return Effect.gen(function* () {
    const database = yield* Database
    const events = yield* DomainEvents
    const [result, committed] = yield* database
      .transaction((transaction) =>
        Effect.gen(function* () {
          const mutation = yield* body(transaction)
          const written: ReadonlyArray<DomainEvent> = yield* record(transaction, mutation.events)
          return [mutation.result, written] as const
        }).pipe(Effect.provideService(InTransaction, true)),
      )
      .pipe(
        // The driver's own failure becomes the one the engine speaks. What the body raised
        // (a stale version, a refused side effect) is not caught and arrives as itself.
        Effect.mapError((error) => (isDriverFailure(error) ? refusedWhile(doing)(error) : error)),
      )
    yield* events.committed(committed)
    return result
  }).pipe(Semaphore.withPermits(writing, 1))
}

/**
 * The write of a versioned record, refused when the version it was read at is no longer the
 * current one. `write` is an update that matches the expected version and returns the rows it
 * changed: none means someone else wrote first.
 */
export const atVersion =
  (entity: string, id: string, expected: number) =>
  <A, E, R>(write: Effect.Effect<ReadonlyArray<A>, E, R>): Effect.Effect<A, E | StaleVersion, R> =>
    Effect.flatMap(write, ([changed]) =>
      changed === undefined
        ? Effect.fail(new StaleVersion({ entity, id, expected }))
        : Effect.succeed(changed),
    )
