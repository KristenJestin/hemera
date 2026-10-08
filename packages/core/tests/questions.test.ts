/**
 * The Planner's questions (#86): a wave and what makes it valid, an answer and what makes it one,
 * a changed answer as the Planner reads it, and what an input is about.
 *
 * Rewritten from `hemera-legacy` (`packages/core/tests/spec.test.ts`, "Answers to a question")
 * against answer versions: an answer is checked against the options a question offers, and a
 * changed answer is a new version said as a change.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  type AskedQuestion,
  answerChangeSaid,
  answerTo,
  answerWords,
  inputAbout,
  optionIdAt,
  waveRefusal,
} from '../src/domain/index.ts'

const OPTIONS = [
  { id: 'A', label: 'Letter', detail: 'The default paper size.' },
  { id: 'B', label: 'A4', detail: 'The international size.' },
]

const asked = (overrides: Partial<AskedQuestion> = {}): AskedQuestion => ({
  text: 'Which paper size does the export use?',
  why: 'The printer settings depend on it.',
  options: OPTIONS.map(({ label, detail }) => ({ label, detail })),
  recommended: 1,
  recommendedReason: 'Most invoices of Acme are printed in A4.',
  ...overrides,
})

describe('Answers to a question', () => {
  test('an option offered or a text of the user’s own is an answer', () => {
    expect(answerTo(OPTIONS, { optionId: 'B' })).toEqual({ answer: { optionId: 'B', text: null } })
    expect(answerTo(OPTIONS, { text: ' Tabloid ' })).toEqual({
      answer: { optionId: null, text: 'Tabloid' },
    })
  })

  test('neither, both, or an option not offered is refused', () => {
    expect(answerTo(OPTIONS, {})).toEqual({
      refused: 'The answer is refused: it names neither an option nor a text.',
    })
    expect(answerTo(OPTIONS, { text: '  ' })).toEqual({
      refused: 'The answer is refused: it names neither an option nor a text.',
    })
    expect(answerTo(OPTIONS, { optionId: 'B', text: 'A4' })).toEqual({
      refused: 'The answer is refused: it names both an option and a text.',
    })
    expect(answerTo(OPTIONS, { optionId: 'C' })).toEqual({
      refused: 'The answer is refused: “C” is not an option of the question.',
    })
  })

  test('an answer reads as the label of its option, or as its text', () => {
    expect(answerWords(OPTIONS, { optionId: 'B', text: null })).toBe('B · A4')
    expect(answerWords(OPTIONS, { optionId: null, text: 'Tabloid' })).toBe('“Tabloid”')
  })

  test('a changed answer is said as a change: now, then was', () => {
    expect(
      answerChangeSaid(
        'Q3',
        2,
        OPTIONS,
        { optionId: 'B', text: null },
        { optionId: 'A', text: null },
      ),
    ).toBe('Q3: now B · A4, was A · Letter (version 2)')
    expect(answerChangeSaid('Q3', 1, OPTIONS, { optionId: 'A', text: null }, null)).toBe(
      'Q3: A · Letter (version 1)',
    )
  })
})

describe('A wave of questions', () => {
  test('options are lettered in order', () => {
    expect([0, 1, 2, 25].map(optionIdAt)).toEqual(['A', 'B', 'C', 'Z'])
  })

  test('a wave of valid questions is accepted', () => {
    expect(waveRefusal([asked(), asked({ text: 'Which columns?', recommended: 0 })])).toBeNull()
  })

  test('an empty wave, a question with one option, without a recommendation or its reason, is refused', () => {
    expect(waveRefusal([])).toBe('refused: a wave holds at least one question.')
    expect(waveRefusal([asked({ options: [{ label: 'A4', detail: '' }] })])).toBe(
      'refused: question 1 offers fewer than two options.',
    )
    expect(waveRefusal([asked(), asked({ recommended: 2 })])).toBe(
      'refused: question 2 recommends no option it offers (its options are 0 to 1).',
    )
    expect(waveRefusal([asked({ recommendedReason: '  ' })])).toBe(
      'refused: question 1 does not say why you recommend its option.',
    )
    expect(waveRefusal([asked({ text: ' ' })])).toBe('refused: question 1 has no text.')
  })
})

describe('What an input is about', () => {
  test('each kind says its item', () => {
    expect(inputAbout('answer', 'Q2', 1)).toBe('the answer to Q2, version 1')
    expect(inputAbout('waiting', 'Q5', null)).toBe('Q5 waiting on someone')
    expect(inputAbout('vision', 'v1', null)).toBe('the user’s vision')
    expect(inputAbout('discuss_decision', 'D1', 2)).toBe('the decision D1, version 2')
    expect(inputAbout('dismissed_finding', 'F3', null)).toBe('the dismissed finding F3')
    expect(inputAbout('triage_kept', 'triage', null)).toBe('the user keeping the mission')
  })
})
