/**
 * The delivery as the engine serves it to the window (S1), over a real link: a mission before Ship
 * has no delivery, its Retry is refused with why, its Stop delivery and the refresh change
 * nothing, and an unknown mission is named as such.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import {
  type EngineStart,
  EngineServedRpcs,
  fromMessagePort,
  makeClientProtocol,
  makeServerProtocol,
} from '@hemera/ipc'
import { Effect, Predicate, Stream } from 'effect'
import type { Scope } from 'effect'
import { RpcClient, RpcServer } from 'effect/rpc'
import { afterEach, beforeEach, expect, test } from 'vite-plus/test'

import { createMission } from '../src/engine/missions.ts'
import { startProfile } from '../src/engine/profile.ts'
import { createProject } from '../src/engine/projects.ts'
import { engineHandlers } from '../src/engine/serve.ts'
import { NO_AGENTS } from './commands-engine.ts'
import { git } from './repositories.ts'
import { SHIPPED, removeFolders, temporaryFolder } from './storage.ts'

let start: EngineStart
beforeEach(() => {
  start = {
    dataFolder: temporaryFolder('delivery-run-link'),
    channel: 'dev',
    version: '1.0.0',
    migrations: SHIPPED,
  }
})
afterEach(removeFolders)

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(body))

/** The engine's served calls over a link, and a mission of Acme in Planning. */
const served = Effect.gen(function* () {
  const { port1: client, port2: server } = new MessageChannel()
  const protocol = yield* makeServerProtocol
  protocol.accept(fromMessagePort(server))
  const quiet = (): void => undefined
  const profile = yield* startProfile(
    start,
    { backupFolders: [], reconciliationSteps: [], sessions: { discovery: NO_AGENTS } },
    quiet,
  )
  yield* RpcServer.make(EngineServedRpcs, { disableFatalDefects: true }).pipe(
    Effect.provide(engineHandlers(start, profile, quiet)),
    Effect.provideService(RpcServer.Protocol, protocol.protocol),
    Effect.forkScoped,
  )
  const engine = yield* RpcClient.make(EngineServedRpcs).pipe(
    Effect.provideService(
      RpcClient.Protocol,
      yield* makeClientProtocol(fromMessagePort(client), 'the engine'),
    ),
  )
  const api = join(temporaryFolder('delivery-run-link-work'), 'acme', 'api')
  mkdirSync(api, { recursive: true })
  git(api, 'init', '-q', '-b', 'main')
  git(api, 'commit', '-q', '--allow-empty', '-m', 'base')
  const mission = yield* profile.use(
    Effect.gen(function* () {
      const project = yield* createProject({
        name: 'Acme',
        mainCheckout: join(api, '..'),
        repositories: ['api'],
      })
      return yield* createMission({
        projectId: project.id,
        idea: { sentence: 'Export the invoices', ticket: null },
      })
    }),
  )
  return { engine, profile, missionId: mission.id }
})

test('a mission before Ship has no delivery: its Retry is refused with why, Stop delivery and the refresh change nothing, an unknown mission is named', () =>
  run(
    Effect.gen(function* () {
      const { engine, missionId } = yield* served
      expect(yield* engine['delivery.get']({ missionId })).toBeNull()
      const watched = yield* engine['delivery.watch']({ missionId }).pipe(
        Stream.take(1),
        Stream.runCollect,
      )
      expect(watched).toEqual([null])
      const refused = yield* engine['delivery.retryRepository']({
        missionId,
        repository: 'api',
      }).pipe(Effect.flip)
      expect(Predicate.isTagged(refused, 'DeliveryRetryRefused')).toBe(true)
      expect(refused).toMatchObject({ reason: 'This mission has no delivery to retry.' })
      expect(yield* engine['delivery.stop']({ missionId })).toBeNull()
      yield* engine['delivery.refresh']({})
      const unknown = yield* engine['delivery.get']({ missionId: 'none' }).pipe(Effect.flip)
      expect(Predicate.isTagged(unknown, 'UnknownMission')).toBe(true)
    }),
  ))
