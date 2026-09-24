/**
 * The commands and the Context view, as the window asks the engine for them (design D6-10,
 * D6-12).
 *
 * The channels are the engine's use cases relayed as they are: what is under test is what a page
 * asking `commands.*` and `context.read` is answered, over the whole engine on the fake agent —
 * the catalogue the settings edit, the runs the Commands panel starts, reads and stops, and the
 * two lists of the Context view. Each suite is named after the scenario of the issue it plays.
 */

import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { AGENTS_FILE, offeredTools } from '@hemera/core'
import type { CommandRun } from '@hemera/ipc'

import { fakeAgent } from '#engine/agents/fake.ts'

import { withQualifiedOpenCode } from './unqualified.ts'
import { type OpenWindow, openWindow } from './window.ts'

let dataFolder: string
let workspace: string
let opened: OpenWindow | null = null

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-tool-channels-'))
  workspace = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-tool-channels-workspace-')))
})

afterEach(async () => {
  await opened?.close()
  opened = null
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workspace, { recursive: true, force: true })
})

/** A line that publishes an address and stays up, as a dev server does. */
const PUBLISHES_AN_ADDRESS = `"${process.execPath}" -e "console.log('http://localhost:4391');setInterval(()=>{},1000)"`

/** Waits in real time for what a read answers to be ready, and answers the last read. */
async function until<A>(read: () => Promise<A>, ready: (seen: A) => boolean): Promise<A> {
  let seen = await read()
  for (let tries = 0; tries < 200 && !ready(seen); tries += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each look waits for the one before it: this is a poll
    await new Promise((resolve) => setTimeout(resolve, 25))
    // oxlint-disable-next-line no-await-in-loop -- the same poll, reading again after the pause
    seen = await read()
  }
  return seen
}

/** A Project on the workspace, with one repository declared under it. */
async function aProject(window: OpenWindow) {
  mkdirSync(join(workspace, 'api'), { recursive: true })
  const made = await window.bridge.invoke('projects.create', {
    name: 'Atlas',
    tone: 'primary',
    mainPath: workspace,
  })
  return await window.bridge.invoke('repositories.add', {
    id: made.id,
    version: made.version,
    relativePath: 'api',
  })
}

describe('The catalogue is edited and read', () => {
  test('a command in a repository is listed with its kind and folder, and edited in place', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    const { bridge } = opened
    const project = await aProject(opened)

    const made = await bridge.invoke('commands.create', {
      projectId: project.id,
      name: 'check',
      line: 'pnpm check',
      kind: 'check',
      folder: 'api',
    })
    // The folder is stored the way the Project declares its repository.
    expect(made.folder).toBe('./api')
    expect(await bridge.invoke('commands.list', { projectId: project.id })).toEqual([made])

    const edited = await bridge.invoke('commands.update', {
      projectId: project.id,
      name: 'check',
      line: 'pnpm test',
      kind: 'check',
      folder: null,
    })
    expect(edited.id).toBe(made.id)
    const listed = await bridge.invoke('commands.list', { projectId: project.id })
    expect(listed.map((one) => [one.name, one.line, one.folder])).toEqual([
      ['check', 'pnpm test', null],
    ])

    await bridge.invoke('commands.remove', { projectId: project.id, name: 'check' })
    expect(await bridge.invoke('commands.list', { projectId: project.id })).toEqual([])
  })

  test('a name the catalogue holds is refused with the engine sentence, and so is a stray folder', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    const { bridge } = opened
    const project = await aProject(opened)
    const draft = { projectId: project.id, name: 'dev', line: 'pnpm dev', kind: 'app' as const }
    await bridge.invoke('commands.create', { ...draft, folder: null })

    await expect(bridge.invoke('commands.create', { ...draft, folder: null })).rejects.toThrow(
      'a command named dev is already in this Project: it is refused, not replaced',
    )
    await expect(
      bridge.invoke('commands.create', { ...draft, name: 'web', folder: 'elsewhere' }),
    ).rejects.toThrow(
      "a command runs in the Workspace root or in one of the Project's repositories",
    )
    await expect(
      bridge.invoke('commands.update', { ...draft, name: 'nothing', folder: null }),
    ).rejects.toThrow('this Project has no command named "nothing"')
  })
})

describe('The agent starts the app and the user opens it', () => {
  test('the panel runs a command by name, reads its address and output, and stops it', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    const { bridge, pushed } = opened
    const project = await aProject(opened)
    const session = await bridge.invoke('sessions.create', {
      projectId: project.id,
      provider: 'claude',
    })
    await bridge.invoke('commands.create', {
      projectId: project.id,
      name: 'dev',
      line: PUBLISHES_AN_ADDRESS,
      kind: 'app',
      folder: null,
    })

    const started = await bridge.invoke('commands.run', { sessionId: session.id, name: 'dev' })
    expect(started.state).toBe('running')
    expect(started.cwd).toBe(workspace)

    const runs = await until(
      () => bridge.invoke('commands.runs', { sessionId: session.id }),
      (seen) => seen[0]?.url != null,
    )
    expect(runs.map((one) => [one.name, one.state, one.url])).toEqual([
      ['dev', 'running', 'http://localhost:4391'],
    ])
    const output = await bridge.invoke('commands.output', {
      sessionId: session.id,
      runId: started.id,
    })
    expect(output.output).toContain('http://localhost:4391')
    // The window heard the run as it went, the run whole and not a line of it.
    const heard = await until(
      () => Promise.resolve(pushed.flatMap((event) => (event.event === 'run' ? [event.run] : []))),
      (seen: readonly CommandRun[]) => seen.some((one) => one.url === 'http://localhost:4391'),
    )
    expect(heard.some((one) => one.url === 'http://localhost:4391')).toBe(true)
    // And the thread holds it once, as the entry the Commands panel and the thread share.
    const thread = await bridge.invoke('sessions.read', { sessionId: session.id })
    expect(thread.entries.filter((entry) => entry.kind === 'command_run')).toHaveLength(1)

    const stopped = await bridge.invoke('commands.stop', {
      sessionId: session.id,
      runId: started.id,
    })
    expect(stopped.state).toBe('stopped')
  })

  test('a one-off line runs in the Workspace root and does not enter the catalogue', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    const { bridge } = opened
    const project = await aProject(opened)
    const session = await bridge.invoke('sessions.create', {
      projectId: project.id,
      provider: 'claude',
    })

    const line = `"${process.execPath}" -e "console.log('once')"`
    const run = await bridge.invoke('commands.run', { sessionId: session.id, line })
    expect(run.commandId).toBeNull()
    expect(run.cwd).toBe(workspace)
    const ended = await until(
      () => bridge.invoke('commands.output', { sessionId: session.id, runId: run.id }),
      (seen) => seen.state !== 'running',
    )
    expect(ended.state).toBe('exited')
    expect(await bridge.invoke('commands.list', { projectId: project.id })).toEqual([])
  })
})

describe('The view lists the sources with their provenance', () => {
  withQualifiedOpenCode()

  test('the base and AGENTS.md with how they reached the agent, the tools and the catalogue', async () => {
    writeFileSync(join(workspace, AGENTS_FILE), '# Atlas\n\nKeep the tests green.\n')
    opened = await openWindow(dataFolder, fakeAgent({ steps: [{ does: 'says', text: 'ok' }] }))
    const { bridge } = opened
    const project = await aProject(opened)
    await bridge.invoke('commands.create', {
      projectId: project.id,
      name: 'check',
      line: 'pnpm check',
      kind: 'check',
      folder: null,
    })
    const session = await bridge.invoke('sessions.create', {
      projectId: project.id,
      provider: 'opencode',
    })
    await bridge.invoke('agents.prompt', { sessionId: session.id, text: 'hello' })

    const view = await bridge.invoke('context.read', { sessionId: session.id })

    expect(view.provided.map((one) => [one.kind, one.path, one.reached])).toEqual([
      ['base', '', 'embedded_resource'],
      ['provided', AGENTS_FILE, 'session_start'],
    ])
    expect(view.provided[1]?.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(view.tools.map((one) => one.name)).toEqual([...offeredTools('free')])
    expect(view.tools.find((one) => one.name === 'search')?.bound).toBe(
      '200 matches and 1 MiB scanned a call',
    )
    expect(view.commands).toEqual([{ name: 'check', line: 'pnpm check' }])
  })

  test('a define Session lists the define set: the Spec tools and no write tool', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    const { bridge } = opened
    const project = await aProject(opened)
    const session = await bridge.invoke('sessions.create', {
      projectId: project.id,
      provider: 'claude',
    })
    await bridge.invoke('specs.create', {
      sessionId: session.id,
      type: 'feature',
      title: 'Export the Journal',
    })

    const view = await bridge.invoke('context.read', { sessionId: session.id })

    const listed = view.tools.map((one) => one.name)
    expect(listed).toEqual([...offeredTools('define')])
    expect(listed).toContain('spec_write')
    expect(listed).not.toContain('fs_write')
    expect(listed).not.toContain('commands_run')
  })
})
