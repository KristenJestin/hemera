/**
 * The last Journal line of several missions, in one read. Each test runs the engine as it starts,
 * over a data folder of its own; the Journal is written by the projection that follows the
 * events, so a test waits for the line it expects rather than for a time.
 */

import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { journalTail } from '../src/engine/home/journal-tail.ts'
import { createMission, moveMission } from '../src/engine/missions.ts'
import { createProject } from '../src/engine/projects.ts'
import { commandsEngine, until } from './commands-engine.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('journal-tail'))
  work = realpathSync.native(temporaryFolder('journal-tail-work'))
})
afterEach(removeFolders)

const engine = () => commandsEngine(data)

const acme = () => {
  const folder = join(work, 'acme')
  mkdirSync(folder, { recursive: true })
  return createProject({ name: 'Acme', mainCheckout: folder, repositories: [] })
}

const idea = (sentence: string) => ({ sentence, ticket: null })

describe('the last Journal line of several missions', () => {
  test('is the last line of each mission, and null for one that has none', async () => {
    const tails = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const first = yield* createMission({ projectId: project.id, idea: idea('Add roles') })
          const second = yield* createMission({ projectId: project.id, idea: idea('Export notes') })
          yield* moveMission(second.id, 'cancel', 'user')
          const ids = [first.id, second.id, 'nobody']
          const seen = yield* until(
            journalTail(ids),
            (all) =>
              all[0]?.line !== null && /cancelled/i.test(all[1]?.line?.text ?? ''),
          )
          return { seen, first, second }
        }),
      ),
    )
    const [first, second, nobody] = tails.seen
    expect(tails.seen.map((tail) => tail.missionId)).toEqual([
      tails.first.id,
      tails.second.id,
      'nobody',
    ])
    expect(first?.line?.text).toBe('Mission started: Add roles')
    expect(first?.line?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(second?.line?.text).toMatch(/cancelled/i)
    expect(nobody?.line).toBeNull()
  })

  test('asks for nothing when no mission is named', async () => {
    const tails = await engine()(({ profile }) => profile.use(journalTail([])))
    expect(tails).toEqual([])
  })
})
