/**
 * What a box a message is written in decides before anything is drawn: what a keystroke meant,
 * and how tall the box stands for what is in it.
 *
 * Both are pure, and both are here rather than in a story, because a story proves what a
 * browser does with the answer and this proves the answer. The scenarios of the Spec · sessions
 * the stories play — « Message enregistré », « Brouillon non envoyé » — rest on these two.
 */

import { describe, expect, test } from 'vite-plus/test'

import { answerTo } from '../src/composer/keystroke.ts'
import { PROMPT_MAX_LINES, PROMPT_MIN_LINES, promptRows } from '../src/composer/lines.ts'

/** A keystroke with nothing unusual about it, which each test then says one thing about. */
function stroke(
  key: string,
  said: Partial<{ shiftKey: boolean; isComposing: boolean; keyCode: number }> = {},
) {
  return {
    key,
    shiftKey: said.shiftKey ?? false,
    isComposing: said.isComposing ?? false,
    keyCode: said.keyCode ?? 13,
  }
}

describe('Message enregistré', () => {
  test('Enter alone sends what is written', () => {
    expect(answerTo(stroke('Enter'))).toBe('send')
  })

  test('Shift+Enter breaks the line instead', () => {
    expect(answerTo(stroke('Enter', { shiftKey: true }))).toBe('newline')
  })

  test.each(['a', 'Escape', 'ArrowUp', 'Tab'])('%s is left to the box', (key) => {
    expect(answerTo(stroke(key))).toBe('through')
  })
})

describe('Brouillon non envoyé', () => {
  test('the Enter that accepts a candidate from an input method sends nothing', () => {
    expect(answerTo(stroke('Enter', { isComposing: true }))).toBe('through')
  })

  test('nor does the Enter a browser reports as 229, which said the same before isComposing', () => {
    expect(answerTo(stroke('Enter', { keyCode: 229 }))).toBe('through')
  })

  test('Shift+Enter while composing is still not a send', () => {
    expect(answerTo(stroke('Enter', { shiftKey: true, isComposing: true }))).toBe('through')
  })
})

describe('Composer de la Session', () => {
  test('an empty box stands at two lines', () => {
    expect(promptRows('')).toBe(PROMPT_MIN_LINES)
  })

  test('one line still stands at two: a box of one line reads as a search field', () => {
    expect(promptRows('Export the invoices')).toBe(PROMPT_MIN_LINES)
  })

  test('it follows the lines that were typed', () => {
    expect(promptRows('one\ntwo\nthree\nfour')).toBe(4)
  })

  test('and stops at eight, however much is written', () => {
    expect(promptRows('line\n'.repeat(40))).toBe(PROMPT_MAX_LINES)
  })
})
