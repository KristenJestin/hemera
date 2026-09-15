/**
 * A focusable, activatable surface.
 *
 * The renderer has no button element: a pressable is a focusable box that answers `Enter` and
 * `Space`. Disabled, it leaves the tab order, ignores activation and drops the hover and
 * active layers the renderer would otherwise keep painting without React.
 *
 * The focus ring follows the focused element the renderer reports, not its focus events:
 * those arrive with empty focus paths and never reach React.
 *
 * Hover and press are painted here rather than handed to the renderer's own `hover:` and
 * `active:` layers, which switch from one frame to the next. No colour can be animated, so
 * the colour is held by a layer of its own whose opacity is: the result reads as a colour
 * fading in, and it costs one box.
 */

import type { EventPayload, PublicInstance } from '@gpuix/react'
import { motion } from '@gpuix/react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { useFocusable, useFocusedElement } from '#lib/interaction.ts'
import { isActivationKey } from '#lib/keyboard.ts'
import { transition } from '#lib/motion.ts'
import { focusRing, freezeStyle, mergeStyle, withoutUndefined } from '#lib/style.ts'
import type { Style } from '#lib/style.ts'
import { control } from '#tokens/components.ts'
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
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)

  const activate = () => {
    if (disabled) return
    onPress()
  }

  const painted = disabled ? freezeStyle(style ?? {}) : (style ?? {})
  const focused = !disabled && instance !== null && focusedElement === instance.id

  // The hover colour the caller declared becomes a layer; what is left of `hover` stays with
  // the renderer, which is where a border or a text colour has to be applied anyway.
  const { backgroundColor: hoverColor, ...hoverRest } = painted.hover ?? {}
  const surface: Style = {
    ...painted,
    position: 'relative',
    ...(hoverColor === undefined ? {} : { hover: hoverRest }),
    // A press that only tints the surface reads as the button going translucent. A pixel of
    // travel reads as a button being pushed, which is what happened. It is not animated: a
    // motion element carries no `tabIndex`, and a pixel over a tenth of a second reads as
    // nothing at all next to the press itself.
    top: pressed && !disabled ? control.pressTravel : 0,
  }

  return (
    <div
      ref={setInstance}
      tabIndex={focusable.tabIndex}
      role={role}
      onClick={activate}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false)
        setPressed(false)
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onKeyDown={(event: EventPayload) => {
        if (!isActivationKey(event)) return
        activate()
      }}
      {...withoutUndefined({
        style: mergeStyle(surface, focused && focusRing(theme), focused && focusStyle),
        testId,
        'aria-label': ariaLabel,
      })}
    >
      {hoverColor === undefined || disabled ? null : (
        <motion.div
          animate={{ opacity: hovered ? 1 : 0 }}
          transition={transition('fast')}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            opacity: 0,
            backgroundColor: hoverColor,
            // The layer takes the corners of the surface it fills, or it paints past them.
            ...(painted.borderRadius === undefined ? {} : { borderRadius: painted.borderRadius }),
            // It is decoration: the clicks belong to the surface underneath.
            pointerEvents: 'none',
          }}
        />
      )}
      {children}
    </div>
  )
}
