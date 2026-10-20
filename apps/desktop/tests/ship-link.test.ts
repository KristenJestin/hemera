/**
 * Ship as the engine serves it to the window (R9), over a real link: the preview of a mission that
 * is not in Review refused with its stage, its confirmation refused with the same reason, an
 * unknown mission named as such, a Ship's progress idle before any and stopped after, and the
 * generic move of Ship refused, so that nothing reaches Shipping without Ship's guard and reruns.
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
import { eq } from 'drizzle-orm'
import { Effect, Predicate, Stream } from 'effect'
import type { Scope } from 'effect'
import { RpcClient, RpcServer } from 'effect/rpc'
import { afterEach, beforeEach, expect, test } from 'vite-plus/test'

import { createMission } from '../src/engine/missions.ts'
import { startProfile } from '../src/engine/profile.ts'
import { createProject } from '../src/engine/projects.ts'
import { engineHandlers } from '../src/engine/serve.ts'
import { Database } from '../src/engine/storage/database.ts'
import { missions } from '../src/engine/storage/schema.ts'
import { NO_AGENTS } from './commands-engine.ts'
import { git } from './repositories.ts'
import { SHIPPED, removeFolders, temporaryFolder } from './storage.ts'

let start: EngineStart
beforeEach(() => {
  start = {
    dataFolder: temporaryFolder('ship-link'),
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
  const api = join(temporaryFolder('ship-link-work'), 'acme', 'api')
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

test('Ship outside Review is refused with the stage, its progress said, and an unknown mission named', () =>
  run(
    Effect.gen(function* () {
      const { engine, missionId } = yield* served
      const progress = engine['ship.progress']({ missionId }).pipe(
        Stream.take(1),
        Stream.runCollect,
      )
      expect(yield* progress).toEqual([{ missionId, step: 'idle', reruns: [], message: null }])
      const seen = yield* engine['ship.preview']({ missionId })
      expect(seen.possible).toBe(false)
      expect(seen.reasons).toEqual(['Ship is offered in Review: the mission is in Planning.'])
      const refused = yield* engine['ship.confirm']({ missionId, previewId: seen.previewId }).pipe(
        Effect.flip,
      )
      expect(Predicate.isTagged(refused, 'ShipRefused')).toBe(true)
      expect(refused).toMatchObject({
        reasons: ['Ship is offered in Review: the mission is in Planning.'],
      })
      // The last Ship stays said until the next: stopped, with why.
      expect(yield* progress).toEqual([
        {
          missionId,
          step: 'stopped',
          reruns: [],
          message: 'Ship is offered in Review: the mission is in Planning.',
        },
      ])
      const unknown = yield* engine['ship.preview']({ missionId: 'none' }).pipe(Effect.flip)
      expect(Predicate.isTagged(unknown, 'UnknownMission')).toBe(true)
    }),
  ))

test('the generic move of Ship stays refused: only Ship’s own confirmation reaches Shipping', () =>
  run(
    Effect.gen(function* () {
      const { engine, profile, missionId } = yield* served
      yield* profile.use(
        Effect.gen(function* () {
          const database = yield* Database
          yield* database
            .update(missions)
            .set({ stage: 'review' })
            .where(eq(missions.id, missionId))
        }),
      )
      const refused = yield* engine['missions.ship']({ id: missionId }).pipe(Effect.flip)
      expect(Predicate.isTagged(refused, 'MoveRefused')).toBe(true)
      expect(refused).toMatchObject({ reasons: ['not available yet'] })
    }),
  ))
