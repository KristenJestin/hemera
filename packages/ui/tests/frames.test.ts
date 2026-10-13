/**
 * The command that records image sequences of a story: what it is asked, and what it opens.
 */

import { describe, expect, test } from 'vite-plus/test'

import { changeAt, framesAt, sequenceOf, storyUrl, valueOf } from '../frames.ts'

describe('An image sequence of a story', () => {
  test('the story, the folder and the changes are read off the command line', () => {
    const sequence = sequenceOf([
      '--story',
      'components-livechip--running',
      '--set',
      'state=finished',
      '--set',
      'endedAt=now',
      '--out',
      'frames',
      '--theme',
      'dark',
    ])
    expect(sequence.story).toBe('components-livechip--running')
    expect([...sequence.set]).toEqual([
      ['state', 'finished'],
      ['endedAt', 'now'],
    ])
    expect(sequence.frames).toBe(12)
    expect(sequence.every).toBe(40)
    expect(storyUrl(sequence)).toBe(
      'http://localhost:6006/iframe.html?id=components-livechip--running&viewMode=story&globals=theme:dark',
    )
  })

  test('a sequence without a story or a folder is refused, saying which', () => {
    expect(() => sequenceOf(['--out', 'frames'])).toThrow('--story')
    expect(() => sequenceOf(['--story', 'components-button--primary'])).toThrow('--out')
    expect(() => sequenceOf(['--story', 'x', '--out', 'y', '--set', 'state'])).toThrow('name=value')
  })

  test('a value is the moment of the change, null, a number or the word itself', () => {
    expect(valueOf('now', 1234)).toBe(1234)
    expect(valueOf('null', 1234)).toBeNull()
    expect(valueOf('84000', 1234)).toBe(84_000)
    expect(valueOf('finished', 1234)).toBe('finished')
  })

  test('an argument written as JSON is given as what it holds: a row added to a list', () => {
    expect(valueOf('[{"id":"lint","name":"lint"}]', 1234)).toEqual([{ id: 'lint', name: 'lint' }])
    expect(valueOf('{"kind":"idle"}', 1234)).toEqual({ kind: 'idle' })
  })

  test('a movement shorter than a screenshot is read on the frames the page painted, every few milliseconds', () => {
    // A screenshot takes longer than a fold lasts: the frames are those the page painted on its
    // own while the change played, each the last one painted at its moment.
    const painted = [
      { at: 990, frame: 'before' },
      { at: 1016, frame: 'a' },
      { at: 1033, frame: 'b' },
      { at: 1050, frame: 'c' },
      { at: 1066, frame: 'd' },
      { at: 1150, frame: 'end' },
    ]
    expect(framesAt(painted, 1000, 5, 20).map((one) => one.frame)).toEqual([
      'before',
      'a',
      'b',
      'c',
      'd',
    ])
    expect(framesAt(painted, 1000, 3, 100).map((one) => one.frame)).toEqual(['before', 'd', 'end'])
  })

  test('a moment before the first frame painted is shown by that first frame', () => {
    expect(framesAt([{ at: 1010, frame: 'first' }], 1000, 2, 5).map((one) => one.frame)).toEqual([
      'first',
      'first',
    ])
  })

  test('a change the catalogue paints late starts its sequence where it is first painted', () => {
    // An idle page paints nothing: the first frame painted after the change is asked is the
    // change itself, however long the catalogue took to render it.
    const painted = [{ at: 400 }, { at: 1640 }, { at: 1656 }]
    expect(changeAt(painted, 1000)).toBe(1639)
    expect(changeAt(painted, 2000)).toBeUndefined()
  })
})
