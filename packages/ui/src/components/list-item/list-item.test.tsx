import { describe, expect, test } from 'bun:test'

import { ListItem } from './list-item.tsx'
import { dark } from '../../theme/dark.ts'
import { focus, mountedCatalogue, nodeOf } from '../../../test-harness.tsx'

describe('ListItem — comportement au clavier', () => {
  test('Enter and Space select the row once', () => {
    let selected = 0
    const root = mountedCatalogue(
      <ListItem testId="row" label="A row" onSelect={() => (selected += 1)} />,
    )
    try {
      const row = nodeOf(root, 'row').id
      root.renderer.nativeSimulateKeystrokes(row, 'enter')
      expect(selected).toBe(1)
      root.renderer.nativeSimulateKeystrokes(row, 'space')
      expect(selected).toBe(2)
    } finally {
      root.unmount()
    }
  })

  test('the selected row is not reselected and reads apart', () => {
    let selected = 0
    const root = mountedCatalogue(
      <ListItem testId="row" label="A row" selected onSelect={() => (selected += 1)} />,
    )
    try {
      const row = nodeOf(root, 'row')
      expect(row.style?.backgroundColor).toBe(dark.colors.surface)
      root.renderer.nativeSimulateKeystrokes(row.id, 'enter')
      expect(selected).toBe(0)
    } finally {
      root.unmount()
    }
  })

  test('the focus ring is painted while the row holds the focus', async () => {
    const root = mountedCatalogue(<ListItem testId="row" label="A row" onSelect={() => {}} />)
    try {
      expect((await focus(root, 'row')).style?.borderColor).toBe(dark.colors.primaryRing)
    } finally {
      root.unmount()
    }
  })

  test('a disabled row ignores activation and leaves the traversal', () => {
    let selected = 0
    const root = mountedCatalogue(
      <>
        <ListItem testId="first" label="First" onSelect={() => {}} />
        <ListItem testId="skipped" label="Skipped" disabled onSelect={() => (selected += 1)} />
        <ListItem testId="last" label="Last" onSelect={() => {}} />
      </>,
    )
    try {
      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'skipped').id, 'enter')
      expect(selected).toBe(0)
      root.renderer.focusElement(nodeOf(root, 'first').id)
      root.renderer.focusNext()
      expect(root.renderer.getFocusedElementId()).toBe(nodeOf(root, 'last').id)
    } finally {
      root.unmount()
    }
  })
})
