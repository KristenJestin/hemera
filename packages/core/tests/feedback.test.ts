/**
 * The rules of Review's feedback (#341): the life of a round, which feedback waits for a Fix, what
 * a feedback is refused for, the hold on the agents' writes while the user reviews, and the pixel
 * size of an image read from its first bytes.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  type FeedbackStanding,
  REVIEW_HOLD,
  feedbackRefusal,
  imagePixels,
  rangeRefusal,
  reviewToolRefusal,
  roundMoveRefusal,
  waitsForFix,
} from '../src/domain/index.ts'

const standing = (fields: Partial<FeedbackStanding> = {}): FeedbackStanding => ({
  kind: 'remark',
  state: 'waiting',
  ...fields,
})

describe('Feedback waits for a Fix', () => {
  test('a waiting remark waits', () => {
    expect(waitsForFix([standing()])).toBe(true)
  })
  test('a waiting code comment waits', () => {
    expect(waitsForFix([standing({ kind: 'code' })])).toBe(true)
  })
  test('a question never waits', () => {
    expect(waitsForFix([standing({ kind: 'question' })])).toBe(false)
  })
  test('a withdrawn remark does not wait', () => {
    expect(waitsForFix([standing({ state: 'withdrawn' })])).toBe(false)
  })
  test('an empty round does not wait', () => {
    expect(waitsForFix([])).toBe(false)
  })
  test('a remark Fix took, addressed or resolved no longer waits', () => {
    for (const state of ['in_round', 'addressed', 'resolved'] as const) {
      expect(waitsForFix([standing({ state })])).toBe(false)
    }
  })
})

describe('A round only moves forward', () => {
  test('collecting → grilling → building → answered → closed are each allowed', () => {
    expect(roundMoveRefusal(1, 'collecting', 'grilling')).toBeNull()
    expect(roundMoveRefusal(1, 'grilling', 'building')).toBeNull()
    expect(roundMoveRefusal(1, 'building', 'answered')).toBeNull()
    expect(roundMoveRefusal(1, 'answered', 'closed')).toBeNull()
  })
  test('a closed round cannot become grilling, and says why', () => {
    expect(roundMoveRefusal(2, 'closed', 'grilling')).toBe(
      'round 2 is closed: it cannot become grilling',
    )
  })
  test('a round never moves to the state it is in', () => {
    expect(roundMoveRefusal(1, 'building', 'building')).toBe(
      'round 1 is building: it cannot become building',
    )
  })
})

describe('A feedback is refused', () => {
  test('with an empty body', () => {
    expect(feedbackRefusal({ stage: 'review', round: 0 }, '  \n ')).toBe(
      'a feedback is never empty: write what you found',
    )
  })
  test('outside Review and Building · round N', () => {
    expect(feedbackRefusal({ stage: 'building', round: 0 }, 'Too slow.')).toBe(
      'feedback is written in Review: the mission is in building',
    )
    expect(feedbackRefusal({ stage: 'shipping', round: 1 }, 'Too slow.')).toBe(
      'feedback is written in Review: the mission is in shipping',
    )
  })
  test('in Review and in Building · round N it is taken', () => {
    expect(feedbackRefusal({ stage: 'review', round: 0 }, 'Too slow.')).toBeNull()
    expect(feedbackRefusal({ stage: 'building', round: 2 }, 'Too slow.')).toBeNull()
  })
})

describe('A range of lines is refused when it is not one', () => {
  test('start below 1, end before start, beyond the file', () => {
    expect(rangeRefusal({ start: 0, end: 2 }, 10)).toBe('line 0 is not a line: lines start at 1')
    expect(rangeRefusal({ start: 5, end: 3 }, 10)).toBe('lines 5–3 are not a range')
    expect(rangeRefusal({ start: 9, end: 11 }, 10)).toBe(
      'lines 9–11 go beyond the file, which has 10 lines',
    )
    expect(rangeRefusal({ start: 10, end: 12 }, 12)).toBeNull()
  })
})

describe('During Review the agents do not write', () => {
  test('fs_write, fs_edit and commands_run are refused in Review, with the reason', () => {
    for (const tool of ['fs_write', 'fs_edit', 'commands_run'] as const) {
      expect(reviewToolRefusal('review', tool)).toBe(`refused: ${REVIEW_HOLD}`)
    }
    expect(REVIEW_HOLD).toBe(
      'The mission is in Review: the user is reviewing the Workspace, and nothing is written or run in it until a round starts.',
    )
  })
  test('reading, listing and searching go on in Review', () => {
    for (const tool of ['fs_read', 'fs_list', 'search', 'commands_list'] as const) {
      expect(reviewToolRefusal('review', tool)).toBeNull()
    }
  })
  test('in Building · round N nothing is held', () => {
    expect(reviewToolRefusal('building', 'fs_write')).toBeNull()
  })
})

describe('An image says its pixel size', () => {
  test('a PNG reads its width and height from IHDR', () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000280000001e00806000000', 'hex')
    expect(imagePixels(png)).toEqual({ width: 640, height: 480 })
  })
  test('a JPEG reads them from its first frame', () => {
    const jpeg = Buffer.from('ffd8ffe000044a46ffc0001108007800a003012200021101031101', 'hex')
    expect(imagePixels(jpeg)).toEqual({ width: 160, height: 120 })
  })
  test('a lossless WebP reads them from VP8L', () => {
    // 100 × 50: (width - 1) and (height - 1) on 14 bits each.
    const bits = 99 | (49 << 14)
    const header = Buffer.from('524946460000000057454250', 'hex')
    const chunk = Buffer.concat([
      Buffer.from('VP8L', 'ascii'),
      Buffer.from([5, 0, 0, 0, 0x2f]),
      Buffer.from([bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff]),
    ])
    expect(imagePixels(Buffer.concat([header, chunk]))).toEqual({ width: 100, height: 50 })
  })
  test('bytes that say no size give null', () => {
    expect(imagePixels(Buffer.from('not an image'))).toBeNull()
  })
})
