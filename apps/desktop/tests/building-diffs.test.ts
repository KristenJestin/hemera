/**
 * What the agent of a pre-launch check is handed of the files that changed (#139): never the
 * content of a sensitive place, never a registered secret, never more than its share of files,
 * and only from the repositories the launch prepares. On the engine as it starts, with Acme's real
 * repositories and a bare remote in temporary folders.
 */

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { checkMission } from '../src/engine/building/check.ts'
import { Secrets } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import { prelaunchChecks } from '../src/engine/storage/schema.ts'
import {
  PACKAGE,
  acmeAt,
  agents,
  answered,
  buildingEngine,
  checked,
  frozenIn,
  pushedOnRemote,
  reporting,
} from './building-world.ts'
import { git } from './repositories.ts'
import { text, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('building-diffs'))
  work = realpathSync.native(temporaryFolder('building-diffs-work'))
})
afterEach(removeFolders)

const SECRET = 'tok-registered-77'

/** What a check kept, as its row holds it. */
const keptOf = (checkId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ results: prelaunchChecks.results })
      .from(prelaunchChecks)
      .where(eq(prelaunchChecks.id, checkId))
    return row?.results ?? ''
  })

describe('The agent of the check is never handed a secret', () => {
  test('a changed .env.production and .npmrc are handed by name only, and a registered secret in a diff is masked, in the kept results and in the brief', async () => {
    const { run, world } = buildingEngine(
      data,
      work,
      agents(
        reporting([answered('.env.production'), answered('.npmrc'), answered('package.json')]),
      ),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* Secrets.useSync((secrets) => secrets.register('suite', [SECRET]))
          const { project, main, bare } = yield* acmeAt(work)
          const { mission } = yield* frozenIn(project.id, main)
          pushedOnRemote(work, bare, (clone) => {
            writeFileSync(join(clone, '.env.production'), 'API_KEY=prod-key-in-env-file\n')
            writeFileSync(join(clone, '.npmrc'), '//registry.example/:_authToken=npm-token-in-rc\n')
            writeFileSync(
              join(clone, 'package.json'),
              PACKAGE.replace('{}', `{ "t": "${SECRET}" }`),
            )
          })
          yield* checkMission(mission.id)
          const view = yield* checked(mission.id)
          return { view, kept: yield* keptOf(view.id) }
        }),
      ),
    )
    const brief = text(world.agents[1]?.answers.prompts[0] ?? [])
    for (const said of [seen.kept, brief]) {
      expect(said).not.toContain('prod-key-in-env-file')
      expect(said).not.toContain('npm-token-in-rc')
      expect(said).not.toContain(SECRET)
    }
    expect(seen.view.handed.map((one) => one.path).toSorted()).toEqual([
      '.env.production',
      '.npmrc',
      'package.json',
    ])
    expect(brief).toContain('.env.production')
    expect(brief).toMatch(/sensitive place: its diff is never handed/)
    // The ordinary file's diff is still handed, its secret masked.
    expect(brief).toContain('"t": ')
  })
})

describe('The agent of the check reads only what the launch prepares, and only so much', () => {
  test('a file changed in a repository the launch does not prepare is not handed', async () => {
    const { run } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, web } = yield* acmeAt(work)
          const { mission } = yield* frozenIn(project.id, main)
          // `web` has no remote: its base is its local branch, which moves with a commit.
          writeFileSync(join(web, 'app.ts'), 'x\n')
          git(web, 'add', '.')
          git(web, 'commit', '-q', '-m', 'app')
          yield* checkMission(mission.id)
          return yield* checked(mission.id)
        }),
      ),
    )
    expect(seen.handed).toEqual([])
    expect(seen.agent.state).toBe('skipped')
  })

  test('beyond 200 changed files, 200 are handed and the rest is listed by name only', async () => {
    const { run, world } = buildingEngine(data, work, agents(reporting([])))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, bare } = yield* acmeAt(work)
          const { mission } = yield* frozenIn(project.id, main)
          pushedOnRemote(work, bare, (clone) => {
            mkdirSync(join(clone, 'docs'))
            for (let at = 0; at < 205; at += 1) {
              writeFileSync(
                join(clone, 'docs', `page-${String(at).padStart(3, '0')}.md`),
                `${String(at)}\n`,
              )
            }
          })
          yield* checkMission(mission.id)
          // The agent is briefed, says nothing, and the check ends without its answer.
          return yield* checked(mission.id)
        }),
      ),
    )
    expect(seen.handed).toHaveLength(200)
    const brief = text(world.agents[1]?.answers.prompts[0] ?? [])
    expect(brief).toContain('docs/page-204.md')
    expect(brief).toMatch(/5 more file\(s\) changed, listed by name only/)
  })
})
