import { describe, expect, test } from 'bun:test'

import { TEST_RENDERER_PAINTS } from '../../../test-setup.ts'

import { Kbd } from './kbd.tsx'
import { useKbd } from './use-kbd.ts'
import { mountedCatalogue, nodeOf, textsOf } from '../../../test-harness.tsx'

describe.skipIf(!TEST_RENDERER_PAINTS)('Kbd — comportement au clavier', () => {
  test('a hint carries no action and stays out of the focus traversal', () => {
    const root = mountedCatalogue(<Kbd testId="hint" combination="enter" />)
    try {
      const hint = nodeOf(root, 'hint')
      root.renderer.focusNext()
      expect(root.renderer.getFocusedElementId()).not.toBe(hint.id)
    } finally {
      root.unmount()
    }
  })

  test('a combination is painted one key at a time', () => {
    const root = mountedCatalogue(<Kbd testId="hint" combination="shift+tab" />)
    try {
      expect(textsOf(nodeOf(root, 'hint'))).toEqual(['shift', 'tab'])
    } finally {
      root.unmount()
    }
  })

  test('the hook splits a combination and drops empty parts', () => {
    expect(useKbd({ combination: 'control+shift+p' }).keys).toEqual(['control', 'shift', 'p'])
    expect(useKbd({ combination: 'enter' }).keys).toEqual(['enter'])
    expect(useKbd({ combination: 'enter+' }).keys).toEqual(['enter'])
  })
})
