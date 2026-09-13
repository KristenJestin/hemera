import { describe, expect, test } from 'bun:test'

import { EmptyState } from './empty-state.tsx'
import { dark } from '../../theme/dark.ts'
import { focus, mountedCatalogue, nodeOf, textsOf } from '../../../test-harness.tsx'

describe('EmptyState — comportement au clavier', () => {
  test('a state without a way out carries nothing focusable', () => {
    const root = mountedCatalogue(
      <EmptyState
        testId="empty"
        iconName="inbox"
        title="No session yet"
        description="Create a session to start."
      />,
    )
    try {
      expect(() => nodeOf(root, 'empty-action')).toThrow()
      expect(textsOf(nodeOf(root, 'empty'))).toEqual([
        'No session yet',
        'Create a session to start.',
      ])
    } finally {
      root.unmount()
    }
  })

  test('the way out is activated by Enter and Space once each', () => {
    let acted = 0
    const root = mountedCatalogue(
      <EmptyState
        testId="empty"
        iconName="inbox"
        title="No session yet"
        description="Create a session to start."
        actionLabel="New session"
        onAction={() => (acted += 1)}
      />,
    )
    try {
      const action = nodeOf(root, 'empty-action').id
      root.renderer.nativeSimulateKeystrokes(action, 'enter')
      expect(acted).toBe(1)
      root.renderer.nativeSimulateKeystrokes(action, 'space')
      expect(acted).toBe(2)
    } finally {
      root.unmount()
    }
  })

  test('the focus ring is painted while the way out holds the focus', async () => {
    const root = mountedCatalogue(
      <EmptyState
        testId="empty"
        iconName="inbox"
        title="No session yet"
        description="Create a session to start."
        actionLabel="New session"
        onAction={() => {}}
      />,
    )
    try {
      expect((await focus(root, 'empty-action')).style?.borderColor).toBe(dark.colors.primaryRing)
    } finally {
      root.unmount()
    }
  })
})
