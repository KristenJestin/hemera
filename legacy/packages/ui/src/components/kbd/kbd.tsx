/** A keyboard hint: one key, or a combination written with `+`. */

import { mergeStyle, withoutUndefined } from '#lib/style.ts'
import type { Style } from '#lib/style.ts'
import { Stack } from '#primitives/stack.tsx'
import { Text } from '#primitives/text.tsx'
import { radius, space } from '#tokens/primitives.ts'
import { useTheme } from '#theme/provider.tsx'
import { useKbd } from './use-kbd.ts'

export interface KbdProps {
  /** A key, or a combination such as `shift+tab`. */
  combination: string
  style?: Style
  testId?: string
}

export function Kbd({ combination, style, testId }: KbdProps) {
  const theme = useTheme()
  const behaviour = useKbd({ combination })
  const key: Style = {
    borderWidth: 1,
    borderColor: theme.colors.line2,
    borderRadius: radius.sm,
    backgroundColor: theme.colors.surface,
    paddingLeft: space.xs,
    paddingRight: space.xs,
  }

  return (
    <Stack gap="2xs" align="center" {...withoutUndefined({ testId, style })}>
      {behaviour.keys.map((name) => (
        <Text key={name} color="muted" scale="xs" family="mono" style={mergeStyle(key)}>
          {name}
        </Text>
      ))}
    </Stack>
  )
}
