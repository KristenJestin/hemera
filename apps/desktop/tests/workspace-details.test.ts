/**
 * The Workspaces cards of a Project's settings say the engine's views in their own words (D8-02,
 * D8-05, D8-06, D8-08, D8-09, D8-14, D8-15): read without a DOM, from the module the page hands
 * the components from.
 */

import { describe, expect, test } from 'vite-plus/test'

import type { PlanRepository, RepositoryState, Variable, WorkspacePlan } from '@hemera/ipc'
import {
  branchOfName,
  branchesKeptOf,
  changesOf,
  interruptedOf,
  planLinesOf,
  recipeAddOf,
  recipeLinesOf,
  runDetailsOf,
  serviceLinesOf,
  stepLinesOf,
  summaryOf,
  workspaceCardOf,
  workspaceRowsOf,
  workspaceVariablesOf,
  worktreesOf,
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
      step(2, { kind: 'copy', target: './.env', base: './sources/api', state: 'pending' }),
      step(3, { kind: 'link', target: './CLAUDE.md', base: null, state: 'pending' }),
      step(1, { state: 'failed', message: "fatal: 'sources/front' already exists" }),
    ])
    expect(lines.map((one) => [one.kind, one.target, one.state, one.message])).toEqual([
      ['worktree', 'sources/api', 'failed', "fatal: 'sources/front' already exists"],
      // Its path under the repository it applies in (D8-05 as amended by recette 1).
      ['copy', 'sources/api/.env', 'pending', undefined],
      ['link', './CLAUDE.md', 'pending', undefined],
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
          portlessName: null,
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

  test('a recipe step is added as the engine takes it, with the base it names', () => {
    expect(
      recipeAddOf({
        kind: 'copy',
        base: './sources/api',
        path: '.env',
        commandId: null,
        line: null,
        lineWindows: null,
        lineLinux: null,
      }),
    ).toEqual({
      kind: 'copy',
      base: './sources/api',
      path: '.env',
      commandId: null,
      line: null,
      lineWindows: null,
      lineLinux: null,
    })
    expect(
      recipeAddOf({
        kind: 'run',
        base: null,
        path: null,
        commandId: 'command-install',
        line: null,
        lineWindows: null,
        lineLinux: null,
      }),
    ).toEqual({
      kind: 'run',
      base: null,
      path: null,
      commandId: 'command-install',
      line: null,
      lineWindows: null,
      lineLinux: null,
    })
    expect(
      recipeLinesOf([
        {
          id: 'r1',
          kind: 'run',
          base: null,
          path: null,
          commandId: 'command-dev',
          rank: 'a',
          line: null,
          lineWindows: null,
          lineLinux: null,
        },
      ]),
    ).toEqual([
      {
        id: 'r1',
        kind: 'run',
        base: null,
        path: null,
        commandId: 'command-dev',
        line: null,
        lineWindows: null,
        lineLinux: null,
      },
    ])
  })

  // Scenario: "A preparation interrupted by a quit can be resumed".
  test('a Workspace preparing with no preparation running is an interrupted one', () => {
    expect(interruptedOf(workspace('login-form', { state: 'preparing', live: false }))).toBe(true)
    expect(interruptedOf(workspace('login-form', { state: 'preparing', live: true }))).toBe(false)
    expect(interruptedOf(workspace('login-form', { state: 'failed', live: false }))).toBe(false)
  })
})

describe("main's row says what Git says of its folder", () => {
  test('the first repository Git answered for: its branch, its commit and its changes', () => {
    const rows = workspaceRowsOf([LOGIN_FORM, MAIN], STATUS)

    expect(rows[0]?.summary).toEqual({
      branch: 'atlas/HEM-7-login-form',
      commit: 'c'.repeat(40),
      changes: '1 staged, 1 unstaged, 1 untracked',
    })
    // Only main's row carries it: another Workspace says its Git state once opened.
    expect(rows[1]?.summary).toBeUndefined()
  })

  test('no change is "clean", and a repository Git refused gives way to the next one', () => {
    const refused: RepositoryState = {
      relativePath: 'sources/front',
      git: { ok: false, error: 'fatal: not a git repository' },
    }
    const clean: RepositoryState = {
      relativePath: 'sources/web',
      git: {
        ok: true,
        branch: 'main',
        commit: 'd'.repeat(40),
        staged: 0,
        unstaged: 0,
        untracked: 0,
      },
    }

    expect(summaryOf([refused, clean])).toEqual({
      branch: 'main',
      commit: 'd'.repeat(40),
      changes: 'clean',
    })
    expect(changesOf({ staged: 2, unstaged: 1, untracked: 0 })).toBe('2 staged, 1 unstaged')
    // Git refused every one of them: the row says nothing it was not told.
    expect(summaryOf([refused])).toBeUndefined()
  })

  test('before Git answered, the row says nothing of it', () => {
    expect(workspaceRowsOf([MAIN], null)[0]?.summary).toBeUndefined()
  })
})

describe('A dedicated Workspace from the settings is made from its plan', () => {
  const plan: WorkspacePlan = {
    name: '',
    root: '/data/workspaces/atlas',
    path: '/data/workspaces/atlas',
    branchPrefix: 'atlas',
    repositories: ['sources/api', 'docs'],
    gitAvailable: true,
  }

  /** What Git answered of each of them, read one at a time (#110). */
  const reads: PlanRepository[] = [
    {
      relativePath: 'sources/api',
      holdsRepository: true,
      branches: ['main', 'dev'],
      base: 'main',
      detachedCommit: null,
      branch: 'atlas/',
      included: true,
      reason: null,
    },
    {
      relativePath: 'docs',
      holdsRepository: false,
      branches: [],
      base: null,
      detachedCommit: null,
      branch: 'atlas/',
      included: false,
      reason: null,
    },
  ]

  test('the dialog takes a row per location of the plan, with what was read of each', () => {
    expect(planLinesOf(plan, reads)).toEqual([
      {
        path: 'sources/api',
        read: {
          holdsRepository: true,
          branches: ['main', 'dev'],
          base: 'main',
          detachedCommit: null,
          branch: 'atlas/',
          included: true,
          reason: null,
        },
      },
      {
        path: 'docs',
        read: {
          holdsRepository: false,
          branches: [],
          base: null,
          detachedCommit: null,
          branch: 'atlas/',
          included: false,
          reason: null,
        },
      },
    ])
  })

  test('a location nothing has been read of yet has its row and no answer', () => {
    expect(planLinesOf(plan, [reads[0]!])).toEqual([
      {
        path: 'sources/api',
        read: {
          holdsRepository: true,
          branches: ['main', 'dev'],
          base: 'main',
          detachedCommit: null,
          branch: 'atlas/',
          included: true,
          reason: null,
        },
      },
      { path: 'docs', read: null },
    ])
  })

  test('its branches follow the name as the engine slugs it, under the prefix of the plan', () => {
    expect(branchOfName(plan.branchPrefix)('Login form')).toBe('atlas/login-form')
  })

  test('what the dialog kept is created as worktrees, base and branch as typed', () => {
    expect(
      worktreesOf({
        name: 'login-form',
        repositories: [{ path: 'sources/api', base: 'a'.repeat(40), branch: 'kris/login' }],
      }),
    ).toEqual([{ relativePath: 'sources/api', base: 'a'.repeat(40), branch: 'kris/login' }])
  })
})
