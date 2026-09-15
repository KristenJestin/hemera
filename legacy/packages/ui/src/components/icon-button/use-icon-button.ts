/**
 * Behaviour of an icon button: the same activation rule as a button, with the label kept as
 * the accessible name since nothing is painted for it.
 */

import { useCallback } from 'react'

export interface UseIconButtonOptions {
  onPress: () => void
  /** Name of the action; painted nowhere, announced everywhere. */
  label: string
  disabled?: boolean
}

export interface IconButtonBehaviour {
  inert: boolean
  label: string
  press: () => void
}

export function useIconButton({
  onPress,
  label,
  disabled = false,
}: UseIconButtonOptions): IconButtonBehaviour {
  return {
    inert: disabled,
    label,
    press: useCallback(() => {
      if (disabled) return
      onPress()
    }, [disabled, onPress]),
  }
}
