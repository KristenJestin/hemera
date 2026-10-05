/**
 * The intent and the outcome of every action with an effect outside the database: an engine that
 * stops between the two leaves an intent that is perhaps done. At the next start it is
 * indeterminate, the post-condition of its kind says what the world shows when it can, and an
 * action that has none is never run again on its own: its handler, once registered, is called
 * once, after the reconciliation.
 */

import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  type EffectfulAction,
  EffectfulActions,
  actionRulesLayer,
  listActions,
} from '../src/engine/tools/actions.ts'
import { fingerprintOf } from '../src/engine/tools/read.ts'
import { Database } from '../src/engine/storage/database.ts'
import { commandRuns } from '../src/engine/storage/schema.ts'
import { commandsEngine } from './commands-engine.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('actions'))
  work = realpathSync.native(temporaryFolder('actions-work'))
})
afterEach(removeFolders)

const fingerprint = (text: string) => fingerprintOf(Buffer.from(text, 'utf8'))

const OWNER = { kind: 'mission', missionId: 'mission-1', taskId: null } as const

/** Writes an intent and nothing more: what an engine killed before the outcome leaves. */
const intentOf = (kind: string, details: Parameters<EffectfulActions['Service']['begin']>[2]) =>
  EffectfulActions.use((actions) => actions.begin(kind, OWNER, details))

describe('An engine killed between the intent and the outcome of an action', () => {
  test('a file write is done, failed or indeterminate at restart, by the file’s fingerprint', async () => {
    const files = ['written.txt', 'untouched.txt', 'changed.txt'].map((name) => join(work, name))
    for (const file of files) writeFileSync(file, 'before\n')
    const ids = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.forEach(files, (path) =>
          intentOf('file.write', {
            path,
            before: fingerprint('before\n'),
            after: fingerprint('after\n'),
          }),
        ),
      ),
    )
    // What the world shows when the engine comes back.
    writeFileSync(files[0] ?? '', 'after\n')
    writeFileSync(files[2] ?? '', 'someone else\n')

    const actions = await commandsEngine(data)(({ profile }) => profile.use(listActions()))
    expect(actions.map((action) => [action.id, action.state])).toEqual([
      [ids[0], 'done'],
      [ids[1], 'failed'],
      [ids[2], 'indeterminate'],
    ])
    expect(readFileSync(files[2] ?? '', 'utf8')).toBe('someone else\n')
  })

  test('a command becomes indeterminate and is never run again', async () => {
    await commandsEngine(data)(({ profile }) =>
      profile.use(intentOf('command.run', { command: null, line: 'node --version', folder: null })),
    )
    const [actions, runs] = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const database = yield* Database
          return [yield* listActions(), yield* database.select().from(commandRuns)] as const
        }),
      ),
    )
    expect(actions).toMatchObject([{ kind: 'command.run', state: 'indeterminate' }])
    expect(runs).toEqual([])
  })

  test('the handler of an indeterminate action is called once, after the start, and never again', async () => {
    await commandsEngine(data)(({ profile }) =>
      profile.use(intentOf('command.run', { command: null, line: 'npm test', folder: null })),
    )
    const handed: EffectfulAction[] = []
    const rules = actionRulesLayer({
      handlers: new Map([
        ['command.run', (action: EffectfulAction) => Effect.sync(() => void handed.push(action))],
      ]),
    })
    const waitForHandler = Effect.gen(function* () {
      for (let tries = 0; tries < 100 && handed.length === 0; tries += 1) {
        yield* Effect.sleep('20 millis')
      }
    })
    await commandsEngine(data, { actionRules: rules })(() => waitForHandler)
    await commandsEngine(data, { actionRules: rules })(() => Effect.sleep('200 millis'))
    expect(handed).toHaveLength(1)
    expect(handed[0]).toMatchObject({
      kind: 'command.run',
      state: 'indeterminate',
      owner: OWNER,
      details: { line: 'npm test' },
    })
  })
})

describe('An action that ends records its outcome', () => {
  test('done or failed, with what happened, masked', async () => {
    const actions = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const service = yield* EffectfulActions
          const one = yield* service.begin('command.run', OWNER, { line: 'node a.js' })
          const two = yield* service.begin('command.run', OWNER, { line: 'node b.js' })
          yield* service.done(one, 'done, exit code 0')
          yield* service.failed(two, 'it did not start: Bearer abcdefghijklmnop')
          return yield* listActions()
        }),
      ),
    )
    expect(actions.map((action) => [action.state, action.outcome])).toEqual([
      ['done', 'done, exit code 0'],
      ['failed', 'it did not start: Bearer •••'],
    ])
  })
})
