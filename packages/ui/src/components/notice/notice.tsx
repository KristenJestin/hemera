/** An inline notice carrying one tone. */

import { mergeStyle } from '../../lib/style.ts'
import type { Style } from '../../lib/style.ts'
import { Box } from '../../primitives/box.tsx'
import { Icon } from '../../primitives/icon.tsx'
import { Stack } from '../../primitives/stack.tsx'
import { Text } from '../../primitives/text.tsx'
import { radius, space } from '../../tokens/primitives.ts'
import type { ThemeColors } from '../../tokens/semantic.ts'
import { useTheme } from '../../theme/provider.tsx'
import { useNotice } from './use-notice.ts'
import type { NoticeTone } from './use-notice.ts'

export interface NoticeProps {
  tone: NoticeTone
  message: string
  style?: Style
  testId?: string
}

const ROLES: Record<NoticeTone, { fill: keyof ThemeColors; text: keyof ThemeColors }> = {
  info: { fill: 'infoSoft', text: 'info' },
  warn: { fill: 'warnSoft', text: 'warn' },
  error: { fill: 'badSoft', text: 'bad' },
  success: { fill: 'okSoft', text: 'ok' },
}

export function Notice({ tone, message, style, testId }: NoticeProps) {
  const theme = useTheme()
  const behaviour = useNotice({ tone })
  const roles = ROLES[behaviour.tone]

  const surface: Style = {
    display: 'flex',
    backgroundColor: theme.colors[roles.fill],
    borderRadius: radius.xl,
    paddingLeft: space.lg,
    paddingRight: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
  }

  return (
    <Box style={mergeStyle(surface, style)} {...(testId === undefined ? {} : { testId })}>
      <Stack gap="md" align="center">
        <Icon name={behaviour.iconName} size="sm" color={roles.text} />
        <Text color={roles.text} scale="sm">
          {message}
        </Text>
      </Stack>
    </Box>
  )
}
