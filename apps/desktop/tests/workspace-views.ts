/**
 * The engine's views of `atlas` the renderer's Workspace suites draw from: its `main` and its
 * `login-form`, a `serve` run, a step, and what Git answers of `login-form` (D8-01, D8-05, D8-15).
 */

import type { CommandRun, RepositoryState, Workspace, WorkspaceStep } from '@hemera/ipc'

/** A Workspace of `atlas`, as the engine lists one. */
export function workspace(id: string, change: Partial<Workspace> = {}): Workspace {
  return {
    id,
    projectId: 'atlas',
    name: id,
    path: `/data/workspaces/atlas/${id}`,
    specId: null,
    state: 'ready',
    main: false,
    dedicated: true,
    live: false,
    createdAt: '2026-09-24T08:00:00.000Z',
    cleanedAt: null,
    repositories: [
      { relativePath: 'sources/api', branch: 'atlas/HEM-7-login-form', base: 'a'.repeat(40) },
      { relativePath: 'sources/front', branch: 'atlas/HEM-7-login-form', base: 'b'.repeat(40) },
    ],
    ...change,
  }
}

export const MAIN = workspace('main', {
  path: '/home/ana/atlas',
  main: true,
  dedicated: false,
  repositories: [],
})

export const LOGIN_FORM = workspace('login-form')

/** A `serve` run of `atlas`, running in `login-form` unless told otherwise. */
export function run(id: string, change: Partial<CommandRun> = {}): CommandRun {
  return {
    id,
    projectId: 'atlas',
    sessionId: 'session-1',
    commandId: 'command-dev',
    name: 'dev',
    line: 'pnpm dev',
    type: 'serve',
    scope: 'workspace',
    cwd: '/data/workspaces/atlas/login-form/sources/front',
    folder: './sources/front',
    workspaceId: 'login-form',
    workspaceName: 'login-form',
    environment: { PORT: '3001' },
    state: 'running',
    pid: 4242,
    url: 'http://localhost:3000',
    readyAt: null,
    readiness: 'starting',
    portConflict: null,
    heldAgainst: [],
    exitCode: null,
    startedBy: 'agent',
    output: 'ready on http://localhost:3000\n',
    dropped: 0,
    startedAt: '2026-09-24T08:00:00.000Z',
    endedAt: null,
    joined: false,
    ...change,
  }
}

/** One step of a preparation, as the engine answers it. */
export function step(position: number, change: Partial<WorkspaceStep> = {}): WorkspaceStep {
  return {
    id: `step-${String(position)}`,
    position,
    kind: 'worktree',
    target: 'sources/api',
    base: null,
    path: null,
    commandId: null,
    state: 'done',
    message: null,
    runId: null,
    ...change,
  }
}

/** What Git answers for `login-form`: one repository in order, the other refused. */
export const STATUS: RepositoryState[] = [
  {
    relativePath: 'sources/api',
    git: {
      ok: true,
      branch: 'atlas/HEM-7-login-form',
      commit: 'c'.repeat(40),
      staged: 1,
      unstaged: 1,
      untracked: 1,
    },
  },
  { relativePath: 'sources/front', git: { ok: false, error: 'fatal: not a git repository' } },
]
