/**
 * The window → main → engine chain, outside Electron: three Node ports stand for the window's,
 * main's two ends, and the engine's. What Electron's own ports do is the end-to-end suite's.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import {
  DatabaseOpen,
  EngineGone,
  EngineMainRpcs,
  fromMessagePort,
  makeClientProtocol,
  makeServerProtocol,
  type EngineStart,
  type EnvironmentReport,
  type Preferences,
  RestoreRefused,
  StaleVersion,
  WindowRpcs,
} from '@hemera/ipc'
import { Deferred, Effect, Fiber, Option, Schema, Stream } from 'effect'
import type { Scope } from 'effect'
import { RpcClient, RpcServer } from 'effect/rpc'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { startProfile } from '../src/engine/profile.ts'
import { engineHandlers } from '../src/engine/serve.ts'
import { windowHandlers } from '../src/main/window-link.ts'
import { SHIPPED, removeFolders, temporaryFolder } from './storage.ts'

let start: EngineStart
beforeEach(() => {
  start = {
    dataFolder: temporaryFolder('links'),
    channel: 'dev',
    version: '1.0.0',
    migrations: SHIPPED,
  }
})
afterEach(removeFolders)

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
  let logsShown = 0
  let foldersAsked = 0
  const displayed: Preferences[] = []

  const { port1: mainToEngine, port2: engineEnd } = new MessageChannel()
  const engineServer = yield* makeServerProtocol
  engineServer.accept(fromMessagePort(engineEnd))
  const engineLog = (line: string) => {
    engineLines.push(line)
  }
  const profile = yield* startProfile(
    start,
    { backupFolders: [], reconciliationSteps: [] },
    engineLog,
  )
  yield* RpcServer.make(EngineMainRpcs, { disableFatalDefects: true }).pipe(
    Effect.provide(engineHandlers(start, profile, engineLog)),
    Effect.provideService(RpcServer.Protocol, engineServer.protocol),
    Effect.forkScoped,
  )
  const engineProtocol = yield* makeClientProtocol(fromMessagePort(mainToEngine), 'the engine')
  const engine = yield* RpcClient.make(EngineMainRpcs).pipe(
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
          showLog: Effect.sync(() => {
            logsShown += 1
          }),
          chooseFolder: Effect.sync(() => {
            foldersAsked += 1
            return '/work/acme'
          }),
          display: (preferences) =>
            Effect.sync(() => {
              displayed.push(preferences)
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
    logsShown: () => logsShown,
    foldersAsked: () => foldersAsked,
    displayed,
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
        const { migrations: _, ...started } = start
        const status = yield* window['engine.status']()
        expect(status).toMatchObject({ ready: true, ...started })
        expect(Schema.is(DatabaseOpen)(status.database)).toBe(true)
        expect(status.database).toMatchObject({ writtenByVersion: '1.0.0', reconciliation: 'none' })
        const first = yield* Stream.runHead(window['engine.statusChanges']())
        expect(first).toEqual(Option.some(status))
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

  test('main shows the diagnostic log when the window asks', () =>
    run(
      Effect.gen(function* () {
        const { window, logsShown } = yield* chain
        yield* window['application.showLog']()
        expect(logsShown()).toBe(1)
      }),
    ))

  test('main opens the system’s folder picker when the window asks, and answers the folder', () =>
    run(
      Effect.gen(function* () {
        const { window, foldersAsked } = yield* chain
        expect(yield* window['application.chooseFolder']()).toBe('/work/acme')
        expect(foldersAsked()).toBe(1)
      }),
    ))

  test('a preference the window writes is stored by the engine and worn by main', () =>
    run(
      Effect.gen(function* () {
        const { window, displayed } = yield* chain
        yield* window['preferences.write']({ theme: 'dark' })
        expect(yield* window['preferences.read']()).toEqual({ theme: 'dark' })
        expect(displayed).toEqual([{ theme: 'dark' }, { theme: 'dark' }])
      }),
    ))

  test('a backup is written where the window asks, and a refused restore relaunches nothing', () =>
    run(
      Effect.gen(function* () {
        const { window, relaunches } = yield* chain
        const written = yield* window['profile.backup']({ folder: temporaryFolder('chosen') })
        expect(written).toMatch(/hemera-backup-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ$/)
        const refused = yield* Effect.flip(
          window['profile.restore']({ folder: temporaryFolder('not-a-backup') }),
        )
        expect(refused).toBeInstanceOf(RestoreRefused)
        expect(relaunches()).toBe(0)
        yield* window['profile.restore']({ folder: written })
        expect(relaunches()).toBe(1)
      }),
    ))

  test('a Project made from the window is read, changed and followed through main', () =>
    run(
      Effect.gen(function* () {
        const { window } = yield* chain
        const main = temporaryFolder('atlas')
        mkdirSync(join(main, 'api', '.git'), { recursive: true })
        const found = yield* window['projects.detectRepositories']({ folder: main })
        expect(found).toEqual(['api'])
        const made = yield* window['projects.create']({
          name: 'Atlas',
          mainCheckout: main,
          repositories: found,
        })
        const heard = yield* Effect.forkChild(Stream.runHead(window['projects.changes']()))
        yield* Effect.sleep(20)
        const renamed = yield* window['projects.update']({
          id: made.id,
          version: made.version,
          name: 'Atlas II',
        })
        expect(yield* Fiber.join(heard)).toEqual(Option.some(renamed))
        expect(yield* window['projects.list']()).toEqual([renamed])
        const stale = yield* Effect.flip(
          window['projects.update']({ id: made.id, version: made.version, name: 'Atlas III' }),
        )
        expect(stale).toBeInstanceOf(StaleVersion)
        const status = yield* window['repositories.status']({
          id: renamed.repositories[0]?.id ?? '',
        })
        expect(status).toMatchObject({ reason: expect.stringMatching(/^fatal: /) })
      }),
    ))
})
