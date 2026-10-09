/**
 * A Project's key prefix, set from the window through main to the engine: saved, refused when it
 * is not a prefix, refused when another Project's missions carry it.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import {
  EngineMainRpcs,
  fromMessagePort,
  InvalidKeyPrefix,
  KeyPrefixTaken,
  makeClientProtocol,
  makeServerProtocol,
  StaleVersion,
  WindowRpcs,
  type EngineStart,
} from '@hemera/ipc'
import { Effect, Stream } from 'effect'
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
    dataFolder: temporaryFolder('key-prefix'),
    channel: 'dev',
    version: '1.0.0',
    migrations: SHIPPED,
  }
})
afterEach(removeFolders)

const unused = Effect.die('not asked of this main')

/** The window → main → engine chain, as `links.test.ts` builds it. */
const chain = Effect.gen(function* () {
  const { port1: mainToEngine, port2: engineEnd } = new MessageChannel()
  const engineServer = yield* makeServerProtocol
  engineServer.accept(fromMessagePort(engineEnd))
  const quiet = (): void => undefined
  const profile = yield* startProfile(start, { backupFolders: [], reconciliationSteps: [] }, quiet)
  yield* RpcServer.make(EngineMainRpcs, { disableFatalDefects: true }).pipe(
    Effect.provide(engineHandlers(start, profile, quiet)),
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
          report: unused,
          relaunch: unused,
          showLog: unused,
          chooseFolder: unused,
          display: () => unused,
          notices: Stream.empty,
          preview: () => unused,
          hemeraAuto: { status: unused, save: () => unused, remove: unused },
          jiraToken: { status: () => unused, save: () => unused, remove: () => unused },
        },
        quiet,
      ),
    ),
    Effect.provideService(RpcServer.Protocol, windowServer.protocol),
    Effect.forkScoped,
  )
  const windowProtocol = yield* makeClientProtocol(fromMessagePort(windowEnd), 'main')
  return yield* RpcClient.make(WindowRpcs).pipe(
    Effect.provideService(RpcClient.Protocol, windowProtocol),
  )
})

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(body))

const projectOf = (window: Effect.Success<typeof chain>, name: string) =>
  Effect.gen(function* () {
    const main = temporaryFolder(name.toLowerCase())
    mkdirSync(join(main, 'api', '.git'), { recursive: true })
    return yield* window['projects.create']({ name, mainCheckout: main, repositories: ['api'] })
  })

describe('A Project’s key prefix, set from the window', () => {
  test('is saved, and the Project answers it at its next version', () =>
    run(
      Effect.gen(function* () {
        const window = yield* chain
        const atlas = yield* projectOf(window, 'Atlas')
        const saved = yield* window['projects.setKeyPrefix']({
          id: atlas.id,
          version: atlas.version,
          prefix: 'at',
        })
        expect(saved.keyPrefix).toBe('AT')
        expect(saved.version).toBeGreaterThan(atlas.version)
        const stale = yield* Effect.flip(
          window['projects.setKeyPrefix']({ id: atlas.id, version: atlas.version, prefix: 'ATL' }),
        )
        expect(stale).toBeInstanceOf(StaleVersion)
      }),
    ))

  test('is refused when it is not 2 to 6 capitals and digits starting with a letter', () =>
    run(
      Effect.gen(function* () {
        const window = yield* chain
        const atlas = yield* projectOf(window, 'Atlas')
        for (const prefix of ['A', '1AB', 'AB CD', 'TOOLONG1']) {
          const refused = yield* Effect.flip(
            window['projects.setKeyPrefix']({ id: atlas.id, version: atlas.version, prefix }),
          )
          expect(refused).toBeInstanceOf(InvalidKeyPrefix)
        }
      }),
    ))

  test('is refused when keys of another Project’s missions carry it', () =>
    run(
      Effect.gen(function* () {
        const window = yield* chain
        const atlas = yield* projectOf(window, 'Atlas')
        const borealis = yield* projectOf(window, 'Borealis')
        yield* window['missions.create']({
          projectId: atlas.id,
          idea: { sentence: 'Export invoices', ticket: null },
        })
        const taken = yield* Effect.flip(
          window['projects.setKeyPrefix']({
            id: borealis.id,
            version: borealis.version,
            prefix: atlas.keyPrefix,
          }),
        )
        expect(taken).toBeInstanceOf(KeyPrefixTaken)
        expect((yield* window['projects.get']({ id: borealis.id })).keyPrefix).toBe(
          borealis.keyPrefix,
        )
      }),
    ))
})
