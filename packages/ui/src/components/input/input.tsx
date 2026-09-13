/** A single line field. */

import { useState } from 'react'
import type { PublicInstance } from '@gpuix/react'

import { useFocusedElement } from '../../lib/interaction.ts'
import { focusRing, mergeStyle, variants, withoutUndefined } from '../../lib/style.ts'
import type { Style } from '../../lib/style.ts'
import { control, state } from '../../tokens/components.ts'
import { fontFamily, fontSize, radius } from '../../tokens/primitives.ts'
import type { Theme } from '../../tokens/semantic.ts'
import { useTheme } from '../../theme/provider.tsx'
import { useInput } from './use-input.ts'

export type InputSize = 'sm' | 'md'

export interface InputProps {
  value: string
  onValueChange: (value: string) => void
  onSubmit?: (value: string) => void
  placeholder?: string
  /** Marks the field as carrying a value the caller refused. */
  invalid?: boolean
  size?: InputSize
  disabled?: boolean
  style?: Style
  testId?: string
  'aria-label'?: string
}

function fieldStyles(theme: Theme) {
  return variants({
    base: {
      borderWidth: 1,
      borderRadius: radius.lg,
      backgroundColor: theme.colors.surface,
      color: theme.colors.text,
      fontFamily: fontFamily.sans,
      fontSize: fontSize.base,
    },
    variants: {
      tone: {
        default: { borderColor: theme.colors.line2 },
        invalid: { borderColor: theme.colors.bad },
      },
      size: {
        sm: {
          height: control.height.sm,
          paddingLeft: control.paddingX.sm,
          paddingRight: control.paddingX.sm,
        },
        md: {
          height: control.height.md,
          paddingLeft: control.paddingX.md,
          paddingRight: control.paddingX.md,
        },
      },
    },
    defaults: { tone: 'default', size: 'md' },
  })
}

export function Input({
  value,
  onValueChange,
  onSubmit,
  placeholder,
  invalid = false,
  size = 'md',
  disabled = false,
  style,
  testId,
  'aria-label': ariaLabel,
}: InputProps) {
  const theme = useTheme()
  const behaviour = useInput({ value, onValueChange, onSubmit, disabled })
  const focusedElement = useFocusedElement()
  const [instance, setInstance] = useState<PublicInstance | null>(null)
  const focused = !behaviour.inert && instance !== null && focusedElement === instance.id
  const dimmed = behaviour.inert ? { opacity: state.disabledOpacity } : {}

  return (
    <input
      ref={setInstance}
      value={value}
      readOnly={behaviour.inert}
      tabIndex={behaviour.inert ? -1 : 0}
      onChange={behaviour.change}
      onSubmit={behaviour.submit}
      {...withoutUndefined({
        placeholder,
        testId,
        'aria-label': ariaLabel,
        style: mergeStyle(
          fieldStyles(theme)({ tone: invalid ? 'invalid' : 'default', size }),
          dimmed,
          focused && focusRing(theme),
          style,
        ),
      })}
    />
  )
}
