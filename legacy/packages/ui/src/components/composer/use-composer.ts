/**
 * Behaviour of the composer.
 *
 * The draft belongs to the caller. Sending goes through the field's own submission: the
 * renderer's native editor consumes `Enter`, so the application never binds the key.
 */

import { useCallback } from 'react'

export interface UseComposerOptions {
  draft: string
  onDraftChange: (draft: string) => void
  onSend: (draft: string) => void
  disabled?: boolean
}

export interface ComposerBehaviour {
  inert: boolean
  /** True when the draft holds something worth sending. */
  sendable: boolean
  change: (draft: string) => void
  send: (draft: string) => void
}

export function useComposer({
  draft,
  onDraftChange,
  onSend,
  disabled = false,
}: UseComposerOptions): ComposerBehaviour {
  const sendable = !disabled && draft.trim().length > 0
  return {
    inert: disabled,
    sendable,
    change: useCallback(
      (next: string) => {
        if (disabled) return
        onDraftChange(next)
      },
      [disabled, onDraftChange],
    ),
    send: useCallback(
      (submitted: string) => {
        if (disabled || submitted.trim().length === 0) return
        onSend(submitted)
      },
      [disabled, onSend],
    ),
  }
}
