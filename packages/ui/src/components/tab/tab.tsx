/** A project tab: a colour dot, a label and, when there is one, a counter. */

import { mergeStyle } from '../../lib/style.ts'
import type { Style } from '../../lib/style.ts'
import { Box } from '../../primitives/box.tsx'
import { Pressable } from '../../primitives/pressable.tsx'
import { Stack } from '../../primitives/stack.tsx'
import { Text } from '../../primitives/text.tsx'
import { control, dot, state } from '../../tokens/components.ts'
import { radius } from '../../tokens/primitives.ts'
import type { ThemeColors } from '../../tokens/semantic.ts'
import { useTheme } from '../../theme/provider.tsx'
import { Badge } from '../badge/badge.tsx'
import { useTab } from './use-tab.ts'

export interface TabProps {
  label: string
  onSelect: () => void
  /** Role the project colour dot is painted with. */
  dotColor: keyof ThemeColors
  active?: boolean
  /** Number of items waiting in this project, when there are any. */
  count?: number
  disabled?: boolean
  style?: Style
  testId?: string
}

export function Tab({
  label,
  onSelect,
  dotColor,
  active = false,
  count,
  disabled = false,
  style,
  testId,
}: TabProps) {
  const theme = useTheme()
  const behaviour = useTab({ onSelect, active, disabled })

  const surface: Style = {
    display: 'flex',
    alignItems: 'center',
    height: control.height.md,
    paddingLeft: control.paddingX.sm,
    paddingRight: control.paddingX.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: behaviour.active ? theme.colors.line : theme.colors.bg,
    backgroundColor: behaviour.active ? theme.colors.surface : theme.colors.bg,
    cursor: 'pointer',
    ...(behaviour.inert ? { opacity: state.disabledOpacity, cursor: 'not-allowed' as const } : {}),
    ...(behaviour.active ? {} : { hover: { backgroundColor: theme.colors.surface2 } }),
  }

  return (
    <Pressable
      onPress={behaviour.select}
      disabled={behaviour.inert}
      style={mergeStyle(surface, style)}
      aria-label={label}
      role="tab"
      {...(testId === undefined ? {} : { testId })}
    >
      <Stack gap="sm" align="center">
        <Box
          style={{
            width: dot.size,
            height: dot.size,
            borderRadius: radius.pill,
            backgroundColor: theme.colors[dotColor],
          }}
        />
        <Text
          color={behaviour.active ? 'text' : 'muted'}
          scale="md"
          weight={behaviour.active ? 'semibold' : 'medium'}
        >
          {label}
        </Text>
        {count === undefined ? null : <Badge kind="count" count={count} />}
      </Stack>
    </Pressable>
  )
}
