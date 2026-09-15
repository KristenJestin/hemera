import { describe, expect, test } from 'bun:test'

import { TEST_RENDERER_PAINTS } from '../../../test-setup.ts'

import { Input } from './input.tsx'
import { useInput, valueOf } from './use-input.ts'
import type { InputBehaviour, UseInputOptions } from './use-input.ts'
import { dark } from '#theme/dark.ts'
import { focus, mountedCatalogue, nodeOf } from '../../../test-harness.tsx'

function noop() {}

/** Calls the hook inside a component, which is the only place a hook may run. */
function Probe({
  options,
  onReady,
}: {
  options: UseInputOptions
  onReady: (behaviour: InputBehaviour) => void
}) {
  onReady(useInput(options))
  return null
}

describe.skipIf(!TEST_RENDERER_PAINTS)('Input — comportement au clavier', () => {
  test('the field takes the focus and paints the ring', async () => {
    const root = mountedCatalogue(
      <Input testId="field" value="" onValueChange={noop} aria-label="Project name" />,
    )
    try {
      const focused = await focus(root, 'field')
      expect(root.renderer.getFocusedElementId()).toBe(focused.id)
      expect(focused.style?.borderColor).toBe(dark.colors.primaryRing)
    } finally {
      root.unmount()
    }
  })

  test('typing reports the new value to the caller', () => {
    let value = ''
    const root = mountedCatalogue(
      <Input testId="field" value={value} onValueChange={(next) => (value = next)} />,
    )
    try {
      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'field').id, 'a b c')
      expect(value.length).toBeGreaterThan(0)
    } finally {
      root.unmount()
    }
  })

  test('an invalid field is outlined in the error role', () => {
    const root = mountedCatalogue(<Input testId="field" invalid value="" onValueChange={noop} />)
    try {
      expect(nodeOf(root, 'field').style?.borderColor).toBe(dark.colors.bad)
    } finally {
      root.unmount()
    }
  })

  test('a disabled field refuses edits', () => {
    let changed = 0
    let behaviour: InputBehaviour | null = null
    const root = mountedCatalogue(
      <Probe
        options={{ value: 'kept', onValueChange: () => (changed += 1), disabled: true }}
        onReady={(ready) => (behaviour = ready)}
      />,
    )
    try {
      behaviour!.change({ value: 'typed' } as never)
      expect(changed).toBe(0)
      expect(behaviour!.inert).toBe(true)
    } finally {
      root.unmount()
    }
  })

  test('sending goes through the submission the renderer reports', () => {
    const sent: string[] = []
    let behaviour: InputBehaviour | null = null
    const root = mountedCatalogue(
      <Probe
        options={{ value: 'draft', onValueChange: noop, onSubmit: (value) => sent.push(value) }}
        onReady={(ready) => (behaviour = ready)}
      />,
    )
    try {
      behaviour!.submit({ value: 'draft' } as never)
      expect(sent).toEqual(['draft'])
      expect(valueOf({ value: undefined } as never, 'fallback')).toBe('fallback')
    } finally {
      root.unmount()
    }
  })
})
