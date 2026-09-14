import { describe, expect, test } from 'bun:test'

import { TEST_RENDERER_PAINTS } from '../../../test-setup.ts'
import type { EventPayload } from '@gpuix/react'

import { Gutter } from './gutter.tsx'
import { DEFAULT_GUTTER_STEP, sizeWithinBounds, useGutter } from './use-gutter.ts'
import type { GutterBehaviour, UseGutterOptions } from './use-gutter.ts'
import { dark } from '../../theme/dark.ts'
import { focus, mountedCatalogue, nodeOf } from '../../../test-harness.tsx'

const BOUNDS = { min: 180, max: 420, defaultSize: 248 }

/** Runs the hook inside a component, which is the only place a hook may run. */
function behaviourOf(options: UseGutterOptions): GutterBehaviour {
  let captured: GutterBehaviour | null = null
  function Probe() {
    captured = useGutter(options)
    return null
  }
  const root = mountedCatalogue(<Probe />)
  root.unmount()
  if (captured === null) throw new Error('the hook never ran')
  return captured
}

function key(name: string): EventPayload {
  return { key: name } as EventPayload
}

describe.skipIf(!TEST_RENDERER_PAINTS)('Gutter — comportement au clavier', () => {
  test('the arrow keys move the size by one step', () => {
    const sizes: number[] = []
    const behaviour = behaviourOf({
      size: 248,
      onSizeChange: (size) => sizes.push(size),
      ...BOUNDS,
    })
    expect(behaviour.onKeyDown(key('right'))).toBe(true)
    expect(behaviour.onKeyDown(key('left'))).toBe(true)
    expect(behaviour.onKeyDown(key('enter'))).toBe(false)
    expect(sizes).toEqual([248 + DEFAULT_GUTTER_STEP, 248 - DEFAULT_GUTTER_STEP])
  })

  test('a move never leaves the bounds', () => {
    const sizes: number[] = []
    behaviourOf({
      size: BOUNDS.max,
      onSizeChange: (size) => sizes.push(size),
      ...BOUNDS,
    }).onKeyDown(key('right'))
    behaviourOf({
      size: BOUNDS.min,
      onSizeChange: (size) => sizes.push(size),
      ...BOUNDS,
    }).onKeyDown(key('left'))
    expect(sizes).toEqual([BOUNDS.max, BOUNDS.min])
  })

  test('a double activation returns to the default size', () => {
    const sizes: number[] = []
    const root = mountedCatalogue(
      <Gutter
        testId="gutter"
        label="Sidebar width"
        size={400}
        onSizeChange={(size) => sizes.push(size)}
        {...BOUNDS}
      />,
    )
    try {
      const bounds = root.renderer.getElementBounds(nodeOf(root, 'gutter').id)
      expect(bounds).not.toBeNull()
      behaviourOf({ size: 400, onSizeChange: (size) => sizes.push(size), ...BOUNDS }).reset()
      expect(sizes).toContain(BOUNDS.defaultSize)
    } finally {
      root.unmount()
    }
  })

  test('a stored size outside the bounds falls back to the default', () => {
    expect(sizeWithinBounds(300, BOUNDS)).toBe(300)
    expect(sizeWithinBounds(10, BOUNDS)).toBe(BOUNDS.defaultSize)
    expect(sizeWithinBounds(9000, BOUNDS)).toBe(BOUNDS.defaultSize)
    expect(sizeWithinBounds(null, BOUNDS)).toBe(BOUNDS.defaultSize)
    expect(sizeWithinBounds(Number.NaN, BOUNDS)).toBe(BOUNDS.defaultSize)
  })

  test('the focus ring is painted while the gutter holds the focus', async () => {
    const root = mountedCatalogue(
      <Gutter
        testId="gutter"
        label="Sidebar width"
        size={248}
        onSizeChange={() => {}}
        {...BOUNDS}
      />,
    )
    try {
      expect((await focus(root, 'gutter')).style?.borderColor).toBe(dark.colors.primaryRing)
    } finally {
      root.unmount()
    }
  })

  test('dragging clamps the reported size', () => {
    const sizes: number[] = []
    behaviourOf({ size: 410, onSizeChange: (size) => sizes.push(size), ...BOUNDS }).drag(100)
    expect(sizes).toEqual([BOUNDS.max])
  })
})
