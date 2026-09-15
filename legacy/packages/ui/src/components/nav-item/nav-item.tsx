/** A navigation entry of the sidebar: an icon, a label and, when there is one, a badge. */

import { mergeStyle } from '#lib/style.ts'
import type { Style } from '#lib/style.ts'
import type { IconName } from '#icons/catalog.ts'
import { Icon } from '#primitives/icon.tsx'
import { Pressable } from '#primitives/pressable.tsx'
import { Stack } from '#primitives/stack.tsx'
import { Text } from '#primitives/text.tsx'
import { row, state } from '#tokens/components.ts'
import { radius, space } from '#tokens/primitives.ts'
import { useTheme } from '#theme/provider.tsx'
import { useNavItem } from './use-nav-item.ts'

export interface NavItemProps {
  label: string
  iconName: IconName
  onSelect: () => void
  selected?: boolean
  disabled?: boolean
  /** Painted after the label, such as a status badge. */
  trailing?: React.ReactNode
  style?: Style
  testId?: string
}

export function NavItem({
  label,
  iconName,
  onSelect,
  selected = false,
  disabled = false,
  trailing,
  style,
  testId,
}: NavItemProps) {
  const theme = useTheme()
  const behaviour = useNavItem({ onSelect, selected, disabled })

  const surface: Style = {
    display: 'flex',
    alignItems: 'center',
    height: row.height,
    paddingLeft: space.md,
    paddingRight: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: behaviour.selected ? theme.colors.line : 'transparent',
    backgroundColor: behaviour.selected ? theme.colors.surface : 'transparent',
    cursor: 'pointer',
    ...(behaviour.inert ? { opacity: state.disabledOpacity, cursor: 'not-allowed' as const } : {}),
    ...(behaviour.selected ? {} : { hover: { backgroundColor: theme.colors.surface2 } }),
  }

  return (
    <Pressable
      onPress={behaviour.select}
      disabled={behaviour.inert}
      style={mergeStyle(surface, style)}
      aria-label={label}
      {...(testId === undefined ? {} : { testId })}
    >
      <Stack gap="md" align="center" grow justify="between">
        <Stack gap="md" align="center" grow>
          <Icon name={iconName} size="xs" color={behaviour.selected ? 'primary' : 'dim'} />
          <Text color={behaviour.selected ? 'text' : 'muted'} scale="md" truncate>
            {label}
          </Text>
        </Stack>
        {trailing ?? null}
      </Stack>
    </Pressable>
  )
}
