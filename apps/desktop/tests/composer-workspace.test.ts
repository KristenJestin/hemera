/**
 * The Workspace pill of the composer, as the window wires it (design D8-08).
 *
 * What the pill lists and when it is fixed are rules of the page, read here without a DOM; the
 * rest runs over the whole engine on the fake agent, with the Sessions store listening as the
 * application does: a Session made in the Workspace picked on the Home, moved before its agent
 * starts, and refused once it has.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { Session, SessionEntry, Workspace } from '@hemera/ipc'
import { fakeAgent } from '#engine/agents/fake.ts'
import { listenToAgents, say } from '#renderer/agent-store.ts'
import {
  chooseWorkspace,
  closeSessions,
  listenToWorkspaces,
  offeredWorkspacesOf,
  openSessions,
  sessionsSnapshot,
  startSession,
  workspaceFixedOf,
} from '#renderer/sessions-store.ts'

import { type OpenWindow, install, openWindow } from './window.ts'

/** One Workspace of the Project, as `workspaces.list` answers one. */
function workspace(id: string, state: Workspace['state'], main = false): Workspace {
  return {
    id,
    projectId: 'atlas',
    name: main ? 'main' : id,
    path: `/home/ana/${id}`,
    specId: null,
    state,
    main,
    dedicated: !main,
    live: false,
    createdAt: '2026-09-24T08:00:00.000Z',
    cleanedAt: state === 'cleaned' ? '2026-09-24T09:00:00.000Z' : null,
    repositories: [],
  }
}

/** A Session in `main`, its agent in the native state given. */
function session(nativeState: Session['nativeState']): Session {
  return {
    id: 'session-1',
    projectId: 'atlas',
    title: 'Login form',
    titleSource: 'derived',
    provider: 'claude',
    model: null,
    nativeState,
    workspaceId: null,
    workspaceFixed: nativeState !== 'none',
    archivedAt: null,
    createdAt: 0,
    lastWrittenAt: 0,
    version: 1,
  }
}

/** One entry of a thread, of the kind given. */
function entry(kind: SessionEntry['kind']): SessionEntry {
  return {
    id: `entry-${kind}`,
    sessionId: 'session-1',
    seq: 1,
    role: kind === 'message' ? 'user' : 'hemera',
    kind,
    body: '',
    payload: '{}',
    correlationId: null,
    turnId: null,
    state: null,
    origin: 'live',
    createdAt: 0,
  }
}

describe("The pill lists the Project's ready Workspaces, main first", () => {
  test('only the ready ones, main first, main sent as null', () => {
    const listed = offeredWorkspacesOf([
      workspace('login-form', 'ready'),
      workspace('export', 'preparing'),
      workspace('main-id', 'ready', true),
      workspace('broken', 'failed'),
      workspace('gone', 'cleaned'),
    ])
    expect(listed).toEqual([
      { id: null, name: 'main', path: '/home/ana/main-id' },
      { id: 'login-form', name: 'login-form', path: '/home/ana/login-form' },
    ])
  })

  test("a Session's own Workspace is listed whatever its state", () => {
    const listed = offeredWorkspacesOf(
      [workspace('main-id', 'ready', true), workspace('gone', 'cleaned')],
      'gone',
    )
    expect(listed.map((one) => one.name)).toEqual(['main', 'gone'])
  })
})

describe('The Workspace is fixed once the agent has started', () => {
  test('a Session whose agent never started can still change', () => {
    expect(workspaceFixedOf(session('none'), [entry('message')], false)).toBe(false)
  })

  test('an agent in a native state, a turn running or a turn in the thread fixes it', () => {
    expect(workspaceFixedOf(session('attached'), [], false)).toBe(true)
    expect(workspaceFixedOf(session('none'), [entry('message')], true)).toBe(true)
    expect(workspaceFixedOf(session('none'), [entry('message'), entry('turn')], false)).toBe(true)
  })
})

describe('A Session is made and moved in the Workspace the pill chose', () => {
  let dataFolder: string
  let main: string
  let spike: string
  let opened: OpenWindow | null = null
  let stops: (() => void)[] = []

  beforeEach(() => {
    dataFolder = mkdtempSync(join(tmpdir(), 'hemera-composer-workspace-'))
    main = realpathSync(mkdtempSync(join(tmpdir(), 'hemera-composer-workspace-main-')))
    spike = realpathSync(mkdtempSync(join(tmpdir(), 'hemera-composer-workspace-spike-')))
  })

  afterEach(async () => {
    for (const stop of stops) stop()
    stops = []
    closeSessions()
    await opened?.close()
    opened = null
    for (const folder of [dataFolder, main, spike]) rmSync(folder, { recursive: true, force: true })
  })

  /** Waits for the stores to hold what is waited for, in real time. */
  async function until(ready: () => boolean): Promise<void> {
    for (let tries = 0; tries < 200 && !ready(); tries += 1) {
      // oxlint-disable-next-line no-await-in-loop -- a poll: each look waits for the one before it
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  test('made in the Workspace picked, moved before the agent starts, fixed once it has', async () => {
    opened = await openWindow(dataFolder, fakeAgent({ steps: [{ does: 'says', text: 'Here.' }] }))
    install(opened.bridge)
    stops = [listenToAgents(), listenToWorkspaces()]
    const { bridge } = opened
    const project = await bridge.invoke('projects.create', {
      name: 'Atlas',
      tone: 'primary',
      mainPath: main,
    })
    await openSessions(project.id)
    await until(() => sessionsSnapshot().workspaces.length === 1)

    // A Workspace made in the settings while the Home is on screen reaches its pill.
    const picked = await bridge.invoke('workspaces.createOnFolder', {
      projectId: project.id,
      path: spike,
    })
    await until(() => sessionsSnapshot().workspaces.length === 2)
    const offered = offeredWorkspacesOf(sessionsSnapshot().workspaces)
    expect(offered.map((one) => one.id)).toEqual([null, picked.id])

    // Made in it, from the Home.
    const made = await startSession(project.id, 'claude', picked.id)
    expect(made?.workspaceId).toBe(picked.id)

    // Moved to `main` before anything was said: the engine takes it.
    const held = sessionsSnapshot().sessions.find((one) => one.id === made?.id)
    expect(held === undefined ? false : await chooseWorkspace(held, null)).toBe(true)
    const moved = sessionsSnapshot().sessions.find((one) => one.id === made?.id)
    expect(moved?.workspaceId).toBeNull()

    // Once the agent has answered, a change is refused, said, and the Session keeps `main`.
    await say(made?.id ?? '', 'Where are you?')
    await openSessions(project.id)
    const started = sessionsSnapshot().sessions.find((one) => one.id === made?.id)
    expect(started === undefined ? true : await chooseWorkspace(started, picked.id)).toBe(false)
    expect(sessionsSnapshot().refusal).toBe('The Workspace is fixed once the agent has started.')
    const [kept] = await bridge.invoke('sessions.list', { projectId: project.id })
    expect(kept?.workspaceId).toBeNull()
  })
})
