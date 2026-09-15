/** A square control carrying only an icon. */

import { mergeStyle, variants } from '#lib/style.ts'
import type { Style } from '#lib/style.ts'
import type { IconName } from '#icons/catalog.ts'
import { Icon } from '#primitives/icon.tsx'
import { Pressable } from '#primitives/pressable.tsx'
import { control, state } from '#tokens/components.ts'
import { radius } from '#tokens/primitives.ts'
import type { Theme } from '#tokens/semantic.ts'
import { useTheme } from '#theme/provider.tsx'
import { useIconButton } from './use-icon-button.ts'

export type IconButtonTone = 'ghost' | 'secondary'
export type IconButtonSize = 'sm' | 'md'

export interface IconButtonProps {
  name: IconName
  /** Name of the action; painted nowhere, announced everywhere. */
  label: string
  onPress: () => void
  tone?: IconButtonTone
  size?: IconButtonSize
  disabled?: boolean
  style?: Style
  testId?: string
}

const ICON_SIZE = { sm: 'xs', md: 'sm' } as const

function toneStyles(theme: Theme) {
  return variants({
    base: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      borderWidth: 1,
      cursor: 'pointer',
    },
    variants: {
      tone: {
        ghost: {
          backgroundColor: theme.colors.bg,
          borderColor: theme.colors.bg,
          hover: { backgroundColor: theme.colors.surface2 },
          active: { backgroundColor: theme.colors.surface3 },
        },
        secondary: {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.line2,
          hover: { borderColor: theme.colors.primary },
          active: { backgroundColor: theme.colors.surface2 },
        },
      },
      size: {
        sm: { width: control.height.sm, height: control.height.sm },
        md: { width: control.height.md, height: control.height.md },
      },
    },
    defaults: { tone: 'ghost', size: 'md' },
  })
}

export function IconButton({
  name,
  label,
  onPress,
  tone = 'ghost',
  size = 'md',
  disabled = false,
  style,
  testId,
}: IconButtonProps) {
  const theme = useTheme()
  const behaviour = useIconButton({ onPress, label, disabled })
  const dimmed = behaviour.inert
    ? { opacity: state.disabledOpacity, cursor: 'not-allowed' as const }
    : {}

  return (
    <Pressable
      onPress={behaviour.press}
      disabled={behaviour.inert}
      style={mergeStyle(toneStyles(theme)({ tone, size }), dimmed, style)}
      aria-label={behaviour.label}
      {...(testId === undefined ? {} : { testId })}
    >
      <Icon name={name} size={ICON_SIZE[size]} color="muted" />
    </Pressable>
  )
}
