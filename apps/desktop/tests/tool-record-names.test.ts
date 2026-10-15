/**
 * A call whose arguments hold a secret in a field name or in a string tag: the record the gate
 * writes of it keeps neither in clear (#404). The engine is the real one, in temporary folders.
 */

import { realpathSync } from 'node:fs'

import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { MASK } from '@hemera/core/domain'

import { Secrets } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import { toolCalls } from '../src/engine/storage/schema.ts'
import { commandsEngine } from './commands-engine.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { acmeWithMission, callTool, sessionOf } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('record-names'))
  work = realpathSync.native(temporaryFolder('record-names-work'))
})
afterEach(removeFolders)

const token = `ghp_${'Q1w2E3r4T5'.repeat(2)}`
const secret = `sesame-4417 password=hunter2 ${token}`
const said = `${MASK} password=${MASK} ${MASK}`

describe('A tool call holding a secret in a field name or a tag is recorded with both masked (#404)', () => {
  test('a known value, a token and a password in a name and in a tag, at the top level and nested, are recorded masked', async () => {
    const recorded = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          yield* Secrets.useSync((secrets) => secrets.register('suite', ['sesame-4417']))
          const { mission, main } = yield* acmeWithMission(work)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          yield* callTool(builder.grantId, 'fs_read', {
            path: 'notes.md',
            [secret]: 1,
            _tag: secret,
            extra: { [token]: 'v', 'sesame-4417': 'w', list: [{ _tag: secret }] },
          })
          const database = yield* Database
          return yield* database
            .select({ arguments: toolCalls.arguments })
            .from(toolCalls)
            .where(eq(toolCalls.sessionId, builder.sessionId))
        }),
      ),
    )
    expect(recorded).toHaveLength(1)
    const text = recorded[0]?.arguments ?? ''
    for (const part of ['sesame-4417', 'hunter2', token]) expect(text).not.toContain(part)
    expect(JSON.parse(text)).toEqual({
      path: 'notes.md',
      [said]: MASK,
      _tag: said,
      extra: { [MASK]: 'v', [`${MASK} (2)`]: 'w', list: [{ _tag: said }] },
    })
  })
})
