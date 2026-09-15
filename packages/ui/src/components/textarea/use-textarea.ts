/**
 * Behaviour of a multiline field.
 *
 * The renderer grows the field between the row bounds it is given; nothing is measured in
 * JavaScript. `Enter` inserts a newline unless a submission is declared, in which case the
 * renderer submits — the application never intercepts the key.
 */

import type { EventPayload } from '@gpuix/react'
import { useCallback } from 'react'

import { valueOf } from '#components/input/use-input.ts'

export interface UseTextareaOptions {
  value: string
  onValueChange: (value: string) => void
  onSubmit?: ((value: string) => void) | undefined
  disabled?: boolean
  /** Rows the field never shrinks below. */
  minRows?: number | undefined
  /** Rows the field never grows past; it scrolls instead. */
  maxRows?: number | undefined
}

export interface TextareaBehaviour {
  inert: boolean
  minRows: number
  maxRows: number
  /** True when the renderer submits on Enter rather than inserting a newline. */
  submitsOnEnter: boolean
  change: (event: EventPayload) => void
  submit: (event: EventPayload) => void
}

export const DEFAULT_MIN_ROWS = 2
export const DEFAULT_MAX_ROWS = 12

export function useTextarea({
  value,
  onValueChange,
  onSubmit,
  disabled = false,
  minRows = DEFAULT_MIN_ROWS,
  maxRows = DEFAULT_MAX_ROWS,
}: UseTextareaOptions): TextareaBehaviour {
  return {
    inert: disabled,
    minRows,
    maxRows: Math.max(minRows, maxRows),
    submitsOnEnter: onSubmit !== undefined,
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
