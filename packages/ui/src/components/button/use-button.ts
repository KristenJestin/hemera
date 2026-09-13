/**
 * Behaviour of a button: when it may be activated, and what activating it does.
 *
 * The hook carries no visual value; the component reads the tokens.
 */

import { useCallback } from 'react'

export interface UseButtonOptions {
  onPress: () => void
  disabled?: boolean
  /** An action in flight: the control is shown busy and refuses activation. */
  loading?: boolean
}

export interface ButtonBehaviour {
  /** True when the control refuses activation and leaves the tab order. */
  inert: boolean
  press: () => void
}

export function useButton({
  onPress,
  disabled = false,
  loading = false,
}: UseButtonOptions): ButtonBehaviour {
  const inert = disabled || loading
  return {
    inert,
    press: useCallback(() => {
      if (inert) return
      onPress()
    }, [inert, onPress]),
  }
}
