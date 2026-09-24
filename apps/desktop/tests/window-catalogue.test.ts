/**
 * "Add to catalogue" on a one-off run, as the window does it (design D8-11).
 *
 * Over the whole engine, with the tools store listening as the application does: a line run from
 * the Commands panel stays a one-off and out of the catalogue, until the human adds it — under
 * the run's name, with the line it ran, as a `script` at the Workspace root — and the run itself
 * is not rewritten. A second press is the engine's refusal, in its words.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { fakeAgent } from '#engine/agents/fake.ts'
import {
  addToCatalogue,
  catalogueOf,
  listenToTools,
  readRuns,
  runCommand,
  runsOf,
} from '#renderer/tools-store.ts'

import { type OpenWindow, install, openWindow } from './window.ts'

let dataFolder: string
let workspace: string
let opened: OpenWindow | null = null
let stops: (() => void)[] = []

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-window-catalogue-'))
  workspace = realpathSync(mkdtempSync(join(tmpdir(), 'hemera-window-catalogue-workspace-')))
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

/** A line that ends well, run once from the panel. */
const ONE_OFF = `"${process.execPath}" -e "process.exit(0)"`

describe('A one-off execution stays out of the catalogue', () => {
  test('until the human adds it, and the run stays a one-off', async () => {
    opened = await openWindow(dataFolder, fakeAgent({ steps: [] }))
    install(opened.bridge)
    stops = [listenToTools()]
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

    expect(await runCommand(session.id, { line: ONE_OFF })).toBeNull()
    await until(() => runsOf(session.id)[0]?.state === 'exited')
    const [run] = runsOf(session.id)
    expect(run?.commandId).toBeNull()
    expect(await bridge.invoke('commands.list', { projectId: project.id })).toEqual([])

    // The human's click: the run's name, the line it ran, a script at the root, the defaults.
    expect(run === undefined ? 'no run' : await addToCatalogue(run)).toBeNull()
    expect(catalogueOf(project.id)).toEqual([
      expect.objectContaining({
        name: run?.name,
        line: ONE_OFF,
        lineWindows: null,
        lineLinux: null,
        type: 'script',
        folder: null,
        scope: 'workspace',
        portless: false,
      }),
    ])

    // The run is what it was: a one-off.
    await readRuns(session.id)
    expect(runsOf(session.id).map((one) => one.commandId)).toEqual([null])

    // Pressed again, the name is taken: the engine's sentence, and nothing replaced.
    expect(run === undefined ? null : await addToCatalogue(run)).toBe(
      `a command named ${run?.name ?? ''} is already in this Project: it is refused, not replaced`,
    )
    expect(catalogueOf(project.id)).toHaveLength(1)
  })
})
