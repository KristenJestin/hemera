/**
 * The agents that are live, and when one is let go of (D5-05).
 *
 * Each suite is named after the scenario of the issue's `Spec · agent-runtime` section that it
 * covers, and every one of them moves a clock by hand: what the pool does with five idle minutes
 * is the point, and waiting five minutes to find out is not a test. Nothing here starts an agent
 * — the release is a function the suite wrote, which is what the pool pulls the trigger on.
 */

import { Effect, Layer } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  Clock,
  IDLE_AFTER_MS,
  Pool,
  UnknownHeldAgentError,
  poolLayer,
} from '#engine/agents/pool.ts'

/** A clock a suite moves itself, and the minutes it can skip. */
function movedClock() {
  let at = 1_000_000
  return {
    now: Effect.sync(() => at),
    advance: (milliseconds: number): void => {
      at += milliseconds
    },
  }
}

/** Runs a program against the pool, with the time the suite moves. */
function ranWith<A, E>(
  clock: ReturnType<typeof movedClock>,
  program: Effect.Effect<A, E, Pool>,
): Promise<A> {
  return Effect.runPromise(
    // The clock is handed *into* the pool rather than merged beside it: the pool is what reads
    // the time, and a suite that moved the clock would otherwise not be moving the pool's.
    program.pipe(
      Effect.provide(Layer.provide(poolLayer, Layer.succeed(Clock, { now: clock.now }))),
    ),
  )
}

/** A release that records itself, which is how a suite sees the pool let an agent go. */
function releasing(into: string[], sessionId: string): Effect.Effect<void> {
  return Effect.sync(() => into.push(sessionId))
}

describe('Un agent inactif', () => {
  test('an idle agent is released', async () => {
    const clock = movedClock()
    const released: string[] = []

    await ranWith(
      clock,
      Effect.gen(function* () {
        const pool = yield* Pool
        yield* pool.held('session-1', releasing(released, 'session-1'))
        expect(yield* pool.live).toEqual(['session-1'])

        // A minute short of the timeout it is still held: idle is a duration, not an opinion.
        clock.advance(IDLE_AFTER_MS - 1)
        expect(yield* pool.sweep).toEqual([])
        expect(yield* pool.live).toEqual(['session-1'])

        clock.advance(1)
        expect(yield* pool.sweep).toEqual(['session-1'])
        expect(yield* pool.live).toEqual([])

        // And a sweep that found nothing lets go of nothing twice.
        expect(yield* pool.sweep).toEqual([])
      }),
    )

    expect(released).toEqual(['session-1'])
  })

  test('an agent that was just used is not released', async () => {
    const clock = movedClock()
    const released: string[] = []

    await ranWith(
      clock,
      Effect.gen(function* () {
        const pool = yield* Pool
        yield* pool.held('session-1', releasing(released, 'session-1'))

        clock.advance(IDLE_AFTER_MS - 1)
        yield* pool.used('session-1')
        clock.advance(1)

        // The five minutes before the use do not count: what is idle is an agent nothing has
        // talked to since, and this one was talked to a millisecond ago.
        expect(yield* pool.sweep).toEqual([])
        expect(yield* pool.live).toEqual(['session-1'])
      }),
    )

    expect(released).toEqual([])
  })
})

describe('Un agent en cours de travail', () => {
  test('a pending permission prevents release', async () => {
    const clock = movedClock()
    const released: string[] = []

    await ranWith(
      clock,
      Effect.gen(function* () {
        const pool = yield* Pool
        yield* pool.held('session-1', releasing(released, 'session-1'))
        // The question is waiting for the user, and the user may be at lunch.
        yield* pool.busy('session-1', true)

        clock.advance(IDLE_AFTER_MS * 4)
        expect(yield* pool.sweep).toEqual([])
        expect(yield* pool.live).toEqual(['session-1'])

        yield* pool.busy('session-1', false)
        expect(yield* pool.sweep).toEqual(['session-1'])
      }),
    )

    expect(released).toEqual(['session-1'])
  })

  test('a turn that is still running prevents release, and two of them both count', async () => {
    const clock = movedClock()
    const released: string[] = []

    await ranWith(
      clock,
      Effect.gen(function* () {
        const pool = yield* Pool
        yield* pool.held('session-1', releasing(released, 'session-1'))
        yield* pool.busy('session-1', true)
        yield* pool.busy('session-1', true)

        clock.advance(IDLE_AFTER_MS * 10)
        expect(yield* pool.sweep).toEqual([])

        // One of the two is done; the other is not, and the agent stays.
        yield* pool.busy('session-1', false)
        expect(yield* pool.sweep).toEqual([])

        yield* pool.busy('session-1', false)
        expect(yield* pool.sweep).toEqual(['session-1'])
      }),
    )

    expect(released).toEqual(['session-1'])
  })

  test('a release that fails still lets the Session go, rather than holding a dead agent', async () => {
    const clock = movedClock()

    const live = await ranWith(
      clock,
      Effect.gen(function* () {
        const pool = yield* Pool
        yield* pool.held('session-1', Effect.die('the connection was already gone'))
        clock.advance(IDLE_AFTER_MS)
        yield* pool.sweep
        return yield* pool.live
      }),
    )

    expect(live).toEqual([])
  })
})

describe('Un agent que le pool ne connaît pas', () => {
  test('saying a Session is busy when it has no agent is refused, naming it', async () => {
    const clock = movedClock()

    const refused = await ranWith(
      clock,
      Effect.flip(
        Effect.gen(function* () {
          const pool = yield* Pool
          yield* pool.busy('session-inconnue', true)
        }),
      ),
    )

    expect(refused).toBeInstanceOf(UnknownHeldAgentError)
    expect(refused.sessionId).toBe('session-inconnue')
  })

  test('a Session let go of by its caller is forgotten rather than swept twice', async () => {
    const clock = movedClock()
    const released: string[] = []

    const live = await ranWith(
      clock,
      Effect.gen(function* () {
        const pool = yield* Pool
        yield* pool.held('session-1', releasing(released, 'session-1'))
        yield* pool.forgotten('session-1')
        clock.advance(IDLE_AFTER_MS)
        expect(yield* pool.sweep).toEqual([])
        return yield* pool.live
      }),
    )

    expect(live).toEqual([])
    expect(released).toEqual([])
  })
})
