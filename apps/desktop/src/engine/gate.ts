/**
 * The automation gate: what every automation passes before it acts on the world — starting or
 * resuming an agent session, running a delivery step, executing an approved action, a ticket
 * synchronisation that writes.
 *
 * At a normal start it is open. After a restore it stays closed until the restored Profile has
 * been reconciled with the world. A closed gate makes an automation wait, never fail.
 */

import { Context, Effect, Latch, Layer } from 'effect'

export class AutomationGate extends Context.Service<
  AutomationGate,
  {
    /** Waits until the gate is open; returns at once when it is. */
    readonly pass: Effect.Effect<void>
    readonly open: Effect.Effect<void>
    readonly isOpen: Effect.Effect<boolean>
  }
>()('AutomationGate') {}

/** A gate that starts closed: the start opens it once it knows nothing is to reconcile. */
export const automationGateLayer = Layer.effect(
  AutomationGate,
  Effect.gen(function* () {
    const latch = yield* Latch.make(false)
    return {
      pass: latch.await,
      open: Effect.asVoid(latch.open),
      isOpen: Effect.sync(() => latch.isOpen()),
    }
  }),
)

/** An automation, held at the gate until it opens. */
export const throughGate = <A, E, R>(
  automation: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | AutomationGate> =>
  Effect.gen(function* () {
    yield* (yield* AutomationGate).pass
    return yield* automation
  })
