/**
 * The attempts of a Building and their verdict (#142): a red check makes the attempt red, else a
 * green one green, else not verified; the third red on a task stops it; a red check's output is
 * handed cut to its last 40 lines and 4 KB, saying what was cut.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  REDS_BEFORE_A_NEED,
  attemptResult,
  outputTail,
  placeWords,
  stateAfterAttempt,
} from '../src/domain/index.ts'

describe('The verdict of an attempt', () => {
  test('any red makes it red, else any green green, else not verified', () => {
    expect(attemptResult(['green', 'red', 'skipped'])).toBe('red')
    expect(attemptResult(['green', 'skipped'])).toBe('green')
    expect(attemptResult(['skipped'])).toBe('not_verified')
    expect(attemptResult([])).toBe('not_verified')
  })

  test('a green or not verified task is done; a red one goes back in progress until the third red blocks it', () => {
    expect(stateAfterAttempt('green', 0)).toBe('done')
    expect(stateAfterAttempt('not_verified', 0)).toBe('done')
    expect(stateAfterAttempt('red', 1)).toBe('in_progress')
    expect(stateAfterAttempt('red', 2)).toBe('in_progress')
    expect(stateAfterAttempt('red', REDS_BEFORE_A_NEED)).toBe('blocked')
  })

  test('the Workspace root is said in words', () => {
    expect(placeWords('')).toBe('the Workspace root')
    expect(placeWords('web')).toBe('web')
  })
})

describe('The end of a red check’s output', () => {
  test('a short output is handed whole', () => {
    expect(outputTail('one\ntwo\n')).toEqual({ tail: 'one\ntwo', cut: null })
  })

  test('only the last 40 lines are handed, saying how many were cut', () => {
    const output = Array.from({ length: 50 }, (_, at) => `line ${String(at + 1)}`).join('\n')
    const { tail, cut } = outputTail(output)
    expect(tail.split('\n')).toHaveLength(40)
    expect(tail.split('\n')[0]).toBe('line 11')
    expect(cut).toBe('the first 10 line(s) are cut: only the last 40 line(s) are shown')
  })

  test('at most 4 KB of whole lines are handed', () => {
    const output = Array.from({ length: 30 }, () => 'x'.repeat(200)).join('\n')
    const { tail, cut } = outputTail(output)
    expect(new TextEncoder().encode(tail).length).toBeLessThanOrEqual(4096)
    expect(tail.split('\n').every((line) => line.length === 200)).toBe(true)
    expect(cut).toMatch(/only the last \d+ line\(s\), at most 4 KB, are shown/)
  })
})
