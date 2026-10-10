/**
 * Recent on Home: the missions opened last, durable across the engine's restarts. Each test runs
 * the engine as it starts, over a data folder of its own; a restart is a second opening of the
 * same folder.
 */

import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import { UnknownMission } from '@hemera/ipc'
import { Effect, Result } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { missionOpened, recentMissions } from '../src/engine/home/recent.ts'
import { createMission } from '../src/engine/missions.ts'
import { createProject } from '../src/engine/projects.ts'
import { commandsEngine } from './commands-engine.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('home-recent'))
  work = realpathSync.native(temporaryFolder('home-recent-work'))
})
afterEach(removeFolders)

const engine = () => commandsEngine(data)

const acme = () => {
  const folder = join(work, 'acme')
  mkdirSync(folder, { recursive: true })
  return createProject({ name: 'Acme', mainCheckout: folder, repositories: [] })
}

/** Several missions of one Project, in the order made. */
const made = (count: number) =>
  Effect.gen(function* () {
    const project = yield* acme()
    const all = []
    for (let n = 1; n <= count; n += 1) {
      all.push(
        yield* createMission({
          projectId: project.id,
          idea: { sentence: `Mission ${String(n)}`, ticket: null },
        }),
      )
    }
    return all
  })

const titles = (all: ReadonlyArray<{ readonly title: string }>) => all.map((one) => one.title)

describe('Recent', () => {
  test('is empty until a mission is opened', async () => {
    const recent = await engine()(({ profile }) => profile.use(recentMissions))
    expect(recent).toEqual([])
  })

  test('lists the missions opened, the last opened first', async () => {
    const recent = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const [one, two, three] = yield* made(3)
          for (const mission of [one, two, three]) yield* missionOpened(mission?.id ?? '')
          return yield* recentMissions
        }),
      ),
    )
    expect(titles(recent)).toEqual([
      expect.stringContaining('Mission 3'),
      expect.stringContaining('Mission 2'),
      expect.stringContaining('Mission 1'),
    ])
  })

  test('moves a mission opened again to the top, once', async () => {
    const recent = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const [one, two, three] = yield* made(3)
          for (const mission of [one, two, three, one]) yield* missionOpened(mission?.id ?? '')
          return yield* recentMissions
        }),
      ),
    )
    expect(recent.map((mission) => mission.key)).toEqual(['ACME-1', 'ACME-3', 'ACME-2'])
  })

  test('keeps at most eight, the oldest dropped', async () => {
    const recent = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const all = yield* made(10)
          for (const mission of all) yield* missionOpened(mission.id)
          return yield* recentMissions
        }),
      ),
    )
    expect(recent).toHaveLength(8)
    expect(recent[0]?.key).toBe('ACME-10')
    expect(recent[7]?.key).toBe('ACME-3')
  })

  test('holds across an engine restart', async () => {
    await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const [one, two] = yield* made(2)
          yield* missionOpened(one?.id ?? '')
          yield* missionOpened(two?.id ?? '')
        }),
      ),
    )
    const recent = await engine()(({ profile }) => profile.use(recentMissions))
    expect(recent.map((mission) => mission.key)).toEqual(['ACME-2', 'ACME-1'])
  })

  test('refuses a mission that does not exist, and keeps the list as it was', async () => {
    const { outcome, recent } = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const [one] = yield* made(1)
          yield* missionOpened(one?.id ?? '')
          const refused = yield* Effect.result(missionOpened('nobody'))
          return { outcome: refused, recent: yield* recentMissions }
        }),
      ),
    )
    expect(Result.isFailure(outcome) && outcome.failure).toBeInstanceOf(UnknownMission)
    expect(recent).toHaveLength(1)
  })

  test('opened together, every mission is kept', async () => {
    const recent = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const all = yield* made(4)
          yield* Effect.all(
            all.map((mission) => missionOpened(mission.id)),
            { concurrency: 'unbounded' },
          )
          return yield* recentMissions
        }),
      ),
    )
    expect(recent).toHaveLength(4)
  })
})
