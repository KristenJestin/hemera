/**
 * The settings of the model cascade, the cap and the budget, as a window sends them (#41): a cap
 * is a whole number from 1 to 6, a budget's limits are whole numbers from 0, and the group reads
 * and writes nothing else.
 */

import { Result, Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { ModelsRpcs, ProjectLimits } from '../src/index.ts'

const decode = Schema.decodeUnknownResult(ProjectLimits)
const budget = { launches: 8, attempts: 30, rounds: 3 }

describe('A Project’s limits', () => {
  test.each([1, 3, 6])('a cap of %i is taken', (cap) => {
    expect(Result.isSuccess(decode({ cap, budget }))).toBe(true)
  })

  test.each([0, 7, 2.5])('a cap of %d is refused', (cap) => {
    expect(Result.isFailure(decode({ cap, budget }))).toBe(true)
  })

  test('a negative or partial limit is refused', () => {
    expect(Result.isFailure(decode({ cap: 3, budget: { ...budget, launches: -1 } }))).toBe(true)
    expect(Result.isFailure(decode({ cap: 3, budget: { ...budget, rounds: 1.5 } }))).toBe(true)
  })
})

test('the group reads and sets the roles’ models, the marks, the limits and a mission’s budget', () => {
  expect([...ModelsRpcs.requests.keys()].sort()).toEqual([
    'limits.mission',
    'limits.project',
    'limits.setProject',
    'models.mark',
    'models.marks',
    'models.roles',
    'models.setRole',
  ])
})
