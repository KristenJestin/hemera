/**
 * The base every Session is given (D6-07): a tool it names is one Hemera lends.
 */

import { describe, expect, test } from 'vite-plus/test'

import { CONTEXT_BASE, TOOL_NAMES } from '#index.ts'

describe('The base names only the tools Hemera lends', () => {
  test('so a renamed tool cannot leave the base pointing at nothing', () => {
    const named = [...CONTEXT_BASE.matchAll(/`([a-z_]+)`/g)].map((match) => match[1])

    expect(named).toEqual(['session_get'])
    for (const tool of named) expect(TOOL_NAMES).toContain(tool)
  })
})
