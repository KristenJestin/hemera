/**
 * Behaviour of a select: an anchored menu, one open at a time, and the focus handed back.
 *
 * Closing an overlay that held the focus leaves the window deaf to the keyboard, so the focus
 * returns to the trigger explicitly.
 */

import type { EventPayload } from '@gpuix/react'
import { useCallback, useState } from 'react'

import { useFocusReturn } from '../../lib/interaction.ts'
import { isDismissKey } from '../../lib/keyboard.ts'

export interface SelectOption<Value extends string> {
  value: Value
  label: string
}

export interface UseSelectOptions<Value extends string> {
  value: Value
  options: readonly SelectOption<Value>[]
  onValueChange: (value: Value) => void
  disabled?: boolean
}

export interface SelectBehaviour<Value extends string> {
  inert: boolean
  open: boolean
  /** Option currently selected, or null when the value names none. */
  selected: SelectOption<Value> | null
  toggle: () => void
  close: () => void
  choose: (value: Value) => void
  /** Closes on the dismiss key and gives the focus back to the trigger. */
  onKeyDown: (event: EventPayload) => void
}

export function useSelect<Value extends string>({
  value,
  options,
  onValueChange,
  disabled = false,
}: UseSelectOptions<Value>): SelectBehaviour<Value> {
  const [open, setOpen] = useState(false)
  const focusReturn = useFocusReturn()

  const close = useCallback(() => {
    setOpen(false)
    focusReturn.restore()
  }, [focusReturn])

  const toggle = useCallback(() => {
    if (disabled) return
    setOpen((wasOpen) => {
      if (wasOpen) {
        focusReturn.restore()
        return false
      }
      focusReturn.capture()
      return true
    })
  }, [disabled, focusReturn])

  return {
    inert: disabled,
    open,
    selected: options.find((option) => option.value === value) ?? null,
    toggle,
    close,
    choose: useCallback(
      (chosen: Value) => {
        if (disabled) return
        onValueChange(chosen)
        setOpen(false)
        focusReturn.restore()
      },
      [disabled, onValueChange, focusReturn],
    ),
    onKeyDown: useCallback(
      (event: EventPayload) => {
        if (!isDismissKey(event)) return
        close()
      },
      [close],
    ),
  }
}
