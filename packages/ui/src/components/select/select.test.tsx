import { describe, expect, test } from 'bun:test'

import { TEST_RENDERER_PAINTS } from '../../../test-setup.ts'

import { Select } from './select.tsx'
import { dark } from '#theme/dark.ts'
import { focus, mountedCatalogue, nodeOf, textsOf } from '../../../test-harness.tsx'

const OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const

describe.skipIf(!TEST_RENDERER_PAINTS)('Select — comportement au clavier', () => {
  test('Enter opens the menu and the options are painted', () => {
    const root = mountedCatalogue(
      <Select
        testId="theme"
        label="Theme"
        value="dark"
        options={OPTIONS}
        onValueChange={() => {}}
      />,
    )
    try {
      expect(() => nodeOf(root, 'theme-menu')).toThrow()
      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'theme').id, 'enter')
      root.renderer.flush()
      expect(textsOf(nodeOf(root, 'theme-menu'))).toEqual(['Light', 'Dark'])
    } finally {
      root.unmount()
    }
  })

  test('choosing an option reports it and closes the menu', () => {
    let chosen = ''
    const root = mountedCatalogue(
      <Select
        testId="theme"
        label="Theme"
        value="dark"
        options={OPTIONS}
        onValueChange={(value) => (chosen = value)}
      />,
    )
    try {
      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'theme').id, 'enter')
      root.renderer.flush()
      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'theme-option-light').id, 'enter')
      root.renderer.flush()
      expect(chosen).toBe('light')
      expect(() => nodeOf(root, 'theme-menu')).toThrow()
    } finally {
      root.unmount()
    }
  })

  test('Escape closes the menu and gives the focus back to the trigger', async () => {
    const root = mountedCatalogue(
      <Select
        testId="theme"
        label="Theme"
        value="dark"
        options={OPTIONS}
        onValueChange={() => {}}
      />,
    )
    try {
      const trigger = await focus(root, 'theme')
      root.renderer.nativeSimulateKeystrokes(trigger.id, 'enter')
      root.renderer.flush()
      expect(() => nodeOf(root, 'theme-menu')).not.toThrow()

      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'theme-option-light').id, 'escape')
      root.renderer.flush()
      expect(() => nodeOf(root, 'theme-menu')).toThrow()
      // The window stays answerable to the keyboard because the focus came back.
      expect(root.renderer.getFocusedElementId()).toBe(nodeOf(root, 'theme').id)
    } finally {
      root.unmount()
    }
  })

  test('the focus ring is painted while the trigger holds the focus', async () => {
    const root = mountedCatalogue(
      <Select
        testId="theme"
        label="Theme"
        value="dark"
        options={OPTIONS}
        onValueChange={() => {}}
      />,
    )
    try {
      expect((await focus(root, 'theme')).style?.borderColor).toBe(dark.colors.primaryRing)
    } finally {
      root.unmount()
    }
  })

  test('a disabled select never opens', () => {
    const root = mountedCatalogue(
      <Select
        testId="theme"
        label="Theme"
        value="dark"
        options={OPTIONS}
        disabled
        onValueChange={() => {}}
      />,
    )
    try {
      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'theme').id, 'enter')
      root.renderer.flush()
      expect(() => nodeOf(root, 'theme-menu')).toThrow()
    } finally {
      root.unmount()
    }
  })
})
