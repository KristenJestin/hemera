/**
 * The Tests of a Project's settings, as the window reads and writes them (#421): each repository's
 * guess with its rule beside the value written by hand, a draft turned into the value the engine
 * stores, and the engine's refusal said under its field.
 */

import { TestReportingRefused } from '@hemera/core/domain'
import { StaleVersion, type Repository } from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import {
  reportingOfDraft,
  testsRefusalOf,
  testsRowsOf,
} from '../src/renderer/tests-settings-model.ts'

const repository = (id: string, path: string, more: Partial<Repository> = {}): Repository => ({
  id,
  projectId: 'acme',
  path,
  includedByDefault: true,
  remote: 'origin',
  baseBranch: 'main',
  lastFetchedAt: null,
  testReporting: null,
  ...more,
})

const API = repository('r-api', 'api')
const WEB = repository('r-web', 'web', {
  testReporting: { runner: 'vitest', report: { format: 'json', path: 'reports/vitest.json' } },
})
const SHARED = repository('r-shared', 'shared')

describe('the guess is shown with its rule', () => {
  test('each repository shows its guess and its own value, and none until the guesses are read', () => {
    const guesses = new Map([
      ['r-api', { runner: 'pytest' as const, from: 'pyproject.toml' }],
      ['r-web', { runner: 'vitest' as const, from: 'vite.config.ts' }],
      ['r-shared', null],
    ])
    expect(testsRowsOf([API, WEB, SHARED], null)).toBeNull()
    expect(testsRowsOf([API, WEB, SHARED], guesses)).toEqual([
      { repository: 'api', guess: { runner: 'pytest', from: 'pyproject.toml' }, custom: null },
      {
        repository: 'web',
        guess: { runner: 'vitest', from: 'vite.config.ts' },
        custom: { runner: 'vitest', report: { format: 'json', path: 'reports/vitest.json' } },
      },
      { repository: 'shared', guess: null, custom: null },
    ])
  })
})

describe('a custom value replaces it, and back to the guess removes it', () => {
  test('a draft is written as the value the engine stores', () => {
    expect(reportingOfDraft({ runner: 'pytest', report: 'hemera', path: 'ignored' })).toEqual({
      runner: 'pytest',
    })
    expect(reportingOfDraft({ runner: 'node', report: 'junit', path: 'junit.xml' })).toEqual({
      runner: 'node',
      report: { format: 'junit', path: 'junit.xml' },
    })
  })
})

describe('a path outside the repository and an unknown format are refused', () => {
  test('the engine’s refusal is said under its field, any other at the foot', () => {
    const outside = new TestReportingRefused({
      field: 'path',
      reason: '../junit.xml is outside api: the report must be written inside it.',
    })
    expect(testsRefusalOf(outside)).toEqual({
      field: { field: 'path', words: outside.reason },
      foot: undefined,
    })
    const stale = new StaleVersion({ entity: 'project', id: 'acme', expected: 1 })
    expect(testsRefusalOf(stale)).toEqual({ field: undefined, foot: stale.message })
  })
})
