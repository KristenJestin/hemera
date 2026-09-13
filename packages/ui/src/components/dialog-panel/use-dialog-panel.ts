/**
 * Behaviour of a decision panel.
 *
 * The renderer has no modal and no focus trap: a decision is taken in an explicit panel with
 * its own buttons. Closing it restores the focus on whatever opened it, or the window stops
 * answering the keyboard.
 */

import type { EventPayload } from '@gpuix/react'
import { useCallback, useEffect } from 'react'

import { useFocusReturn } from '../../lib/interaction.ts'
import { isDismissKey } from '../../lib/keyboard.ts'

export interface UseDialogPanelOptions {
  open: boolean
  onClose: () => void
}

export interface DialogPanelBehaviour {
  open: boolean
  /** Closes the panel and gives the focus back to the element that opened it. */
  close: () => void
  onKeyDown: (event: EventPayload) => void
}

export function useDialogPanel({ open, onClose }: UseDialogPanelOptions): DialogPanelBehaviour {
  const focusReturn = useFocusReturn()

  // Captured when the panel opens, given back when it closes — however it closed, including
  // through a button of the caller or by the panel leaving the tree altogether.
  useEffect(() => {
    if (!open) return undefined
    focusReturn.capture()
    return () => focusReturn.restore()
  }, [open, focusReturn])

  const close = useCallback(() => {
    onClose()
  }, [onClose])

  return {
    open,
    close,
    onKeyDown: useCallback(
      (event: EventPayload) => {
        if (!isDismissKey(event)) return
        close()
      },
      [close],
    ),
  }
}
