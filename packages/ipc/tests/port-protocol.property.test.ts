/**
 * Whatever happens on a link, and in whatever order, an answer reaches the request that asked
 * for it and no other: calls, stream items, interruptions and a port closing, interleaved at
 * random over the two ports of a Node `MessageChannel`.
 */

import { MessageChannel } from 'node:worker_threads'

import { Cause, Effect, Exit, Fiber, Option, Schema, Stream } from 'effect'
import { Rpc, RpcClient, RpcGroup, RpcServer } from 'effect/rpc'
import * as fc from 'fast-check'
import { describe, expect, test } from 'vite-plus/test'

import {
  fromMessagePort,
  isConnectionClosed,
  makeClientProtocol,
  makeServerProtocol,
} from '../src/index.ts'

const Group = RpcGroup.make(
  Rpc.make('Echo', {
    payload: { value: Schema.Number, delay: Schema.Number },
    success: Schema.Number,
  }),
  Rpc.make('Range', {
    payload: { from: Schema.Number, count: Schema.Number },
    success: Schema.Number,
    stream: true,
  }),
)

const handlers = Group.toLayer({
  Echo: ({ value, delay }) => Effect.as(Effect.sleep(delay), value),
  Range: ({ from, count }) => Stream.range(from, from + count - 1),
})

type Step =
  | { readonly kind: 'call'; readonly value: number; readonly delay: number }
  | { readonly kind: 'stream'; readonly from: number; readonly count: number }
  | { readonly kind: 'interrupt'; readonly target: number }
  | { readonly kind: 'close'; readonly side: 'caller' | 'server' }

const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('call' as const),
      value: fc.integer(),
      delay: fc.integer({ min: 0, max: 5 }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('stream' as const),
      from: fc.integer({ min: -1000, max: 1000 }),
      count: fc.integer({ min: 1, max: 40 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant('interrupt' as const), target: fc.nat() }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('close' as const),
      side: fc.constantFrom('caller' as const, 'server' as const),
    }),
  },
)

/** What a request may legitimately end with: its own answer, its interruption, a closed link. */
const settledAsExpected = (
  exit: Exit.Exit<number | ReadonlyArray<number>, unknown>,
  expected: number | ReadonlyArray<number>,
) =>
  Exit.match(exit, {
    onSuccess: (value) => {
      expect(value).toEqual(expected)
      return true
    },
    onFailure: (cause) =>
      Cause.hasInterruptsOnly(cause) ||
      Option.exists(Cause.findErrorOption(cause), isConnectionClosed),
  })

const scenario = (steps: ReadonlyArray<Step>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { port1: callerPort, port2: serverPort } = new MessageChannel()
      const server = yield* makeServerProtocol
      server.accept(fromMessagePort(serverPort))
      yield* RpcServer.make(Group, { disableFatalDefects: true }).pipe(
        Effect.provide(handlers),
        Effect.provideService(RpcServer.Protocol, server.protocol),
        Effect.forkScoped,
      )
      const protocol = yield* makeClientProtocol(fromMessagePort(callerPort), 'the test server')
      const client = yield* RpcClient.make(Group).pipe(
        Effect.provideService(RpcClient.Protocol, protocol),
      )

      const requests: Array<{
        readonly fiber: Fiber.Fiber<number | ReadonlyArray<number>, unknown>
        readonly expected: number | ReadonlyArray<number>
      }> = []
      for (const next of steps) {
        if (next.kind === 'call') {
          const fiber = yield* Effect.forkChild(
            client.Echo({ value: next.value, delay: next.delay }),
          )
          requests.push({ fiber, expected: next.value })
        } else if (next.kind === 'stream') {
          const fiber = yield* Effect.forkChild(
            Stream.runCollect(client.Range({ from: next.from, count: next.count })),
          )
          requests.push({
            fiber,
            expected: Array.from({ length: next.count }, (_, index) => next.from + index),
          })
        } else if (next.kind === 'interrupt') {
          const target = requests[next.target % Math.max(requests.length, 1)]
          if (target !== undefined) yield* Fiber.interrupt(target.fiber)
        } else {
          ;(next.side === 'caller' ? callerPort : serverPort).close()
        }
        yield* Effect.yieldNow
      }

      for (const { fiber, expected } of requests) {
        const exit = yield* Fiber.await(fiber).pipe(
          Effect.timeoutOrElse({
            duration: '3 seconds',
            orElse: () => Effect.die(new Error('a request never settled')),
          }),
        )
        expect(settledAsExpected(exit, expected)).toBe(true)
      }
    }),
  )

describe('Answers on a link stay matched to their requests', () => {
  test('random interleavings of calls, stream items, interruptions and closures', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 30 }), (steps) =>
        Effect.runPromise(scenario(steps)),
      ),
      { numRuns: 60 },
    )
  }, 60_000)
})
