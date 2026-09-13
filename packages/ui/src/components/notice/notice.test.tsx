import { describe, expect, test } from 'bun:test'

import { Notice } from './notice.tsx'
import { useNotice } from './use-notice.ts'
import { dark } from '../../theme/dark.ts'
import { mountedCatalogue, nodeOf, textsOf } from '../../../test-harness.tsx'

describe('Notice — comportement au clavier', () => {
  test('a notice carries no action and stays out of the focus traversal', () => {
    const root = mountedCatalogue(<Notice testId="notice" tone="info" message="Saved" />)
    try {
      const notice = nodeOf(root, 'notice')
      root.renderer.focusNext()
      expect(root.renderer.getFocusedElementId()).not.toBe(notice.id)
      expect(textsOf(notice)).toEqual(['Saved'])
    } finally {
      root.unmount()
    }
  })

  test('each tone paints its own role pair', () => {
    const root = mountedCatalogue(
      <>
        <Notice testId="info" tone="info" message="Info" />
        <Notice testId="error" tone="error" message="Error" />
      </>,
    )
    try {
      expect(nodeOf(root, 'info').style?.backgroundColor).toBe(dark.colors.infoSoft)
      expect(nodeOf(root, 'error').style?.backgroundColor).toBe(dark.colors.badSoft)
    } finally {
      root.unmount()
    }
  })

  test('each tone is announced with an icon of the catalogue', () => {
    expect(useNotice({ tone: 'info' }).iconName).toBe('info')
    expect(useNotice({ tone: 'warn' }).iconName).toBe('triangle-alert')
    expect(useNotice({ tone: 'error' }).iconName).toBe('circle-x')
    expect(useNotice({ tone: 'success' }).iconName).toBe('circle-check')
  })
})
