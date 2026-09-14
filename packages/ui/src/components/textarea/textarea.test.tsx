import { describe, expect, test } from 'bun:test'

import { TEST_RENDERER_PAINTS } from '../../../test-setup.ts'

import { Textarea } from './textarea.tsx'
import { DEFAULT_MAX_ROWS, DEFAULT_MIN_ROWS, useTextarea } from './use-textarea.ts'
import type { TextareaBehaviour, UseTextareaOptions } from './use-textarea.ts'
import { dark } from '../../theme/dark.ts'
import { focus, mountedCatalogue, nodeOf } from '../../../test-harness.tsx'

function noop() {}

/** Runs the hook inside a component, which is the only place a hook may run. */
function behaviourOf(options: UseTextareaOptions): TextareaBehaviour {
  let captured: TextareaBehaviour | null = null
  function Probe() {
    captured = useTextarea(options)
    return null
  }
  const root = mountedCatalogue(<Probe />)
  root.unmount()
  if (captured === null) throw new Error('the hook never ran')
  return captured
}

describe.skipIf(!TEST_RENDERER_PAINTS)('Textarea — comportement au clavier', () => {
  test('the field takes the focus and paints the ring', async () => {
    const root = mountedCatalogue(
      <Textarea testId="composer" value="" onValueChange={noop} aria-label="Message" />,
    )
    try {
      const focused = await focus(root, 'composer')
      expect(focused.style?.borderColor).toBe(dark.colors.primaryRing)
    } finally {
      root.unmount()
    }
  })

  test('the field grows between its row bounds, measured by the renderer', () => {
    const root = mountedCatalogue(
      <Textarea testId="composer" value="" onValueChange={noop} minRows={3} maxRows={6} />,
    )
    try {
      expect(nodeOf(root, 'composer').type).toBe('textarea')
    } finally {
      root.unmount()
    }
  })

  test('Enter inserts a newline unless a submission is declared', () => {
    expect(behaviourOf({ value: '', onValueChange: noop }).submitsOnEnter).toBe(false)
    expect(behaviourOf({ value: '', onValueChange: noop, onSubmit: noop }).submitsOnEnter).toBe(
      true,
    )
  })

  test('sending goes through the submission, never through a key listener', () => {
    const sent: string[] = []
    behaviourOf({
      value: 'draft',
      onValueChange: noop,
      onSubmit: (value) => sent.push(value),
    }).submit({ value: 'draft' } as never)
    expect(sent).toEqual(['draft'])
  })

  test('the row bounds keep their order and their defaults', () => {
    expect(behaviourOf({ value: '', onValueChange: noop }).minRows).toBe(DEFAULT_MIN_ROWS)
    expect(behaviourOf({ value: '', onValueChange: noop }).maxRows).toBe(DEFAULT_MAX_ROWS)
    expect(behaviourOf({ value: '', onValueChange: noop, minRows: 8, maxRows: 2 }).maxRows).toBe(8)
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)("Soumission d'un champ multiligne", () => {
  test('sending goes through the field submission, never through an intercepted Enter', () => {
    const sent: string[] = []
    const root = mountedCatalogue(
      <Textarea
        testId="field"
        value="a message"
        onValueChange={noop}
        onSubmit={(value) => sent.push(value)}
        aria-label="Message"
      />,
    )
    try {
      const field = nodeOf(root, 'field')
      // The renderer submits by itself once a submission is declared: the application
      // registers no key listener of its own for Enter.
      expect(field.type).toBe('textarea')
      expect(
        behaviourOf({ value: 'a message', onValueChange: noop, onSubmit: noop }).submitsOnEnter,
      ).toBe(true)

      // The submission itself carries the content: the send never reads a key event.
      behaviourOf({
        value: 'a message',
        onValueChange: noop,
        onSubmit: (value) => sent.push(value),
      }).submit({ value: 'a message' } as never)
      expect(sent).toEqual(['a message'])
    } finally {
      root.unmount()
    }
  })

  test('without a declared submission the field keeps Enter for a newline', () => {
    expect(behaviourOf({ value: '', onValueChange: noop }).submitsOnEnter).toBe(false)
  })
})
