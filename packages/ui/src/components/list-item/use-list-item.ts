/** Behaviour of a list row: selecting it, and refusing to reselect the selected one. */

import { useCallback } from 'react'

export interface UseListItemOptions {
  onSelect: () => void
  selected?: boolean
  disabled?: boolean
}

export interface ListItemBehaviour {
  inert: boolean
  selected: boolean
  select: () => void
}

export function useListItem({
  onSelect,
  selected = false,
  disabled = false,
}: UseListItemOptions): ListItemBehaviour {
  return {
    inert: disabled,
    selected,
    select: useCallback(() => {
      if (disabled || selected) return
      onSelect()
    }, [disabled, selected, onSelect]),
  }
}
