/**
 * `snapshots.diagnose` (#140), asked from the window through main to the engine: per repository
 * of a mission, the refs of the snapshot store that hold its trees and the rows copied into the
 * database. What the developer section reads when a diff does not read back.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import {
  EngineMainRpcs,
  type EngineStart,
  WindowRpcs,
  fromMessagePort,
  makeClientProtocol,
  makeServerProtocol,
} from '@hemera/ipc'
import { Effect, Stream } from 'effect'
import type { Scope } from 'effect'
import { RpcClient, RpcServer } from 'effect/rpc'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { Snapshots } from '../src/engine/building/snapshots.ts'
import { startProfile } from '../src/engine/profile.ts'
import { engineHandlers } from '../src/engine/serve.ts'
import { windowHandlers } from '../src/main/window-link.ts'
import { git, repository } from './repositories.ts'
import { SHIPPED, removeFolders, temporaryFolder } from './storage.ts'

let start: EngineStart
let work: string
beforeEach(() => {
  start = {
    dataFolder: temporaryFolder('diagnose'),
    channel: 'dev',
    version: '1.0.0',
    migrations: SHIPPED,
  }
  work = temporaryFolder('diagnose-work')
})
afterEach(removeFolders)

const unused = Effect.die('not asked of this main')

/** The window → main → engine chain, as `links.test.ts` builds it, with the engine's Profile. */
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
  const window = yield* RpcClient.make(WindowRpcs).pipe(
    Effect.provideService(RpcClient.Protocol, windowProtocol),
  )
  return { window, profile }
})

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(body))

describe('The snapshots of a mission are diagnosed from the developer section', () => {
  test('each repository with the refs of its trees and its copied rows, and a mission with none answers none', () =>
    run(
      Effect.gen(function* () {
        const { window, profile } = yield* chain
        const main = repository(join(work, 'acme'), 'main')
        const atlas = yield* window['projects.create']({
          name: 'Atlas',
          mainCheckout: main,
          repositories: [],
        })
        const mission = yield* window['missions.create']({
          projectId: atlas.id,
          idea: { sentence: 'Diagnose the snapshots', ticket: null },
        })
        const quiet = yield* window['missions.create']({
          projectId: atlas.id,
          idea: { sentence: 'Nothing taken', ticket: null },
        })
        const api = { name: 'api', folder: main }
        yield* profile.use(
          Effect.gen(function* () {
            const snapshots = yield* Snapshots
            const owner = { kind: 'attempt', missionId: mission.id, attemptId: 'a1' } as const
            const from = yield* snapshots.take(api, { ...owner, side: 'start' })
            writeFileSync(join(main, 'one.txt'), 'one\n')
            mkdirSync(join(main, 'docs'))
            writeFileSync(join(main, 'docs', 'two.txt'), 'two\n')
            const to = yield* snapshots.take(api, { ...owner, side: 'end' })
            const files = yield* snapshots.changed(mission.id, api, from, to)
            yield* snapshots.capture(mission.id, api, from, to, files)
          }),
        )

        const diagnosed = yield* window['snapshots.diagnose']({ missionId: mission.id })
        const none = yield* window['snapshots.diagnose']({ missionId: quiet.id })

        expect(diagnosed).toEqual([
          {
            repository: 'api',
            refs: [
              `refs/hemera/${mission.id}/a1/end/api`,
              `refs/hemera/${mission.id}/a1/start/api`,
            ],
            files: 2,
            contents: 2,
          },
        ])
        expect(none).toEqual([])
        expect(git(main, 'for-each-ref')).not.toContain('hemera')
      }),
    ))
})
