/**
 * The domain events, told once they are committed.
 *
 * Whoever follows the engine's changes (an RPC stream that pushes them to the window, a
 * projection that keeps a cursor) hears the events of a transaction after it has committed, never
 * inside it, in sequence order: nothing reacts to a change that was rolled back. A follower that
 * must hold across an engine that stops reads the journal from its cursor at its next start.
 */

import { Context, Effect, Layer, PubSub, Stream } from 'effect'
import type { Scope } from 'effect'

import type { DomainEvent } from './journal.ts'

export class DomainEvents extends Context.Service<
  DomainEvents,
  {
    /** The events a transaction has just committed, in sequence order. */
    readonly committed: (events: ReadonlyArray<DomainEvent>) => Effect.Effect<void>
    /** Every event committed from the moment the subscription is taken, for as long as it lasts. */
    readonly subscribe: Effect.Effect<Stream.Stream<DomainEvent>, never, Scope.Scope>
  }
>()('DomainEvents') {}

export const domainEventsLayer = Layer.effect(
  DomainEvents,
  Effect.gen(function* () {
    const hub = yield* PubSub.unbounded<DomainEvent>()
    return {
      committed: (events) => PubSub.publishAll(hub, events).pipe(Effect.asVoid),
      subscribe: Effect.map(PubSub.subscribe(hub), (subscription) =>
        Stream.fromSubscription(subscription),
      ),
    }
  }),
)
