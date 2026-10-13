/**
 * The rules of the automatic review (#147): what a finding must carry to be kept, the special
 * task Hemera writes from one, and the reviewers' tools.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  CONTRADICTION_OPTIONS,
  type ReviewFinding,
  findingProblem,
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

describe('A finding of review_report', () => {
  test('a blocking finding without evidence is refused', () => {
    expect(findingProblem(finding({ severity: 'blocking' }), inCheckpoint)).toBe(
      'a blocking finding carries its evidence: what you read that shows it',
    )
    expect(
      findingProblem(finding({ severity: 'blocking', evidence: 'R1.S1 says so.' }), inCheckpoint),
    ).toBeNull()
  })

  test('a path not in the checkpoint is refused; a finding with no path is kept', () => {
    expect(findingProblem(finding({ repository: 'api', path: 'src/y.ts' }), inCheckpoint)).toBe(
      'api/src/y.ts is not in the checkpoint: name a file you read there',
    )
    expect(
      findingProblem(finding({ repository: 'api', path: 'src/x.ts' }), inCheckpoint),
    ).toBeNull()
    expect(findingProblem(finding(), inCheckpoint)).toBeNull()
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
