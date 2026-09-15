/**
 * A focusable, activatable surface.
 *
 * The renderer has no button element: a pressable is a focusable box that answers `Enter` and
 * `Space`. Disabled, it leaves the tab order, ignores activation and drops the hover and
 * active layers the renderer would otherwise keep painting without React.
 *
 * The focus ring follows the focused element the renderer reports, not its focus events:
 * those arrive with empty focus paths and never reach React.
 */

import type { EventPayload, PublicInstance } from '@gpuix/react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { useFocusable, useFocusedElement } from '#lib/interaction.ts'
import { isActivationKey } from '#lib/keyboard.ts'
import { focusRing, freezeStyle, mergeStyle, withoutUndefined } from '#lib/style.ts'
import type { Style } from '#lib/style.ts'
import { useTheme } from '#theme/provider.tsx'

export interface PressableProps {
  onPress: () => void
  disabled?: boolean
  style?: Style
  /** Layer applied while the element holds the focus, on top of the ring. */
  focusStyle?: Style
  children?: ReactNode
  testId?: string
  role?: string
  'aria-label'?: string
}

export function Pressable({
  onPress,
  disabled = false,
  style,
  focusStyle,
  children,
  testId,
  role = 'button',
  'aria-label': ariaLabel,
}: PressableProps) {
  const theme = useTheme()
  const focusable = useFocusable({ disabled })
  const focusedElement = useFocusedElement()
  const [instance, setInstance] = useState<PublicInstance | null>(null)

  const activate = () => {
    if (disabled) return
    onPress()
  }

  const painted = disabled ? freezeStyle(style ?? {}) : (style ?? {})
  const focused = !disabled && instance !== null && focusedElement === instance.id

  return (
    <div
      ref={setInstance}
      tabIndex={focusable.tabIndex}
      role={role}
      onClick={activate}
      onKeyDown={(event: EventPayload) => {
        if (!isActivationKey(event)) return
        activate()
      }}
      {...withoutUndefined({
        style: mergeStyle(painted, focused && focusRing(theme), focused && focusStyle),
        testId,
        'aria-label': ariaLabel,
      })}
    >
      {children}
    </div>
  )
}
