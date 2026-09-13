import { describe, expect, test } from 'bun:test'

import { Separator } from './separator.tsx'
import { dark } from '../../theme/dark.ts'
import { mountedCatalogue, nodeOf } from '../../../test-harness.tsx'

describe('Separator — comportement au clavier', () => {
  test('a separator carries no action and stays out of the focus traversal', () => {
    const root = mountedCatalogue(<Separator testId="rule" />)
    try {
      const rule = nodeOf(root, 'rule')
      expect(rule.children ?? []).toHaveLength(0)
      root.renderer.focusNext()
      expect(root.renderer.getFocusedElementId()).not.toBe(rule.id)
    } finally {
      root.unmount()
    }
  })

  test('each orientation draws its rule in the line role', () => {
    const root = mountedCatalogue(
      <>
        <Separator testId="horizontal" />
        <Separator testId="vertical" orientation="vertical" />
      </>,
    )
    try {
      expect(nodeOf(root, 'horizontal').style?.height).toBe(1)
      expect(nodeOf(root, 'horizontal').style?.backgroundColor).toBe(dark.colors.line)
      expect(nodeOf(root, 'vertical').style?.width).toBe(1)
    } finally {
      root.unmount()
    }
  })
})
