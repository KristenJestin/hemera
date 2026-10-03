/**
 * The ports main hands the engine, matched to the launches they belong to.
 *
 * A port cannot travel inside an RPC message, so main posts the port of a launch on the engine's
 * process port, beside the launch's own stream, with the launch's number. The two arrive in any
 * order: the port may be there before the launch asks for it, or after.
 */

import { Deferred, Effect } from 'effect'

export interface Handovers<P> {
  /** A port main handed over for `launch`. */
  readonly receive: (launch: number, port: P) => void
  /** The port of `launch`, once it is there; each is taken once. */
  readonly take: (launch: number) => Effect.Effect<P>
}

export function makeHandovers<P>(): Handovers<P> {
  const waiting = new Map<number, Deferred.Deferred<P>>()
  const slot = (launch: number): Deferred.Deferred<P> => {
    const existing = waiting.get(launch)
    if (existing !== undefined) return existing
    const created = Deferred.makeUnsafe<P>()
    waiting.set(launch, created)
    return created
  }
  return {
    receive: (launch, port) => {
      Deferred.doneUnsafe(slot(launch), Effect.succeed(port))
    },
    take: (launch) =>
      Effect.suspend(() => {
        const deferred = slot(launch)
        return Deferred.await(deferred).pipe(
          Effect.tap(() => Effect.sync(() => waiting.delete(launch))),
        )
      }),
  }
}
