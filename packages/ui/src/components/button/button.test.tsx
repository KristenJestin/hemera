import { describe, expect, test } from 'bun:test'

import { TEST_RENDERER_PAINTS } from '../../../test-setup.ts'

import { Button } from './button.tsx'
import { dark } from '../../theme/dark.ts'
import { focus, mountedCatalogue, nodeOf } from '../../../test-harness.tsx'

describe.skipIf(!TEST_RENDERER_PAINTS)('Button — comportement au clavier', () => {
  test('Enter and Space each activate the button once', () => {
    let pressed = 0
    const root = mountedCatalogue(
      <Button testId="button" label="Create" onPress={() => (pressed += 1)} />,
    )
    try {
      const button = nodeOf(root, 'button').id
      root.renderer.nativeSimulateKeystrokes(button, 'enter')
      expect(pressed).toBe(1)
      root.renderer.nativeSimulateKeystrokes(button, 'space')
      expect(pressed).toBe(2)
    } finally {
      root.unmount()
    }
  })

  test('the focus ring is painted while the button holds the focus', async () => {
    const root = mountedCatalogue(<Button testId="button" label="Create" onPress={() => {}} />)
    try {
      const resting = nodeOf(root, 'button').style?.borderColor
      const focused = await focus(root, 'button')
      expect(root.renderer.getFocusedElementId()).toBe(focused.id)
      expect(focused.style?.borderColor).not.toBe(resting)
      expect(focused.style?.borderColor).toBe(dark.colors.primaryRing)
    } finally {
      root.unmount()
    }
  })

  test('a disabled button ignores activation and freezes its style', () => {
    let pressed = 0
    const root = mountedCatalogue(
      <Button testId="button" label="Create" disabled onPress={() => (pressed += 1)} />,
    )
    try {
      const button = nodeOf(root, 'button')
      expect(button.style?.hover).toBeUndefined()
      expect(button.style?.active).toBeUndefined()
      root.renderer.nativeSimulateKeystrokes(button.id, 'enter')
      root.renderer.nativeSimulateKeystrokes(button.id, 'space')
      expect(pressed).toBe(0)
    } finally {
      root.unmount()
    }
  })

  test('a loading button refuses activation until the action lands', () => {
    let pressed = 0
    const root = mountedCatalogue(
      <Button testId="button" label="Saving" loading onPress={() => (pressed += 1)} />,
    )
    try {
      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'button').id, 'enter')
      expect(pressed).toBe(0)
    } finally {
      root.unmount()
    }
  })

  test('focus traversal skips a disabled button', () => {
    const root = mountedCatalogue(
      <>
        <Button testId="first" label="First" onPress={() => {}} />
        <Button testId="skipped" label="Skipped" disabled onPress={() => {}} />
        <Button testId="last" label="Last" onPress={() => {}} />
      </>,
    )
    try {
      root.renderer.focusElement(nodeOf(root, 'first').id)
      root.renderer.focusNext()
      expect(root.renderer.getFocusedElementId()).toBe(nodeOf(root, 'last').id)
    } finally {
      root.unmount()
    }
  })
})
