/** Behaviour of a card: whether its header action is offered. */

import { useCallback } from 'react'

export interface UseCardOptions {
  /** Action offered in the header, or nothing when the card has none. */
  onAction?: (() => void) | undefined
}

export interface CardBehaviour {
  hasAction: boolean
  act: () => void
}

export function useCard({ onAction }: UseCardOptions = {}): CardBehaviour {
  return {
    hasAction: onAction !== undefined,
    act: useCallback(() => onAction?.(), [onAction]),
  }
}
