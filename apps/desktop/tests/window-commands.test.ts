/**
 * The runs of a Session as the window holds them: the thread's block and the Commands panel
 * (design D6-12).
 *
 * Over the whole engine on the fake agent, with the tools store listening as the application
 * does: what is under test is that a run the agent started reaches the page as it goes — its
 * address, what it printed — and that the entry of the thread and the run the panel reads are the
 * same run.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { fakeAgent } from '#engine/agents/fake.ts'
import { commandRunOf } from '#renderer/agent-tool-payloads.ts'
import { agentOf, listenToAgents, say } from '#renderer/agent-store.ts'
import { listenToTools, readRuns, runsOf, stopRun } from '#renderer/tools-store.ts'

import { type OpenWindow, install, openWindow } from './window.ts'

let dataFolder: string
let workspace: string
let opened: OpenWindow | null = null
let stops: (() => void)[] = []

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-window-commands-'))
  workspace = realpathSync(mkdtempSync(join(tmpdir(), 'hemera-window-commands-workspace-')))
})

afterEach(async () => {
  for (const stop of stops) stop()
  stops = []
  await opened?.close()
  opened = null
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workspace, { recursive: true, force: true })
})

/** A line that publishes an address and stays up, as a dev server does. */
const PUBLISHES_AN_ADDRESS = `"${process.execPath}" -e "console.log('http://localhost:4392');setInterval(()=>{},1000)"`

/** Waits for the stores to hold what is waited for, in real time. */
async function until(ready: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !ready(); tries += 1) {
    // oxlint-disable-next-line no-await-in-loop -- a poll: each look waits for the one before it
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('The agent starts the app and the user opens it', () => {
  test('the run the agent started reaches the page with its address, in the thread and the panel', async () => {
    opened = await openWindow(
      dataFolder,
      fakeAgent({
        steps: [{ does: 'uses', call: 'commands_run', arguments: { name: 'dev', key: 'dev-1' } }],
      }),
    )
    install(opened.bridge)
    stops = [listenToAgents(), listenToTools()]
    const { bridge } = opened
    const project = await bridge.invoke('projects.create', {
      name: 'Atlas',
      tone: 'primary',
      mainPath: workspace,
    })
    await bridge.invoke('commands.create', {
      projectId: project.id,
      name: 'dev',
      line: PUBLISHES_AN_ADDRESS,
      type: 'serve',
      lineWindows: null,
      lineLinux: null,
      scope: 'workspace',
      portless: false,
      folder: null,
    })
    const session = await bridge.invoke('sessions.create', {
      projectId: project.id,
      provider: 'claude',
    })

    await say(session.id, 'start the app')
    await until(() => runsOf(session.id)[0]?.url === 'http://localhost:4392')

    // The panel's list, heard as it went.
    const [run] = runsOf(session.id)
    expect(run?.name).toBe('dev')
    expect(run?.state).toBe('running')
    expect(run?.output).toContain('http://localhost:4392')
    // The thread's block is the same run: its entry, drawn with what the run pushed since.
    const entry = agentOf(session.id).entries.find((one) => one.kind === 'command_run')
    const drawn = entry === undefined ? null : commandRunOf(entry, runsOf(session.id))
    expect(drawn?.url).toBe('http://localhost:4392')
    expect(drawn?.output).toContain('http://localhost:4392')

    // Read again, as a Session opened later reads it, it is the same run.
    await readRuns(session.id)
    expect(runsOf(session.id).map((one) => one.id)).toEqual([run?.id])

    // The user stops it from the page, and the page shows it stopped.
    await stopRun(session.id, run?.id ?? '')
    expect(runsOf(session.id)[0]?.state).toBe('stopped')
  })
})
