/**
 * The agent of the headless end-to-end suite: the fake agent of #32 answering for Claude Code,
 * scripted by the suite, so the packaged engine never starts a real agent while it runs. The
 * other agents are not installed there, whatever this machine has.
 */

import { realpathSync } from 'node:fs'

import { AgentNotInstalled } from '@hemera/ipc'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { Discovery } from '../src/engine/agents/discovery.ts'
import { suiteAgent, suiteFor } from '../src/engine/agents/suite-agent.ts'
import { Chats } from '../src/engine/chat/service.ts'
import { transcriptOf } from '../src/engine/chat/store.ts'
import { createProject } from '../src/engine/projects.ts'
import { commandsEngine } from './commands-engine.ts'
import { FAST, until, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('suite-agent'))
  work = realpathSync.native(temporaryFolder('suite-agent-work'))
})
afterEach(removeFolders)

describe('The suite’s agent', () => {
  test('it is built only when main hands the engine the probe’s port, whatever the environment', async () => {
    const variable = process.env['HEMERA_E2E_HEADLESS']
    process.env['HEMERA_E2E_HEADLESS'] = '1'
    try {
      expect(await Effect.runPromise(suiteFor(undefined))).toBeNull()
      expect(await Effect.runPromise(suiteFor({}))).not.toBeNull()
    } finally {
      if (variable === undefined) delete process.env['HEMERA_E2E_HEADLESS']
      else process.env['HEMERA_E2E_HEADLESS'] = variable
    }
  })

  test('Claude Code is installed and signed in; the other agents are not installed', async () => {
    const agent = await Effect.runPromise(suiteAgent)
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const discovery = yield* Discovery
        const listed = yield* discovery.list
        const claude = yield* discovery.resolve('claude')
        const codex = yield* Effect.flip(discovery.resolve('codex'))
        return { listed, claude, codex }
      }).pipe(Effect.provide(agent.sessions.discovery)),
    )
    expect(seen.listed.map(({ id, installed, signedIn }) => ({ id, installed, signedIn }))).toEqual(
      [
        { id: 'claude', installed: true, signedIn: true },
        { id: 'codex', installed: false, signedIn: false },
        { id: 'opencode', installed: false, signedIn: false },
      ],
    )
    expect(seen.claude.adapter.id).toBe('claude')
    expect(seen.codex).toBeInstanceOf(AgentNotInstalled)
  })

  test('a Chat’s message is answered as the script given last says', async () => {
    const agent = await Effect.runPromise(suiteAgent)
    const run = commandsEngine(data, { sessions: { ...agent.sessions, timings: FAST } })
    const entries = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* createProject({
            name: 'Acme',
            mainCheckout: work,
            repositories: [],
          })
          yield* agent.script({ steps: [{ does: 'says', text: 'It is in api/export.ts.' }] })
          const chat = yield* Chats.use((chats) => chats.create(project.id))
          yield* Chats.use((chats) => chats.send(chat.id, 'Where are the invoices exported?', []))
          yield* until(
            Effect.map(transcriptOf(chat.id, null), (page) =>
              JSON.stringify(page.entries).includes('It is in api/export.ts.'),
            ),
          )
          return (yield* transcriptOf(chat.id, null)).entries
        }),
      ),
    )
    expect(JSON.stringify(entries)).toContain('Where are the invoices exported?')
  })
})
