/**
 * Where the live edge of a thread is, and when the reader is still at it.
 *
 * The one decision the scroller makes, taken out of the scroll handler so it can be read here
 * rather than played in a browser. The story proves what the pill does with the answer; this
 * proves the answer, at the threshold and on either side of it.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  LIVE_EDGE_THRESHOLD,
  atLiveEdge,
  distanceToLiveEdge,
} from '../src/message/scroller/live-edge.ts'

/** A thread twice as tall as the window it is read in, scrolled wherever the test says. */
function scrolled(scrollTop: number) {
  return { scrollTop, scrollHeight: 2000, clientHeight: 1000 }
}

describe('Fil qui suit le bord vif', () => {
  test('at the bottom, the reader is at the live edge', () => {
    expect(atLiveEdge(scrolled(1000))).toBe(true)
  })

  test('a few pixels short of it, they still are: an edge is not a point', () => {
    expect(atLiveEdge(scrolled(1000 - LIVE_EDGE_THRESHOLD))).toBe(true)
  })

  test('one pixel past the threshold, the thread lets go', () => {
    expect(atLiveEdge(scrolled(1000 - LIVE_EDGE_THRESHOLD - 1))).toBe(false)
  })

  test('at the top of a long thread, it has plainly let go', () => {
    expect(atLiveEdge(scrolled(0))).toBe(false)
  })

  test('a thread shorter than its window is at its own edge', () => {
    expect(atLiveEdge({ scrollTop: 0, scrollHeight: 400, clientHeight: 1000 })).toBe(true)
  })
})

describe('Retour au dernier message', () => {
  test('how far the reader is from the last message is what the pill brings them back over', () => {
    expect(distanceToLiveEdge(scrolled(200))).toBe(800)
  })

  test('a browser rounding a fractional height never puts them past the end', () => {
    expect(distanceToLiveEdge({ scrollTop: 1000.5, scrollHeight: 2000, clientHeight: 1000 })).toBe(
      0,
    )
  })
})
