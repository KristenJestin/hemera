/** Behaviour of an empty state: whether it offers a way out. */

import { useCallback } from 'react'

export interface UseEmptyStateOptions {
  onAction?: (() => void) | undefined
}

export interface EmptyStateBehaviour {
  hasAction: boolean
  act: () => void
}

export function useEmptyState({ onAction }: UseEmptyStateOptions = {}): EmptyStateBehaviour {
  return {
    hasAction: onAction !== undefined,
    act: useCallback(() => onAction?.(), [onAction]),
  }
}
