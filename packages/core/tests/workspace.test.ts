/**
 * The pure part of a Workspace: its name, its branch, its preparation and its variables (design
 * D8-02, D8-04, D8-05, D8-06). Each suite is named after the scenario it covers, where the rule
 * of that scenario lives here; the engine's own suites cover the disk, Git and the processes.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  InvalidVariableKeyError,
  InvalidWorkspaceNameError,
  type RecipeStep,
  type WorkspaceStep,
  branchNameFor,
  defaultBranchPrefix,
  mergedEnvironment,
  nextPending,
  resumedSteps,
  slugOf,
  stepsFor,
  variableKey,
  workspaceName,
  workspaceStateOf,
} from '#index.ts'

/** The recipe of the scenario: copy `.env` in the repositories, link CLAUDE.md, run install. */
const RECIPE: RecipeStep[] = [
  { id: 'r1', kind: 'copy', path: '.env', scope: 'repositories', commandId: null, rank: 'a' },
  { id: 'r2', kind: 'link', path: 'CLAUDE.md', scope: 'root', commandId: null, rank: 'b' },
  { id: 'r3', kind: 'run', path: null, scope: 'root', commandId: 'install-id', rank: 'c' },
]

const NAMES = new Map([['install-id', 'install']])

/** The steps of the scenario, with an identifier each, as the engine reads them back. */
function stepsWithIds(): WorkspaceStep[] {
  return stepsFor(['./sources/api', './sources/front'], RECIPE, NAMES).map((step, index) =>
    Object.assign({ id: `s${index + 1}` }, step),
  )
}

describe('The steps follow the recipe in order', () => {
  test('the two worktrees, then the copy, the link and the run, all pending', () => {
    const steps = stepsFor(['./sources/api', './sources/front'], RECIPE, NAMES)
    expect(steps.map((step) => [step.position, step.kind, step.target, step.state])).toEqual([
      [1, 'worktree', './sources/api', 'pending'],
      [2, 'worktree', './sources/front', 'pending'],
      [3, 'copy', '.env', 'pending'],
      [4, 'link', 'CLAUDE.md', 'pending'],
      [5, 'run', 'install', 'pending'],
    ])
  })

  test('a recipe step keeps its scope and its command; a worktree has neither', () => {
    const steps = stepsFor(['./sources/api'], RECIPE, NAMES)
    expect(steps[0]).toMatchObject({ scope: null, commandId: null, message: null, runId: null })
    expect(steps[1]).toMatchObject({ scope: 'repositories', commandId: null })
    expect(steps[3]).toMatchObject({ scope: 'root', commandId: 'install-id' })
  })
})

describe('Resuming re-checks before retrying', () => {
  test('a done step gone from the disk is redone, the failed one retried, a done run kept', () => {
    const [api, front, copy, link, run] = stepsWithIds()
    const before: WorkspaceStep[] = [
      { ...api!, state: 'done' },
      { ...front!, state: 'failed', message: 'fatal: a branch named x already exists' },
      { ...copy!, state: 'done' },
      { ...link!, state: 'done' },
      { ...run!, state: 'done', runId: 'run-1' },
    ]
    // The first worktree's folder was removed by hand; everything else is still there.
    const resumed = resumedSteps(before, (step) => step.id !== api!.id)

    expect(resumed.map((step) => step.state)).toEqual([
      'pending',
      'pending',
      'done',
      'done',
      'done',
    ])
    expect(resumed[1]?.message).toBeNull()
    expect(resumed[4]?.runId).toBe('run-1')
    expect(nextPending(resumed)?.id).toBe(api!.id)
  })

  test('a step an engine left running is started again', () => {
    const [api] = stepsWithIds()
    expect(resumedSteps([{ ...api!, state: 'running' }], () => true)[0]?.state).toBe('pending')
  })

  test('a skipped step and a pending one are kept as they are', () => {
    const [api, front] = stepsWithIds()
    const kept = resumedSteps([{ ...api!, state: 'skipped' }, front!], () => false)
    expect(kept.map((step) => step.state)).toEqual(['skipped', 'pending'])
  })
})

describe('A Workspace stands where its steps stand', () => {
  test('ready when every step is done or skipped, and with no step at all', () => {
    const [api, front] = stepsWithIds()
    expect(
      workspaceStateOf([
        { ...api!, state: 'done' },
        { ...front!, state: 'skipped' },
      ]),
    ).toBe('ready')
    expect(workspaceStateOf([])).toBe('ready')
  })

  test('failed when one failed, preparing while one is left to do', () => {
    const [api, front] = stepsWithIds()
    expect(
      workspaceStateOf([
        { ...api!, state: 'done' },
        { ...front!, state: 'failed' },
      ]),
    ).toBe('failed')
    expect(workspaceStateOf([{ ...api!, state: 'done' }, front!])).toBe('preparing')
    expect(
      nextPending([
        { ...api!, state: 'done' },
        { ...front!, state: 'done' },
      ]),
    ).toBeNull()
  })
})

describe("A Workspace's variable overrides the Project's", () => {
  test('the process, then the Project, then the Workspace, the last one winning', () => {
    const merged = mergedEnvironment(
      { PATH: '/usr/bin', PORT: '80', EMPTY: undefined },
      { PORT: '3000', API_URL: 'http://localhost:4000' },
      new Map([['PORT', '3001']]),
    )
    expect(merged).toEqual({ PATH: '/usr/bin', PORT: '3001', API_URL: 'http://localhost:4000' })
  })
})

describe('A variable is named as a shell names one', () => {
  test('capitals, digits and underscores, not starting with a digit', () => {
    expect(variableKey(' PORT ')).toBe('PORT')
    expect(variableKey('_API_2')).toBe('_API_2')
    expect(() => variableKey('port')).toThrow(InvalidVariableKeyError)
    expect(() => variableKey('2PORT')).toThrow(InvalidVariableKeyError)
    expect(() => variableKey('API-URL')).toThrow(InvalidVariableKeyError)
  })
})

describe('A Workspace name is one folder name', () => {
  test('kept trimmed', () => {
    expect(workspaceName('  login-form ')).toBe('login-form')
  })

  test('empty, a path, a climb or main is refused', () => {
    for (const refused of ['', '   ', 'a/b', 'a\\b', '..', '.', 'main']) {
      expect(() => workspaceName(refused)).toThrow(InvalidWorkspaceNameError)
    }
  })
})

describe('A slug is lowercase words joined by dashes', () => {
  test('punctuation and spaces become one dash, none at the ends', () => {
    expect(slugOf('Login form!')).toBe('login-form')
    expect(slugOf('  --Add  the OAuth2 flow--  ')).toBe('add-the-oauth2-flow')
  })

  test('an accented letter keeps its letter', () => {
    expect(slugOf('Élan créé')).toBe('elan-cree')
  })

  test("a Project's prefix is its name as a slug, hemera when nothing is left", () => {
    expect(defaultBranchPrefix('Hemera Desktop')).toBe('hemera-desktop')
    expect(defaultBranchPrefix('!!!')).toBe('hemera')
  })
})

describe('A branch is named after the prefix, the key and the slug', () => {
  test('`<prefix>/<key>-<slug>`', () => {
    expect(branchNameFor('hemera', 'HEM-7', 'login-form')).toBe('hemera/HEM-7-login-form')
  })
})
