/**
 * Focus and pointer state helpers.
 *
 * Closing an overlay that held the focus leaves the window deaf to the keyboard, so the focus
 * is restored explicitly on the element that opened it.
 */

import { useGpuix } from '@gpuix/react'
import type { EventPayload, NativeRenderer } from '@gpuix/react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

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

/**
 * Which element holds the keyboard focus, read from the renderer.
 *
 * The renderer does not deliver its focus events to React — the focus paths it hands the
 * listener are empty — but the focused element it reports is always right. The focus state is
 * therefore sampled, for the same reason the window size is: a value that stays wrong forever
 * is worse than one that arrives a frame late. One sampler serves every subscriber.
 */
const FOCUS_SAMPLE_INTERVAL_MS = 60

const focusListeners = new Set<() => void>()
let focusedElement: number | null = null
let focusTimer: ReturnType<typeof setInterval> | null = null
let focusSource: NativeRenderer | null = null

function sampleFocus(): void {
  const sampled = focusSource?.getFocusedElementId?.() ?? null
  if (sampled === focusedElement) return
  focusedElement = sampled
  for (const listener of focusListeners) listener()
}

function subscribeToFocus(listener: () => void): () => void {
  focusListeners.add(listener)
  if (focusTimer === null) focusTimer = setInterval(sampleFocus, FOCUS_SAMPLE_INTERVAL_MS)
  return () => {
    focusListeners.delete(listener)
    if (focusListeners.size > 0 || focusTimer === null) return
    clearInterval(focusTimer)
    focusTimer = null
  }
}

/** Host id of the element holding the keyboard focus, or null when none does. */
export function useFocusedElement(): number | null {
  const { renderer } = useGpuix()
  useEffect(() => {
    focusSource = renderer
    sampleFocus()
  }, [renderer])
  return useSyncExternalStore(
    subscribeToFocus,
    () => focusedElement,
    () => null,
  )
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

  // Stable across renders: an overlay captures once, when it opens, not at every paint.
  return useMemo(
    () => ({
      capture,
      restore,
      get captured() {
        return captured.current
      },
    }),
    [capture, restore],
  )
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
