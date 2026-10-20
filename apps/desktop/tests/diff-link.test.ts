/**
 * The live diff of a mission asked from the window through main to the engine (#249), and its
 * automatic review (#147) for the Building page (#151): each group crosses both links, its
 * refusals arriving typed.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import {
  EngineMainRpcs,
  fromMessagePort,
  makeClientProtocol,
  makeServerProtocol,
  UnknownCheckpoint,
  UnknownDiffFile,
  UnknownMission,
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
import { git } from './repositories.ts'
import { NO_AGENTS } from './commands-engine.ts'
import { SHIPPED, removeFolders, temporaryFolder } from './storage.ts'

let start: EngineStart
beforeEach(() => {
  start = {
    dataFolder: temporaryFolder('diff-link'),
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
  const profile = yield* startProfile(
    start,
    { backupFolders: [], reconciliationSteps: [], sessions: { discovery: NO_AGENTS } },
    quiet,
  )
  yield* RpcServer.make(EngineMainRpcs, { disableFatalDefects: true }).pipe(
    Effect.provide(engineHandlers(start, profile, quiet)),
    Effect.provideService(RpcServer.Protocol, engineServer.protocol),
    Effect.forkScoped,
  )
  const engineProtocol = yield* makeClientProtocol(fromMessagePort(mainToEngine), 'the engine')
  const engine = yield* RpcClient.make(EngineMainRpcs).pipe(
    Effect.provideService(RpcClient.Protocol, engineProtocol),
  )
  const { port1: windowEnd, port2: mainEnd } = new MessageChannel()
  const windowServer = yield* makeServerProtocol
  windowServer.accept(fromMessagePort(mainEnd))
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

describe('The diff crosses main', () => {
  test('a mission before its Workspace has an empty diff, and an unknown mission or checkpoint is refused typed', async () => {
    const seen = await run(
      Effect.gen(function* () {
        const window = yield* chain
        const main = temporaryFolder('acme')
        mkdirSync(join(main, 'api'), { recursive: true })
        git(join(main, 'api'), 'init', '-q', '-b', 'main')
        const project = yield* window['projects.create']({
          name: 'Acme',
          mainCheckout: main,
          repositories: ['api'],
        })
        const mission = yield* window['missions.create']({
          projectId: project.id,
          idea: { sentence: 'Export the invoices as CSV', ticket: null },
        })
        return {
          empty: yield* window['diff.live']({ missionId: mission.id }),
          unknown: yield* Effect.flip(window['diff.live']({ missionId: 'nope' })),
          checkpoint: yield* Effect.flip(window['diff.atCheckpoint']({ checkpointId: 'nope' })),
          file: yield* Effect.flip(
            window['diff.file']({ missionId: mission.id, repository: 'api', path: 'a.ts' }),
          ),
        }
      }),
    )
    expect(seen.empty).toEqual({ source: 'checkpoint', checkpoint: null, repositories: [] })
    expect(seen.unknown).toBeInstanceOf(UnknownMission)
    expect(seen.checkpoint).toBeInstanceOf(UnknownCheckpoint)
    expect(seen.file).toBeInstanceOf(UnknownDiffFile)
  })
})

describe('The automatic review crosses main', () => {
  test('a mission before its Building has no review, and an unknown mission is refused typed', async () => {
    const seen = await run(
      Effect.gen(function* () {
        const window = yield* chain
        const main = temporaryFolder('acme')
        mkdirSync(join(main, 'api'), { recursive: true })
        git(join(main, 'api'), 'init', '-q', '-b', 'main')
        const project = yield* window['projects.create']({
          name: 'Acme',
          mainCheckout: main,
          repositories: ['api'],
        })
        const mission = yield* window['missions.create']({
          projectId: project.id,
          idea: { sentence: 'Export the invoices as CSV', ticket: null },
        })
        return {
          none: yield* window['autoReview.read']({ missionId: mission.id, buildingId: null }),
          first: yield* window['autoReview.changed']({ missionId: mission.id }).pipe(
            Stream.take(1),
            Stream.runCollect,
          ),
          unknown: yield* Effect.flip(
            window['autoReview.read']({ missionId: 'nope', buildingId: null }),
          ),
        }
      }),
    )
    expect(seen.none).toBeNull()
    expect([...seen.first]).toEqual([null])
    expect(seen.unknown).toBeInstanceOf(UnknownMission)
  })
})
