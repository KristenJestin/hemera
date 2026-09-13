/** A pill that opens an anchored menu of options. */

import type { EventPayload } from '@gpuix/react'

import { mergeStyle, variants } from '../../lib/style.ts'
import type { Style } from '../../lib/style.ts'
import { Anchored } from '../../primitives/anchored.tsx'
import { Icon } from '../../primitives/icon.tsx'
import { Pressable } from '../../primitives/pressable.tsx'
import { Stack } from '../../primitives/stack.tsx'
import { Text } from '../../primitives/text.tsx'
import { control, row, state } from '../../tokens/components.ts'
import { radius, space } from '../../tokens/primitives.ts'
import type { Theme } from '../../tokens/semantic.ts'
import { useTheme } from '../../theme/provider.tsx'
import { useSelect } from './use-select.ts'
import type { SelectOption } from './use-select.ts'

export type SelectSize = 'sm' | 'md'

export interface SelectProps<Value extends string> {
  value: Value
  options: readonly SelectOption<Value>[]
  onValueChange: (value: Value) => void
  /** Name of the choice; painted nowhere, announced everywhere. */
  label: string
  /** Shown when the value names no option. */
  placeholder?: string
  size?: SelectSize
  disabled?: boolean
  style?: Style
  testId?: string
}

function triggerStyles(theme: Theme) {
  return variants({
    base: {
      display: 'flex',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.colors.line2,
      backgroundColor: theme.colors.surface2,
      borderRadius: radius.lg,
      cursor: 'pointer',
      hover: { borderColor: theme.colors.primary },
    },
    variants: {
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
    defaults: { size: 'md' },
  })
}

export function Select<Value extends string>({
  value,
  options,
  onValueChange,
  label,
  placeholder = '',
  size = 'md',
  disabled = false,
  style,
  testId,
}: SelectProps<Value>) {
  const theme = useTheme()
  const behaviour = useSelect({ value, options, onValueChange, disabled })
  const dimmed = behaviour.inert
    ? { opacity: state.disabledOpacity, cursor: 'not-allowed' as const }
    : {}

  const menu: Style = {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.line2,
    borderRadius: radius.xl,
    boxShadow: theme.shadows.md,
    padding: space.sm,
  }

  return (
    <div onKeyDown={(event: EventPayload) => behaviour.onKeyDown(event)}>
      <Pressable
        onPress={behaviour.toggle}
        disabled={behaviour.inert}
        style={mergeStyle(triggerStyles(theme)({ size }), dimmed, style)}
        aria-label={label}
        {...(testId === undefined ? {} : { testId })}
      >
        <Stack gap="sm" align="center">
          <Text color={behaviour.selected === null ? 'dim' : 'text'} scale="md" weight="medium">
            {behaviour.selected?.label ?? placeholder}
          </Text>
          <Icon name="chevron-down" size="xs" color="muted" />
        </Stack>
      </Pressable>

      {behaviour.open ? (
        <Anchored
          side="bottom"
          align="start"
          style={menu}
          {...(testId === undefined ? {} : { testId: `${testId}-menu` })}
        >
          {options.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => behaviour.choose(option.value)}
              style={{
                display: 'flex',
                alignItems: 'center',
                height: row.height,
                paddingLeft: space.md,
                paddingRight: space.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: theme.colors.surface,
                hover: { backgroundColor: theme.colors.surface2 },
              }}
              testId={`${testId ?? 'select'}-option-${option.value}`}
            >
              <Text color={option.value === value ? 'primaryText' : 'text'} scale="md">
                {option.label}
              </Text>
            </Pressable>
          ))}
        </Anchored>
      ) : null}
    </div>
  )
}
