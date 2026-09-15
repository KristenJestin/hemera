import { describe, expect, test } from 'bun:test'

import { TEST_RENDERER_PAINTS } from '../../../test-setup.ts'
import { useState } from 'react'

import { Modal } from './modal.tsx'
import { Button } from '#components/button/button.tsx'
import { Text } from '#primitives/text.tsx'
import { Stack } from '#primitives/stack.tsx'
import { focus, mountedCatalogue, nodeOf, textsOf } from '../../../test-harness.tsx'

/** A trigger, the decision it opens, and content that must stay painted behind it. */
function Decision({ dismissOnScrim = true }: { dismissOnScrim?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <Stack direction="column" gap="md" align="start">
      <Button testId="trigger" label="Archive" onPress={() => setOpen(true)} />
      <Text testId="behind" color="muted">
        The thread stays where it was.
      </Text>
      <Modal
        testId="panel"
        open={open}
        onClose={() => setOpen(false)}
        title="Archive this session?"
        dismissOnScrim={dismissOnScrim}
        actions={<Button testId="cancel" label="Cancel" onPress={() => setOpen(false)} />}
      >
        <Text color="muted">It stays readable among the archived ones.</Text>
      </Modal>
    </Stack>
  )
}

/** The panel is painted while it leaves, so a test that reads it back has to wait. */
async function afterExit(root: ReturnType<typeof mountedCatalogue>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, EXIT_WAIT_MS))
  root.renderer.flush()
}

/** Longer than the exit itself, short enough that a suite is not slowed by it. */
const EXIT_WAIT_MS = 220

describe.skipIf(!TEST_RENDERER_PAINTS)('Modal — comportement au clavier', () => {
  test('a closed decision paints nothing', () => {
    const root = mountedCatalogue(<Decision />)
    try {
      expect(() => nodeOf(root, 'panel')).toThrow()
    } finally {
      root.unmount()
    }
  })

  test('the decision opens from its trigger and carries its own buttons', () => {
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

  test('what sits behind keeps painting instead of being replaced', () => {
    const root = mountedCatalogue(<Decision />)
    try {
      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'trigger').id, 'enter')
      root.renderer.flush()
      // The defect this replaces: the panel took the content's place, so the composer and
      // everything else under it stopped existing while a decision was open.
      expect(() => nodeOf(root, 'behind')).not.toThrow()
      expect(() => nodeOf(root, 'trigger')).not.toThrow()
    } finally {
      root.unmount()
    }
  })

  test('the panel sits behind a scrim rather than alone in the flow', () => {
    const root = mountedCatalogue(<Decision />)
    try {
      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'trigger').id, 'enter')
      root.renderer.flush()
      // The scrim is what hides the window and swallows the clicks that reach it; the shell
      // is what stretches it over the whole window.
      expect(() => nodeOf(root, 'panel-scrim')).not.toThrow()
    } finally {
      root.unmount()
    }
  })

  test('Escape closes the decision and gives the focus back to the trigger', async () => {
    const root = mountedCatalogue(<Decision />)
    try {
      const trigger = await focus(root, 'trigger')
      root.renderer.nativeSimulateKeystrokes(trigger.id, 'enter')
      root.renderer.flush()
      expect(() => nodeOf(root, 'panel')).not.toThrow()

      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'cancel').id, 'escape')
      root.renderer.flush()
      // Still painted, on its way out.
      expect(() => nodeOf(root, 'panel')).not.toThrow()
      await afterExit(root)
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
      await afterExit(root)

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
      await afterExit(root)

      expect(() => nodeOf(root, 'panel')).toThrow()
      expect(root.renderer.getFocusedElementId()).toBe(nodeOf(root, 'trigger').id)
    } finally {
      root.unmount()
    }
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Décision fermée par le voile', () => {
  test('a click on the scrim closes, a click inside the panel does not', async () => {
    const root = mountedCatalogue(<Decision />)
    try {
      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'trigger').id, 'enter')
      root.renderer.flush()
      await new Promise((resolve) => setTimeout(resolve, 0))
      root.renderer.flush()

      const panel = root.renderer.getElementBounds(nodeOf(root, 'panel').id)
      expect(panel).not.toBeNull()
      if (panel === null) return

      // Inside the panel: the decision is being taken, not dismissed.
      root.renderer.nativeSimulateClick(panel.x + panel.width / 2, panel.y + panel.height / 2)
      root.renderer.flush()
      expect(() => nodeOf(root, 'panel')).not.toThrow()

      // Outside it, on the scrim: the panel sits inside a padding, so its own corner is the
      // window as far as the user is concerned.
      const scrim = root.renderer.getElementBounds(nodeOf(root, 'panel-scrim').id)
      expect(scrim).not.toBeNull()
      if (scrim === null) return
      root.renderer.nativeSimulateClick(scrim.x + 4, scrim.y + 4)
      root.renderer.flush()
      await afterExit(root)
      expect(() => nodeOf(root, 'panel')).toThrow()
    } finally {
      root.unmount()
    }
  })
})
