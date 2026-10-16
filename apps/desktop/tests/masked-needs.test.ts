/**
 * A record the engine builds, its names and tags fixed by a schema, is stored masked and read back
 * whole, whatever value a project variable holds (#404, round 2). The engine is the real one, in
 * temporary folders.
 */

import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, relative } from 'node:path'

import { DecisionFields, MissionOwner, PermissionAnswer } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Effect, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { AGENT_REQUESTS, answerNeed, createNeed, getNeed } from '../src/engine/needs.ts'
import { Secrets } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import { permissionRequests } from '../src/engine/storage/schema.ts'
import { commandsEngine, until } from './commands-engine.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { acmeWithMission, callTool, sessionOf, verdictsSaying } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('masked-needs'))
  work = realpathSync.native(temporaryFolder('masked-needs-work'))
})
afterEach(removeFolders)

describe('A need the engine builds is read back whole when a variable holds one of its names (#404)', () => {
  test('a decision need is created while a variable holds `options`', async () => {
    const fields = DecisionFields.make({
      question: 'Which export?',
      options: ['CSV', 'JSON'],
      recommended: null,
    })
    const need = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          yield* Secrets.useSync((secrets) => secrets.register('suite', ['options']))
          const { project, mission } = yield* acmeWithMission(work)
          const owner = MissionOwner.make({
            projectId: project.id,
            missionId: mission.id,
            taskId: null,
          })
          const made = yield* createNeed(AGENT_REQUESTS, owner, fields)
          return yield* getNeed(made.id)
        }),
      ),
    )
    expect(need.fields).toEqual(fields)
  })

  test('a permission request is answered while a variable holds `hemera`', async () => {
    const verdicts = verdictsSaying(() => ({
      verdict: 'ask',
      reason: 'a write in the Workspace',
      by: 'suite',
      settingsSection: 'models',
    }))
    const [need, ended] = await commandsEngine(data, { tools: { verdicts: verdicts.layer } })(
      ({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            // `hemera` is in `hemeraReason`, `settings` in `settingsSection`.
            yield* Secrets.useSync((secrets) => secrets.register('suite', ['hemera', 'settings']))
            const { mission, main } = yield* acmeWithMission(work)
            const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
            yield* callTool(builder.grantId, 'fs_write', { path: 'notes.md', content: 'x' })
            const database = yield* Database
            const [row] = yield* database.select().from(permissionRequests)
            if (row === undefined) return yield* Effect.die(new Error('no request'))
            const seen = yield* getNeed(row.needId)
            yield* answerNeed({
              id: row.needId,
              answer: PermissionAnswer.make({ choice: 'deny' }),
              key: crypto.randomUUID(),
            })
            const done = yield* until(
              database.select().from(permissionRequests).where(eq(permissionRequests.id, row.id)),
              ([now]) => now?.state === 'ended',
            )
            return [seen, done[0]] as const
          }),
        ),
    )
    expect(Predicate.isTagged(need.fields, 'Permission')).toBe(true)
    expect(need.fields).toMatchObject({
      hemeraReason: 'a write in the Workspace',
      settingsSection: 'models',
    })
    expect(ended).toMatchObject({ state: 'ended', result: 'refused' })
  })
})

describe('Names and tags are masked only where an agent chose them (#404)', () => {
  test('only the record of a tool call’s arguments masks its names and tags', () => {
    const root = join(import.meta.dirname, '../src')
    const users = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => /\bmaskArguments\(/.test(readFileSync(join(root, file), 'utf8')))
      .map((file) => relative(root, join(root, file)).replaceAll('\\', '/'))
      .toSorted()
    expect(users).toEqual(['engine/secrets.ts', 'engine/tools/gate.ts'])
  })
})
