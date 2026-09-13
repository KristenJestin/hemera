/** What a panel shows when it holds nothing yet. */

import { mergeStyle } from '../../lib/style.ts'
import type { Style } from '../../lib/style.ts'
import type { IconName } from '../../icons/catalog.ts'
import { Icon } from '../../primitives/icon.tsx'
import { Stack } from '../../primitives/stack.tsx'
import { Text } from '../../primitives/text.tsx'
import { space } from '../../tokens/primitives.ts'
import { Button } from '../button/button.tsx'
import { useEmptyState } from './use-empty-state.ts'

export interface EmptyStateProps {
  iconName: IconName
  title: string
  description: string
  /** Label of the way out, when the state offers one. */
  actionLabel?: string
  onAction?: (() => void) | undefined
  style?: Style
  testId?: string
}

export function EmptyState({
  iconName,
  title,
  description,
  actionLabel,
  onAction,
  style,
  testId,
}: EmptyStateProps) {
  const behaviour = useEmptyState({ onAction })

  return (
    <Stack
      direction="column"
      gap="lg"
      align="center"
      justify="center"
      style={mergeStyle({ paddingTop: space['3xl'], paddingBottom: space['3xl'] }, style)}
      {...(testId === undefined ? {} : { testId })}
    >
      <Icon name={iconName} size="lg" color="dim" />
      <Text color="text" scale="lg" weight="semibold">
        {title}
      </Text>
      <Text color="muted" scale="md">
        {description}
      </Text>
      {behaviour.hasAction && actionLabel !== undefined ? (
        <Button
          label={actionLabel}
          tone="primary"
          onPress={behaviour.act}
          {...(testId === undefined ? {} : { testId: `${testId}-action` })}
        />
      ) : null}
    </Stack>
  )
}
