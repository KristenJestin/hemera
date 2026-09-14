import { describe, expect, test } from 'bun:test'

import { TEST_RENDERER_PAINTS } from '../../../test-setup.ts'

import { IconButton } from './icon-button.tsx'
import { dark } from '../../theme/dark.ts'
import { focus, mountedCatalogue, nodeOf } from '../../../test-harness.tsx'

describe.skipIf(!TEST_RENDERER_PAINTS)('IconButton — comportement au clavier', () => {
  test('Enter and Space each activate the control once', () => {
    let pressed = 0
    const root = mountedCatalogue(
      <IconButton testId="add" name="plus" label="New project" onPress={() => (pressed += 1)} />,
    )
    try {
      const add = nodeOf(root, 'add').id
      root.renderer.nativeSimulateKeystrokes(add, 'enter')
      expect(pressed).toBe(1)
      root.renderer.nativeSimulateKeystrokes(add, 'space')
      expect(pressed).toBe(2)
    } finally {
      root.unmount()
    }
  })

  test('the focus ring is painted while the control holds the focus', async () => {
    const root = mountedCatalogue(
      <IconButton testId="add" name="plus" label="New project" onPress={() => {}} />,
    )
    try {
      const focused = await focus(root, 'add')
      expect(focused.style?.borderColor).toBe(dark.colors.primaryRing)
    } finally {
      root.unmount()
    }
  })

  test('a disabled control ignores activation and freezes its style', () => {
    let pressed = 0
    const root = mountedCatalogue(
      <IconButton
        testId="add"
        name="plus"
        label="New project"
        disabled
        onPress={() => (pressed += 1)}
      />,
    )
    try {
      const add = nodeOf(root, 'add')
      expect(add.style?.hover).toBeUndefined()
      root.renderer.nativeSimulateKeystrokes(add.id, 'enter')
      expect(pressed).toBe(0)
    } finally {
      root.unmount()
    }
  })
})
