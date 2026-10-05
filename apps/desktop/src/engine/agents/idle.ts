/**
 * Idle release: an agent's process with no turn running and no request of its own waiting on
 * Hemera is let go once it has been idle for five minutes, by a sweep every minute.
 *
 * Letting a process go is not ending its session: the runtime resumes the session at the next
 * prompt, and re-applies the options chosen for it. The clock is Effect's, so a test moves it.
 */

import { Clock, Context, Duration, Effect, Layer, Schedule } from 'effect'

/** How long an agent's process may stay idle before it is let go. */
export const IDLE_AFTER = Duration.minutes(5)

/** How often the idle processes are looked at. */
export const SWEEP_EVERY = Duration.minutes(1)

/** A process the pool holds: whether it is busy now, and how it is let go. */
export interface Held {
  /** A turn runs, or a request of its own waits on Hemera. */
  readonly busy: () => boolean
  readonly release: Effect.Effect<void>
}

export class IdleAgents extends Context.Service<
  IdleAgents,
  {
    /** Holds a process, idle from now. */
    readonly hold: (id: string, held: Held) => Effect.Effect<void>
    /** The process did something: its five minutes start again. */
    readonly touch: (id: string) => Effect.Effect<void>
    /** The process is gone another way (it died, it was stopped): the pool forgets it. */
    readonly drop: (id: string) => Effect.Effect<void>
  }
>()('IdleAgents') {}

/** The pool, and its sweep every minute for as long as its scope lasts. */
export const idleAgentsLayer = Layer.effect(
  IdleAgents,
  Effect.gen(function* () {
    const held = new Map<string, Held & { idleSince: number }>()
    const sweep = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      for (const [id, one] of [...held]) {
        if (one.busy()) {
          one.idleSince = now
          continue
        }
        if (now - one.idleSince < Duration.toMillis(IDLE_AFTER)) continue
        held.delete(id)
        yield* one.release
      }
    })
    yield* sweep.pipe(
      Effect.delay(SWEEP_EVERY),
      Effect.repeat(Schedule.spaced(SWEEP_EVERY)),
      Effect.forkScoped,
    )
    return {
      hold: (id, one) =>
        Effect.map(Clock.currentTimeMillis, (now) => {
          held.set(id, { ...one, idleSince: now })
        }),
      touch: (id) =>
        Effect.map(Clock.currentTimeMillis, (now) => {
          const one = held.get(id)
          if (one !== undefined) one.idleSince = now
        }),
      drop: (id) =>
        Effect.sync(() => {
          held.delete(id)
        }),
    }
  }),
)
