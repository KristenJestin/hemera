/** A small count, status or mission marker. */

import { mergeStyle } from '../../lib/style.ts'
import type { Style } from '../../lib/style.ts'
import { Box } from '../../primitives/box.tsx'
import { Text } from '../../primitives/text.tsx'
import { badge } from '../../tokens/components.ts'
import { radius, space } from '../../tokens/primitives.ts'
import type { Theme, ThemeColors } from '../../tokens/semantic.ts'
import { useTheme } from '../../theme/provider.tsx'
import { useBadge } from './use-badge.ts'
import type { BadgeMission, BadgeStatus, UseBadgeOptions } from './use-badge.ts'

export type BadgeProps = UseBadgeOptions & {
  style?: Style
  testId?: string
}

const STATUS_ROLES: Record<BadgeStatus, { fill: keyof ThemeColors; text: keyof ThemeColors }> = {
  ok: { fill: 'okSoft', text: 'ok' },
  warn: { fill: 'warnSoft', text: 'warn' },
  bad: { fill: 'badSoft', text: 'bad' },
  info: { fill: 'infoSoft', text: 'info' },
}

const MISSION_ROLES: Record<BadgeMission, { fill: keyof ThemeColors; text: keyof ThemeColors }> = {
  define: { fill: 'missionDefineSoft', text: 'missionDefine' },
  build: { fill: 'missionBuildSoft', text: 'missionBuild' },
  free: { fill: 'missionFreeSoft', text: 'missionFree' },
}

function rolesOf(props: BadgeProps): { fill: keyof ThemeColors; text: keyof ThemeColors } {
  if (props.kind === 'status') return STATUS_ROLES[props.status]
  if (props.kind === 'tag') return MISSION_ROLES[props.mission]
  return { fill: 'bad', text: 'onPrimary' }
}

function surfaceOf(theme: Theme, roles: { fill: keyof ThemeColors }, count: boolean): Style {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors[roles.fill],
    borderRadius: radius.pill,
    height: count ? badge.height.count : badge.height.label,
    minWidth: badge.minWidth,
    paddingLeft: space.sm,
    paddingRight: space.sm,
  }
}

export function Badge(props: BadgeProps) {
  const theme = useTheme()
  const behaviour = useBadge(props)
  const roles = rolesOf(props)
  const weight = props.kind === 'count' ? 'bold' : 'semibold'

  return (
    <Box
      style={mergeStyle(surfaceOf(theme, roles, props.kind === 'count'), props.style)}
      {...(props.testId === undefined ? {} : { testId: props.testId })}
    >
      <Text color={roles.text} scale="xs" weight={weight}>
        {behaviour.text}
      </Text>
    </Box>
  )
}
