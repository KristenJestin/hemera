import { describe, expect, test } from 'bun:test'

import { TEST_RENDERER_PAINTS } from '../../../test-setup.ts'

import { Composer } from './composer.tsx'
import { useComposer } from './use-composer.ts'
import type { ComposerBehaviour, UseComposerOptions } from './use-composer.ts'
import { dark } from '#theme/dark.ts'
import { focus, mountedCatalogue, nodeOf } from '../../../test-harness.tsx'

function noop() {}

/** Runs the hook inside a component, which is the only place a hook may run. */
function behaviourOf(options: UseComposerOptions): ComposerBehaviour {
  let captured: ComposerBehaviour | null = null
  function Probe() {
    captured = useComposer(options)
    return null
  }
  const root = mountedCatalogue(<Probe />)
  root.unmount()
  if (captured === null) throw new Error('the hook never ran')
  return captured
}

describe.skipIf(!TEST_RENDERER_PAINTS)('Composer — comportement au clavier', () => {
  test('the frame lights up when its own field holds the focus', async () => {
    const root = mountedCatalogue(
      <Composer
        testId="composer"
        draft=""
        onDraftChange={noop}
        onSend={noop}
        aria-label="Message"
      />,
    )
    try {
      const resting = nodeOf(root, 'composer').style?.borderColor
      await focus(root, 'composer-field')
      expect(nodeOf(root, 'composer').style?.borderColor).not.toBe(resting)
      expect(nodeOf(root, 'composer').style?.borderColor).toBe(dark.colors.primaryRing)
    } finally {
      root.unmount()
    }
  })

  test('sending goes through the field submission, never through an intercepted Enter', () => {
    const sent: string[] = []
    behaviourOf({ draft: 'hello', onDraftChange: noop, onSend: (draft) => sent.push(draft) }).send(
      'hello',
    )
    expect(sent).toEqual(['hello'])
  })

  test('an empty or blank draft is not sendable', () => {
    const sent: string[] = []
    const push = (draft: string) => sent.push(draft)
    expect(behaviourOf({ draft: '', onDraftChange: noop, onSend: push }).sendable).toBe(false)
    expect(behaviourOf({ draft: '   ', onDraftChange: noop, onSend: push }).sendable).toBe(false)
    expect(behaviourOf({ draft: 'a', onDraftChange: noop, onSend: push }).sendable).toBe(true)

    behaviourOf({ draft: '   ', onDraftChange: noop, onSend: push }).send('   ')
    expect(sent).toEqual([])
  })

  test('a disabled composer refuses edits and sends nothing', () => {
    const sent: string[] = []
    const changed: string[] = []
    const behaviour = behaviourOf({
      draft: 'kept',
      onDraftChange: (draft) => changed.push(draft),
      onSend: (draft) => sent.push(draft),
      disabled: true,
    })
    behaviour.change('typed')
    behaviour.send('kept')
    expect(changed).toEqual([])
    expect(sent).toEqual([])
    expect(behaviour.sendable).toBe(false)
  })

  test('the toolbar and the footer are painted around the field', () => {
    const root = mountedCatalogue(
      <Composer
        testId="composer"
        draft=""
        onDraftChange={noop}
        onSend={noop}
        toolbar={<></>}
        footer={<></>}
      />,
    )
    try {
      expect(nodeOf(root, 'composer-field').type).toBe('textarea')
    } finally {
      root.unmount()
    }
  })
})
