import { describe, expect, test } from 'bun:test'

import { NavItem } from './nav-item.tsx'
import { Badge } from '../badge/badge.tsx'
import { dark } from '../../theme/dark.ts'
import { focus, mountedCatalogue, nodeOf, textsOf } from '../../../test-harness.tsx'

describe('NavItem — comportement au clavier', () => {
  test('Enter and Space select the entry once', () => {
    let selected = 0
    const root = mountedCatalogue(
      <NavItem
        testId="entry"
        label="A session"
        iconName="message-square"
        onSelect={() => (selected += 1)}
      />,
    )
    try {
      const entry = nodeOf(root, 'entry').id
      root.renderer.nativeSimulateKeystrokes(entry, 'enter')
      expect(selected).toBe(1)
      root.renderer.nativeSimulateKeystrokes(entry, 'space')
      expect(selected).toBe(2)
    } finally {
      root.unmount()
    }
  })

  test('the selected entry reads apart and is not reselected', () => {
    let selected = 0
    const root = mountedCatalogue(
      <NavItem
        testId="entry"
        label="A session"
        iconName="message-square"
        selected
        onSelect={() => (selected += 1)}
      />,
    )
    try {
      const entry = nodeOf(root, 'entry')
      expect(entry.style?.backgroundColor).toBe(dark.colors.surface)
      root.renderer.nativeSimulateKeystrokes(entry.id, 'enter')
      expect(selected).toBe(0)
    } finally {
      root.unmount()
    }
  })

  test('the badge is painted after the label', () => {
    const root = mountedCatalogue(
      <NavItem
        testId="entry"
        label="A session"
        iconName="message-square"
        onSelect={() => {}}
        trailing={<Badge kind="count" count={4} />}
      />,
    )
    try {
      expect(textsOf(nodeOf(root, 'entry'))).toEqual(['A session', '4'])
    } finally {
      root.unmount()
    }
  })

  test('the focus ring is painted while the entry holds the focus', async () => {
    const root = mountedCatalogue(
      <NavItem testId="entry" label="A session" iconName="message-square" onSelect={() => {}} />,
    )
    try {
      expect((await focus(root, 'entry')).style?.borderColor).toBe(dark.colors.primaryRing)
    } finally {
      root.unmount()
    }
  })
})
