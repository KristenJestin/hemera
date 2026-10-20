/**
 * A record the engine builds, its names and tags fixed by a schema, is stored masked and read back
 * whole, whatever value a project variable holds (#404, round 2). The engine is the real one, in
 * temporary folders.
 */

import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, relative } from 'node:path'

import {
  DecisionFields,
  MASK,
  MissionOwner,
  PermissionAnswer,
  SETTINGS_SECTIONS,
} from '@hemera/core/domain'
import { APP_SECTIONS } from '@hemera/ui'
import { eq } from 'drizzle-orm'
import { Effect, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { PROOF_LIMIT_SECTION } from '../src/engine/building/proofs.ts'
import {
  AGENT_REQUESTS,
  answerNeed,
  createNeed,
  getNeed,
  requestFromAgent,
} from '../src/engine/needs.ts'
import { HEMERA_AUTO_SECTION } from '../src/engine/permissions/hemera-auto.ts'
import { Secrets } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import { needs, permissionRequests } from '../src/engine/storage/schema.ts'
import { cardOf } from '../src/renderer/needs.ts'
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

describe('A need Hemera writes keeps the settings section it links to (#416)', () => {
  test('every section the engine links a need to, and every one the window opens, is kept whole', () => {
    const linked = [HEMERA_AUTO_SECTION, PROOF_LIMIT_SECTION, 'models', 'agents']
    expect(SETTINGS_SECTIONS).toEqual(expect.arrayContaining([...linked, ...APP_SECTIONS.keys()]))
  })

  test('with the variable `hemera`, the permission need keeps `settingsSection: "hemera-auto"` and its link works', async () => {
    const verdicts = verdictsSaying(() => ({
      verdict: 'ask',
      reason: 'no rule allows it for hemera',
      by: 'suite',
      settingsSection: 'hemera-auto',
    }))
    const need = await commandsEngine(data, { tools: { verdicts: verdicts.layer } })(
      ({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            yield* Secrets.useSync((secrets) => secrets.register('suite', ['hemera']))
            const { mission, main } = yield* acmeWithMission(work)
            const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
            yield* callTool(builder.grantId, 'fs_write', { path: 'notes.md', content: 'x' })
            const database = yield* Database
            const [row] = yield* until(
              database.select().from(permissionRequests),
              (rows) => rows.length > 0,
            )
            if (row === undefined) return yield* Effect.die(new Error('no request'))
            return yield* getNeed(row.needId)
          }),
        ),
    )
    expect(need.fields).toMatchObject({
      settingsSection: 'hemera-auto',
      hemeraReason: `no rule allows it for ${MASK}`,
    })
    expect(cardOf(need, new Date()).ask).toMatchObject({
      settings: APP_SECTIONS.get('hemera-auto'),
    })
  })

  test('an environment need an agent asks for masks the section it names', async () => {
    const [need, stored] = await commandsEngine(data, {
      missions: { grants: { holds: () => Effect.succeed(true) } },
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          yield* Secrets.useSync((secrets) => secrets.register('suite', ['hemera']))
          const { mission } = yield* acmeWithMission(work)
          const asked = yield* requestFromAgent(
            { id: 'session-1', role: 'builder', missionId: mission.id },
            'Environment',
            { missing: 'a judge', action: 'Set one up', settingsSection: 'hemera-auto' },
            null,
          )
          const database = yield* Database
          const rows = yield* database.select({ fields: needs.fields }).from(needs)
          return [yield* getNeed(asked.id), rows[0]?.fields ?? ''] as const
        }),
      ),
    )
    expect(need.fields).toMatchObject({ settingsSection: `${MASK}-auto` })
    expect(stored).not.toContain('hemera')
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
