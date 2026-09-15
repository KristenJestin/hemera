/** Behaviour of a project tab: selecting it, and refusing to reselect the active one. */

import { useCallback } from 'react'

export interface UseTabOptions {
  onSelect: () => void
  active?: boolean
  disabled?: boolean
}

export interface TabBehaviour {
  inert: boolean
  active: boolean
  select: () => void
}

export function useTab({
  onSelect,
  active = false,
  disabled = false,
}: UseTabOptions): TabBehaviour {
  return {
    inert: disabled,
    active,
    select: useCallback(() => {
      if (disabled || active) return
      onSelect()
    }, [disabled, active, onSelect]),
  }
}
