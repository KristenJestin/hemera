/**
 * The one way an agent's value becomes text: JSON as `JSON.stringify` writes it, with what nests
 * deeper than `NESTING_LIMIT` containers cut where it begins, and never an error.
 */

import { MASK, NESTING_LIMIT } from '@hemera/core/domain'
import { Predicate } from 'effect'
import type { Schema } from 'effect'
import * as fc from 'fast-check'
import { describe, expect, test } from 'vite-plus/test'

import { agentText } from '../src/engine/agents/text.ts'

/**
 * A value of `levels` containers, one in another, `bottom` in the innermost: built with no
 * recursion, and the same whatever its depth as far as it goes (the root is the first container).
 */
const nested = (
  levels: number,
  shape: 'lists' | 'records' | 'both',
  bottom: Schema.Json = 'bottom',
): Schema.Json => {
  let value: Schema.Json = bottom
  for (let level = levels - 1; level >= 0; level -= 1) {
    value = shape === 'lists' || (shape === 'both' && level % 2 === 0) ? [value] : { next: value }
  }
  return value
}

describe('An agent value is text as JSON.stringify writes it, within the limit', () => {
  test('any value that is JSON is written as JSON.stringify writes it', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        // SAFETY: `fc.jsonValue()` makes values of the JSON model; the schema type is the same set.
        const json = value as Schema.Json
        expect(agentText(json)).toBe(JSON.stringify(json))
      }),
    )
  })

  test('a replacer is applied as JSON.stringify applies it: to every value, the root under an empty key', () => {
    const replace = (key: string, held: Schema.Json): Schema.Json =>
      Predicate.isString(held) ? `${key}:${String(held.length)}` : held
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        // SAFETY: as above.
        const json = value as Schema.Json
        expect(agentText(json, replace)).toBe(
          JSON.stringify(json, (key, held) => replace(key, held)),
        )
      }),
    )
  })
})

describe('An agent value nested deeper than the limit is cut, never an error', () => {
  for (const shape of ['lists', 'records', 'both'] as const) {
    test(`the limit is exact: ${String(NESTING_LIMIT)} containers are kept whole, the next one is cut (${shape})`, () => {
      expect(agentText(nested(NESTING_LIMIT, shape))).toContain('bottom')
      const cut = agentText(nested(NESTING_LIMIT + 1, shape))
      expect(cut).not.toContain('bottom')
      expect(cut).toContain(JSON.stringify(MASK))
      expect(cut).toBe(JSON.stringify(nested(NESTING_LIMIT, shape, MASK)))
    })

    test(`a value 100,000 levels deep is text of JSON, cut at the limit (${shape})`, () => {
      const text = agentText(nested(100_000, shape))
      expect(text).toContain(JSON.stringify(MASK))
      expect(text).not.toContain('bottom')
      expect(() => JSON.parse(text)).not.toThrow()
    })
  }

  test('a value that cannot be read is the mark, whole', () => {
    const unreadable: Schema.Json = { fine: 1 }
    Object.defineProperty(unreadable, 'broken', {
      enumerable: true,
      get: () => {
        throw new Error('no')
      },
    })
    expect(agentText([1, unreadable])).toBe(JSON.stringify(MASK))
  })
})

describe('An agent value is turned into text in time in proportion to its size', () => {
  const timed = (run: () => void): number => {
    let fastest = Number.POSITIVE_INFINITY
    for (let round = 0; round < 7; round += 1) {
      const start = performance.now()
      run()
      fastest = Math.min(fastest, performance.now() - start)
    }
    return fastest
  }
  const growth = (make: (size: number) => Schema.Json, size: number): number =>
    timed(() => agentText(make(16 * size))) / timed(() => agentText(make(size)))

  test('16 times as many items in a list takes less than 64 times as long', () => {
    expect(growth((size) => Array.from({ length: size }, () => 'an item'), 2_000)).toBeLessThan(64)
  })

  test('16 times as many fields in a record takes less than 64 times as long', () => {
    expect(
      growth(
        (size) =>
          Object.fromEntries(Array.from({ length: size }, (_, at) => [`field${String(at)}`, at])),
        2_000,
      ),
    ).toBeLessThan(64)
  })

  test('16 times as many levels, past the limit, takes less than 64 times as long', () => {
    expect(growth((size) => nested(size, 'both'), 2_000)).toBeLessThan(64)
  })
})
