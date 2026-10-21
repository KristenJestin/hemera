/**
 * What the Review page asks beside its feedback (#496), from the window through main to the
 * engine: the proofs, the pushes, Ship and the team's comments cross both links, their refusals
 * arriving typed.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import {
  EngineMainRpcs,
  fromMessagePort,
  makeClientProtocol,
  makeServerProtocol,
  UnknownMission,
  UnknownTeamComment,
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
    dataFolder: temporaryFolder('review-link'),
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

describe('The Review page’s groups cross main', () => {
  test('a mission before its Review has no proofs, no push, no comment and no Ship, each said typed', async () => {
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
        const missionId = mission.id
        return {
          proofs: yield* window['proofs.read']({ missionId }),
          pushes: yield* window['delivery.pushes']({ missionId }),
          pushed: yield* window['delivery.changes']({ missionId }).pipe(
            Stream.take(1),
            Stream.runCollect,
          ),
          comments: yield* window['teamComments.list']({ missionId }),
          // The comments' changes say only what changes: an unknown mission is refused at once.
          unknownCommented: yield* Effect.flip(
            window['teamComments.changes']({ missionId: 'nope' }).pipe(Stream.runDrain),
          ),
          preview: yield* window['ship.preview']({ missionId }),
          progress: yield* window['ship.progress']({ missionId }).pipe(
            Stream.take(1),
            Stream.runCollect,
          ),
          unknownProofs: yield* Effect.flip(window['proofs.read']({ missionId: 'nope' })),
          unknownShip: yield* Effect.flip(window['ship.preview']({ missionId: 'nope' })),
          unknownComment: yield* Effect.flip(window['teamComments.dismiss']({ commentId: 'nope' })),
        }
      }),
    )
    expect(seen.proofs).toBeNull()
    expect(seen.pushes.repositories).toEqual([])
    expect([...seen.pushed]).toHaveLength(1)
    expect(seen.comments).toEqual([])
    expect(seen.unknownCommented).toBeInstanceOf(UnknownMission)
    expect(seen.preview.possible).toBe(false)
    expect(seen.preview.reasons).toEqual(['Ship is offered in Review: the mission is in Planning.'])
    expect([...seen.progress].map((one) => one.step)).toEqual(['idle'])
    expect(seen.unknownProofs).toBeInstanceOf(UnknownMission)
    expect(seen.unknownShip).toBeInstanceOf(UnknownMission)
    expect(seen.unknownComment).toBeInstanceOf(UnknownTeamComment)
  })
})
