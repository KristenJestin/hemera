import { SidebarRow, SidebarStageGroup, type SidebarPlace } from '@hemera/ui'
import { type ReactNode, useMemo } from 'react'

import type { Link } from './link.ts'
import { lineOf, type MissionLine } from './missions.ts'
import { sidebarGroupsOf } from './project-lines.ts'
import { useLastEvents } from './project-route.tsx'
import { useMissions } from './use-missions.ts'

export interface SidebarMissionsProps {
  link: Link
  engineReady: boolean
  projectId: string
  current: SidebarPlace
  onOpenMission: (key: string) => void
}

export interface SidebarMissionListProps {
  lines: readonly MissionLine[]
  events: ReadonlyMap<string, string>
  current: SidebarPlace
  onOpenMission: (key: string) => void
}

/** The stages and their rows, as the sidebar draws them under an open Project. */
export function SidebarMissionList({
  lines,
  events,
  current,
  onOpenMission,
}: SidebarMissionListProps): ReactNode {
  return sidebarGroupsOf(lines, events).map((group) => (
    <SidebarStageGroup
      key={group.stage}
      stage={group.stage}
      count={group.count}
      folded={group.folded}
    >
      {group.rows.map((row) => (
        <SidebarRow
          key={row.missionKey}
          {...row}
          current={current.kind === 'mission' && current.key === row.missionKey}
          onPress={() => onOpenMission(row.missionKey)}
        />
      ))}
    </SidebarStageGroup>
  ))
}

/** The missions listed under an open Project in the sidebar, by stage; none until they are read. */
export function SidebarMissions({
  link,
  engineReady,
  projectId,
  current,
  onOpenMission,
}: SidebarMissionsProps): ReactNode {
  const state = useMissions(link, engineReady, projectId)
  const missions = state.kind === 'ready' ? state.missions : []
  const events = useLastEvents(link, engineReady, missions)
  // Marks are not drawn here, so a repository is named by its id.
  const lines = useMemo(() => missions.map((mission) => lineOf(mission, (id) => id)), [missions])
  if (state.kind !== 'ready') return null
  return (
    <SidebarMissionList
      lines={lines}
      events={events}
      current={current}
      onOpenMission={onOpenMission}
    />
  )
}
