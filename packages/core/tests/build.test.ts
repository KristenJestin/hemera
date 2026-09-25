/**
 * The build's pure rules (design D10-03, D10-06, D10-07, D10-08): the task labels, the ready set
 * and the promotions of the dependency graph, blockers, the verdict of a check and of an attempt,
 * `{files}`, and the checks proposed from the catalogue. Each scenario suite is named after the
 * scenario it covers.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  attemptResult,
  checkPlaces,
  checkProblem,
  dependantsOf,
  evaluateExpect,
  expandFiles,
  promotions,
  proposeChecks,
  readySet,
  satisfied,
  stateAfterAttempt,
  storyDone,
  taskLabels,
  tasksSettled,
} from '#index.ts'
import type { BuildTask, CheckDraft, Command, TaskDependency, TaskState } from '#index.ts'
import { globMatcher } from '#domain/build.ts'

function task(taskId: string, state: TaskState = 'waiting', more: Partial<BuildTask> = {}) {
  return { taskId, executor: 'agent' as const, state, skipUnblocks: false, ...more }
}

/** Applies the promotions the rules give, as the engine writes them. */
function promoted(tasks: readonly BuildTask[], dependencies: readonly TaskDependency[]) {
  const moves = new Map(promotions(tasks, dependencies).map((move) => [move.taskId, move.state]))
  return tasks.map((one) => ({ ...one, state: moves.get(one.taskId) ?? one.state }))
}

function ids(tasks: readonly BuildTask[]): string[] {
  return tasks.map((one) => one.taskId)
}

/** T3 depends on T1 and T2, which depend on nothing. */
const JOIN: TaskDependency[] = [
  { taskId: 't3', dependsOnId: 't1' },
  { taskId: 't3', dependsOnId: 't2' },
]

describe('Every ready task is handed at once', () => {
  test('the first two are handed together, the third once both are done', () => {
    let tasks = promoted([task('t1'), task('t2'), task('t3')], JOIN)
    expect(ids(readySet(tasks, JOIN))).toEqual(['t1', 't2'])

    tasks = promoted([task('t1', 'done'), task('t2', 'in_progress'), task('t3')], JOIN)
    expect(ids(readySet(tasks, JOIN))).toEqual(['t2'])
    expect(tasks[2]?.state).toBe('waiting')

    tasks = promoted([task('t1', 'done'), task('t2', 'done'), task('t3')], JOIN)
    expect(tasks[2]?.state).toBe('ready')
    expect(ids(readySet(tasks, JOIN))).toEqual(['t3'])
  })
})

describe('The task labels', () => {
  test('T1 to Tn in the rank order of the revision, whatever the order given', () => {
    const labels = taskLabels([
      { id: 'b', rank: 'n' },
      { id: 'a', rank: 'a' },
      { id: 'c', rank: 't' },
    ])
    expect([...labels]).toEqual([
      ['a', 'T1'],
      ['b', 'T2'],
      ['c', 'T3'],
    ])
  })
})

describe('A skip unblocks its dependants only when the user says so', () => {
  test('done satisfies, skipped only with skipUnblocks, nothing else does', () => {
    expect(satisfied({ state: 'done', skipUnblocks: false })).toBe(true)
    expect(satisfied({ state: 'skipped', skipUnblocks: true })).toBe(true)
    expect(satisfied({ state: 'skipped', skipUnblocks: false })).toBe(false)
    for (const state of [
      'waiting',
      'ready',
      'in_progress',
      'checking',
      'yours',
      'blocked',
    ] as const) {
      expect(satisfied({ state, skipUnblocks: true })).toBe(false)
    }
  })

  test('a dependant waits behind a skip that does not unblock, and goes on behind one that does', () => {
    const dependencies = [{ taskId: 't2', dependsOnId: 't1' }]
    expect(promotions([task('t1', 'skipped'), task('t2')], dependencies)).toEqual([])
    expect(
      promotions([task('t1', 'skipped', { skipUnblocks: true }), task('t2')], dependencies),
    ).toEqual([{ taskId: 't2', state: 'ready' }])
  })
})

describe('A human task waits for the user', () => {
  test('a human task whose dependencies are met becomes yours, and is never handed', () => {
    const tasks = [
      task('t1', 'done'),
      task('t2', 'done'),
      task('t3', 'waiting', { executor: 'human' }),
    ]
    expect(promotions(tasks, JOIN)).toEqual([{ taskId: 't3', state: 'yours' }])
    expect(readySet(promoted(tasks, JOIN), JOIN)).toEqual([])
  })

  test('at prepare, the tasks with no dependency are ready or yours at once', () => {
    const tasks = [task('t1'), task('t2', 'waiting', { executor: 'human' }), task('t3')]
    expect(promotions(tasks, JOIN)).toEqual([
      { taskId: 't1', state: 'ready' },
      { taskId: 't2', state: 'yours' },
    ])
  })

  test('only waiting tasks are promoted', () => {
    expect(promotions([task('t1', 'ready'), task('t2', 'blocked')], [])).toEqual([])
  })
})

describe('The ready set', () => {
  test('keeps a task in progress, and leaves out what is checked, yours, blocked or skipped', () => {
    const tasks = [
      task('a', 'in_progress'),
      task('b', 'checking'),
      task('c', 'yours'),
      task('d', 'blocked'),
      task('e', 'skipped'),
      task('f', 'done'),
      task('g', 'ready'),
    ]
    expect(ids(readySet(tasks, []))).toEqual(['a', 'g'])
  })
})

describe('A blocker suspends the task and its dependants only', () => {
  test('the dependants are reached through the whole graph, each once', () => {
    const dependencies = [
      { taskId: 't2', dependsOnId: 't1' },
      { taskId: 't3', dependsOnId: 't2' },
      { taskId: 't4', dependsOnId: 't2' },
      { taskId: 't4', dependsOnId: 't3' },
      { taskId: 't6', dependsOnId: 't5' },
    ]
    expect(dependantsOf('t1', dependencies)).toEqual(['t2', 't3', 't4'])
    expect(dependantsOf('t3', dependencies)).toEqual(['t4'])
    expect(dependantsOf('t4', dependencies)).toEqual([])
  })
})

describe('A story’s checks run once its tasks are done', () => {
  const links = [
    { taskId: 't1', storyId: 's1' },
    { taskId: 't2', storyId: 's1' },
    { taskId: 't3', storyId: 's2' },
  ]

  test('done once every covering task is done, and not before', () => {
    expect(storyDone('s1', links, [task('t1', 'done'), task('t2', 'checking')])).toBe(false)
    expect(storyDone('s1', links, [task('t1', 'done'), task('t2', 'done')])).toBe(true)
  })

  test('a skipped covering task leaves the story unchecked, and a story no task covers too', () => {
    expect(storyDone('s1', links, [task('t1', 'done'), task('t2', 'skipped')])).toBe(false)
    expect(storyDone('s9', links, [task('t1', 'done')])).toBe(false)
  })
})

describe('No task is left', () => {
  test('once every task is done or skipped', () => {
    expect(tasksSettled([task('t1', 'done'), task('t2', 'skipped')])).toBe(true)
    expect(tasksSettled([task('t1', 'done'), task('t2', 'yours')])).toBe(false)
  })
})

describe('The agent’s signal is not a verdict', () => {
  test('an attempt is red with one red check, green with one green, unverified otherwise', () => {
    expect(attemptResult(['green', 'red', 'skipped'])).toBe('red')
    expect(attemptResult(['green', 'skipped'])).toBe('green')
    expect(attemptResult(['skipped'])).toBe('unverified')
    expect(attemptResult([])).toBe('unverified')
  })

  test('a red attempt goes back in progress, a green or unverified one is done', () => {
    expect(stateAfterAttempt('red', 1)).toBe('in_progress')
    expect(stateAfterAttempt('red', 2)).toBe('in_progress')
    expect(stateAfterAttempt('green', 1)).toBe('done')
    expect(stateAfterAttempt('unverified', 1)).toBe('done')
  })
})

describe('Three red attempts come back to the user', () => {
  test('the third red attempt makes the task yours', () => {
    expect(stateAfterAttempt('red', 3)).toBe('yours')
  })
})

describe('A check runs in each repository the task changed', () => {
  test('in each changed repository, in its one repository, or at the root', () => {
    expect(checkPlaces({ where: 'changed', repository: null }, ['./api', './web'])).toEqual([
      './api',
      './web',
    ])
    expect(checkPlaces({ where: 'repository', repository: './api' }, ['./web'])).toEqual(['./api'])
    expect(checkPlaces({ where: 'root', repository: null }, ['./web'])).toEqual([''])
  })
})

describe('A value under its minimum is red', () => {
  const coverage = { pattern: String.raw`All files\s*\|\s*([\d.,]+)`, minimum: 70 }

  test('64.2 read against a minimum of 70 is red, and says so', () => {
    expect(evaluateExpect('Coverage\nAll files |  64.2 | 80\n', 0, coverage)).toEqual({
      verdict: 'red',
      value: 64.2,
      detail: '64.2 < 70',
    })
  })

  test('a number at or above the minimum is green', () => {
    expect(evaluateExpect('All files | 70 |', 0, coverage)).toEqual({
      verdict: 'green',
      value: 70,
      detail: null,
    })
  })

  test('a comma reads as the decimal separator, a percent sign after it is dropped', () => {
    const percent = { pattern: 'Lines: (.+)$', minimum: 64 }
    expect(evaluateExpect('Lines: 64,2 %\n', 0, percent).value).toBe(64.2)
    expect(evaluateExpect('Lines: 64.2%\n', 0, percent).value).toBe(64.2)
  })

  test('an error is never masked: a failed run is red whatever number it shows', () => {
    expect(evaluateExpect('All files | 99 |', 1, coverage)).toEqual({
      verdict: 'red',
      value: 99,
      detail: 'exited with 1',
    })
    expect(evaluateExpect('', null, null).detail).toBe('ended without an exit code')
  })

  test('no number where the pattern points is red', () => {
    const pattern = 'Lines: (.+)$'
    for (const output of ['nothing here', 'Lines: n/a', 'Lines: 1,234.5']) {
      expect(evaluateExpect(output, 0, { pattern, minimum: 1 })).toEqual({
        verdict: 'red',
        value: null,
        detail: `no number matched /${pattern}/`,
      })
    }
  })

  test('without an expected number, exit code 0 is green and any other red', () => {
    expect(evaluateExpect('ok', 0, null)).toEqual({ verdict: 'green', value: null, detail: null })
    expect(evaluateExpect('boom', 2, null)).toEqual({
      verdict: 'red',
      value: null,
      detail: 'exited with 2',
    })
  })
})

describe('Only the tests the task wrote run', () => {
  const line = 'pnpm wdio run {files}'
  const filter = 'e2e/**/*.e2e.ts'

  test('the line runs with the one matching file the task added', () => {
    const changed = [
      { path: 'e2e/login/sign-in.e2e.ts', status: 'A' },
      { path: 'src/login.ts', status: 'M' },
    ]
    expect(expandFiles(line, changed, filter)).toBe('pnpm wdio run e2e/login/sign-in.e2e.ts')
  })

  test('with no matching file, the check is skipped', () => {
    expect(expandFiles(line, [{ path: 'src/login.ts', status: 'A' }], filter)).toBeNull()
    expect(expandFiles(line, [], filter)).toBeNull()
  })

  test('a deleted file is never handed, and every placeholder is replaced', () => {
    const changed = [
      { path: 'e2e/old.e2e.ts', status: 'D' },
      { path: 'e2e/new.e2e.ts', status: 'R' },
    ]
    expect(expandFiles('a {files} b {files}', changed, filter)).toBe(
      'a e2e/new.e2e.ts b e2e/new.e2e.ts',
    )
  })

  test('a file with spaces or quotes stays one word', () => {
    const changed = [
      { path: 'e2e/sign in.e2e.ts', status: 'A' },
      { path: 'e2e/say "hi".e2e.ts', status: 'M' },
    ]
    expect(expandFiles(line, changed, filter)).toBe(
      `pnpm wdio run "e2e/sign in.e2e.ts" "e2e/say "'"'"hi"'"'".e2e.ts"`,
    )
  })

  test('{files} with no filter takes every changed file; a filter alone is a condition', () => {
    const changed = [{ path: 'src/a.ts', status: 'M' }]
    expect(expandFiles('lint {files}', changed, null)).toBe('lint src/a.ts')
    expect(expandFiles('pnpm test', changed, 'src/**')).toBe('pnpm test')
    expect(expandFiles('pnpm test', changed, 'docs/**')).toBeNull()
  })

  test('a line with no {files} and no filter is returned as it is', () => {
    expect(expandFiles('pnpm lint', [], null)).toBe('pnpm lint')
  })
})

describe('A files filter', () => {
  const cases: readonly (readonly [string, string, boolean])[] = [
    ['e2e/**/*.e2e.ts', 'e2e/a.e2e.ts', true],
    ['e2e/**/*.e2e.ts', 'e2e/a/b/c.e2e.ts', true],
    ['e2e/**/*.e2e.ts', 'src/e2e/a.e2e.ts', false],
    ['e2e/**/*.e2e.ts', 'e2e/a.e2e.tsx', false],
    ['*.ts', 'a.ts', true],
    ['*.ts', 'src/a.ts', false],
    ['**/*.ts', 'src/a.ts', true],
    ['**/*.ts', 'a.ts', true],
    ['src/**', 'src/a/b.ts', true],
    ['src/**', 'lib/a.ts', false],
    ['a?.ts', 'ab.ts', true],
    ['a?.ts', 'a/.ts', false],
    ['*.{ts,tsx}', 'a.tsx', true],
    ['*.{ts,tsx}', 'a.js', false],
    ['{src,e2e/{a,b}}/*.ts', 'e2e/b/x.ts', true],
    ['{src,e2e/{a,b}}/*.ts', 'e2e/c/x.ts', false],
    ['a+b(1).ts', 'a+b(1).ts', true],
    ['a.ts', 'abts', false],
  ]

  test.each(cases)('%s against %s is %s', (glob, path, matches) => {
    expect(globMatcher(glob)(path)).toBe(matches)
  })
})

describe('Defaults come from the catalogue', () => {
  function command(
    id: string,
    name: string,
    type: Command['type'],
    folderBase: string | null = null,
  ): Pick<Command, 'id' | 'name' | 'type' | 'folderBase'> {
    return { id, name, type, folderBase }
  }

  test('checks are proposed from the types, in the catalogue’s order', () => {
    const proposed = proposeChecks([
      command('c1', 'dev', 'serve'),
      command('c2', 'lint', 'lint'),
      command('c3', 'typecheck', 'script'),
      command('c4', 'unit tests', 'test'),
      command('c5', 'e2e', 'test'),
      command('c6', 'build', 'build'),
      command('c7', 'install', 'configure'),
    ])
    expect(proposed.map((one) => [one.commandId, one.when, one.where])).toEqual([
      ['c2', 'task', 'changed'],
      ['c3', 'task', 'changed'],
      ['c4', 'story', 'changed'],
      ['c5', 'end', 'root'],
      ['c6', 'end', 'root'],
    ])
    for (const one of proposed) {
      expect(one).toMatchObject({ line: null, repository: null, expect: null, files: null })
    }
    expect(proposed[0]?.name).toBe('lint')
  })

  test('an end-to-end suite and a type check are told by their names', () => {
    const proposed = proposeChecks([
      command('a', 'End-to-end', 'test'),
      command('b', 'tsc', 'build'),
      command('c', 'Type check', 'test'),
    ])
    expect(proposed.map((one) => [one.commandId, one.when])).toEqual([
      ['a', 'end'],
      ['b', 'task'],
      ['c', 'task'],
    ])
  })

  test('a command of one repository runs where the catalogue puts it', () => {
    const [lint] = proposeChecks([command('c1', 'lint', 'lint', './api')])
    expect(lint?.where).toBe('root')
  })

  test('a catalogue with nothing to check proposes nothing', () => {
    expect(proposeChecks([command('c1', 'dev', 'serve')])).toEqual([])
  })
})

describe('A check is saved only when it can run', () => {
  const draft: CheckDraft = {
    name: 'coverage',
    commandId: null,
    line: 'pnpm test --coverage',
    where: 'root',
    repository: null,
    when: 'end',
    expect: { pattern: String.raw`All files\s*\|\s*([\d.]+)`, minimum: 70 },
    files: 'src/**/*.{ts,tsx}',
  }

  test('a complete draft has no problem', () => {
    expect(checkProblem(draft, ['lint'])).toBeNull()
    expect(checkProblem({ ...draft, line: null, commandId: 'c1', expect: null }, [])).toBeNull()
    expect(checkProblem({ ...draft, where: 'repository', repository: './api' }, [])).toBeNull()
  })

  test('each problem is said in plain words', () => {
    const problems: readonly (readonly [Partial<CheckDraft>, string])[] = [
      [{ name: '  ' }, 'Give the check a name.'],
      [{ name: 'lint' }, 'A check named “lint” already exists.'],
      [{ commandId: 'c1' }, 'A check runs a command of the catalogue or a line, not both.'],
      [{ line: ' ' }, 'Choose a command of the catalogue or write a line to run.'],
      [{ where: 'repository' }, 'Choose the repository the check runs in.'],
      [{ repository: './api' }, 'Only a check that runs in one repository names a repository.'],
      [{ expect: { pattern: '', minimum: 1 } }, 'Write the pattern the number is read with.'],
      [{ expect: { pattern: '(', minimum: 1 } }, 'The pattern is not a valid regular expression.'],
      [
        { expect: { pattern: String.raw`\d+%`, minimum: 1 } },
        'Put the number to read between parentheses in the pattern, as in Coverage: ([0-9.]+)%.',
      ],
      [{ expect: { pattern: '(1)', minimum: Number.NaN } }, 'The minimum must be a number.'],
      [{ files: ' ' }, 'Write the files filter, as in e2e/**/*.e2e.ts, or remove it.'],
      [{ files: 'src/*.{ts' }, 'The files filter opens a { it does not close.'],
    ]
    for (const [change, sentence] of problems) {
      expect(checkProblem({ ...draft, ...change }, ['lint'])).toBe(sentence)
    }
  })
})
