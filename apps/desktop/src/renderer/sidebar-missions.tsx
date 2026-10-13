import { SidebarRow, SidebarStageGroup, type SidebarPlace } from '@hemera/ui'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

import { percentOf } from './building-model.ts'
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
  /** Building's percentage of each mission in Building, by its id, once read. */
  percents?: ReadonlyMap<string, number> | undefined
  current: SidebarPlace
  onOpenMission: (key: string) => void
}

/** The stages and their rows, as the sidebar draws them under an open Project. */
export function SidebarMissionList({
  lines,
  events,
  percents,
  current,
  onOpenMission,
}: SidebarMissionListProps): ReactNode {
  return sidebarGroupsOf(lines, events, percents).map((group) => (
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

/** What follows the percentages: the missions to follow, and the end of it. */
export interface PercentsFollowing {
  readonly follow: (missionIds: ReadonlyArray<string>) => void
  readonly stop: () => void
}

/** Follows the Building of each mission it is given, and hands on each one's percentage. */
export function followPercents(
  link: Pick<Link, 'onBuilding'>,
  onPercents: (percents: ReadonlyMap<string, number>) => void,
): PercentsFollowing {
  const followed = new Map<string, () => void>()
  let percents: ReadonlyMap<string, number> = new Map()
  const told = (next: ReadonlyMap<string, number>): void => {
    percents = next
    onPercents(next)
  }
  return {
    follow: (missionIds) => {
      for (const [id, stop] of followed) {
        if (missionIds.includes(id)) continue
        stop()
        followed.delete(id)
        told(new Map([...percents].filter(([one]) => one !== id)))
      }
      for (const id of missionIds) {
        if (followed.has(id)) continue
        followed.set(
          id,
          link.onBuilding(
            id,
            (building) => {
              if (building !== null) told(new Map([...percents, [id, percentOf(building)]]))
            },
            // Without it, the row says no percentage.
            () => undefined,
          ),
        )
      }
    },
    stop: () => {
      for (const stop of followed.values()) stop()
      followed.clear()
    },
  }
}

/** Building's percentage of each mission in Building among those listed, as it moves. */
function usePercents(
  link: Link,
  engineReady: boolean,
  missionIds: ReadonlyArray<string>,
): ReadonlyMap<string, number> {
  const [percents, setPercents] = useState<ReadonlyMap<string, number>>(new Map())
  const key = missionIds.join(' ')
  useEffect(() => {
    if (!engineReady || key === '') return undefined
    const following = followPercents(link, setPercents)
    following.follow(key.split(' '))
    return () => following.stop()
  }, [link, engineReady, key])
  return percents
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
  const building = useMemo(
    () => missions.filter((mission) => mission.stage === 'building').map((mission) => mission.id),
    [missions],
  )
  const percents = usePercents(link, engineReady, building)
  if (state.kind !== 'ready') return null
  return (
    <SidebarMissionList
      lines={lines}
      events={events}
      percents={percents}
      current={current}
      onOpenMission={onOpenMission}
    />
  )
}
