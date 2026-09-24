/**
 * A command the agent proposes, as the window draws and decides it (design D8-11).
 *
 * Over the whole engine on the fake agent, with the stores listening as the application does:
 * the proposal reaches the thread as an entry the block reads, Accept and Decline go through the
 * tools store, the outcome comes back as the same entry, and a refusal is the engine's sentence.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { fakeAgent } from '#engine/agents/fake.ts'
import { agentOf, listenToAgents, say } from '#renderer/agent-store.ts'
import { commandProposalOf } from '#renderer/agent-tool-payloads.ts'
import {
  acceptProposal,
  catalogueOf,
  declineProposal,
  listenToTools,
} from '#renderer/tools-store.ts'

import { type OpenWindow, install, openWindow } from './window.ts'

let dataFolder: string
let workspace: string
let opened: OpenWindow | null = null
let stops: (() => void)[] = []

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-window-proposals-'))
  workspace = realpathSync(mkdtempSync(join(tmpdir(), 'hemera-window-proposals-workspace-')))
})

afterEach(async () => {
  for (const stop of stops) stop()
  stops = []
  await opened?.close()
  opened = null
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workspace, { recursive: true, force: true })
})

/** Waits for the stores to hold what is waited for, in real time. */
async function until(ready: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !ready(); tries += 1) {
    // oxlint-disable-next-line no-await-in-loop -- a poll: each look waits for the one before it
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** A proposal as the agent makes it, at the Workspace root. */
const proposing = (name: string) => ({
  does: 'uses' as const,
  call: 'commands_propose',
  arguments: {
    name,
    line: `node scripts/${name}.js`,
    type: 'script',
    why: `the ${name} is run before every test`,
  },
})

describe('A proposal enters the catalogue only when accepted', () => {
  test('accepted, declined, and refused when the name was taken meanwhile', async () => {
    opened = await openWindow(
      dataFolder,
      fakeAgent({ steps: [proposing('seed'), proposing('reset'), proposing('fixtures')] }),
    )
    install(opened.bridge)
    stops = [listenToAgents(), listenToTools()]
    const { bridge } = opened
    const project = await bridge.invoke('projects.create', {
      name: 'Atlas',
      tone: 'primary',
      mainPath: workspace,
    })
    const session = await bridge.invoke('sessions.create', {
      projectId: project.id,
      provider: 'claude',
    })

    await say(session.id, 'look for what is worth keeping')
    /** The proposals of the thread as the blocks read them, by name. */
    const proposals = () =>
      new Map(
        agentOf(session.id)
          .entries.map((entry) => commandProposalOf(entry))
          .flatMap((drawn) => (drawn === null ? [] : [[drawn.name, drawn] as const])),
      )
    await until(() => proposals().size === 3)
    expect([...proposals().values()].map((one) => one.state)).toEqual([
      'pending',
      'pending',
      'pending',
    ])
    expect(await bridge.invoke('commands.list', { projectId: project.id })).toEqual([])

    // Accepted: in the catalogue after the click, and the block redrawn in its outcome.
    expect(await acceptProposal(session.id, proposals().get('seed')?.proposalId ?? '')).toBeNull()
    await until(() => proposals().get('seed')?.state === 'accepted')
    expect(proposals().get('seed')?.state).toBe('accepted')
    expect(catalogueOf(project.id).map((one) => one.name)).toEqual(['seed'])

    // Declined: never in it.
    expect(await declineProposal(session.id, proposals().get('reset')?.proposalId ?? '')).toBeNull()
    await until(() => proposals().get('reset')?.state === 'declined')
    expect(proposals().get('reset')?.state).toBe('declined')

    // A name the catalogue took since: refused in the engine's words, the proposal still pending.
    await bridge.invoke('commands.create', {
      projectId: project.id,
      name: 'fixtures',
      line: 'node scripts/other.js',
      lineWindows: null,
      lineLinux: null,
      type: 'script',
      folder: null,
      scope: 'workspace',
      portless: false,
    })
    expect(await acceptProposal(session.id, proposals().get('fixtures')?.proposalId ?? '')).toBe(
      'a command named fixtures is already in this Project: it is refused, not replaced',
    )
    expect(proposals().get('fixtures')?.state).toBe('pending')

    const catalogue = await bridge.invoke('commands.list', { projectId: project.id })
    expect(catalogue.map((one) => one.name).toSorted()).toEqual(['fixtures', 'seed'])
  })
})
