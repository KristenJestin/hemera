/** A framed group: a header carrying a title, a counter and one action, then its body. */

import type { ReactNode } from 'react'

import { mergeStyle } from '../../lib/style.ts'
import type { Style } from '../../lib/style.ts'
import { Box } from '../../primitives/box.tsx'
import { Pressable } from '../../primitives/pressable.tsx'
import { Stack } from '../../primitives/stack.tsx'
import { Text } from '../../primitives/text.tsx'
import { radius, space } from '../../tokens/primitives.ts'
import { useTheme } from '../../theme/provider.tsx'
import { Badge } from '../badge/badge.tsx'
import { Separator } from '../separator/separator.tsx'
import { useCard } from './use-card.ts'

export interface CardProps {
  title: string
  /** Number the header announces, when there is one. */
  count?: number
  /** Label of the header action, when the card offers one. */
  actionLabel?: string
  onAction?: (() => void) | undefined
  children?: ReactNode
  style?: Style
  testId?: string
}

export function Card({ title, count, actionLabel, onAction, children, style, testId }: CardProps) {
  const theme = useTheme()
  const behaviour = useCard({ onAction })

  const surface: Style = {
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: radius['2xl'],
    boxShadow: theme.shadows.sm,
  }

  return (
    <Box style={mergeStyle(surface, style)} {...(testId === undefined ? {} : { testId })}>
      <Stack
        gap="md"
        align="center"
        justify="between"
        style={{
          paddingLeft: space.xl,
          paddingRight: space.xl,
          paddingTop: space.lg,
          paddingBottom: space.lg,
        }}
      >
        <Stack gap="md" align="center">
          <Text color="text" scale="lg" weight="semibold">
            {title}
          </Text>
          {count === undefined ? null : <Badge kind="count" count={count} />}
        </Stack>
        {behaviour.hasAction && actionLabel !== undefined ? (
          <Pressable
            onPress={behaviour.act}
            aria-label={actionLabel}
            {...(testId === undefined ? {} : { testId: `${testId}-action` })}
            style={{
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: 'transparent',
              cursor: 'pointer',
            }}
          >
            <Text color="primaryText" scale="sm" weight="medium">
              {actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </Stack>
      <Separator />
      <Box style={{ display: 'flex', flexDirection: 'column', padding: space.xl }}>{children}</Box>
    </Box>
  )
}
