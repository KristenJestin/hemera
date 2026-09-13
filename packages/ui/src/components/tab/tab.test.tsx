import { describe, expect, test } from 'bun:test'

import { Tab } from './tab.tsx'
import { dark } from '../../theme/dark.ts'
import { focus, mountedCatalogue, nodeOf, textsOf } from '../../../test-harness.tsx'

describe('Tab — comportement au clavier', () => {
  test('Enter and Space select the tab once', () => {
    let selected = 0
    const root = mountedCatalogue(
      <Tab testId="tab" label="Hemera" dotColor="primary" onSelect={() => (selected += 1)} />,
    )
    try {
      const tab = nodeOf(root, 'tab').id
      root.renderer.nativeSimulateKeystrokes(tab, 'enter')
      expect(selected).toBe(1)
      root.renderer.nativeSimulateKeystrokes(tab, 'space')
      expect(selected).toBe(2)
    } finally {
      root.unmount()
    }
  })

  test('the active tab is not reselected', () => {
    let selected = 0
    const root = mountedCatalogue(
      <Tab
        testId="tab"
        label="Hemera"
        dotColor="primary"
        active
        onSelect={() => (selected += 1)}
      />,
    )
    try {
      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'tab').id, 'enter')
      expect(selected).toBe(0)
    } finally {
      root.unmount()
    }
  })

  test('the active tab reads apart from a resting one', () => {
    const root = mountedCatalogue(
      <>
        <Tab testId="active" label="Hemera" dotColor="primary" active onSelect={() => {}} />
        <Tab testId="resting" label="Atlas" dotColor="ok" onSelect={() => {}} />
      </>,
    )
    try {
      expect(nodeOf(root, 'active').style?.backgroundColor).toBe(dark.colors.surface)
      expect(nodeOf(root, 'resting').style?.backgroundColor).toBe(dark.colors.bg)
    } finally {
      root.unmount()
    }
  })

  test('the counter is painted beside the label', () => {
    const root = mountedCatalogue(
      <Tab testId="tab" label="Hemera" dotColor="primary" count={3} onSelect={() => {}} />,
    )
    try {
      expect(textsOf(nodeOf(root, 'tab'))).toEqual(['Hemera', '3'])
    } finally {
      root.unmount()
    }
  })

  test('the focus ring is painted while the tab holds the focus', async () => {
    const root = mountedCatalogue(
      <Tab testId="tab" label="Hemera" dotColor="primary" onSelect={() => {}} />,
    )
    try {
      expect((await focus(root, 'tab')).style?.borderColor).toBe(dark.colors.primaryRing)
    } finally {
      root.unmount()
    }
  })

  test('a disabled tab ignores activation and freezes its style', () => {
    let selected = 0
    const root = mountedCatalogue(
      <Tab
        testId="tab"
        label="Hemera"
        dotColor="primary"
        disabled
        onSelect={() => (selected += 1)}
      />,
    )
    try {
      const tab = nodeOf(root, 'tab')
      expect(tab.style?.hover).toBeUndefined()
      root.renderer.nativeSimulateKeystrokes(tab.id, 'enter')
      expect(selected).toBe(0)
    } finally {
      root.unmount()
    }
  })
})
