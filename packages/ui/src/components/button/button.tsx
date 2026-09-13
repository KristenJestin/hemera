/**
 * The primary action control.
 *
 * Controlled by its caller, styled from tokens only, and frozen when disabled so the
 * renderer stops painting hover and active without React.
 */

import { Pressable } from '../../primitives/pressable.tsx'
import { Stack } from '../../primitives/stack.tsx'
import { Text } from '../../primitives/text.tsx'
import { Icon } from '../../primitives/icon.tsx'
import type { IconName } from '../../icons/catalog.ts'
import { mergeStyle, variants } from '../../lib/style.ts'
import type { Style } from '../../lib/style.ts'
import { control, state } from '../../tokens/components.ts'
import { radius, space } from '../../tokens/primitives.ts'
import type { Theme, ThemeColors } from '../../tokens/semantic.ts'
import { useTheme } from '../../theme/provider.tsx'
import { useButton } from './use-button.ts'

export type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps {
  label: string
  onPress: () => void
  tone?: ButtonTone
  size?: ButtonSize
  /** Icon shown before the label, or alone when `iconOnly` is set. */
  iconName?: IconName
  /** Shows the icon without its label; the label stays the accessible name. */
  iconOnly?: boolean
  loading?: boolean
  disabled?: boolean
  style?: Style
  testId?: string
}

const ICON_SIZE = { sm: 'xs', md: 'sm', lg: 'md' } as const

const LABEL_SCALE = { sm: 'sm', md: 'md', lg: 'base' } as const

function toneStyles(theme: Theme) {
  return variants({
    base: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.lg,
      borderWidth: 1,
      cursor: 'pointer',
    },
    variants: {
      tone: {
        primary: {
          backgroundColor: theme.colors.primary,
          borderColor: theme.colors.primary,
          hover: { backgroundColor: theme.colors.primaryStrong },
          active: { backgroundColor: theme.colors.pressTint },
        },
        secondary: {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.line2,
          hover: { borderColor: theme.colors.primary },
          active: { backgroundColor: theme.colors.surface2 },
        },
        ghost: {
          backgroundColor: theme.colors.bg,
          borderColor: theme.colors.bg,
          hover: { backgroundColor: theme.colors.surface2 },
          active: { backgroundColor: theme.colors.surface3 },
        },
        danger: {
          backgroundColor: theme.colors.bad,
          borderColor: theme.colors.bad,
          hover: { backgroundColor: theme.colors.badSoft },
          active: { backgroundColor: theme.colors.pressTint },
        },
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
        lg: {
          height: control.height.lg,
          paddingLeft: control.paddingX.lg,
          paddingRight: control.paddingX.lg,
        },
      },
    },
    defaults: { tone: 'secondary', size: 'md' },
  })
}

/** Role the label and the icon take, so both read from the same token. */
function contentColorOf(tone: ButtonTone): keyof ThemeColors {
  if (tone === 'primary' || tone === 'danger') return 'onPrimary'
  return 'text'
}

export function Button({
  label,
  onPress,
  tone = 'secondary',
  size = 'md',
  iconName,
  iconOnly = false,
  loading = false,
  disabled = false,
  style,
  testId,
}: ButtonProps) {
  const theme = useTheme()
  const behaviour = useButton({ onPress, disabled, loading })
  const square = iconOnly
    ? { width: control.height[size], paddingLeft: space.none, paddingRight: space.none }
    : {}
  const dimmed = behaviour.inert
    ? { opacity: state.disabledOpacity, cursor: 'not-allowed' as const }
    : {}
  const shown: IconName | undefined = loading ? 'loader-circle' : iconName

  return (
    <Pressable
      onPress={behaviour.press}
      disabled={behaviour.inert}
      style={mergeStyle(toneStyles(theme)({ tone, size }), square, dimmed, style)}
      // The label stays the accessible name even when only the icon is painted.
      aria-label={label}
      {...(testId === undefined ? {} : { testId })}
    >
      <Stack gap="sm" align="center" justify="center">
        {shown === undefined ? null : (
          <Icon name={shown} size={ICON_SIZE[size]} color={contentColorOf(tone)} />
        )}
        {iconOnly ? null : (
          <Text color={contentColorOf(tone)} scale={LABEL_SCALE[size]} weight="medium">
            {label}
          </Text>
        )}
      </Stack>
    </Pressable>
  )
}
