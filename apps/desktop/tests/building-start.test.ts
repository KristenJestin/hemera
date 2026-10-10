/**
 * The start of the Building once the Workspace is ready (#139): the Project's exclusive resources
 * are held before `BuildingStart` is called, and the start is recorded only once the port
 * returned, so a start that failed is a need whose Retry starts it again.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent, Acme's real repositories
 * and a bare remote in temporary folders. Every wait is on state.
 */

import { realpathSync } from 'node:fs'

import type { ResourceHolding } from '@hemera/ipc'
import { Effect, Layer, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { checkMission } from '../src/engine/building/check.ts'
import { BuildingStart, launchMission, preparationOf } from '../src/engine/building/launch.ts'
import { getMission } from '../src/engine/missions.ts'
import { getNeed, retryNeed } from '../src/engine/needs.ts'
import { saveResources } from '../src/engine/resources/declarations.ts'
import { ExclusiveResources } from '../src/engine/resources/reservations.ts'
import { acmeAt, agents, buildingEngine, checked, frozenIn, inStage } from './building-world.ts'
import { until, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('building-start'))
  work = realpathSync.native(temporaryFolder('building-start-work'))
})
afterEach(removeFolders)

/** What the port runs at each call, set by the test once the engine is up. */
interface StartProbe {
  seen: Effect.Effect<void>
}

/** A port that runs `seen` at each call, then fails while `failing` calls remain. */
const startPort = (failing: number) => {
  const missions: string[] = []
  const probe: StartProbe = { seen: Effect.void }
  let left = failing
  const layer = Layer.succeed(BuildingStart, {
    start: (missionId: string) =>
      Effect.gen(function* () {
        missions.push(missionId)
        yield* probe.seen
        if (left > 0) {
          left -= 1
          return yield* Effect.die(new Error('the Builder could not start'))
        }
      }),
  })
  return { missions, layer, probe }
}

describe('The Building starts once its resources are held, and its start is recorded once done', () => {
  test('a declared exclusive resource is held by the mission when BuildingStart is called', async () => {
    const starts = startPort(0)
    const held: Array<ReadonlyArray<ResourceHolding>> = []
    const { run } = buildingEngine(data, work, agents(), starts)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acmeAt(work)
          yield* saveResources(project.id, [
            {
              name: 'shared database',
              description: 'The development database every Workspace of Acme uses',
              uses: [],
              changes: [],
              resetCommandId: null,
            },
          ])
          const context = yield* Effect.context<ExclusiveResources>()
          starts.probe.seen = ExclusiveResources.use((resources) => resources.holders).pipe(
            Effect.map((holders) => {
              held.push(holders)
            }),
            Effect.provide(context),
            Effect.orDie,
          )
          const { mission } = yield* frozenIn(project.id, main)
          yield* checkMission(mission.id)
          const view = yield* checked(mission.id)
          yield* launchMission(mission.id, view.id, 'launch')
          yield* inStage(mission.id, 'building')
          // Without a reset, #88 asks the user to confirm the resource's state: the start waits.
          const needsNow = Effect.map(getMission(mission.id), (one) => one.needs)
          yield* until(Effect.map(needsNow, (pending) => pending.length > 0))
          const needs = yield* needsNow
          const before = [...starts.missions]
          yield* retryNeed(needs[0]?.id ?? '')
          yield* until(Effect.sync(() => held.length > 0))
          return { mission, before }
        }),
      ),
    )
    expect(seen.before).toEqual([])
    expect(starts.missions).toEqual([seen.mission.id])
    expect(held[0]?.map((one) => one.holder?.missionId ?? null)).toEqual([seen.mission.id])
  })

  test('a start that fails is a need on the mission, and its Retry starts the Building again', async () => {
    const starts = startPort(1)
    const { run } = buildingEngine(data, work, agents(), starts)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acmeAt(work)
          const { mission } = yield* frozenIn(project.id, main)
          yield* checkMission(mission.id)
          const view = yield* checked(mission.id)
          yield* launchMission(mission.id, view.id, 'launch')
          yield* inStage(mission.id, 'building')
          yield* until(Effect.map(preparationOf(mission.id), (one) => one?.needId != null))
          const failed = yield* preparationOf(mission.id)
          const needId = failed?.needId ?? ''
          const pending = yield* getNeed(needId)
          yield* retryNeed(needId)
          yield* until(Effect.sync(() => starts.missions.length === 2))
          yield* until(Effect.map(getNeed(needId), (need) => need.state === 'withdrawn'))
          return { mission, pending }
        }),
      ),
    )
    expect(seen.pending.state).toBe('pending')
    const { fields } = seen.pending
    expect(Predicate.isTagged(fields, 'Environment') ? fields.missing : '').toMatch(
      /The Building did not start/,
    )
    expect(starts.missions).toEqual([seen.mission.id, seen.mission.id])
  })
})
