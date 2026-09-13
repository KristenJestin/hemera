/** A selectable row of a list. */

import { mergeStyle } from '../../lib/style.ts'
import type { Style } from '../../lib/style.ts'
import { Pressable } from '../../primitives/pressable.tsx'
import { Stack } from '../../primitives/stack.tsx'
import { Text } from '../../primitives/text.tsx'
import { row, state } from '../../tokens/components.ts'
import { radius, space } from '../../tokens/primitives.ts'
import { useTheme } from '../../theme/provider.tsx'
import { useListItem } from './use-list-item.ts'

export interface ListItemProps {
  label: string
  onSelect: () => void
  selected?: boolean
  disabled?: boolean
  /** Painted after the label, such as a badge. */
  trailing?: React.ReactNode
  style?: Style
  testId?: string
}

export function ListItem({
  label,
  onSelect,
  selected = false,
  disabled = false,
  trailing,
  style,
  testId,
}: ListItemProps) {
  const theme = useTheme()
  const behaviour = useListItem({ onSelect, selected, disabled })

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
      role="listitem"
      {...(testId === undefined ? {} : { testId })}
    >
      <Stack gap="md" align="center" grow justify="between">
        <Text color={behaviour.selected ? 'text' : 'muted'} scale="md" truncate>
          {label}
        </Text>
        {trailing ?? null}
      </Stack>
    </Pressable>
  )
}
