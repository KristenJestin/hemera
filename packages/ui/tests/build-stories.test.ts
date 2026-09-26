import { describe, expect, test } from 'vitest'

import {
  type BuildStoryView,
  type BuildTaskView,
  type BuildViewData,
  storyProgressOf,
  storyRowsOf,
} from '../src/build/model.ts'
import { BUILDING, T1_DONE } from '../src/build/build-fixtures.ts'

/**
 * The stories of a build as the panel draws them (issue #116), and where each stands (the review of
 * #122): a story no task realises is never done, one task realises one story in the drawing even
 * when it names several, and a state's precedence is the whole story's.
 */

/** A story of the build the view draws, whatever the Spec holds. */
function story(id: string, key: string): BuildStoryView {
  return { id, key, title: key, labels: [], state: 'open', attempts: [] }
}

/** A task of the build realising the given stories, in the given state. */
function task(id: string, state: BuildTaskView['state'], storyIds: string[]): BuildTaskView {
  return { ...T1_DONE, id, label: id, state, storyIds }
}

/** The build the panel reads, holding the given stories and tasks. */
function build(stories: BuildStoryView[], tasks: BuildTaskView[]): BuildViewData {
  return { ...BUILDING, stories, tasks }
}

describe('Where a story of the build stands', () => {
  test('a story no task realises is never done', () => {
    expect(storyProgressOf([])).toBe('todo')

    const rows = storyRowsOf(build([story('s1', 'S1')], []), [])
    expect(rows.map((row) => [row.key, row.progress, row.tasks.length])).toEqual([
      ['S1', 'todo', 0],
    ])
  })

  test('a blocked task wins over a done one, and one in progress over a done one', () => {
    expect(storyProgressOf([task('a', 'done', []), task('b', 'blocked', [])])).toBe('blocked')
    expect(storyProgressOf([task('a', 'done', []), task('b', 'yours', [])])).toBe('blocked')
    expect(storyProgressOf([task('a', 'done', []), task('b', 'in_progress', [])])).toBe(
      'in_progress',
    )
    expect(storyProgressOf([task('a', 'done', []), task('b', 'checking', [])])).toBe('in_progress')
    expect(storyProgressOf([task('a', 'done', []), task('b', 'skipped', [])])).toBe('done')
  })

  test('a task realising two stories is drawn under the first only, and counted in both', () => {
    const both = task('shared', 'in_progress', ['s1', 's2'])
    const first = task('first', 'done', ['s1'])
    const rows = storyRowsOf(build([story('s1', 'S1'), story('s2', 'S2')], [first, both]), [])

    expect(rows.map((row) => [row.key, row.tasks.map((one) => one.id)])).toEqual([
      ['S1', ['first', 'shared']],
      ['S2', []],
    ])
    expect(rows.map((row) => row.progress)).toEqual(['in_progress', 'in_progress'])
  })

  test('a story the Spec wrote is drawn with its words, one it does not with none', () => {
    const rows = storyRowsOf(build([story('s1', 'S1'), story('s2', 'S2')], []), [
      {
        id: 's1',
        key: 'S1',
        title: 'Export a month',
        narrative: 'A month leaves',
        criteria: ['one'],
      },
    ])

    expect(rows[0]!.narrative).toBe('A month leaves')
    expect(rows[0]!.criteria).toEqual(['one'])
    expect(rows[1]!.narrative).toBe('')
    expect(rows[1]!.criteria).toEqual([])
  })
})
