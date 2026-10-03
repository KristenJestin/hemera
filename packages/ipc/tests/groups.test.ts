import { MessageChannel } from 'node:worker_threads'

import { Deferred, Effect, Fiber, Schema, Stream } from 'effect'
import { RpcClient, RpcServer } from 'effect/rpc'
import { describe, expect, test } from 'vite-plus/test'

import {
  AgentsProcessGone,
  closedAs,
  EngineGone,
  EngineRpcs,
  EngineStart,
  type EngineStatus,
  fromMessagePort,
  LaunchFailed,
  makeClientProtocol,
  makeServerProtocol,
  streamClosedAs,
} from '../src/index.ts'

const status: EngineStatus = {
  ready: true,
  version: '1.0.0',
  channel: 'dev',
  dataFolder: '/data',
}

/** main's view of an engine that answers its status and then never ends the change stream. */
const engineLink = Effect.gen(function* () {
  const { port1: mainPort, port2: enginePort } = new MessageChannel()
  const server = yield* makeServerProtocol
  server.accept(fromMessagePort(enginePort))
  yield* RpcServer.make(EngineRpcs, { disableFatalDefects: true }).pipe(
    Effect.provide(
      EngineRpcs.toLayer({
        'engine.status': () => Effect.succeed(status),
        'engine.statusChanges': () => Stream.concat(Stream.make(status), Stream.never),
      }),
    ),
    Effect.provideService(RpcServer.Protocol, server.protocol),
    Effect.forkScoped,
  )
  const protocol = yield* makeClientProtocol(fromMessagePort(mainPort), 'the engine')
  const client = yield* RpcClient.make(EngineRpcs).pipe(
    Effect.provideService(RpcClient.Protocol, protocol),
  )
  return { client, enginePort }
})

describe('The engine link', () => {
  test('a dead engine fails a pending call and a later one with EngineGone', () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { client, enginePort } = yield* engineLink
          expect(yield* client['engine.status']()).toEqual(status)
          const heard = yield* Deferred.make<void>()
          const changes = yield* Effect.forkChild(
            Stream.runCollect(
              client['engine.statusChanges']().pipe(
                streamClosedAs(() => new EngineGone()),
                Stream.tap(() => Deferred.succeed(heard, undefined)),
              ),
            ),
          )
          yield* Deferred.await(heard)
          enginePort.close()
          const pending = yield* Effect.flip(Fiber.join(changes))
          expect(pending).toBeInstanceOf(EngineGone)
          const later = yield* Effect.flip(
            client['engine.status']().pipe(closedAs(() => new EngineGone())),
          )
          expect(later).toBeInstanceOf(EngineGone)
        }),
      ),
    ))

  test('the start message crosses the link through the JSON codec and back', () => {
    const codec = Schema.toCodecJson(EngineStart)
    const start = { dataFolder: '/data', channel: 'beta' as const, version: '1.0.0-beta.1' }
    const sent = JSON.parse(JSON.stringify(Schema.encodeSync(codec)(start)))
    expect(Schema.decodeUnknownSync(codec)(sent)).toEqual(start)
    expect(() => Schema.decodeUnknownSync(codec)({ ...sent, channel: 'nightly' })).toThrow()
  })
})

describe('Errors that can reach a screen', () => {
  test.each([
    [new EngineGone(), 'Hemera’s engine stopped.'],
    [new AgentsProcessGone(), 'An agent’s process stopped.'],
    [
      new LaunchFailed({ reason: 'the program is missing' }),
      'An agent’s process could not be started: the program is missing',
    ],
  ])('%s says what happened in a sentence', (error, sentence) => {
    expect(error.message).toBe(sentence)
    expect(error.message).not.toMatch(/[{}]|\n\s+at /)
  })
})
