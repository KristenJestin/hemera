/**
 * What the side column of a Session draws: the Commands tab and the Context tab (design D6-10,
 * D6-12).
 *
 * The page imports the design system's components, which need a browser; what is read here is
 * the pure module the page hands them from — the runs as the panel lists them, the tab a Session
 * opens on, and the three lists of the Context view — and, over the whole engine on the fake
 * agent, the stores those are read from.
 */

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { AGENTS_FILE } from '@hemera/core'
import type { CommandRun, ContextView } from '@hemera/ipc'

import { fakeAgent } from '#engine/agents/fake.ts'
import { listenToAgents, say } from '#renderer/agent-store.ts'
import {
  contextListsOf,
  hasSideColumn,
  openingTabOf,
  panelRunsOf,
  sideTabsOf,
} from '#renderer/side-column.ts'
import { contextOf, listenToTools, readContext, runCommand, runsOf } from '#renderer/tools-store.ts'

import { type OpenWindow, install, openWindow } from './window.ts'

/** A run as the engine pushes one. */
function aRun(id: string, cwd: string, state: CommandRun['state'], commandId: string | null) {
  return {
    id,
    projectId: 'atlas',
    sessionId: 'session-1',
    commandId,
    name: 'dev',
    line: 'pnpm dev',
    kind: 'app' as const,
    cwd,
    state,
    pid: 4242,
    url: state === 'running' ? 'http://localhost:5173' : null,
    exitCode: state === 'running' ? null : 0,
    output: 'ready\n',
    dropped: 0,
    startedAt: '2026-09-23T08:00:00.000Z',
    endedAt: null,
    joined: false,
  } satisfies CommandRun
}

describe('The agent starts the app and the user opens it', () => {
  test('the panel lists each run with its folder under the root, its address and its output', () => {
    const runs = [
      aRun('r1', '/home/ana/atlas', 'running', 'c1'),
      aRun('r2', '/home/ana/atlas/api', 'exited', null),
      aRun('r3', 'C:\\Users\\ana\\atlas\\web', 'stopped', 'c2'),
    ]

    expect(panelRunsOf(runs.slice(0, 2), '/home/ana/atlas')).toEqual([
      expect.objectContaining({
        id: 'r1',
        folder: '.',
        state: 'running',
        url: 'http://localhost:5173',
        output: 'ready\n',
        oneOff: false,
      }),
      expect.objectContaining({ id: 'r2', folder: 'api', state: 'finished', oneOff: true }),
    ])
    // A Windows root reads the same way.
    expect(panelRunsOf(runs.slice(2), 'C:\\Users\\ana\\atlas')[0]?.folder).toBe('web')
  })

  test('a Session with a command running opens on its commands', () => {
    const done = aRun('r1', '/a', 'exited', 'c1')
    const tabs = sideTabsOf(1, 0, [done], null)
    expect(openingTabOf([aRun('r1', '/a', 'running', 'c1')], tabs)).toBe('commands')
    expect(openingTabOf([done], tabs)).toBe('activity')
    // With nothing done yet, the tab that has something is the one it opens on.
    expect(openingTabOf([done], sideTabsOf(0, 0, [done], null))).toBe('commands')
  })
})

/** What the engine answers of a Session's context, with the sources and the catalogue given. */
function aView(
  provided: ContextView['provided'][number]['kind'][],
  commands: ContextView['commands'] = [],
): ContextView {
  return {
    provided: provided.map((kind) => ({
      kind,
      path: kind === 'base' ? '' : 'AGENTS.md',
      fingerprint: 'f'.repeat(64),
      deliveredAt: '2026-09-23T08:00:00.000Z',
      reached: kind === 'base' ? 'embedded_resource' : 'read_natively',
    })),
    tools: [{ name: 'fs_read', bound: '256 KiB' }],
    commands,
    private: [],
  }
}

describe('The Context tab is reachable without AGENTS.md', () => {
  test('the base alone still lists the tools, so the column opens on the Context view', () => {
    const tabs = sideTabsOf(0, 0, [], aView(['base']))

    expect(tabs.context).toBe(true)
    expect(hasSideColumn(tabs)).toBe(true)
    expect(openingTabOf([], tabs)).toBe('context')
  })
})

describe('No side column on a Session that has nothing to show', () => {
  test('no plan, no file, no run, no catalogue and no context known draw no column', () => {
    const tabs = sideTabsOf(0, 0, [], null)
    expect(tabs).toEqual({ activity: false, commands: false, context: false })
    expect(hasSideColumn(tabs)).toBe(false)
  })

  test('each tab that has something draws it, and the column opens on that tab', () => {
    const plan = sideTabsOf(2, 0, [], aView(['base']))
    expect(plan.activity).toBe(true)
    expect(openingTabOf([], plan)).toBe('activity')

    const catalogue = sideTabsOf(0, 0, [], aView(['base'], [{ name: 'check', line: 'pnpm check' }]))
    expect(catalogue.commands).toBe(true)
    expect(openingTabOf([], catalogue)).toBe('commands')

    const instructions = sideTabsOf(0, 0, [], aView(['base', 'native']))
    expect(instructions.context).toBe(true)
    expect(openingTabOf([], instructions)).toBe('context')
    expect(hasSideColumn(instructions)).toBe(true)
  })
})

describe('The view lists the sources with their provenance', () => {
  test('provided, consultable and private, each said as the view draws it', () => {
    const view: ContextView = {
      provided: [
        {
          kind: 'base',
          path: '',
          fingerprint: 'a'.repeat(64),
          deliveredAt: '2026-09-23T08:00:00.000Z',
          reached: 'embedded_resource',
        },
        {
          kind: 'native',
          path: 'AGENTS.md',
          fingerprint: 'b'.repeat(64),
          deliveredAt: '2026-09-23T08:00:00.000Z',
          reached: 'read_natively',
        },
        {
          kind: 'instructions',
          path: 'AGENTS.md',
          fingerprint: 'c'.repeat(64),
          deliveredAt: '2026-09-23T09:00:00.000Z',
          reached: 'delivery_prompt',
        },
      ],
      tools: [{ name: 'search', bound: '200 matches and 1 MiB scanned a call' }],
      commands: [{ name: 'check', line: 'pnpm check' }],
      private: [{ agent: 'OpenCode', sentence: 'its own configuration still loads.' }],
    }

    const lists = contextListsOf(view)
    expect(lists.provided.map((one) => [one.kind, one.label])).toEqual([
      ['base', 'The base'],
      ['file', 'AGENTS.md'],
      ['delivery', 'AGENTS.md'],
    ])
    expect(lists.provided[1]?.detail).toBe(`read by the agent itself · ${'b'.repeat(12)}`)
    expect(lists.provided[2]?.detail).toBe(`delivered between two turns · ${'c'.repeat(12)}`)
    expect(lists.tools).toEqual([{ name: 'search', bound: '200 matches and 1 MiB scanned a call' }])
    expect(lists.commands).toEqual([{ name: 'check', command: 'pnpm check' }])
    expect(lists.agents).toEqual([
      { name: 'OpenCode', sentence: 'its own configuration still loads.' },
    ])
  })

  test('the file Hemera gave at the start is listed as a file, said to be given then', () => {
    const view: ContextView = {
      provided: [
        {
          kind: 'provided',
          path: 'AGENTS.md',
          fingerprint: 'd'.repeat(64),
          deliveredAt: '2026-09-23T08:00:00.000Z',
          reached: 'session_start',
        },
      ],
      tools: [],
      commands: [],
      private: [],
    }

    const lists = contextListsOf(view)
    expect(lists.provided.map((one) => [one.kind, one.label])).toEqual([['file', 'AGENTS.md']])
    expect(lists.provided[0]?.detail).toBe(`given at the start of the Session · ${'d'.repeat(12)}`)
  })
})

describe('A one-off command shows and is not promoted', () => {
  let dataFolder: string
  let workspace: string
  let opened: OpenWindow | null = null
  let stops: (() => void)[] = []

  beforeEach(() => {
    dataFolder = mkdtempSync(join(tmpdir(), 'hemera-side-column-'))
    workspace = realpathSync(mkdtempSync(join(tmpdir(), 'hemera-side-column-workspace-')))
  })

  afterEach(async () => {
    for (const stop of stops) stop()
    stops = []
    await opened?.close()
    opened = null
    rmSync(dataFolder, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  })

  test('a line run from the panel shows there and in the Context tab the catalogue is unchanged', async () => {
    writeFileSync(join(workspace, AGENTS_FILE), '# Atlas\n')
    opened = await openWindow(dataFolder, fakeAgent({ steps: [{ does: 'says', text: 'ok' }] }))
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
      provider: 'opencode',
    })
    await readContext(session.id)
    // Nothing was given before the first turn, and the tools are lent all the same.
    expect(contextOf(session.id)?.provided).toEqual([])
    expect(contextOf(session.id)?.tools.length).toBeGreaterThan(0)

    await say(session.id, 'hello')
    // The turn ended, and the view the window holds was read again: the base and the file.
    for (let tries = 0; tries < 200 && (contextOf(session.id)?.provided.length ?? 0) < 2; tries++) {
      // oxlint-disable-next-line no-await-in-loop -- a poll: each look waits for the one before it
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(contextOf(session.id)?.provided.map((one) => one.kind)).toEqual(['base', 'provided'])

    const line = `"${process.execPath}" -e "console.log('once')"`
    expect(await runCommand(session.id, { line })).toBeNull()
    expect(runsOf(session.id).map((one) => [one.commandId, one.line])).toEqual([[null, line]])
    expect(panelRunsOf(runsOf(session.id), workspace)[0]?.oneOff).toBe(true)
    expect(contextOf(session.id)?.commands).toEqual([])
  })
})
