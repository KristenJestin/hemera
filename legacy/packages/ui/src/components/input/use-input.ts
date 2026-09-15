/**
 * Behaviour of a single line field.
 *
 * The field is controlled: the caller owns the value. The renderer's native editor consumes
 * `Enter`, so sending goes through the field's own submission rather than a key listener.
 */

import type { EventPayload } from '@gpuix/react'
import { useCallback } from 'react'

export interface UseInputOptions {
  value: string
  onValueChange: (value: string) => void
  /** Called when the field submits; the renderer reports it, the application never binds Enter. */
  onSubmit?: ((value: string) => void) | undefined
  disabled?: boolean
}

export interface InputBehaviour {
  /** True when the field refuses edits and leaves the tab order. */
  inert: boolean
  change: (event: EventPayload) => void
  submit: (event: EventPayload) => void
}

/** The text a field event carries. */
export function valueOf(event: EventPayload, fallback: string): string {
  return typeof event.value === 'string' ? event.value : fallback
}

export function useInput({
  value,
  onValueChange,
  onSubmit,
  disabled = false,
}: UseInputOptions): InputBehaviour {
  return {
    inert: disabled,
    change: useCallback(
      (event: EventPayload) => {
        if (disabled) return
        onValueChange(valueOf(event, value))
      },
      [disabled, onValueChange, value],
    ),
    submit: useCallback(
      (event: EventPayload) => {
        if (disabled) return
        onSubmit?.(valueOf(event, value))
      },
      [disabled, onSubmit, value],
    ),
  }
}
