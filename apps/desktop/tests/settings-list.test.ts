/**
 * The lists of a Project's settings that the engine keeps in order and proposes defaults for (the
 * checks and the doc recipes, #152): read with their proposals, nothing kept before it is
 * accepted, a proposal accepted leaving the others in place, a reorder written as moves once it
 * settles.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  type ListOps,
  type ListState,
  acceptProposals,
  moveOf,
  movesOf,
  readList,
  writeOrder,
} from '../src/renderer/settings-list.ts'
import { providerStore } from '../src/renderer/ticket-providers-model.ts'

interface Kept {
  readonly id: string
  readonly name: string
}

/** An engine that keeps names in order, proposes `lint` and `build` while it keeps none. */
function engine(kept: Kept[] = []) {
  const asked: string[] = []
  let next = kept.length
  const ops: ListOps<Kept, string> = {
    list: async () => [...kept],
    propose: async () => (kept.length === 0 ? ['lint', 'build'] : []),
    accept: async (drafts) => {
      asked.push(`accept ${drafts.join(',')}`)
      for (const name of drafts) kept.push({ id: `k${String(next++)}`, name })
      return [...kept]
    },
    move: async (id, rank) => {
      asked.push(`move ${id} ${String(rank)}`)
      const at = kept.findIndex((one) => one.id === id)
      const [moved] = kept.splice(at, 1)
      if (moved !== undefined) kept.splice(rank, 0, moved)
      return [...kept]
    },
    unread: 'The checks could not be read',
  }
  return { ops, asked, kept }
}

const fresh = () =>
  providerStore<ListState<Kept, string>>({
    kept: null,
    proposals: [],
    order: null,
    error: undefined,
  })

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('The proposals of a list, accepted', () => {
  test('nothing is kept before it is accepted', async () => {
    const { ops, kept } = engine()
    const store = fresh()
    readList(ops, store)
    await settled()
    expect(store.get().kept).toEqual([])
    expect(store.get().proposals.map((one) => [one.id, one.draft])).toEqual([
      ['proposed-0', 'lint'],
      ['proposed-1', 'build'],
    ])
    expect(kept).toEqual([])
  })

  test('accept one: it is kept, and the other proposal stays where it was', async () => {
    const { ops, asked } = engine()
    const store = fresh()
    readList(ops, store)
    await settled()
    await acceptProposals(ops, store, ['proposed-1'])
    expect(asked).toEqual(['accept build'])
    expect(store.get().kept?.map((one) => one.name)).toEqual(['build'])
    expect(store.get().proposals.map((one) => one.id)).toEqual(['proposed-0'])
  })

  test('accept all: every proposal is kept at once', async () => {
    const { ops, asked } = engine()
    const store = fresh()
    readList(ops, store)
    await settled()
    await acceptProposals(ops, store, ['proposed-0', 'proposed-1'])
    expect(asked).toEqual(['accept lint,build'])
    expect(store.get().proposals).toEqual([])
  })

  test('a list that cannot be read says so in words', async () => {
    const { ops } = engine()
    const store = fresh()
    readList({ ...ops, list: () => Promise.reject(new Error('the disk is full')) }, store)
    await settled()
    expect(store.get().error).toBe('The checks could not be read: the disk is full')
  })
})

describe('A list reordered', () => {
  test('the order shown at once is written as moves, one after the other', async () => {
    const { ops, asked } = engine([
      { id: 'a', name: 'lint' },
      { id: 'b', name: 'typecheck' },
      { id: 'c', name: 'test' },
    ])
    const store = fresh()
    readList(ops, store)
    await settled()
    const written = writeOrder(ops, store, ['c', 'a', 'b'])
    expect(store.get().order).toEqual(['c', 'a', 'b'])
    await written
    expect(asked).toEqual(['move c 0'])
    expect(store.get().kept?.map((one) => one.id)).toEqual(['c', 'a', 'b'])
    expect(store.get().order).toBeNull()
  })

  test('two lines moved are two moves', () => {
    expect(movesOf(['a', 'b', 'c', 'd'], ['b', 'a', 'd', 'c'])).toEqual([
      { id: 'a', rank: 1 },
      { id: 'd', rank: 2 },
    ])
    expect(movesOf(['a', 'b'], ['a', 'b'])).toEqual([])
  })
})

describe('A reorder is one move', () => {
  test('a line moved down or up is found with the place it goes to', () => {
    expect(moveOf(['a', 'b', 'c', 'd'], ['b', 'c', 'a', 'd'])).toEqual({ id: 'a', rank: 2 })
    expect(moveOf(['a', 'b', 'c', 'd'], ['a', 'd', 'b', 'c'])).toEqual({ id: 'd', rank: 1 })
    expect(moveOf(['a', 'b'], ['a', 'b'])).toBeNull()
  })
})
