/**
 * A focusable, activatable surface.
 *
 * The renderer has no button element: a pressable is a focusable box that answers `Enter` and
 * `Space`. Disabled, it leaves the tab order, ignores activation and drops the hover and
 * active layers the renderer would otherwise keep painting without React.
 */

import type { EventPayload } from '@gpuix/react'
import type { ReactNode } from 'react'

import { useFocusState, useFocusable } from '../lib/interaction.ts'
import { isActivationKey } from '../lib/keyboard.ts'
import { focusRing, freezeStyle, mergeStyle, withoutUndefined } from '../lib/style.ts'
import type { Style } from '../lib/style.ts'
import { useTheme } from '../theme/provider.tsx'

export interface PressableProps {
  onPress: () => void
  disabled?: boolean
  style?: Style
  /** Layer applied while the element holds the focus, on top of the ring. */
  focusStyle?: Style
  children?: ReactNode
  testId?: string
}

export function Pressable({
  onPress,
  disabled = false,
  style,
  focusStyle,
  children,
  testId,
}: PressableProps) {
  const theme = useTheme()
  const focusable = useFocusable({ disabled })
  const focus = useFocusState()

  const activate = () => {
    if (disabled) return
    onPress()
  }

  const painted = disabled ? freezeStyle(style ?? {}) : (style ?? {})
  const focused = focus.focused && !disabled

  return (
    <div
      tabIndex={focusable.tabIndex}
      onClick={activate}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      onKeyDown={(event: EventPayload) => {
        if (!isActivationKey(event)) return
        activate()
      }}
      {...withoutUndefined({
        style: mergeStyle(painted, focused && focusRing(theme), focused && focusStyle),
        testId,
      })}
    >
      {children}
    </div>
  )
}
