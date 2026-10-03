/**
 * The behaviour every link of Hemera relies on, proven over the two ports of a Node
 * `MessageChannel`: one stands for the side that calls (a window, main), the other for the side
 * that serves (main, the engine). Electron's own ports are checked by the end-to-end suite.
 */

import { MessageChannel } from 'node:worker_threads'

import { Deferred, Effect, Exit, Fiber, Schema, Stream } from 'effect'
import type { Scope } from 'effect'
import { Rpc, RpcClient, RpcClientError, RpcGroup, RpcServer } from 'effect/rpc'
import { describe, expect, test } from 'vite-plus/test'

import {
  fromMessagePort,
  isConnectionClosed,
  makeClientProtocol,
  makeServerProtocol,
} from '../src/index.ts'

class Refused extends Schema.TaggedError<Refused>()('Refused', { reason: Schema.String }) {}

const groupWith = (badItem: Schema.Codec<number, number>) =>
  RpcGroup.make(
    Rpc.make('Greet', { payload: { name: Schema.String }, success: Schema.String, error: Refused }),
    Rpc.make('Count', { payload: { upTo: Schema.Number }, success: Schema.Number, stream: true }),
    Rpc.make('Hold', { success: Schema.Void }),
    Rpc.make('Slow', { payload: { millis: Schema.Number }, success: Schema.String }),
    Rpc.make('Ticks', { success: Schema.Number, stream: true }),
    Rpc.make('Bad', { success: badItem, stream: true }),
  )

const ServerGroup = groupWith(Schema.Number)
/** The caller's schema refuses items from 3 up: the fourth item of `Bad` does not decode. */
const ClientGroup = groupWith(Schema.Number.check(Schema.isLessThan(3)))

const setup = Effect.gen(function* () {
  const { port1: callerPort, port2: serverPort } = new MessageChannel()
  const probes = {
    holdStarted: yield* Deferred.make<void>(),
    holdInterrupted: yield* Deferred.make<void>(),
    ticksStopped: yield* Deferred.make<void>(),
    badStopped: yield* Deferred.make<void>(),
  }
  const handlers = ServerGroup.toLayer({
    Greet: ({ name }) =>
      name === ''
        ? Effect.fail(new Refused({ reason: 'empty name' }))
        : Effect.succeed(`hello ${name}`),
    Count: ({ upTo }) => Stream.range(1, upTo),
    Hold: () =>
      Deferred.succeed(probes.holdStarted, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() => Deferred.succeed(probes.holdInterrupted, undefined)),
      ),
    Slow: ({ millis }) => Effect.as(Effect.sleep(millis), 'done'),
    Ticks: () =>
      Stream.iterate(0, (n) => n + 1).pipe(
        Stream.ensuring(Deferred.succeed(probes.ticksStopped, undefined)),
      ),
    Bad: () =>
      Stream.iterate(0, (n) => n + 1).pipe(
        Stream.ensuring(Deferred.succeed(probes.badStopped, undefined)),
      ),
  })
  const server = yield* makeServerProtocol
  server.accept(fromMessagePort(serverPort))
  yield* RpcServer.make(ServerGroup, { disableFatalDefects: true }).pipe(
    Effect.provide(handlers),
    Effect.provideService(RpcServer.Protocol, server.protocol),
    Effect.forkScoped,
  )
  const protocol = yield* makeClientProtocol(fromMessagePort(callerPort), 'the test server')
  const client = yield* RpcClient.make(ClientGroup).pipe(
    Effect.provideService(RpcClient.Protocol, protocol),
  )
  return { client, probes, callerPort, serverPort }
})

type Link = Effect.Success<typeof setup>

/** Fails the test with what it was waiting for, rather than letting it hang. */
const within = <A, E, R>(self: Effect.Effect<A, E, R>, what: string) =>
  self.pipe(
    Effect.timeoutOrElse({
      duration: '2 seconds',
      orElse: () => Effect.die(new Error(`still waiting for ${what}`)),
    }),
  )

const run = (body: (link: Link) => Effect.Effect<void, unknown, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(setup, body)))

describe('A link over a MessagePort', () => {
  test('a request succeeds, and fails with its typed error received as its class', () =>
    run(({ client }) =>
      Effect.gen(function* () {
        expect(yield* within(client.Greet({ name: 'kris' }), 'Greet')).toBe('hello kris')
        const error = yield* within(Effect.flip(client.Greet({ name: '' })), 'the refusal')
        expect(error).toBeInstanceOf(Refused)
        expect(error).toMatchObject({ reason: 'empty name' })
      }),
    ))

  test('a stream delivers 100 items in order', () =>
    run(({ client }) =>
      Effect.gen(function* () {
        const values = yield* within(Stream.runCollect(client.Count({ upTo: 100 })), 'Count')
        expect(values).toEqual(Array.from({ length: 100 }, (_, index) => index + 1))
      }),
    ))

  test('interrupting a call interrupts its handler', () =>
    run(({ client, probes }) =>
      Effect.gen(function* () {
        const call = yield* Effect.forkChild(client.Hold())
        yield* within(Deferred.await(probes.holdStarted), 'the handler to start')
        yield* Fiber.interrupt(call)
        yield* within(Deferred.await(probes.holdInterrupted), 'the handler to be interrupted')
      }),
    ))

  test('stopping a stream on the calling side stops it on the server', () =>
    run(({ client, probes }) =>
      Effect.gen(function* () {
        const values = yield* within(Stream.runCollect(Stream.take(client.Ticks(), 3)), 'Ticks')
        expect(values).toEqual([0, 1, 2])
        yield* within(Deferred.await(probes.ticksStopped), 'the server stream to stop')
      }),
    ))

  test('closing the calling port interrupts its calls on the server (a window reloads)', () =>
    run(({ client, probes, callerPort }) =>
      Effect.gen(function* () {
        yield* Effect.forkChild(client.Hold())
        yield* within(Deferred.await(probes.holdStarted), 'the handler to start')
        callerPort.close()
        yield* within(Deferred.await(probes.holdInterrupted), 'the handler to be interrupted')
      }),
    ))

  test('closing the serving port fails the pending call and the later ones (the engine dies)', () =>
    run(({ client, probes, serverPort }) =>
      Effect.gen(function* () {
        const call = yield* Effect.forkChild(client.Hold())
        yield* within(Deferred.await(probes.holdStarted), 'the handler to start')
        serverPort.close()
        const pending = yield* within(Effect.flip(Fiber.join(call)), 'the pending call to fail')
        expect(pending).toBeInstanceOf(RpcClientError.RpcClientError)
        expect(isConnectionClosed(pending)).toBe(true)
        const later = yield* within(Effect.flip(client.Greet({ name: 'x' })), 'a later call')
        expect(isConnectionClosed(later)).toBe(true)
      }),
    ))

  test('an item that does not decode ends only its own stream, and the server stops it', () =>
    run(({ client, probes }) =>
      Effect.gen(function* () {
        const bad = yield* Effect.forkChild(Stream.runCollect(client.Bad()))
        const good = yield* within(Stream.runCollect(client.Count({ upTo: 50 })), 'Count')
        expect(good).toHaveLength(50)
        const badExit = yield* within(Fiber.await(bad), 'the bad stream to end')
        expect(Exit.isFailure(badExit)).toBe(true)
        expect(yield* within(client.Greet({ name: 'after' }), 'a call after')).toBe('hello after')
        yield* within(Deferred.await(probes.badStopped), 'the server to stop the bad stream')
      }),
    ))

  test('interrupting a stream whose items are still arriving holds back no other answer', () =>
    run(({ client }) =>
      Effect.gen(function* () {
        // The smallest interleaving the property test below found: a stream of more items than
        // the caller buffers, interrupted while the calls beside it wait for their answers.
        const interrupted = yield* Effect.forkChild(Stream.runCollect(client.Count({ upTo: 17 })))
        yield* Effect.yieldNow
        const beside = yield* Effect.forkChild(Stream.runCollect(client.Count({ upTo: 1 })))
        yield* Effect.yieldNow
        const first = yield* Effect.forkChild(client.Greet({ name: 'first' }))
        yield* Effect.yieldNow
        const second = yield* Effect.forkChild(client.Greet({ name: 'second' }))
        yield* Effect.yieldNow
        yield* Fiber.interrupt(interrupted)
        expect(yield* within(Fiber.join(beside), 'the stream beside it')).toEqual([1])
        expect(yield* within(Fiber.join(first), 'the first call')).toBe('hello first')
        expect(yield* within(Fiber.join(second), 'the second call')).toBe('hello second')
      }),
    ))

  test(
    'a call that runs longer than 5 seconds completes normally',
    () =>
      run(({ client }) =>
        Effect.gen(function* () {
          expect(yield* client.Slow({ millis: 6_000 })).toBe('done')
        }),
      ),
    15_000,
  )
})
