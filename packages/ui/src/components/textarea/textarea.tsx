/** A multiline field whose height grows between its row bounds. */

import { useState } from 'react'
import type { PublicInstance } from '@gpuix/react'

import { useFocusedElement } from '../../lib/interaction.ts'
import { focusRing, mergeStyle, withoutUndefined } from '../../lib/style.ts'
import type { Style } from '../../lib/style.ts'
import { control, state } from '../../tokens/components.ts'
import { fontFamily, fontSize, lineHeight, radius } from '../../tokens/primitives.ts'
import { useTheme } from '../../theme/provider.tsx'
import { useTextarea } from './use-textarea.ts'

export interface TextareaProps {
  value: string
  onValueChange: (value: string) => void
  /** Declaring it makes the renderer submit on Enter instead of inserting a newline. */
  onSubmit?: (value: string) => void
  placeholder?: string
  minRows?: number
  maxRows?: number
  disabled?: boolean
  style?: Style
  testId?: string
  'aria-label'?: string
  /** Reports the painted element, so a surrounding frame can follow its focus. */
  onInstance?: (instance: PublicInstance | null) => void
}

export function Textarea({
  value,
  onValueChange,
  onSubmit,
  placeholder,
  minRows,
  maxRows,
  disabled = false,
  style,
  testId,
  'aria-label': ariaLabel,
  onInstance,
}: TextareaProps) {
  const theme = useTheme()
  const behaviour = useTextarea({ value, onValueChange, onSubmit, disabled, minRows, maxRows })
  const focusedElement = useFocusedElement()
  const [instance, setInstance] = useState<PublicInstance | null>(null)
  const focused = !behaviour.inert && instance !== null && focusedElement === instance.id

  const field: Style = {
    borderWidth: 1,
    borderColor: theme.colors.line2,
    borderRadius: radius.lg,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    fontFamily: fontFamily.sans,
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
    paddingLeft: control.paddingX.md,
    paddingRight: control.paddingX.md,
    ...(behaviour.inert ? { opacity: state.disabledOpacity } : {}),
  }

  return (
    <textarea
      ref={(painted) => {
        setInstance(painted)
        onInstance?.(painted)
      }}
      value={value}
      readOnly={behaviour.inert}
      tabIndex={behaviour.inert ? -1 : 0}
      minRows={behaviour.minRows}
      maxRows={behaviour.maxRows}
      onChange={behaviour.change}
      {...withoutUndefined({
        placeholder,
        testId,
        'aria-label': ariaLabel,
        onSubmit: behaviour.submitsOnEnter ? behaviour.submit : undefined,
        style: mergeStyle(field, focused && focusRing(theme), style),
      })}
    />
  )
}
