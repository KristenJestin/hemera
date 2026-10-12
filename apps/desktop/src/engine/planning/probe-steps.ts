/**
 * What each running Probe is doing (#206), and each running helper (#222): the title of its
 * session's latest tool call, as its thread writes it. It is kept in memory only, never in the
 * database: it says what a Probe does now, and a restart, which relaunches a running Probe, starts
 * it over with no step.
 *
 * The Probes and the helpers write it as their sessions act, under their own ids; the chips read
 * it, and follow its changes beside the mission's events.
 */

import { Context, Effect, Layer, PubSub, Stream } from 'effect'
import type { Scope } from 'effect'

export interface SteppedProbe {
  /** The Probe's id, or the helper's. */
  readonly probeId: string
  readonly missionId: string
}

export class ProbeSteps extends Context.Service<
  ProbeSteps,
  {
    /** A Probe's latest step, or null before its first call. */
    readonly of: (probeId: string) => Effect.Effect<string | null>
    readonly set: (probe: SteppedProbe, step: string) => Effect.Effect<void>
    /** Its step dropped, once the Probe is wiped. */
    readonly forget: (probeId: string) => Effect.Effect<void>
    /** The missions whose Probe's step changed, from the moment the subscription is taken. */
    readonly subscribe: Effect.Effect<Stream.Stream<string>, never, Scope.Scope>
  }
>()('ProbeSteps') {}

export const probeStepsLayer = Layer.effect(
  ProbeSteps,
  Effect.gen(function* () {
    const steps = new Map<string, string>()
    const changed = yield* PubSub.unbounded<string>()
    return {
      of: (probeId) => Effect.sync(() => steps.get(probeId) ?? null),
      set: ({ probeId, missionId }, step) =>
        Effect.suspend(() => {
          if (steps.get(probeId) === step) return Effect.void
          steps.set(probeId, step)
          return Effect.asVoid(PubSub.publish(changed, missionId))
        }),
      forget: (probeId) => Effect.sync(() => void steps.delete(probeId)),
      subscribe: Effect.map(PubSub.subscribe(changed), (subscription) =>
        Stream.fromSubscription(subscription),
      ),
    }
  }),
)
