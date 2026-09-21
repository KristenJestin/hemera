/**
 * The agents that are running, and when one of them is let go (design D5-05).
 *
 * An agent is a process, and a process nobody is talking to is a process paying rent: this file
 * keeps the small book of what is live and answers which ones have been idle long enough to be
 * let go of. It holds no agent of its own — the runtime owns the connections, because it is the
 * runtime that routes what an agent says — and it holds the *release* the runtime gave it, which
 * is what its sweep pulls the trigger on.
 *
 * Two rules are the whole of it, and both are the design's: an agent is let go when it has been
 * idle long enough, and never while a turn is running or a question is waiting for an answer.
 * What makes that testable is the clock: the time is a port rather than `Date.now()`, so a suite
 * advances five minutes in a millisecond and reads what the sweep did, rather than waiting.
 */

import { Context, Data, Effect, Layer } from 'effect'

/** How long an agent may sit unused before it is let go of. */
export const IDLE_AFTER_MS = 5 * 60 * 1000

/** The time, as the pool reads it: a port, so that a suite can move it. */
export interface ClockService {
  readonly now: Effect.Effect<number>
}

export class Clock extends Context.Service<Clock, ClockService>()('PoolClock') {}

/** The clock of a running engine. */
export const clockLayer = Layer.succeed(Clock, { now: Effect.sync(() => Date.now()) })

/** Something about a Session's agent that the pool refuses to do. */
export class UnknownHeldAgentError extends Data.TaggedError('UnknownHeldAgentError')<{
  readonly sessionId: string
}> {}

/** One live agent, as the pool knows it. */
interface Entry {
  /** What lets this agent go: the runtime's own release, pulled when it is idle. */
  readonly release: Effect.Effect<void>
  /** When it was last used, in the clock's own time. */
  lastUsed: number
  /** How many things are in flight that must not be interrupted. */
  busy: number
}

export interface PoolService {
  /** Notes a live agent. A Session that already has one is not held twice. */
  readonly held: (sessionId: string, release: Effect.Effect<void>) => Effect.Effect<void>
  /** Notes that this Session was used just now: an agent in use is not idle. */
  readonly used: (sessionId: string) => Effect.Effect<void>
  /** Says whether a turn is running or a question is waiting, and counts both. */
  readonly busy: (sessionId: string, busy: boolean) => Effect.Effect<void, UnknownHeldAgentError>
  /** Forgets a Session the caller has already let go of, so the book stays true. */
  readonly forgotten: (sessionId: string) => Effect.Effect<void>
  /** Lets go of every agent idle long enough, and answers which ones it let go of. */
  readonly sweep: Effect.Effect<readonly string[]>
  /** Which Sessions have an agent running, oldest first. */
  readonly live: Effect.Effect<readonly string[]>
}

export class Pool extends Context.Service<Pool, PoolService>()('Pool') {}

export const poolLayer = Layer.effect(
  Pool,
  Effect.gen(function* () {
    const clock = yield* Clock
    const entries = new Map<string, Entry>()

    return {
      held: (sessionId, release) =>
        Effect.gen(function* () {
          if (entries.has(sessionId)) return
          const now = yield* clock.now
          entries.set(sessionId, { release, lastUsed: now, busy: 0 })
        }),

      used: (sessionId) =>
        Effect.gen(function* () {
          const entry = entries.get(sessionId)
          if (entry === undefined) return
          entry.lastUsed = yield* clock.now
        }),

      busy: (sessionId, busy) =>
        Effect.gen(function* () {
          const entry = entries.get(sessionId)
          if (entry === undefined) {
            return yield* Effect.fail(new UnknownHeldAgentError({ sessionId }))
          }
          entry.busy = Math.max(0, entry.busy + (busy ? 1 : -1))
        }),

      forgotten: (sessionId) =>
        Effect.sync(() => {
          entries.delete(sessionId)
        }),

      sweep: Effect.gen(function* () {
        const now = yield* clock.now
        const idle = [...entries.entries()].filter(
          ([, entry]) => entry.busy === 0 && now - entry.lastUsed >= IDLE_AFTER_MS,
        )
        for (const [sessionId, entry] of idle) {
          // Let go of before it is forgotten: a release that throws must not leave the book
          // saying an agent is live when it no longer is.
          entries.delete(sessionId)
          yield* entry.release.pipe(Effect.catchCause(() => Effect.void))
        }
        return idle.map(([sessionId]) => sessionId)
      }),

      live: Effect.sync(() => [...entries.keys()]),
    } satisfies PoolService
  }),
)
