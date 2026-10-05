/**
 * Idle release: an agent's process with no turn running and no request of its own waiting on
 * Hemera is let go after five minutes, swept every minute, on a clock the test moves. Letting a
 * process go is not ending its session: the session is resumed at the next prompt.
 */

import { Duration, Effect } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, test } from 'vite-plus/test'

import { IdleAgents, idleAgentsLayer } from '../src/engine/agents/idle.ts'

/** A process held by the pool: busy or not as the test says, and released into `released`. */
const held = (released: string[], id: string, busy: { now: boolean }) =>
  IdleAgents.use((pool) =>
    pool.hold(id, {
      busy: () => busy.now,
      release: Effect.sync(() => void released.push(id)),
    }),
  )

const minutes = (count: number) => TestClock.adjust(Duration.minutes(count))

const inPool = <A, E>(program: Effect.Effect<A, E, IdleAgents>) =>
  Effect.runPromise(
    Effect.scoped(program.pipe(Effect.provide(idleAgentsLayer), Effect.provide(TestClock.layer()))),
  )

describe('An idle agent is let go after five minutes', () => {
  test('not before five minutes, and at the first sweep after them', () =>
    inPool(
      Effect.gen(function* () {
        const released: string[] = []
        yield* held(released, 'claude-1', { now: false })
        yield* minutes(4)
        expect(released).toEqual([])
        yield* minutes(1)
        expect(released).toEqual(['claude-1'])
      }),
    ))

  test('never while a turn runs or a request of its own waits, however long', () =>
    inPool(
      Effect.gen(function* () {
        const released: string[] = []
        const busy = { now: true }
        yield* held(released, 'codex-1', busy)
        yield* minutes(30)
        expect(released).toEqual([])
        busy.now = false
        yield* IdleAgents.use((pool) => pool.touch('codex-1'))
        yield* minutes(4)
        expect(released).toEqual([])
        yield* minutes(1)
        expect(released).toEqual(['codex-1'])
      }),
    ))

  test('activity starts the five minutes again', () =>
    inPool(
      Effect.gen(function* () {
        const released: string[] = []
        yield* held(released, 'opencode-1', { now: false })
        yield* minutes(4)
        yield* IdleAgents.use((pool) => pool.touch('opencode-1'))
        yield* minutes(4)
        expect(released).toEqual([])
        yield* minutes(1)
        expect(released).toEqual(['opencode-1'])
      }),
    ))

  test('a process dropped from the pool (it died, it was stopped) is never released by it', () =>
    inPool(
      Effect.gen(function* () {
        const released: string[] = []
        yield* held(released, 'claude-2', { now: false })
        yield* IdleAgents.use((pool) => pool.drop('claude-2'))
        yield* minutes(10)
        expect(released).toEqual([])
      }),
    ))
})
