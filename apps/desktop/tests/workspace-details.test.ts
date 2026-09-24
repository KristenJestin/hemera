/**
 * The Workspaces cards of a Project's settings say the engine's views in their own words (D8-02,
 * D8-05, D8-06, D8-08, D8-09, D8-14, D8-15): read without a DOM, from the module the page hands
 * the components from.
 */

import { describe, expect, test } from 'vite-plus/test'

import type { Variable } from '@hemera/ipc'
import {
  branchesKeptOf,
  interruptedOf,
  recipeAddOf,
  recipeLinesOf,
  runDetailsOf,
  serviceLinesOf,
  stepLinesOf,
  workspaceCardOf,
  workspaceRowsOf,
  workspaceVariablesOf,
} from '#renderer/workspace-details.ts'

import { LOGIN_FORM, MAIN, STATUS, run, step, workspace } from './workspace-views.ts'

describe('The cards say the engine views in their own words', () => {
  test('the list puts main first and takes dedicated from the engine', () => {
    const picked = workspace('spike', { dedicated: false, repositories: [] })
    expect(
      workspaceRowsOf([LOGIN_FORM, MAIN, picked]).map((one) => [one.name, one.main, one.dedicated]),
    ).toEqual([
      ['main', true, false],
      ['login-form', false, true],
      ['spike', false, false],
    ])
  })

  test('the branches a cleanup keeps are named once each', () => {
    expect(branchesKeptOf(LOGIN_FORM)).toEqual(['atlas/HEM-7-login-form'])
  })

  // Scenarios: "Each repository shows its branch, commit and changes", "A Git error is surfaced as is".
  test("a card lists the worktrees being read, then Git's answer, an error as Git said it", () => {
    expect(workspaceCardOf(LOGIN_FORM, null).repositories).toEqual([
      { path: 'sources/api', git: null },
      { path: 'sources/front', git: null },
    ])
    const read = workspaceCardOf(LOGIN_FORM, STATUS).repositories
    expect(read[0]?.git).toMatchObject({ ok: true, staged: 1, unstaged: 1, untracked: 1 })
    expect(read[1]?.git).toEqual({ ok: false, error: 'fatal: not a git repository' })
  })

  test('a cleaned-up Workspace lists no repository and says when it was cleaned up', () => {
    const cleaned = workspace('onboarding', {
      state: 'cleaned',
      cleanedAt: '2026-09-24T09:00:00.000Z',
    })
    const card = workspaceCardOf(cleaned, STATUS, Date.parse('2026-09-24T10:00:00.000Z'))
    expect(card.repositories).toEqual([])
    expect(card.cleanedAt).toBe('Cleaned up today.')
  })

  test('a step of the recipe says where it lands, and a failure keeps its message', () => {
    const lines = stepLinesOf([
      step(2, { kind: 'copy', target: '.env', scope: 'repositories', state: 'pending' }),
      step(1, { state: 'failed', message: "fatal: 'sources/front' already exists" }),
    ])
    expect(lines.map((one) => [one.kind, one.target, one.state, one.message])).toEqual([
      ['worktree', 'sources/api', 'failed', "fatal: 'sources/front' already exists"],
      ['copy', '.env in each repository', 'pending', undefined],
    ])
  })

  // Scenario: "A Workspace's variable overrides the Project's".
  test("a Workspace's variable names the Project's value it overrides, the others inherited", () => {
    const project: Variable[] = [
      { key: 'DATABASE_URL', value: 'postgres://localhost/atlas', workspaceId: null },
      { key: 'PORT', value: '3000', workspaceId: null },
    ]
    const own: Variable[] = [{ key: 'PORT', value: '3001', workspaceId: 'login-form' }]
    expect(workspaceVariablesOf(own, project)).toEqual([
      { key: 'PORT', value: '3001', overrides: '3000' },
      { key: 'DATABASE_URL', value: 'postgres://localhost/atlas', inherited: true },
    ])
  })

  // Scenario: "A port conflict names its holder", on both sides (Decided 12).
  test('a service says a conflict on both sides, and whether it goes through Portless', () => {
    const lines = serviceLinesOf(
      [
        run('run-dev', {
          heldAgainst: [
            {
              port: 3000,
              runId: 'run-main',
              workspaceId: null,
              workspaceName: 'main',
              name: 'dev',
            },
          ],
        }),
        run('run-main', {
          workspaceId: null,
          workspaceName: 'main',
          startedBy: 'user',
          portConflict: {
            port: 3000,
            runId: 'run-dev',
            workspaceId: 'login-form',
            workspaceName: 'login-form',
            name: 'dev',
          },
        }),
      ],
      [
        {
          id: 'command-dev',
          projectId: 'atlas',
          name: 'dev',
          line: 'pnpm dev',
          lineWindows: null,
          lineLinux: null,
          type: 'serve',
          folderBase: './sources/front',
          folder: null,
          scope: 'workspace',
          portless: true,
          createdAt: 0,
        },
      ],
    )
    expect(lines[0]).toMatchObject({
      workspace: 'login-form',
      heldAgainst: [{ port: 3000, run: 'dev', workspace: 'main' }],
      portless: true,
      startedBy: 'agent',
    })
    expect(lines[1]).toMatchObject({
      workspace: 'main',
      portConflict: { port: 3000, holderRun: 'dev', holderWorkspace: 'login-form' },
      startedBy: 'user',
    })
  })

  // Scenario: "A run shows what it ran".
  test('the details of a run are its line, its folder, its variables and how it ended', () => {
    const details = runDetailsOf(run('run-test', { type: 'test', state: 'exited', exitCode: 0 }))
    expect(details).toMatchObject({
      line: 'pnpm dev',
      folder: '/data/workspaces/atlas/login-form/sources/front',
      environment: { PORT: '3001' },
      exitCode: 0,
      state: 'exited',
    })
  })

  test('a recipe step is added as the engine takes it, its base joined to its path', () => {
    expect(
      recipeAddOf({ kind: 'copy', base: './sources/api', path: '.env', commandId: null }),
    ).toEqual({
      kind: 'copy',
      path: './sources/api/.env',
      scope: 'root',
      commandId: null,
    })
    expect(
      recipeAddOf({ kind: 'run', base: null, path: null, commandId: 'command-install' }),
    ).toEqual({
      kind: 'run',
      path: null,
      scope: 'root',
      commandId: 'command-install',
    })
    expect(
      recipeLinesOf([
        { id: 'r1', kind: 'run', path: null, scope: 'root', commandId: 'command-dev', rank: 'a' },
      ]),
    ).toEqual([{ id: 'r1', kind: 'run', base: null, path: null, commandId: 'command-dev' }])
  })

  // Scenario: "A preparation interrupted by a quit can be resumed".
  test('a Workspace preparing with no preparation running is an interrupted one', () => {
    expect(interruptedOf(workspace('login-form', { state: 'preparing', live: false }))).toBe(true)
    expect(interruptedOf(workspace('login-form', { state: 'preparing', live: true }))).toBe(false)
    expect(interruptedOf(workspace('login-form', { state: 'failed', live: false }))).toBe(false)
  })
})
