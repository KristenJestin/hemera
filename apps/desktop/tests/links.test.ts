/**
 * The window → main → engine chain, outside Electron: three Node ports stand for the window's,
 * main's two ends, and the engine's. What Electron's own ports do is the end-to-end suite's.
 */

import { MessageChannel } from 'node:worker_threads'

import {
  EngineGone,
  EngineRpcs,
  fromMessagePort,
  makeClientProtocol,
  makeServerProtocol,
  type EngineStart,
  type EnvironmentReport,
  WindowRpcs,
} from '@hemera/ipc'
import { Deferred, Effect, Fiber, Option, Stream } from 'effect'
import type { Scope } from 'effect'
import { RpcClient, RpcServer } from 'effect/rpc'
import { describe, expect, test } from 'vite-plus/test'

import { engineHandlers } from '../src/engine/serve.ts'
import { windowHandlers } from '../src/main/window-link.ts'

const start: EngineStart = { dataFolder: '/data', channel: 'dev', version: '1.0.0' }

const report: EnvironmentReport = {
  version: '1.0.0',
  channel: 'dev',
  platform: 'linux',
  osVersion: 'test',
  distribution: null,
  session: null,
  displays: [],
  versions: { electron: '44', chrome: '140', node: '24' },
  dataFolder: '/data',
  notVerified: [],
  producedAt: '2026-10-03T00:00:00.000Z',
}

const chain = Effect.gen(function* () {
  const engineLines: string[] = []
  const mainLines: string[] = []
  let relaunched = 0

  const { port1: mainToEngine, port2: engineEnd } = new MessageChannel()
  const engineServer = yield* makeServerProtocol
  engineServer.accept(fromMessagePort(engineEnd))
  yield* RpcServer.make(EngineRpcs, { disableFatalDefects: true }).pipe(
    Effect.provide(engineHandlers(start, (line) => engineLines.push(line))),
    Effect.provideService(RpcServer.Protocol, engineServer.protocol),
    Effect.forkScoped,
  )
  const engineProtocol = yield* makeClientProtocol(fromMessagePort(mainToEngine), 'the engine')
  const engine = yield* RpcClient.make(EngineRpcs).pipe(
    Effect.provideService(RpcClient.Protocol, engineProtocol),
  )

  const { port1: windowEnd, port2: mainFromWindow } = new MessageChannel()
  const windowServer = yield* makeServerProtocol
  windowServer.accept(fromMessagePort(mainFromWindow))
  yield* RpcServer.make(WindowRpcs, { disableFatalDefects: true }).pipe(
    Effect.provide(
      windowHandlers(
        engine,
        {
          report: Effect.succeed(report),
          relaunch: Effect.sync(() => {
            relaunched += 1
          }),
        },
        (line) => mainLines.push(line),
      ),
    ),
    Effect.provideService(RpcServer.Protocol, windowServer.protocol),
    Effect.forkScoped,
  )
  const windowProtocol = yield* makeClientProtocol(fromMessagePort(windowEnd), 'main')
  const window = yield* RpcClient.make(WindowRpcs).pipe(
    Effect.provideService(RpcClient.Protocol, windowProtocol),
  )
  return {
    window,
    windowEnd,
    engineEnd,
    engineLines,
    mainLines,
    relaunches: () => relaunched,
  }
})

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(body))

/** Waits for a condition the other side of a port makes true. */
const eventually = (condition: () => boolean, what: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (condition()) return
      yield* Effect.sleep(10)
    }
    return yield* Effect.die(new Error(`never saw ${what}`))
  })

describe('The window reaches the engine through main', () => {
  test('the window reads the engine status the engine was started with', () =>
    run(
      Effect.gen(function* () {
        const { window } = yield* chain
        expect(yield* window['engine.status']()).toEqual({ ready: true, ...start })
        const first = yield* Stream.runHead(window['engine.statusChanges']())
        expect(first).toEqual(Option.some({ ready: true, ...start }))
      }),
    ))

  test('a window that goes away interrupts its stream down to the engine’s handler', () =>
    run(
      Effect.gen(function* () {
        const { window, windowEnd, engineLines } = yield* chain
        const heard = yield* Deferred.make<void>()
        yield* Effect.forkChild(
          Stream.runDrain(
            Stream.tap(window['engine.statusChanges'](), () => Deferred.succeed(heard, undefined)),
          ),
        )
        yield* Deferred.await(heard)
        windowEnd.close()
        yield* eventually(
          () =>
            engineLines.some((line) => /^engine\.statusChanges: (ended|interrupted)$/.test(line)),
          'the engine’s handler interrupted',
        )
      }),
    ))

  test('a dead engine fails what the window waits on with EngineGone, and main logs it', () =>
    run(
      Effect.gen(function* () {
        const { window, engineEnd, mainLines } = yield* chain
        const heard = yield* Deferred.make<void>()
        const changes = yield* Effect.forkChild(
          Stream.runDrain(
            Stream.tap(window['engine.statusChanges'](), () => Deferred.succeed(heard, undefined)),
          ),
        )
        yield* Deferred.await(heard)
        engineEnd.close()
        expect(yield* Effect.flip(Fiber.join(changes))).toBeInstanceOf(EngineGone)
        expect(yield* Effect.flip(window['engine.status']())).toBeInstanceOf(EngineGone)
        expect(mainLines).toContain('engine.statusChanges: failed: Hemera’s engine stopped.')
      }),
    ))

  test('main answers the environment report and the relaunch itself', () =>
    run(
      Effect.gen(function* () {
        const { window, relaunches } = yield* chain
        expect(yield* window['environment.report']()).toEqual(report)
        yield* window['application.relaunch']()
        expect(relaunches()).toBe(1)
      }),
    ))
})
