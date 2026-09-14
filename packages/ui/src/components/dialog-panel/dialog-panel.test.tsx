import { describe, expect, test } from 'bun:test'

import { TEST_RENDERER_PAINTS } from '../../../test-setup.ts'
import { useState } from 'react'

import { DialogPanel } from './dialog-panel.tsx'
import { Button } from '../button/button.tsx'
import { Text } from '../../primitives/text.tsx'
import { Stack } from '../../primitives/stack.tsx'
import { focus, mountedCatalogue, nodeOf, textsOf } from '../../../test-harness.tsx'

/** A trigger and the panel it opens, which is how a decision is actually taken. */
function Decision() {
  const [open, setOpen] = useState(false)
  return (
    <Stack direction="column" gap="md" align="start">
      <Button testId="trigger" label="Archive" onPress={() => setOpen(true)} />
      <DialogPanel
        testId="panel"
        open={open}
        onClose={() => setOpen(false)}
        title="Archive this session?"
        actions={<Button testId="cancel" label="Cancel" onPress={() => setOpen(false)} />}
      >
        <Text color="muted">It stays readable among the archived ones.</Text>
      </DialogPanel>
    </Stack>
  )
}

describe.skipIf(!TEST_RENDERER_PAINTS)('DialogPanel — comportement au clavier', () => {
  test('a closed panel paints nothing', () => {
    const root = mountedCatalogue(<Decision />)
    try {
      expect(() => nodeOf(root, 'panel')).toThrow()
    } finally {
      root.unmount()
    }
  })

  test('the panel opens from its trigger and carries its own buttons', () => {
    const root = mountedCatalogue(<Decision />)
    try {
      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'trigger').id, 'enter')
      root.renderer.flush()
      expect(textsOf(nodeOf(root, 'panel'))).toEqual([
        'Archive this session?',
        'It stays readable among the archived ones.',
        'Cancel',
      ])
    } finally {
      root.unmount()
    }
  })

  test('Escape closes the panel and gives the focus back to the trigger', async () => {
    const root = mountedCatalogue(<Decision />)
    try {
      const trigger = await focus(root, 'trigger')
      root.renderer.nativeSimulateKeystrokes(trigger.id, 'enter')
      root.renderer.flush()
      expect(() => nodeOf(root, 'panel')).not.toThrow()

      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'cancel').id, 'escape')
      root.renderer.flush()
      expect(() => nodeOf(root, 'panel')).toThrow()
      // The window keeps answering the keyboard because the focus came back.
      expect(root.renderer.getFocusedElementId()).toBe(nodeOf(root, 'trigger').id)
    } finally {
      root.unmount()
    }
  })

  test('nothing outside the panel is trapped: the traversal keeps reaching the trigger', () => {
    const root = mountedCatalogue(<Decision />)
    try {
      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'trigger').id, 'enter')
      root.renderer.flush()
      root.renderer.focusElement(nodeOf(root, 'trigger').id)
      expect(root.renderer.getFocusedElementId()).toBe(nodeOf(root, 'trigger').id)
    } finally {
      root.unmount()
    }
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)("Focus restauré après fermeture d'un overlay", () => {
  test('closing by Escape brings the focus back to the button that opened it', async () => {
    const root = mountedCatalogue(<Decision />)
    try {
      const trigger = await focus(root, 'trigger')
      root.renderer.nativeSimulateKeystrokes(trigger.id, 'enter')
      root.renderer.flush()

      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'cancel').id, 'escape')
      root.renderer.flush()

      expect(() => nodeOf(root, 'panel')).toThrow()
      expect(root.renderer.getFocusedElementId()).toBe(nodeOf(root, 'trigger').id)
      // The keyboard still drives the window: the trigger answers again.
      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'trigger').id, 'enter')
      root.renderer.flush()
      expect(() => nodeOf(root, 'panel')).not.toThrow()
    } finally {
      root.unmount()
    }
  })

  test('closing by the cancel button brings the focus back the same way', async () => {
    const root = mountedCatalogue(<Decision />)
    try {
      const trigger = await focus(root, 'trigger')
      root.renderer.nativeSimulateKeystrokes(trigger.id, 'enter')
      root.renderer.flush()

      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'cancel').id, 'enter')
      root.renderer.flush()

      expect(() => nodeOf(root, 'panel')).toThrow()
      expect(root.renderer.getFocusedElementId()).toBe(nodeOf(root, 'trigger').id)
    } finally {
      root.unmount()
    }
  })
})
