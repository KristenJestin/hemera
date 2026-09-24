/**
 * What the Session details draw: the tab they open on, the Commands tab and the Context tab
 * (design D6-10, D6-12).
 *
 * The page imports the design system's components, which need a browser; what is read here is
 * the pure module the page hands them from — the runs as the panel lists them, the tab a Session
 * opens on, and the instructions and tools of the Context view — and, over the whole engine on the fake
 * agent, the stores those are read from.
 */

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { AGENTS_FILE } from '@hemera/core'
import type { CommandRun, ContextView, Provided } from '@hemera/ipc'

import { fakeAgent } from '#engine/agents/fake.ts'
import { listenToAgents, say } from '#renderer/agent-store.ts'
import {
  contextListsOf,
  detailsTabsOf,
  openingTabOf,
  panelRunsOf,
} from '#renderer/session-details.ts'
import { contextOf, listenToTools, readContext, runCommand, runsOf } from '#renderer/tools-store.ts'

import { withQualifiedOpenCode } from './unqualified.ts'
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

  test('the details of a Session with a command running open on its commands', () => {
    const done = aRun('r1', '/a', 'exited', 'c1')
    const tabs = detailsTabsOf(1, 0, [done], null)
    expect(openingTabOf([aRun('r1', '/a', 'running', 'c1')], tabs)).toBe('commands')
    expect(openingTabOf([done], tabs)).toBe('activity')
    // With nothing done yet, the tab that has something is the one it opens on.
    expect(openingTabOf([done], detailsTabsOf(0, 0, [done], null))).toBe('commands')
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
  }
}

describe('The details open on the tab that has something', () => {
  test('a fresh Session whose context is only the base and the tools has no tab with something', () => {
    const tabs = detailsTabsOf(0, 0, [], aView(['base']))

    expect(tabs).toEqual({ activity: false, commands: false, context: false })
    expect(openingTabOf([], tabs)).toBe('context')
  })

  test('AGENTS.md given at the start or read by the agent is no delivery', () => {
    expect(detailsTabsOf(0, 0, [], aView(['base', 'provided'])).context).toBe(false)
    expect(detailsTabsOf(0, 0, [], aView(['base', 'native'])).context).toBe(false)
  })

  test('with no plan, no file, no run, no catalogue and no context known, they open on the Context', () => {
    const tabs = detailsTabsOf(0, 0, [], null)

    expect(tabs).toEqual({ activity: false, commands: false, context: false })
    expect(openingTabOf([], tabs)).toBe('context')
  })

  test('a delivery makes them open on the Context tab', () => {
    const tabs = detailsTabsOf(0, 0, [], aView(['base', 'provided', 'instructions']))

    expect(tabs).toEqual({ activity: false, commands: false, context: true })
    expect(openingTabOf([], tabs)).toBe('context')
  })

  test('a plan makes them open on the Activity tab, and a catalogue on the Commands tab', () => {
    const plan = detailsTabsOf(2, 0, [], aView(['base']))
    expect(plan.activity).toBe(true)
    expect(openingTabOf([], plan)).toBe('activity')

    const catalogue = detailsTabsOf(
      0,
      0,
      [],
      aView(['base'], [{ name: 'check', line: 'pnpm check' }]),
    )
    expect(catalogue.commands).toBe(true)
    expect(openingTabOf([], catalogue)).toBe('commands')
  })

  test('a running command wins over a plan and a delivery', () => {
    const tabs = detailsTabsOf(2, 1, [], aView(['base', 'instructions']))

    expect(openingTabOf([aRun('r1', '/a', 'running', 'c1')], tabs)).toBe('commands')
  })
})

/** One thing a Session was provided, at the time given, reached the way its kind says. */
function aSource(
  kind: Provided['kind'],
  reached: Provided['reached'],
  deliveredAt = '2026-09-23T08:00:00.000Z',
): Provided {
  return {
    kind,
    path: kind === 'base' ? '' : 'AGENTS.md',
    fingerprint: 'f'.repeat(64),
    deliveredAt,
    reached,
  }
}

/** A view with the sources given, the tools of a fresh Session and an empty catalogue. */
function aViewOf(provided: Provided[]): ContextView {
  return {
    provided,
    tools: [{ name: 'search', bound: '200 matches and 1 MiB scanned a call' }],
    commands: [],
  }
}

/** `HH:MM` of a moment, in the zone the test runs in, which is the one the window reads in. */
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** `DD Mon HH:MM` of a moment, in the zone the test runs in, which is the one the window reads in. */
function atOf(iso: string): string {
  const at = new Date(iso)
  const day = at.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  return `${day} ${timeOf(iso)}`
}

/** The root the page reads its Workspace at. */
const ROOT = '/home/kris/projects/atlas'

/** When the fixtures of this block were provided, unless they say otherwise. */
const STARTED = '2026-09-23T08:00:00.000Z'

describe('The Context tab says how the instructions reached the agent', () => {
  test('AGENTS.md given at the start is one line, and the base one line after it, each with its time', () => {
    const view = aViewOf([
      aSource('base', 'embedded_resource'),
      aSource('provided', 'session_start'),
    ])

    expect(contextListsOf(view, ROOT).instructions).toEqual([
      {
        label: 'AGENTS.md',
        file: true,
        detail: 'given at the start of the Session',
        at: atOf(STARTED),
      },
      { label: 'The base', detail: 'as a resource of the first prompt', at: atOf(STARTED) },
    ])
  })

  test('AGENTS.md read by the agent says so, and the base goes through its system prompt', () => {
    const view = aViewOf([aSource('base', 'system_prompt'), aSource('native', 'read_natively')])

    expect(contextListsOf(view, ROOT).instructions).toEqual([
      { label: 'AGENTS.md', file: true, detail: 'read by the agent', at: atOf(STARTED) },
      { label: 'The base', detail: 'through its system prompt', at: atOf(STARTED) },
    ])
  })

  test('a Workspace without AGENTS.md says so in a sentence', () => {
    const view = aViewOf([aSource('base', 'embedded_resource')])

    expect(contextListsOf(view, ROOT).instructions).toEqual([
      { label: 'This Workspace has no AGENTS.md' },
      { label: 'The base', detail: 'as a resource of the first prompt', at: atOf(STARTED) },
    ])
  })

  test('the last change is the latest delivery, with its time, and the file says it changed then', () => {
    const view = aViewOf([
      aSource('base', 'embedded_resource'),
      aSource('provided', 'session_start'),
      aSource('instructions', 'delivery_prompt', '2026-09-23T10:05:00.000Z'),
      aSource('instructions', 'delivery_prompt', '2026-09-23T12:40:00.000Z'),
    ])

    const [file, change, base] = contextListsOf(view, ROOT).instructions
    expect(file).toEqual({
      label: 'AGENTS.md',
      file: true,
      detail: 'given at the start of the Session',
      at: atOf(STARTED),
      changed: atOf('2026-09-23T12:40:00.000Z'),
    })
    expect(change?.label).toBe('Last change')
    expect(change?.detail).toBe('delivered between two turns')
    expect(change?.at).toMatch(/^\d\d Sep/)
    expect(change?.at?.endsWith(timeOf('2026-09-23T12:40:00.000Z'))).toBe(true)
    expect(base?.label).toBe('The base')
  })

  test('a file written during the Session had none at the start, and its delivery is the change', () => {
    const view = aViewOf([
      aSource('base', 'embedded_resource'),
      aSource('instructions', 'delivery_prompt', '2026-09-23T12:40:00.000Z'),
    ])

    const lines = contextListsOf(view, ROOT).instructions
    expect(lines.map((line) => [line.label, line.detail])).toEqual([
      ['AGENTS.md', 'none at the start of the Session'],
      ['Last change', 'delivered between two turns'],
      ['The base', 'as a resource of the first prompt'],
    ])
    expect(lines[0]?.changed).toBe(atOf('2026-09-23T12:40:00.000Z'))
  })

  test('nothing is listed before anything has gone to the agent', () => {
    expect(contextListsOf(aViewOf([]), ROOT).instructions).toEqual([])
  })

  test('the tools and the catalogue are listed as the engine answered them', () => {
    const view: ContextView = {
      ...aViewOf([]),
      commands: [{ name: 'check', line: 'pnpm check' }],
    }

    const lists = contextListsOf(view, ROOT)
    expect(lists.tools).toEqual([{ name: 'search', bound: '200 matches and 1 MiB scanned a call' }])
    expect(lists.commands).toEqual([{ name: 'check', command: 'pnpm check' }])
  })

  test('the Workspace is the main one, at the root the page reads', () => {
    expect(contextListsOf(aViewOf([]), ROOT).workspace).toEqual({ name: 'main', path: ROOT })
  })

  test('the tools were lent when the base went in, and have no time before it', () => {
    expect(contextListsOf(aViewOf([]), ROOT).lentAt).toBeUndefined()
    const view = aViewOf([aSource('base', 'embedded_resource', '2026-09-23T09:30:00.000Z')])
    expect(contextListsOf(view, ROOT).lentAt).toBe(atOf('2026-09-23T09:30:00.000Z'))
  })
})

describe('A one-off command shows and is not promoted', () => {
  withQualifiedOpenCode()

  let dataFolder: string
  let workspace: string
  let opened: OpenWindow | null = null
  let stops: (() => void)[] = []

  beforeEach(() => {
    dataFolder = mkdtempSync(join(tmpdir(), 'hemera-session-details-'))
    workspace = realpathSync(mkdtempSync(join(tmpdir(), 'hemera-session-details-workspace-')))
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
