/**
 * A change of the Workspace's instructions, as the window sees it arrive (design D6-08).
 *
 * The engine watches the `AGENTS.md` at the Workspace root while a Session's agent runs. What is
 * under test is the whole road, from the agent store and the tools store over the engine on the
 * fake agent: the file changes while a turn runs, nothing is handed over during that turn, and
 * once it ends a delivery goes out on its own — no second prompt from anyone — with its entry in
 * the thread, the Context view listing it, and no message of anyone added.
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { AGENTS_FILE, DELIVERY_MARKER } from '@hemera/core'

import { fakeAgent } from '#engine/agents/fake.ts'
import { agentOf, listenToAgents, say } from '#renderer/agent-store.ts'
import { contextOf, listenToTools, readContext } from '#renderer/tools-store.ts'

import { gated } from './application.ts'
import { type OpenWindow, install, openWindow } from './window.ts'

let dataFolder: string
let workspace: string
let opened: OpenWindow | null = null
let stops: (() => void)[] = []

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-window-delivery-'))
  workspace = mkdtempSync(join(tmpdir(), 'hemera-window-delivery-workspace-'))
})

afterEach(async () => {
  for (const stop of stops) stop()
  stops = []
  await opened?.close()
  opened = null
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workspace, { recursive: true, force: true })
})

/** Waits in real time for what is waited for, and says whether it came. */
async function until(ready: () => boolean): Promise<boolean> {
  for (let tries = 0; tries < 200 && !ready(); tries += 1) {
    // oxlint-disable-next-line no-await-in-loop -- a poll: each look waits for the one before it
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return ready()
}

/** A pause in real time, longer than the instructions are given to settle. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 800))

describe('A change during a turn leaves at the next safe point', () => {
  test('nothing goes during the turn; after it, a delivery on its own and no message of anyone', async () => {
    writeFileSync(join(workspace, AGENTS_FILE), 'Be brief.\n')
    const gate = gated(1)
    const agent = fakeAgent({
      steps: [
        { does: 'says', text: 'reading' },
        { does: 'says', text: 'done' },
      ],
      between: gate.between,
    })
    opened = await openWindow(dataFolder, agent)
    install(opened.bridge)
    stops = [listenToAgents(), listenToTools()]
    const project = await opened.bridge.invoke('projects.create', {
      name: 'Atlas',
      tone: 'primary',
      mainPath: workspace,
    })
    const session = await opened.bridge.invoke('sessions.create', {
      projectId: project.id,
      provider: 'opencode',
    })
    await readContext(session.id)

    const turn = say(session.id, 'start')
    await until(() => agentOf(session.id).entries.some((one) => one.body.includes('reading')))

    // The instructions change while the turn is running, and the change settles.
    writeFileSync(join(workspace, AGENTS_FILE), 'Be brief, and say why.\n')
    await settled()
    const deliveriesIn = () =>
      agentOf(session.id).entries.filter((one) => one.kind === 'context_delivery')
    expect(deliveriesIn()).toHaveLength(0)
    expect(agent.answers.prompts).toHaveLength(1)

    // The turn ends: that is the safe point, and the delivery leaves without anyone prompting.
    gate.carryOn()
    expect(await turn).toBeNull()
    expect(await until(() => deliveriesIn().length === 1)).toBe(true)
    expect(agent.answers.prompts).toHaveLength(2)
    expect(agent.answers.blocks[1]?.[0]).toEqual({ type: 'text', text: DELIVERY_MARKER })

    // The entry carries the new fingerprint, and the thread holds the one message the user wrote.
    const fingerprint = createHash('sha256')
      .update('Be brief, and say why.\n', 'utf8')
      .digest('hex')
    expect(deliveriesIn()[0]?.payload).toContain(fingerprint)
    expect(
      agentOf(session.id).entries.filter((one) => one.role === 'user' && one.kind === 'message'),
    ).toHaveLength(1)

    // The Context view heard the delivery and lists it after the base and the file.
    expect(
      await until(
        () => contextOf(session.id)?.provided.some((one) => one.kind === 'instructions') === true,
      ),
    ).toBe(true)
    expect(contextOf(session.id)?.provided.map((one) => [one.kind, one.reached])).toEqual([
      ['base', 'embedded_resource'],
      ['provided', 'session_start'],
      ['instructions', 'delivery_prompt'],
    ])
  })
})
