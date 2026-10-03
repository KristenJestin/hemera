/**
 * The rules of a Workspace: its name, its branch, where its preparation stands, how a resume
 * reads its steps, the environment it runs with, and the template names Hemera fills.
 */

import { Result } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  InvalidBranchName,
  InvalidTemplate,
  InvalidVariableKey,
  InvalidWorkspaceName,
  TEMPLATE_NAMES,
  checkedTemplate,
  fillTemplate,
  mergedEnvironment,
  nextPending,
  preparationStateOf,
  resumedSteps,
  variableKey,
  workspaceBranch,
  workspaceName,
  type StepProgress,
} from '../src/domain/index.ts'

const refusal = <A, E>(result: Result.Result<A, E>): E | undefined =>
  Result.isFailure(result) ? result.failure : undefined
const value = <A, E>(result: Result.Result<A, E>): A | undefined =>
  Result.isSuccess(result) ? result.success : undefined

describe('A Workspace name is one folder name', () => {
  test('kept without the spaces around it', () => {
    expect(value(workspaceName('  login-form '))).toBe('login-form')
  })

  test('empty, a path, a climb or a dot is refused', () => {
    for (const name of ['', '  ', 'a/b', 'a\\b', '.', '..', 'a..b']) {
      expect(refusal(workspaceName(name))).toBeInstanceOf(InvalidWorkspaceName)
    }
  })

  test('a character a folder cannot hold on Windows is refused on every system', () => {
    for (const name of ['a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
      expect(refusal(workspaceName(name))).toBeInstanceOf(InvalidWorkspaceName)
    }
  })
})

describe('A Workspace branch is the prefix, then the name', () => {
  test('`<branch prefix>/<name>`', () => {
    expect(value(workspaceBranch('atlas', 'login-form'))).toBe('atlas/login-form')
  })

  test('a name Git would refuse in a branch is refused as a branch', () => {
    expect(refusal(workspaceBranch('atlas', 'login form'))).toBeInstanceOf(InvalidBranchName)
    expect(refusal(workspaceBranch('atlas', 'x.lock'))).toBeInstanceOf(InvalidBranchName)
  })
})

const step = (position: number, kind: StepProgress['kind'], state: StepProgress['state']) => ({
  id: `s${String(position)}`,
  position,
  kind,
  state,
})

describe('A preparation stands where its steps stand', () => {
  test('ready when every step is done or skipped', () => {
    expect(preparationStateOf([step(1, 'worktree', 'done'), step(2, 'copy', 'skipped')])).toBe(
      'ready',
    )
  })

  test('pending while nothing has started', () => {
    expect(preparationStateOf([step(1, 'worktree', 'pending'), step(2, 'run', 'pending')])).toBe(
      'pending',
    )
  })

  test('failed when one failed, preparing while one is left to do', () => {
    expect(preparationStateOf([step(1, 'worktree', 'done'), step(2, 'run', 'failed')])).toBe(
      'failed',
    )
    expect(preparationStateOf([step(1, 'worktree', 'done'), step(2, 'run', 'pending')])).toBe(
      'preparing',
    )
    expect(preparationStateOf([step(1, 'worktree', 'running')])).toBe('preparing')
  })
})

describe('Resuming re-checks before retrying', () => {
  const steps = [
    step(1, 'worktree', 'done'),
    step(2, 'copy', 'done'),
    step(3, 'run', 'done'),
    step(4, 'link', 'failed'),
    step(5, 'run', 'pending'),
  ]

  test('a done step gone from the disk is redone, the failed one retried, a done run kept', () => {
    const resumed = resumedSteps(steps, (one) => one.kind !== 'copy')
    expect(resumed.map((one) => one.state)).toEqual([
      'done',
      'pending',
      'done',
      'pending',
      'pending',
    ])
    expect(nextPending(resumed)?.position).toBe(2)
  })

  test('a done run is never redone, even when asked of the disk', () => {
    const resumed = resumedSteps(steps, () => false)
    expect(resumed[2]?.state).toBe('done')
  })

  test('a step an engine left running is started again', () => {
    expect(resumedSteps([step(1, 'run', 'running')], () => true)[0]?.state).toBe('pending')
  })
})

describe('A variable is named as a shell names one', () => {
  test('letters, digits and underscores, not starting with a digit', () => {
    expect(value(variableKey(' DATABASE_URL '))).toBe('DATABASE_URL')
    expect(value(variableKey('_x1'))).toBe('_x1')
    for (const key of ['', '1X', 'A-B', 'A B', 'A=B', 'É']) {
      expect(refusal(variableKey(key))).toBeInstanceOf(InvalidVariableKey)
    }
  })
})

describe('The environment is the process, then the Project, then the Workspace', () => {
  test('the last one set wins, and a process variable without a value is left out', () => {
    expect(
      mergedEnvironment(
        { PATH: '/bin', PORT: '1', EMPTY: undefined },
        { PORT: '2', DB: 'project' },
        { DB: 'workspace' },
      ),
    ).toEqual({ PATH: '/bin', PORT: '2', DB: 'workspace' })
  })
})

describe('Hemera fills the template names it knows', () => {
  const values = {
    workspace: 'login-form',
    'workspace.path': '/w/login-form',
    project: 'atlas',
    branch: 'atlas/login-form',
  }

  test('the names are workspace, workspace.path, project and branch', () => {
    expect([...TEMPLATE_NAMES]).toEqual(['workspace', 'workspace.path', 'project', 'branch'])
  })

  test('each name is filled, as often as it is written', () => {
    expect(fillTemplate('db_{workspace}_{workspace}', values)).toBe('db_login-form_login-form')
    expect(fillTemplate('{workspace.path}/.env {project} {branch}', values)).toBe(
      '/w/login-form/.env atlas atlas/login-form',
    )
  })

  test('`{{` is a literal brace, and a closing brace alone is itself', () => {
    expect(fillTemplate('{{workspace} }', values)).toBe('{workspace} }')
    expect(value(checkedTemplate('{{workspace}'))).toBe('{{workspace}')
  })

  test('an unknown name is refused, naming it', () => {
    const refused = refusal(checkedTemplate('db_{workspce}'))
    expect(refused).toBeInstanceOf(InvalidTemplate)
    expect(refused?.name).toBe('workspce')
    expect(refused?.message).toContain('{workspce}')
  })

  test('a brace never closed is refused', () => {
    expect(refusal(checkedTemplate('db_{workspace'))).toBeInstanceOf(InvalidTemplate)
  })

  test('a text without a name is kept as it is', () => {
    expect(fillTemplate('pnpm install', values)).toBe('pnpm install')
  })
})
