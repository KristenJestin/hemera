/**
 * Behaviour of a decision taken over the window.
 *
 * The renderer has no modal element and no focus trap, so both are built here: the scrim
 * swallows every click that would reach what sits behind, and closing the panel gives the
 * focus back to whatever opened it — however it closed, including by leaving the tree.
 * Without that return the window stops answering the keyboard altogether.
 */

import type { EventPayload } from '@gpuix/react'
import { useCallback, useEffect } from 'react'

import { useFocusReturn } from '../../lib/interaction.ts'
import { isDismissKey } from '../../lib/keyboard.ts'

export interface UseModalOptions {
  open: boolean
  onClose: () => void
  /** Whether a click on the scrim closes the decision. Off for a decision that must be taken. */
  dismissOnScrim?: boolean
}

export interface ModalBehaviour {
  open: boolean
  /** Closes the panel and gives the focus back to the element that opened it. */
  close: () => void
  onKeyDown: (event: EventPayload) => void
  /** Click on the scrim: closes only when the decision can be dismissed. */
  onScrimPress: () => void
}

export function useModal({
  open,
  onClose,
  dismissOnScrim = true,
}: UseModalOptions): ModalBehaviour {
  const focusReturn = useFocusReturn()

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
    onScrimPress: useCallback(() => {
      if (dismissOnScrim) close()
    }, [close, dismissOnScrim]),
  }
}
