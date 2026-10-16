/**
 * The rules of the automatic review (#147): what a finding must carry to be kept, the special
 * task Hemera writes from one, and the reviewers' tools.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  CONTRADICTION_OPTIONS,
  type ReviewFinding,
  findingProblem,
  repositoriesOfPath,
  specialTaskId,
  specialTaskOf,
  toolsOf,
} from '../src/domain/index.ts'

const finding = (fields: Partial<ReviewFinding> = {}): ReviewFinding => ({
  severity: 'warning',
  text: 'The CSV export drops the header row.',
  contradicts_spec: false,
  ...fields,
})

const inCheckpoint = (repository: string | null, path: string) =>
  repository === 'api' && path === 'src/x.ts'
const onlyApi = () => ['api']

/** Two repositories: `src/x.ts` changed in `api` only, `shared.ts` changed in both. */
const changed = new Map([
  ['api', ['src/x.ts', 'shared.ts']],
  ['web', ['shared.ts']],
])
const choicesIn = (repositories: ReadonlyArray<string>) => (path: string) =>
  repositoriesOfPath(repositories, (one) => changed.get(one)?.includes(path) === true)
const inBoth = (repository: string | null, path: string) =>
  repository !== null && changed.get(repository)?.includes(path) === true

describe('A finding of review_report', () => {
  test('a blocking finding without evidence is refused', () => {
    expect(findingProblem(finding({ severity: 'blocking' }), inCheckpoint, onlyApi)).toBe(
      'a blocking finding carries its evidence: what you read that shows it',
    )
    expect(
      findingProblem(
        finding({ severity: 'blocking', evidence: 'R1.S1 says so.' }),
        inCheckpoint,
        onlyApi,
      ),
    ).toBeNull()
  })

  test('a path not in the checkpoint is refused; a finding with no path is kept', () => {
    expect(
      findingProblem(finding({ repository: 'api', path: 'src/y.ts' }), inCheckpoint, onlyApi),
    ).toBe('api/src/y.ts is not in the checkpoint: name a file you read there')
    expect(
      findingProblem(finding({ repository: 'api', path: 'src/x.ts' }), inCheckpoint, onlyApi),
    ).toBeNull()
    expect(findingProblem(finding(), inCheckpoint, onlyApi)).toBeNull()
  })
})

describe('A path given without its repository', () => {
  const both = ['api', 'web']

  test('one repository: the path names it, changed there or not', () => {
    expect(choicesIn(['api'])('README.md')).toEqual(['api'])
    expect(choicesIn(['api'])('src/x.ts')).toEqual(['api'])
  })

  test('two repositories with the path changed in one: it names that one', () => {
    expect(choicesIn(both)('src/x.ts')).toEqual(['api'])
  })

  test('two repositories with the path changed in both: both are the choices', () => {
    expect(choicesIn(both)('shared.ts')).toEqual(['api', 'web'])
  })

  test('two repositories with the path changed in neither: every repository is a choice', () => {
    expect(choicesIn(both)('README.md')).toEqual(['api', 'web'])
  })

  test('a finding whose path names no single repository is refused with the repositories to choose from', () => {
    expect(findingProblem(finding({ path: 'shared.ts' }), inBoth, choicesIn(both))).toBe(
      'shared.ts names no single repository: say which, one of api, web',
    )
    expect(findingProblem(finding({ path: 'README.md' }), inBoth, choicesIn(both))).toBe(
      'README.md names no single repository: say which, one of api, web',
    )
  })

  test('a finding whose path names exactly one repository is kept', () => {
    expect(findingProblem(finding({ path: 'src/x.ts' }), inBoth, choicesIn(both))).toBeNull()
    expect(
      findingProblem(finding({ repository: 'web', path: 'shared.ts' }), inBoth, choicesIn(both)),
    ).toBeNull()
  })
})

describe('A special task written from a finding', () => {
  test('RV1, RV2… with a title from the finding’s first line, its final period dropped, and its whole text as the result', () => {
    expect([specialTaskId(1), specialTaskId(2)]).toEqual(['RV1', 'RV2'])
    expect(specialTaskOf({ text: 'Keep the header row.\nThe export drops it.' })).toEqual({
      title: 'Keep the header row',
      result:
        "The automatic review's finding is addressed: Keep the header row.\nThe export drops it.",
    })
  })
})

describe('A finding that contradicts the Spec', () => {
  test('offers the Spec is right, the result is right, and dismiss', () => {
    expect(CONTRADICTION_OPTIONS).toEqual([
      'The Spec is right: make the code follow it',
      'The result is right: record it as a decision',
      'Dismiss',
    ])
  })
})

describe('The reviewers are read-only, without commands, without the Memory', () => {
  test.each(['spec-reviewer', 'code-reviewer'] as const)('%s', (role) => {
    expect(toolsOf(role).toSorted()).toEqual([
      'checkpoint_read',
      'evidence_read',
      'fs_read',
      'hemera_report',
      'hemera_reports',
      'review_report',
      'search',
      'spec_read',
    ])
  })
})
