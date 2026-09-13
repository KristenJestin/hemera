/**
 * Focus and pointer state helpers.
 *
 * Closing an overlay that held the focus leaves the window deaf to the keyboard, so the focus
 * is restored explicitly on the element that opened it.
 */

import { useGpuix } from '@gpuix/react'
import type { EventPayload } from '@gpuix/react'
import { useCallback, useRef, useState } from 'react'

export interface FocusState {
  focused: boolean
  onFocus: (event: EventPayload) => void
  onBlur: (event: EventPayload) => void
}

/** Tracks whether the element holds the keyboard focus. */
export function useFocusState(handlers?: {
  onFocus?: (event: EventPayload) => void
  onBlur?: (event: EventPayload) => void
}): FocusState {
  const [focused, setFocused] = useState(false)
  const onFocus = useCallback(
    (event: EventPayload) => {
      setFocused(true)
      handlers?.onFocus?.(event)
    },
    [handlers],
  )
  const onBlur = useCallback(
    (event: EventPayload) => {
      setFocused(false)
      handlers?.onBlur?.(event)
    },
    [handlers],
  )
  return { focused, onFocus, onBlur }
}

export interface Focusable {
  /** Tab order index; a disabled control leaves the traversal. */
  tabIndex: number
}

/** Focus participation of a control. */
export function useFocusable(options: { disabled?: boolean } = {}): Focusable {
  return { tabIndex: options.disabled === true ? -1 : 0 }
}

export interface FocusReturn {
  /** Remembers the element that currently holds focus. */
  capture: () => void
  /** Gives the focus back to the remembered element. */
  restore: () => void
  /** Element the focus will return to, or null when none was captured. */
  readonly captured: number | null
}

/**
 * Captures the focused element before an overlay opens and restores it on close.
 *
 * Without this the window keeps no focused element and stops answering the keyboard.
 */
export function useFocusReturn(): FocusReturn {
  const { renderer } = useGpuix()
  const captured = useRef<number | null>(null)

  const capture = useCallback(() => {
    captured.current = renderer?.getFocusedElementId?.() ?? null
  }, [renderer])

  const restore = useCallback(() => {
    const target = captured.current
    captured.current = null
    if (target !== null) renderer?.focusElement?.(target)
  }, [renderer])

  return {
    capture,
    restore,
    get captured() {
      return captured.current
    },
  }
}

export interface FocusTraversal {
  next: () => void
  previous: () => void
}

/** Moves the focus manually, the renderer binding no traversal key of its own. */
export function useFocusTraversal(): FocusTraversal {
  const { renderer } = useGpuix()
  return {
    next: useCallback(() => renderer?.focusNext?.(), [renderer]),
    previous: useCallback(() => renderer?.focusPrevious?.(), [renderer]),
  }
}
