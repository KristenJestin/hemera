/**
 * The model cascade, the sub-agent cap and the budget of a mission, as words and numbers: the
 * most precise level wins, the cap's bounds and default, the budget's first guesses, and the
 * sentences an agent and the user read.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  BUDGET_DEFAULTS,
  CAP,
  KEEP_THE_LIMIT,
  budgetQuestion,
  budgetSpentSentence,
  capRefusal,
  counterAsked,
  raiseOption,
  raisedBy,
  resolveSetting,
  slotWaitSentence,
} from '../src/domain/budget.ts'

const app = { agent: 'claude', model: 'sonnet', effort: 'medium' } as const
const project = { agent: 'codex', model: 'gpt-large', effort: 'high' } as const
const mission = { agent: 'claude', model: 'opus', effort: null } as const

describe('The most precise level wins', () => {
  test.each([
    [app, null, null, 'app', app],
    [app, project, null, 'project', project],
    [app, null, mission, 'mission', mission],
    [app, project, mission, 'mission', mission],
  ] as const)('app %o, project %o, mission %o: the %s level', (a, p, m, level, setting) => {
    expect(resolveSetting(a, p, m)).toEqual({ ...setting, level })
  })
})

describe('The cap and the budget', () => {
  test('the cap is 3 by default, a whole number from 1 to 6', () => {
    expect(CAP).toEqual({ least: 1, most: 6, initial: 3 })
  })

  test('the budget per mission is a first guess: 8 launches, 30 attempts, 3 rounds', () => {
    expect(BUDGET_DEFAULTS).toEqual({ launches: 8, attempts: 30, rounds: 3 })
  })

  test('what an agent and the user read', () => {
    expect(capRefusal(3, 3)).toBe(
      '3 sub-agents already run in this Project (the cap is 3); do the work yourself or wait',
    )
    expect(slotWaitSentence(3, 3)).toBe('waiting for a free slot (3 of 3 in use)')
    expect(budgetSpentSentence('launches', 8, 8)).toBe(
      'the launches of this mission are spent (8 of 8)',
    )
  })

  test('the decision a spent counter makes reads back as its counter and its raise', () => {
    expect(budgetQuestion('launches', 'ACME-12')).toBe('The launches budget of ACME-12 is spent')
    expect(counterAsked(budgetQuestion('rounds', 'ACME-12'))).toBe('rounds')
    expect(counterAsked('Which export format?')).toBeNull()
    expect(raisedBy(raiseOption(8))).toBe(8)
    expect(raisedBy(KEEP_THE_LIMIT)).toBeNull()
  })
})
