/**
 * Hemera Auto's pure rules: the verdict from Jev's scores at the Normal level, the bounded human
 * context Jev is told, and who judges a call.
 */

import fc from 'fast-check'
import { describe, expect, test } from 'vite-plus/test'

import {
  HUMAN_CONTEXT_LIMITS,
  type HumanItem,
  boundedHumanContext,
  verdictFromScores,
  whoJudges,
} from '../src/domain/index.ts'

const scores = (risk: number, approval: number, userRequested: number) => ({
  risk,
  approval,
  userRequested,
})

describe('The verdict from the scores, at the Normal level', () => {
  test('risk 2.5 asks whatever the user asked; just below, it does not on its own', () => {
    expect(verdictFromScores(scores(2.5, 0, 1), true)).toBe('ask')
    expect(verdictFromScores(scores(3, 0, 1), true)).toBe('ask')
    expect(verdictFromScores(scores(2.49, 0, 1), true)).toBe('allow')
  })

  test('risk 1.5 asks unless the user asked for it (0.85, with human context)', () => {
    expect(verdictFromScores(scores(1.5, 0, 0), true)).toBe('ask')
    expect(verdictFromScores(scores(1.49, 0, 0), true)).toBe('allow')
    expect(verdictFromScores(scores(1.5, 0, 0.85), true)).toBe('allow')
    expect(verdictFromScores(scores(1.5, 0, 0.84), true)).toBe('ask')
    // Without any human context, "the user asked for it" lifts nothing.
    expect(verdictFromScores(scores(1.5, 0, 1), false)).toBe('ask')
  })

  test('approval 0.75 asks unless the user asked for it', () => {
    expect(verdictFromScores(scores(0, 0.75, 0), true)).toBe('ask')
    expect(verdictFromScores(scores(0, 0.7499, 0), true)).toBe('allow')
    expect(verdictFromScores(scores(0, 0.75, 0.85), true)).toBe('allow')
    expect(verdictFromScores(scores(0, 0.75, 0.85), false)).toBe('ask')
  })

  test('invalid or out-of-range scores ask', () => {
    for (const wrong of [
      scores(Number.NaN, 0, 0),
      scores(-0.1, 0, 0),
      scores(3.01, 0, 0),
      scores(0, -0.1, 0),
      scores(0, 1.01, 0),
      scores(0, Number.POSITIVE_INFINITY, 0),
      scores(0, 0, Number.NaN),
      scores(0, 0, 1.2),
    ]) {
      expect(verdictFromScores(wrong, true)).toBe('ask')
    }
  })

  test('Jev never refuses: every score answers allow or ask', () => {
    fc.assert(
      fc.property(
        fc.double(),
        fc.double(),
        fc.double(),
        fc.boolean(),
        (risk, approval, userRequested, context) => {
          const verdict = verdictFromScores(scores(risk, approval, userRequested), context)
          return verdict === 'allow' || verdict === 'ask'
        },
      ),
    )
  })
})

const item = (text: string, source: HumanItem['source'] = 'answer'): HumanItem => ({
  source,
  text,
})

describe('The human context is bounded', () => {
  test('the limits are 6 items, 2 000 characters each, 12 000 in all', () => {
    expect(HUMAN_CONTEXT_LIMITS).toEqual({
      items: 6,
      itemCharacters: 2000,
      totalCharacters: 12000,
    })
  })

  test('each item says where it comes from, oldest first', () => {
    expect(
      boundedHumanContext([
        item('Ship the export to CSV.', 'frozen-spec'),
        item('Keep the old format.', 'spec-decision'),
        item('Use commas.', 'answer'),
        item('Option B', 'chosen-option'),
        item('Run the tests now.', 'chat-message'),
      ]),
    ).toEqual([
      'The Spec the user froze: Ship the export to CSV.',
      'A decision of the frozen Spec: Keep the old format.',
      'The user answered: Use commas.',
      'An option the user chose: Option B',
      'The user wrote: Run the tests now.',
    ])
  })

  test('only the 6 latest items are kept', () => {
    const items = Array.from({ length: 9 }, (_, at) => item(`answer ${String(at)}`))
    expect(boundedHumanContext(items)).toEqual(
      [3, 4, 5, 6, 7, 8].map((at) => `The user answered: answer ${String(at)}`),
    )
  })

  test('an item too long is left out rather than cut', () => {
    const long = 'x'.repeat(HUMAN_CONTEXT_LIMITS.itemCharacters + 1)
    const kept = boundedHumanContext([item('before'), item(long), item('after')])
    expect(kept).toEqual(['The user answered: before', 'The user answered: after'])
    const longest = 'x'.repeat(HUMAN_CONTEXT_LIMITS.itemCharacters)
    expect(boundedHumanContext([item(longest)])).toEqual([`The user answered: ${longest}`])
  })

  test('the latest items are kept within 12 000 characters, the oldest left out', () => {
    const biggest = (at: number) => item(`${String(at)}${'z'.repeat(1999)}`)
    const kept = boundedHumanContext([1, 2, 3, 4, 5, 6].map(biggest))
    expect(kept.join('').length).toBeLessThanOrEqual(HUMAN_CONTEXT_LIMITS.totalCharacters)
    expect(kept.map((text) => text.slice('The user answered: '.length, -1999))).toEqual([
      '2',
      '3',
      '4',
      '5',
      '6',
    ])
  })
})

describe('Who judges is said, and never "Auto" when nobody judges', () => {
  test('Jev when it is ready, "Hemera asks" otherwise', () => {
    expect(whoJudges(true)).toBe('Jev')
    expect(whoJudges(false)).toBe('Hemera asks')
    expect(whoJudges(false)).not.toMatch(/auto/i)
  })
})
