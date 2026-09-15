import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TEST_RENDERER_PAINTS } from '../../../test-setup.ts'
import { Button } from './button.tsx'
import { Icon } from '#primitives/icon.tsx'
import { mountedCatalogue } from '../../../test-harness.tsx'

const OUT = mkdtempSync(join(tmpdir(), 'hemera-spin-'))

function shot(node: Parameters<typeof mountedCatalogue>[0], name: string): Buffer {
  const root = mountedCatalogue(node)
  try {
    root.renderer.flush()
    root.renderer.captureScreenshot(join(OUT, `${name}.png`))
    return readFileSync(join(OUT, `${name}.png`))
  } finally {
    root.unmount()
  }
}

describe.skipIf(!TEST_RENDERER_PAINTS)('Icône tournée', () => {
  test('an angle changes what is painted, not the box', () => {
    const upright = shot(<Icon name="chevron-down" size="lg" color="text" />, 'upright')
    const turned = shot(<Icon name="chevron-down" size="lg" color="text" rotate={90} />, 'turned')
    expect(upright.equals(turned)).toBe(false)
  })

  test('a loading button asks its icon to turn', () => {
    const root = mountedCatalogue(
      <Button testId="save" tone="primary" loading label="Saving" onPress={() => {}} />,
    )
    try {
      // The rotation is repeated by the renderer, so nothing here re-renders per frame: what
      // this asserts is that the button asked for it, not that a frame moved.
      const tree = JSON.stringify(root.renderer.toJSON())
      expect(tree).toContain('"spin":true')
    } finally {
      root.unmount()
    }
  })

  test('a button that is not loading asks for nothing', () => {
    const root = mountedCatalogue(
      <Button testId="save" tone="primary" iconName="check" label="Save" onPress={() => {}} />,
    )
    try {
      expect(JSON.stringify(root.renderer.toJSON())).not.toContain('"spin":true')
    } finally {
      root.unmount()
    }
  })
})
