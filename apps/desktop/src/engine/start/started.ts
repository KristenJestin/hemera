/**
 * `mission.started`: the engine event told once a new mission's creation has committed.
 *
 * It names the mission and nothing else; what the mission is, is read from the data folder, where
 * it is by then. It is told after the commit and never for a creation that was refused or rolled
 * back, nor for the second call of a double click. The Planner (#85) subscribes to it to start on
 * its own; until then nothing does and a new mission simply waits in Planning.
 *
 *   const starts = yield* MissionStarts.use((started) => started.subscribe)
 *   yield* starts.pipe(Stream.runForEach(({ missionId }) => …), Effect.forkScoped)
 *
 * Unlike a domain event it is not written down: a follower that must hold across a restart reads
 * the missions in Planning at its own start.
 */

import { Context, Effect, Layer, PubSub, Stream } from 'effect'
import type { Scope } from 'effect'

export interface MissionStarted {
  readonly missionId: string
}

export class MissionStarts extends Context.Service<
  MissionStarts,
  {
    /** Tells a creation that has committed. */
    readonly started: (event: MissionStarted) => Effect.Effect<void>
    /** Every mission started from the moment the subscription is taken, for as long as it lasts. */
    readonly subscribe: Effect.Effect<Stream.Stream<MissionStarted>, never, Scope.Scope>
  }
>()('MissionStarts') {}

export const missionStartsLayer = Layer.effect(
  MissionStarts,
  Effect.gen(function* () {
    const hub = yield* PubSub.unbounded<MissionStarted>()
    return {
      started: (event) => PubSub.publish(hub, event).pipe(Effect.asVoid),
      subscribe: Effect.map(PubSub.subscribe(hub), (subscription) =>
        Stream.fromSubscription(subscription),
      ),
    }
  }),
)
