/**
 * The moments the sessions keep (#306): a turn's end and the delivery sent right after it are
 * compared, so two of them taken in a row never tie, even within one millisecond.
 */

import { describe, expect, test } from 'vite-plus/test'

import { instant } from '../src/engine/sessions/instants.ts'

describe('The moments the sessions keep', () => {
  test('moments taken in a row, even within one millisecond, are each later than the last', () => {
    const taken = Array.from({ length: 50 }, () => instant())
    for (const [at, one] of taken.entries()) {
      if (at > 0) expect(one > (taken[at - 1] ?? '')).toBe(true)
    }
  })
})
