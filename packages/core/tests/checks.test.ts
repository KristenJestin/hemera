/**
 * The Project's checks (#143): the model and the sentence each refusal shows, the defaults proposed
 * from the catalogue's check commands, where a check runs, how `{files}` is filled, and how a run
 * is judged by its exit code and the number its output shows.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  type CheckDraft,
  checkPlaces,
  checkProblem,
  evaluateExpect,
  expandFiles,
  globMatcher,
  proposeChecks,
  shellSyntaxIn,
  wordsOf,
} from '../src/domain/index.ts'

const draft = (over: Partial<CheckDraft> = {}): CheckDraft => ({
  name: 'lint',
  commandId: null,
  line: 'node lint.js',
  where: 'changed',
  repository: null,
  when: 'task',
  expect: null,
  files: null,
  ...over,
})

describe('A check is refused with its sentence', () => {
  test('a check with both a command and a line is refused', () => {
    expect(checkProblem(draft({ commandId: 'c1', line: 'node lint.js' }), [])).toBe(
      'A check runs a command of the catalogue or a line, not both.',
    )
  })

  test('a check with neither a command nor a line is refused', () => {
    expect(checkProblem(draft({ line: '  ' }), [])).toBe(
      'Choose a command of the catalogue or write a line to run.',
    )
  })

  test('a check needs a name, unique in the Project', () => {
    expect(checkProblem(draft({ name: ' ' }), [])).toBe('Give the check a name.')
    expect(checkProblem(draft(), ['lint'])).toBe('A check named “lint” already exists.')
  })

  test('a pattern without a capture group is refused', () => {
    expect(
      checkProblem(draft({ expect: { pattern: 'Coverage: [0-9.]+%', minimum: 70 } }), []),
    ).toBe('Put the number to read between parentheses in the pattern, as in Coverage: ([0-9.]+)%.')
  })

  test('a pattern with two capture groups, or that is not a regular expression, is refused', () => {
    expect(
      checkProblem(draft({ expect: { pattern: '(Lines): ([0-9.]+)%', minimum: 70 } }), []),
    ).toBe('The pattern reads one number: keep exactly one pair of parentheses.')
    expect(
      checkProblem(draft({ expect: { pattern: 'Coverage: ([0-9.]+', minimum: 70 } }), []),
    ).toBe('The pattern is not a valid regular expression.')
  })

  test('a minimum that is not a number is refused', () => {
    expect(
      checkProblem(draft({ expect: { pattern: 'Coverage: ([0-9.]+)%', minimum: Number.NaN } }), []),
    ).toBe('The minimum must be a number.')
  })

  test('a repository is named only for a check that runs in one', () => {
    expect(checkProblem(draft({ where: 'repository' }), [])).toBe(
      'Choose the repository the check runs in.',
    )
    expect(checkProblem(draft({ repository: 'api' }), [])).toBe(
      'Only a check that runs in one repository names a repository.',
    )
  })

  test('a line with | is refused naming it', () => {
    expect(checkProblem(draft({ line: 'node lint.js | tee out.txt' }), [])).toBe(
      'Hemera runs a command without a shell, and “|” is shell syntax: put it in a script of the repository and run the script.',
    )
    expect(checkProblem(draft({ line: 'node lint.js && echo ok' }), [])).toContain('“&&”')
    expect(checkProblem(draft({ line: 'node a.js; node b.js' }), [])).toContain('“;”')
    expect(checkProblem(draft({ line: 'node $(which lint)' }), [])).toContain('“$(”')
    expect(checkProblem(draft({ line: 'node lint.js > out.txt' }), [])).toContain('“>”')
  })

  test('a glob outside {files} is refused, the one inside is the filter', () => {
    expect(checkProblem(draft({ line: 'vitest run src/*.test.ts' }), [])).toContain('“*”')
    expect(
      checkProblem(draft({ line: 'vitest run {files}', files: '**/*.test.ts' }), []),
    ).toBeNull()
  })

  test('{files} is in the line only when the files filter is set', () => {
    expect(checkProblem(draft({ line: 'vitest run {files}' }), [])).toBe(
      'Set the files filter {files} is filled with, as in **/*.test.ts, or take {files} out of the line.',
    )
  })

  test('a glob whose braces do not close is refused', () => {
    expect(
      checkProblem(draft({ line: 'vitest run {files}', files: '**/*.{test,spec.ts' }), []),
    ).toBe('The files filter opens a { it does not close.')
  })

  test('a valid check is accepted', () => {
    expect(
      checkProblem(
        draft({
          name: 'coverage',
          line: 'node coverage.js',
          where: 'root',
          when: 'end',
          expect: { pattern: 'Coverage: ([0-9.]+)%', minimum: 70 },
        }),
        ['lint'],
      ),
    ).toBeNull()
    expect(checkProblem(draft({ commandId: 'c1', line: null }), [])).toBeNull()
  })
})

describe('The proposed defaults', () => {
  const command = (
    id: string,
    type: 'serve' | 'test' | 'lint' | 'typecheck' | 'build' | 'e2e' | 'script',
    over: { check?: boolean; repositoryId?: string | null } = {},
  ) => ({ id, name: id, type, check: over.check ?? true, repositoryId: over.repositoryId ?? null })

  test('proposals come from the catalogue’s check commands with the defaults', () => {
    const proposed = proposeChecks([
      command('lint', 'lint'),
      command('types', 'typecheck'),
      command('unit', 'test'),
      command('bundle', 'build'),
      command('browser', 'e2e'),
      command('dev', 'serve'),
      command('seed', 'script'),
      command('slow', 'test', { check: false }),
    ])
    expect(proposed.map((one) => [one.name, one.commandId, one.when, one.where])).toEqual([
      ['lint', 'lint', 'task', 'changed'],
      ['types', 'types', 'task', 'changed'],
      ['unit', 'unit', 'requirement', 'changed'],
      ['bundle', 'bundle', 'end', 'root'],
      ['browser', 'browser', 'end', 'root'],
    ])
    expect(proposed.every((one) => one.line === null && one.expect === null)).toBe(true)
  })

  test('a serve is never proposed, even marked as a check', () => {
    expect(proposeChecks([command('dev', 'serve')])).toEqual([])
  })

  test('a command bound to one repository runs where the catalogue puts it', () => {
    const [proposed] = proposeChecks([command('lint-api', 'lint', { repositoryId: 'r-api' })])
    expect(proposed?.where).toBe('root')
    expect(proposed?.repository).toBeNull()
  })
})

describe('Where a check runs', () => {
  test('root, its one repository, or each changed repository', () => {
    expect(checkPlaces({ where: 'root', repository: null }, ['api', 'web'])).toEqual([''])
    expect(checkPlaces({ where: 'repository', repository: 'api' }, ['web'])).toEqual(['api'])
    expect(checkPlaces({ where: 'changed', repository: null }, ['api', 'web'])).toEqual([
      'api',
      'web',
    ])
    expect(checkPlaces({ where: 'changed', repository: null }, [])).toEqual([])
  })
})

describe('{files}', () => {
  const changed = [
    { path: 'src/sum.ts', deleted: false },
    { path: 'src/sum.test.ts', deleted: false },
    { path: 'src/old.test.ts', deleted: true },
    { path: 'src/my file.test.ts', deleted: false },
  ]

  test('{files} with **/*.test.ts runs only the tests the task wrote, deleted ones left out', () => {
    expect(expandFiles('vitest run {files}', changed, '**/*.test.ts')).toBe(
      "vitest run src/sum.test.ts 'src/my file.test.ts'",
    )
  })

  test('none matching: the check is skipped', () => {
    expect(expandFiles('vitest run {files}', changed, '**/*.e2e.ts')).toBeNull()
  })

  test('a line without {files} runs as it is', () => {
    expect(expandFiles('node lint.js', changed, null)).toBe('node lint.js')
  })

  test('a name holding $, &, ;, %NAME%, a backtick or a quote is one literal word, never shell syntax', () => {
    const names = [
      'routes/$postId.test.tsx',
      'a&b.test.ts',
      'a;b.test.ts',
      '%HOME%.test.ts',
      'a`b.test.ts',
      "it's.test.ts",
      'say "hi".test.ts',
    ]
    for (const name of names) {
      const line = expandFiles('vitest run {files}', [{ path: name, deleted: false }], null) ?? ''
      expect(shellSyntaxIn(line)).toBeNull()
      expect(wordsOf(line)).toEqual(['vitest', 'run', name])
    }
  })

  test('a name starting with - is never read as an option', () => {
    const line =
      expandFiles('node --test {files}', [{ path: '--import=x.test.ts', deleted: false }], null) ??
      ''
    expect(wordsOf(line)).toEqual(['node', '--test', './--import=x.test.ts'])
  })

  test('a brace in a path is kept literal for the run’s templates', () => {
    expect(expandFiles('vitest run {files}', [{ path: 'a{b}.test.ts', deleted: false }], '*')).toBe(
      'vitest run a{{b}}.test.ts',
    )
  })

  test('a glob matches the whole path, ** any folders, braces either part', () => {
    expect(globMatcher('**/*.test.ts')('a.test.ts')).toBe(true)
    expect(globMatcher('**/*.test.ts')('src/deep/a.test.ts')).toBe(true)
    expect(globMatcher('*.ts')('src/a.ts')).toBe(false)
    expect(globMatcher('src/*.{ts,tsx}')('src/a.tsx')).toBe(true)
    expect(globMatcher('src/?.ts')('src/ab.ts')).toBe(false)
  })
})

describe('The verdict of a run', () => {
  const coverage = { pattern: 'Coverage: ([0-9.]+)%', minimum: 70 }

  test('64.2 under a minimum of 70 is red with "64.2 < 70"', () => {
    expect(evaluateExpect('Coverage: 64.2%\n', 0, coverage)).toEqual({
      verdict: 'red',
      value: 64.2,
      detail: '64.2 < 70',
    })
  })

  test('a run that exits 1 is red whatever it printed', () => {
    expect(evaluateExpect('Coverage: 99%\nall good', 1, coverage)).toEqual({
      verdict: 'red',
      value: 99,
      detail: 'exited with 1',
    })
    expect(evaluateExpect('ok', 1, null).detail).toBe('exited with 1')
  })

  test('no number matched is red, naming the pattern', () => {
    expect(evaluateExpect('nothing', 0, coverage).detail).toBe(
      'no number matched /Coverage: ([0-9.]+)%/',
    )
  })

  test('exit 0 is green, and a number at the minimum is green', () => {
    expect(evaluateExpect('', 0, null)).toEqual({ verdict: 'green', value: null, detail: '' })
    expect(evaluateExpect('Coverage: 70%', 0, coverage).verdict).toBe('green')
    expect(
      evaluateExpect('Coverage: 81,5%', 0, { pattern: 'Coverage: ([0-9.,]+)%', minimum: 70 }).value,
    ).toBe(81.5)
  })
})
