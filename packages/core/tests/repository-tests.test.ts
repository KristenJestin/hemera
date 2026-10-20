/**
 * A repository's test runner and report in Project settings (#421): the guess, read from the files
 * at the repository's root and named with its rule, and the check a value written by hand passes
 * on save: a runner the reader knows, a report format the reader reads from that runner, and a
 * path that stays inside the repository.
 */

import { describe, expect, test } from 'vite-plus/test'

import { guessedTests, testReportingRefusal } from '../src/domain/index.ts'

describe('the guess is shown with its rule', () => {
  test('each runner is guessed from the file that names it', () => {
    const cases: ReadonlyArray<readonly [ReadonlyArray<string>, string, string]> = [
      [['package.json', 'vite.config.ts', 'src'], 'vitest', 'vite.config.ts'],
      [['vitest.config.mts'], 'vitest', 'vitest.config.mts'],
      [['jest.config.js', 'package.json'], 'jest', 'jest.config.js'],
      [['.mocharc.yml'], 'mocha', '.mocharc.yml'],
      [['pyproject.toml', 'src'], 'pytest', 'pyproject.toml'],
      [['pytest.ini'], 'pytest', 'pytest.ini'],
      [['conftest.py'], 'pytest', 'conftest.py'],
      [['go.mod', 'go.sum'], 'go', 'go.mod'],
      [['Cargo.toml'], 'cargo', 'Cargo.toml'],
    ]
    for (const [names, runner, from] of cases) {
      expect([names, guessedTests(names)]).toEqual([names, { runner, from }])
    }
  })

  test('the more precise rule wins: a jest configuration beside a vite one', () => {
    expect(guessedTests(['vite.config.ts', 'jest.config.ts'])).toEqual({
      runner: 'jest',
      from: 'jest.config.ts',
    })
    expect(guessedTests(['vite.config.ts', 'vitest.config.ts'])).toEqual({
      runner: 'vitest',
      from: 'vitest.config.ts',
    })
  })

  test('no runner is found when no rule names one', () => {
    expect(guessedTests(['Makefile', 'README.md', 'src'])).toBeNull()
    // A name that only starts like a rule's file is not it.
    expect(guessedTests(['vite.config.ts.bak', 'go.mod.orig'])).toBeNull()
  })
})

describe('a path outside the repository and an unknown format are refused', () => {
  test('a report at a path inside the repository, in a format the reader reads, is kept', () => {
    expect(testReportingRefusal('api', { runner: 'pytest' })).toBeNull()
    expect(testReportingRefusal('shared', { runner: 'go' })).toBeNull()
    const kept = [
      { runner: 'pytest', report: { format: 'junit', path: 'reports/junit.xml' } },
      { runner: 'node', report: { format: 'junit', path: 'junit.xml' } },
      { runner: 'vitest', report: { format: 'json', path: 'reports/vitest.json' } },
    ] as const
    for (const reporting of kept) {
      expect([reporting, testReportingRefusal('web', reporting)]).toEqual([reporting, null])
    }
  })

  test('a path outside the repository is refused with the reason, under the path', () => {
    const outside = [
      '../reports/junit.xml',
      'reports/../../junit.xml',
      '/tmp/junit.xml',
      'C:/r.xml',
    ]
    for (const path of outside) {
      expect(
        testReportingRefusal('web', { runner: 'pytest', report: { format: 'junit', path } }),
      ).toEqual({
        field: 'path',
        reason: `${path} is outside web: the report must be written inside it.`,
      })
    }
  })

  test('a path that names no file of the repository is refused with the reason', () => {
    const refused = (path: string) =>
      testReportingRefusal('web', { runner: 'pytest', report: { format: 'junit', path } })
    expect(refused('  ')).toEqual({
      field: 'path',
      reason: 'Where the runner writes it, from the root of web.',
    })
    expect(refused('reports\\junit.xml')?.field).toBe('path')
    expect(refused('.git/junit.xml')?.field).toBe('path')
    expect(refused('reports//junit.xml')?.field).toBe('path')
  })

  test('a format the reader does not read from that runner is refused, under the report', () => {
    expect(
      testReportingRefusal('api', {
        runner: 'pytest',
        report: { format: 'json', path: 'reports/pytest.json' },
      }),
    ).toEqual({
      field: 'report',
      reason: 'Hemera reads no JSON report from pytest: choose JUnit XML.',
    })
    expect(
      testReportingRefusal('web', {
        runner: 'vitest',
        report: { format: 'junit', path: 'reports/junit.xml' },
      }),
    ).toEqual({
      field: 'report',
      reason: 'Hemera reads no JUnit XML report from vitest: choose JSON.',
    })
    expect(
      testReportingRefusal('shared', {
        runner: 'go',
        report: { format: 'junit', path: 'junit.xml' },
      }),
    ).toEqual({
      field: 'report',
      reason: 'Hemera reads no JUnit XML report from go test: its red is read from the console.',
    })
  })

  test('a runner the reader does not know is refused, under the runner', () => {
    expect(testReportingRefusal('web', { runner: 'unknown' })).toEqual({
      field: 'runner',
      reason: 'Choose the runner of web.',
    })
  })
})
