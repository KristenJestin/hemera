/**
 * A tool of Hemera's asking the human, as the window hears it and answers it (design D5-09,
 * D6-05).
 *
 * The question travels the road the agent's own questions travel: a `permission_request` entry
 * pushed to the page, the block of D5-09 drawn from it, and `agents.decide` for the answer. What
 * is under test is that road, from the agent store: the fake agent writes outside the Workspace
 * root through `fs_write`, the page sees the question with the place resolved and two options
 * for this call only, and the answer it sends is what happens.
 */

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { z } from 'zod'

import type { SessionEntry } from '@hemera/ipc'

import { fakeAgent } from '#engine/agents/fake.ts'
import { agentOf, decide, listenToAgents, say, stopTurn } from '#renderer/agent-store.ts'

import { type OpenWindow, install, openWindow } from './window.ts'

let dataFolder: string
let workspace: string
let outside: string
let opened: OpenWindow | null = null
let stop: () => void = () => undefined

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-window-permissions-'))
  workspace = mkdtempSync(join(tmpdir(), 'hemera-window-permissions-workspace-'))
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'hemera-window-permissions-outside-')))
})

afterEach(async () => {
  stop()
  await opened?.close()
  opened = null
  for (const folder of [dataFolder, workspace, outside]) {
    rmSync(folder, { recursive: true, force: true })
  }
})

/** What a question of Hemera's tools carries, as the block reads it. */
const QUESTION = z.object({
  tool: z.string(),
  resolved: z.string(),
  options: z.array(z.object({ optionId: z.string(), kind: z.string() })),
})

/** The question the page is waiting on, as the agent store holds the thread. */
function pendingIn(entries: readonly SessionEntry[]): SessionEntry | undefined {
  return entries.find(
    (entry) =>
      entry.kind === 'permission_request' && entry.role === 'hemera' && entry.state === 'pending',
  )
}

/** Waits for the store to hold what is waited for, in real time. */
async function until(ready: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !ready(); tries += 1) {
    // oxlint-disable-next-line no-await-in-loop -- a poll: each look waits for the one before it
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** The window open on a Session whose agent writes a file outside the Workspace root. */
async function aSessionWritingOutside(target: string) {
  opened = await openWindow(
    dataFolder,
    fakeAgent({
      steps: [
        { does: 'uses', call: 'fs_write', arguments: { path: target, content: 'hi', key: 'w1' } },
        { does: 'says', text: 'done' },
      ],
    }),
  )
  install(opened.bridge)
  stop = listenToAgents()
  const project = await opened.bridge.invoke('projects.create', {
    name: 'Atlas',
    tone: 'primary',
    mainPath: workspace,
  })
  return await opened.bridge.invoke('sessions.create', {
    projectId: project.id,
    provider: 'claude',
  })
}

describe('A write outside the root asks the human', () => {
  test('the page sees the question with the resolved place, allows it once, and it is written once', async () => {
    const target = join(outside, 'notes.md')
    const session = await aSessionWritingOutside(target)

    const turn = say(session.id, 'write the notes')
    await until(() => pendingIn(agentOf(session.id).entries) !== undefined)
    const question = pendingIn(agentOf(session.id).entries)
    expect(question).toBeDefined()
    // Nothing was written while the human had not answered.
    expect(existsSync(target)).toBe(false)
    const asked = QUESTION.parse(JSON.parse(question?.payload ?? '{}'))
    expect(asked.tool).toBe('fs_write')
    expect(asked.resolved).toBe(target)
    // Two options, for this call only: nothing offers an "always".
    expect(asked.options.map((option) => option.kind).sort()).toEqual(['allow_once', 'reject_once'])

    await decide(session.id, 'allowed')
    expect(await turn).toBeNull()

    expect(readFileSync(target, 'utf8')).toBe('hi')
    const entries = agentOf(session.id).entries
    expect(pendingIn(entries)).toBeUndefined()
    expect(entries.some((entry) => entry.kind === 'permission_decision')).toBe(true)
    expect(
      entries.filter((entry) => entry.kind === 'hemera_tool_call').map((entry) => entry.state),
    ).toEqual(['completed'])
  })

  test('refused, nothing is written', async () => {
    const target = join(outside, 'notes.md')
    const session = await aSessionWritingOutside(target)

    const turn = say(session.id, 'write the notes')
    await until(() => pendingIn(agentOf(session.id).entries) !== undefined)
    await decide(session.id, 'refused')
    await turn

    expect(existsSync(target)).toBe(false)
    expect(
      agentOf(session.id)
        .entries.filter((entry) => entry.kind === 'hemera_tool_call')
        .map((entry) => entry.state),
    ).toEqual(['failed'])
  })

  test('a question the turn is stopped under is cancelled, and nothing is written', async () => {
    const target = join(outside, 'notes.md')
    const session = await aSessionWritingOutside(target)

    const turn = say(session.id, 'write the notes')
    await until(() => pendingIn(agentOf(session.id).entries) !== undefined)
    await stopTurn(session.id)
    await turn

    expect(existsSync(target)).toBe(false)
    const entries = agentOf(session.id).entries
    const closed = entries.find(
      (entry) => entry.kind === 'permission_request' && entry.role === 'hemera',
    )
    expect(closed?.state).toBe('cancelled')
    expect(pendingIn(entries)).toBeUndefined()
  })
})
