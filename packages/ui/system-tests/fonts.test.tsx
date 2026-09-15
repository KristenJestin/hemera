import { describe, expect, test } from 'bun:test'

import { TEST_RENDERER_PAINTS } from '../test-setup.ts'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { addFonts } from '@gpuix/native'
import { createTestRoot } from '@gpuix/react/testing'

import { EMBEDDED_FONTS, MONO_FAMILY, SANS_FAMILY } from '#index.ts'

const fontsDirectory = resolve(import.meta.dir, '..', 'src', 'fonts')

/** A family name no system can resolve, so the renderer falls back. */
const UNRESOLVABLE_FAMILY = 'Hemera No Such Family'

const SAMPLE = 'Session opened for the current project'

interface TreeNode {
  id: number
  testId?: string
  children?: TreeNode[]
}

function findByTestId(node: TreeNode | null | undefined, testId: string): number | null {
  if (node === null || node === undefined) return null
  if (node.testId === testId) return node.id
  for (const child of node.children ?? []) {
    const found = findByTestId(child, testId)
    if (found !== null) return found
  }
  return null
}

/** Paints the same string twice and returns the width each family produced. */
function paintedWidths(family: string): { embedded: number; fallback: number } {
  addFonts(EMBEDDED_FONTS.map((font) => readFileSync(join(fontsDirectory, font.file))))
  const root = createTestRoot({ width: 1280, height: 800 })
  try {
    root.render(
      // A flex column stretches text nodes, which makes a width measurement meaningless.
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <text testId="embedded" style={{ fontFamily: family, fontSize: 14, color: '#ffffff' }}>
          {SAMPLE}
        </text>
        <text
          testId="fallback"
          style={{ fontFamily: UNRESOLVABLE_FAMILY, fontSize: 14, color: '#ffffff' }}
        >
          {SAMPLE}
        </text>
      </div>,
    )
    root.renderer.flush()

    const tree = root.renderer.toJSON() as TreeNode
    const embeddedId = findByTestId(tree, 'embedded')
    const fallbackId = findByTestId(tree, 'fallback')
    expect(embeddedId).not.toBeNull()
    expect(fallbackId).not.toBeNull()

    const embedded = root.renderer.getElementBounds(embeddedId!)
    const fallback = root.renderer.getElementBounds(fallbackId!)
    expect(embedded).not.toBeNull()
    expect(fallback).not.toBeNull()
    return { embedded: embedded!.width, fallback: fallback!.width }
  } finally {
    root.unmount()
  }
}

describe.skipIf(!TEST_RENDERER_PAINTS)('Polices embarquées rendues', () => {
  test.each([SANS_FAMILY, MONO_FAMILY])(
    '%s is painted from the embedded file, not from a system fallback',
    (family) => {
      const widths = paintedWidths(family)
      expect(widths.embedded).toBeGreaterThan(0)
      expect(widths.fallback).toBeGreaterThan(0)
      expect(widths.embedded).not.toBe(widths.fallback)
    },
  )
})
