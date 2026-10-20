/**
 * Review's feedback asked from the window through main to the engine (#341), for the diff view
 * (#497): the group crosses both links, its refusals arriving typed.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import {
  EngineMainRpcs,
  fromMessagePort,
  makeClientProtocol,
  makeServerProtocol,
  UnknownFeedback,
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
    dataFolder: temporaryFolder('feedback-link'),
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

describe("Review's feedback crosses main", () => {
  test('a mission before its Review has no feedback, and an unknown mission or feedback is refused typed', async () => {
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
          state: yield* window['review.state']({ missionId: mission.id }),
          first: yield* window['review.changes']({ missionId: mission.id }).pipe(
            Stream.take(1),
            Stream.runCollect,
          ),
          unknown: yield* Effect.flip(window['review.state']({ missionId: 'nope' })),
          version: yield* Effect.flip(window['review.commentedVersion']({ feedbackId: 'nope' })),
          withdraw: yield* Effect.flip(window['review.feedbackWithdraw']({ feedbackId: 'nope' })),
        }
      }),
    )
    expect(seen.state.feedback).toEqual([])
    expect([...seen.first]).toHaveLength(1)
    expect(seen.unknown).toBeInstanceOf(UnknownMission)
    expect(seen.version).toBeInstanceOf(UnknownFeedback)
    expect(seen.withdraw).toBeInstanceOf(UnknownFeedback)
  })
})
