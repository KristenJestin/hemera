import { describe, expect, test } from 'bun:test'

import { TEST_RENDERER_PAINTS } from '../../../test-setup.ts'

import { Card } from './card.tsx'
import { Text } from '#primitives/text.tsx'
import { dark } from '#theme/dark.ts'
import { focus, mountedCatalogue, nodeOf, textsOf } from '../../../test-harness.tsx'

describe.skipIf(!TEST_RENDERER_PAINTS)('Card — comportement au clavier', () => {
  test('a card without an action carries nothing focusable', () => {
    const root = mountedCatalogue(
      <Card testId="card" title="Sessions">
        <Text color="muted">Body</Text>
      </Card>,
    )
    try {
      expect(() => nodeOf(root, 'card-action')).toThrow()
      expect(textsOf(nodeOf(root, 'card'))).toEqual(['Sessions', 'Body'])
    } finally {
      root.unmount()
    }
  })

  test('the header action is activated by Enter and Space once each', () => {
    let acted = 0
    const root = mountedCatalogue(
      <Card testId="card" title="Sessions" actionLabel="See all" onAction={() => (acted += 1)}>
        <Text color="muted">Body</Text>
      </Card>,
    )
    try {
      const action = nodeOf(root, 'card-action').id
      root.renderer.nativeSimulateKeystrokes(action, 'enter')
      expect(acted).toBe(1)
      root.renderer.nativeSimulateKeystrokes(action, 'space')
      expect(acted).toBe(2)
    } finally {
      root.unmount()
    }
  })

  test('the header counter is painted beside the title', () => {
    const root = mountedCatalogue(
      <Card testId="card" title="Sessions" count={3}>
        <Text color="muted">Body</Text>
      </Card>,
    )
    try {
      expect(textsOf(nodeOf(root, 'card'))).toEqual(['Sessions', '3', 'Body'])
    } finally {
      root.unmount()
    }
  })

  test('the focus ring is painted while the action holds the focus', async () => {
    const root = mountedCatalogue(
      <Card testId="card" title="Sessions" actionLabel="See all" onAction={() => {}}>
        <Text color="muted">Body</Text>
      </Card>,
    )
    try {
      expect((await focus(root, 'card-action')).style?.borderColor).toBe(dark.colors.primaryRing)
    } finally {
      root.unmount()
    }
  })
})
