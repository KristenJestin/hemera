/**
 * Where Planning stands, read from what the engine knows: the four steps of the page, the head's
 * Now line and where a press on it leads, and what stands before Freeze. Each moment of the
 * journey the catalogue draws, from a mission's first second to Freeze.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  freezeOf,
  planningNow,
  planningSteps,
  type PlanningFacts,
} from '../src/blocks/planning/planning-progress.ts'
import * as moments from '../src/surfaces/planning/planning-fixtures.ts'

const stepsOf = (facts: PlanningFacts) =>
  Object.fromEntries(planningSteps(facts).map((step) => [step.id, step]))

describe('the first second of a mission', () => {
  const facts = moments.starting()

  test('the Spec step runs, with the sections written so far and what comes next', () => {
    const steps = stepsOf(facts)
    expect(steps.spec?.state).toBe('running')
    expect(steps.spec?.detail).toBe('0 of 8 sections written')
    expect(steps.spec?.next).toBe('Write Why and Goals, then ask what it cannot decide alone')
    expect(steps.questions?.state).toBe('todo')
    expect(steps.coldRead?.state).toBe('todo')
    expect(steps.freeze?.state).toBe('todo')
  })

  test('the Now line is the Planner’s and leads to the section it writes', () => {
    expect(planningNow(facts)).toEqual({
      text: 'Reads the living spec and the prototype code',
      ball: 'agent',
      target: { kind: 'section', name: 'why' },
      coldRead: null,
    })
  })

  test('Freeze is not in the head before the Spec is declared complete', () => {
    expect(freezeOf(facts)).toEqual({ shown: false })
  })
})

describe('a wave of questions', () => {
  const facts = moments.wave()

  test('the questions step waits for the user, with how many', () => {
    const steps = stepsOf(facts)
    expect(steps.spec?.state).toBe('done')
    expect(steps.questions?.state).toBe('waiting')
    expect(steps.questions?.detail).toBe(
      '1 to answer · 1 waits on someone · 1 being taken into account',
    )
  })

  test('the Now line asks for the answer and leads to the first open question', () => {
    expect(planningNow(facts)).toMatchObject({
      text: 'Q5 waits for your answer',
      ball: 'you',
      target: { kind: 'question', id: 'Q5' },
    })
  })
})

describe('an answer on its way', () => {
  test('sent and not yet taken into account: the Planner has it to integrate', () => {
    const steps = stepsOf(moments.answerDelivered())
    expect(steps.questions?.detail).toBe('1 waits on someone · 2 being taken into account')
  })
})

describe('declared complete, the cold read running', () => {
  const facts = moments.coldReadRunning()

  test('the Now line says the cold read reads the Spec, with its chip, and leads to it', () => {
    const now = planningNow(facts)
    expect(now.text).toBe('The cold read is reading the Spec')
    expect(now.ball).toBe('agent')
    expect(now.target).toEqual({ kind: 'coldRead' })
    expect(now.coldRead?.state).toBe('running')
  })

  test('a Planner idle after its declaration is not believed over the facts', () => {
    expect(planningNow(facts).text).not.toMatch(/Nothing left/)
  })

  test('Freeze stands in the head, disabled, with the reason', () => {
    expect(freezeOf(facts)).toEqual({
      shown: true,
      reasons: ['The cold read is reading the Spec'],
    })
  })

  test('the cold read step runs; the answers are done', () => {
    const steps = stepsOf(facts)
    expect(steps.questions?.state).toBe('done')
    expect(steps.questions?.detail).toBe('4 answered')
    expect(steps.coldRead?.state).toBe('running')
  })
})

describe('findings to settle', () => {
  const facts = moments.findings()

  test('Freeze names what is left; the Now line leads to the first question asked from them', () => {
    expect(freezeOf(facts)).toEqual({
      shown: true,
      reasons: ['1 question to answer', '2 findings to settle'],
    })
    expect(planningNow(facts)).toMatchObject({
      text: 'Q8 waits for your answer',
      target: { kind: 'question', id: 'Q8' },
    })
    expect(stepsOf(facts).coldRead?.state).toBe('waiting')
    expect(stepsOf(facts).coldRead?.detail).toBe('2 findings to settle')
  })
})

describe('ready to freeze', () => {
  const facts = moments.readyToFreeze()

  test('Freeze is enabled and the Now line says it, leading to it', () => {
    expect(freezeOf(facts)).toEqual({ shown: true, reasons: [] })
    expect(planningNow(facts)).toMatchObject({
      text: 'Ready to freeze',
      ball: 'you',
      target: { kind: 'freeze' },
    })
    expect(stepsOf(facts).freeze?.state).toBe('waiting')
  })
})

describe('frozen', () => {
  test('nothing in the head but the stage; every step done', () => {
    const facts = moments.frozen()
    expect(freezeOf(facts)).toEqual({ shown: false })
    expect(planningSteps(facts).every((step) => step.state === 'done')).toBe(true)
  })
})

describe('a Planner in trouble', () => {
  test('stopped: said with its reason, and the Now line leads to the steps', () => {
    const facts = moments.plannerFailed()
    expect(planningNow(facts)).toEqual({
      text: 'The Planner stopped: its provider refused the request (quota reached)',
      ball: 'you',
      target: { kind: 'steps' },
      coldRead: null,
    })
    expect(stepsOf(facts).spec?.state).toBe('failed')
  })

  test('silent: its last turn ended without a word', () => {
    const facts = moments.plannerSilent()
    expect(planningNow(facts).text).toBe('The Planner’s last turn ended without a word')
  })
})
