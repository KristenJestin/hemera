/** One entry of the journal: a dot, a badge, the text and the moment. */

import { mergeStyle } from '../../lib/style.ts'
import type { Style } from '../../lib/style.ts'
import { Box } from '../../primitives/box.tsx'
import { Stack } from '../../primitives/stack.tsx'
import { Text } from '../../primitives/text.tsx'
import { dot } from '../../tokens/components.ts'
import { radius, space } from '../../tokens/primitives.ts'
import type { ThemeColors } from '../../tokens/semantic.ts'
import { useTheme } from '../../theme/provider.tsx'
import { Badge } from '../badge/badge.tsx'
import type { BadgeMission } from '../badge/use-badge.ts'
import { useTimelineItem } from './use-timeline-item.ts'

export interface TimelineItemProps {
  message: string
  at: Date
  /** Clock the caller reads, so a test never depends on the real one. */
  now?: Date
  /** Mission the entry belongs to, when it belongs to one. */
  mission?: BadgeMission
  /** Role the leading dot is painted with. */
  dotColor?: keyof ThemeColors
  style?: Style
  testId?: string
}

export function TimelineItem({
  message,
  at,
  now,
  mission,
  dotColor = 'dim',
  style,
  testId,
}: TimelineItemProps) {
  const theme = useTheme()
  const behaviour = useTimelineItem({ at, now })

  return (
    <Stack
      gap="md"
      align="center"
      style={mergeStyle(
        {
          paddingTop: space.md,
          paddingBottom: space.md,
          borderBottomWidth: 1,
          borderColor: theme.colors.line,
        },
        style,
      )}
      {...(testId === undefined ? {} : { testId })}
    >
      <Box
        style={{
          width: dot.size,
          height: dot.size,
          borderRadius: radius.pill,
          backgroundColor: theme.colors[dotColor],
        }}
      />
      {mission === undefined ? null : <Badge kind="tag" mission={mission} label={mission} />}
      <Stack grow>
        <Text color="text" scale="md" truncate>
          {message}
        </Text>
      </Stack>
      <Text color="dim" scale="xs" family="mono">
        {behaviour.timestamp}
      </Text>
    </Stack>
  )
}
