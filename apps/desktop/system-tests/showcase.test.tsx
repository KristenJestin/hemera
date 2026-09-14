import { describe, expect, test } from 'bun:test'

import { TEST_RENDERER_PAINTS } from '../test-setup.ts'

import { createTestRoot } from '@gpuix/react/testing'
import { dark, light } from '@hemera/ui'

import { ShowcasePage } from '../src/ui/showcase/showcase-page.tsx'

interface TreeNode {
  id: number
  type: string
  style?: Record<string, unknown>
  text?: string | null
  children?: TreeNode[]
}

function backgroundOf(node: TreeNode): string | undefined {
  if (typeof node.style?.backgroundColor === 'string') return node.style.backgroundColor
  for (const child of node.children ?? []) {
    const found = backgroundOf(child)
    if (found !== undefined) return found
  }
  return undefined
}

function textsOf(node: TreeNode): string[] {
  const texts: string[] = []
  if (node.type === 'text' && typeof node.text === 'string') texts.push(node.text)
  for (const child of node.children ?? []) texts.push(...textsOf(child))
  return texts
}

describe.skipIf(!TEST_RENDERER_PAINTS)('Comparaison des deux thèmes', () => {
  test('the page renders every component of the catalogue', () => {
    const root = createTestRoot({ width: 1280, height: 900 })
    try {
      root.render(<ShowcasePage />)
      root.renderer.flush()
      const painted = textsOf(root.renderer.toJSON() as TreeNode)
      for (const component of ['Button', 'Badge', 'Card', 'Composer', 'DialogPanel', 'Notice']) {
        expect(painted).toContain(component)
      }
    } finally {
      root.unmount()
    }
  })

  test('each theme paints the page in its own window background', () => {
    for (const theme of [dark, light]) {
      const root = createTestRoot({ width: 1280, height: 900 })
      try {
        root.render(<ShowcasePage initialTheme={theme.name} />)
        root.renderer.flush()
        expect(backgroundOf(root.renderer.toJSON() as TreeNode)).toBe(theme.colors.bg)
      } finally {
        root.unmount()
      }
    }
  })
})
