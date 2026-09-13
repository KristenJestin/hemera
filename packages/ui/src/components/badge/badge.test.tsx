import { describe, expect, test } from 'bun:test'

import { Badge } from './badge.tsx'
import { DEFAULT_COUNT_CAP, useBadge } from './use-badge.ts'
import { dark } from '../../theme/dark.ts'
import { mountedCatalogue, nodeOf, textsOf } from '../../../test-harness.tsx'

describe('Badge — comportement au clavier', () => {
  test('a badge carries no action and stays out of the focus traversal', () => {
    const root = mountedCatalogue(<Badge testId="count" kind="count" count={3} />)
    try {
      const badge = nodeOf(root, 'count')
      root.renderer.focusNext()
      expect(root.renderer.getFocusedElementId()).not.toBe(badge.id)
    } finally {
      root.unmount()
    }
  })

  test('each kind paints its own role pair', () => {
    const root = mountedCatalogue(
      <>
        <Badge testId="ok" kind="status" status="ok" label="Running" />
        <Badge testId="free" kind="tag" mission="free" label="free" />
      </>,
    )
    try {
      expect(nodeOf(root, 'ok').style?.backgroundColor).toBe(dark.colors.okSoft)
      expect(nodeOf(root, 'free').style?.backgroundColor).toBe(dark.colors.missionFreeSoft)
      expect(textsOf(nodeOf(root, 'ok'))).toEqual(['Running'])
    } finally {
      root.unmount()
    }
  })

  test('a count past the cap is painted capped', () => {
    expect(useBadge({ kind: 'count', count: 3 })).toEqual({ text: '3', capped: false })
    expect(useBadge({ kind: 'count', count: DEFAULT_COUNT_CAP + 1 })).toEqual({
      text: `${DEFAULT_COUNT_CAP}+`,
      capped: true,
    })
    expect(useBadge({ kind: 'count', count: 12, max: 9 })).toEqual({ text: '9+', capped: true })
  })
})
