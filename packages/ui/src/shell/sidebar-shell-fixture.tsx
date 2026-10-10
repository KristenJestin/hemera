import type { ReactNode } from 'react'

import type { Ball } from '../blocks/ball/ball-mark.tsx'
import { type MissionStage, STAGE_ORDER } from '../blocks/mission/vocabulary.ts'
import { CHATS, LONG_TITLE, MISSION } from './shell-cast.ts'
import { SidebarChatRow, type SidebarPlace, SidebarRow, SidebarStageGroup } from './sidebar.tsx'

/** A mission of Acme as the sidebar lists it. */
export interface SidebarMissionEntry {
  missionKey: string
  title: string
  stage: MissionStage
  ball: Ball
  event?: string | undefined
  needsYou: boolean
  percent?: number | undefined
}

/** Acme's missions: one in most stages, one that needs the user, and two that are over. */
export const SIDEBAR_MISSIONS: readonly SidebarMissionEntry[] = [
  {
    missionKey: 'ACME-12',
    title: MISSION.title,
    stage: 'Review',
    ball: 'you',
    event: 'Round 1 addressed: 4 points',
    needsYou: true,
  },
  {
    missionKey: 'ACME-15',
    title: 'Retry a failed webhook from its row',
    stage: 'Building',
    ball: 'agent',
    event: 'T3 done in api, T4 started in web',
    needsYou: false,
    percent: 60,
  },
  {
    missionKey: 'ACME-14',
    title: 'An audit log of who read what',
    stage: 'Planning',
    ball: 'you',
    event: 'Two questions wait for you',
    needsYou: true,
  },
  {
    missionKey: 'ACME-9',
    title: 'Export the movements',
    stage: 'Done',
    ball: 'idle',
    event: 'Shipped',
    needsYou: false,
  },
  {
    missionKey: 'ACME-8',
    title: 'Sort invoices by due date',
    stage: 'Done',
    ball: 'idle',
    event: 'Shipped',
    needsYou: false,
  },
  {
    missionKey: 'ACME-6',
    title: 'Dark mode for the invoices',
    stage: 'Cancelled',
    ball: 'idle',
    event: 'Cancelled',
    needsYou: false,
  },
]

/** Missions under a Project, by stage in the stages' order, the empty stages left out. */
export function SidebarMissionGroups({
  missions,
  current,
  onMission,
}: {
  missions: readonly SidebarMissionEntry[]
  current: SidebarPlace
  onMission: (key: string) => void
}): ReactNode {
  return STAGE_ORDER.map((stage) => {
    const inStage = missions.filter((mission) => mission.stage === stage)
    if (inStage.length === 0) return null
    return (
      <SidebarStageGroup
        key={stage}
        stage={stage}
        count={inStage.length}
        folded={stage === 'Done' || stage === 'Cancelled'}
      >
        {inStage.map((mission) => (
          <SidebarRow
            key={mission.missionKey}
            missionKey={mission.missionKey}
            title={mission.title}
            ball={mission.ball}
            event={mission.event}
            needsYou={mission.needsYou}
            percent={mission.percent}
            current={current.kind === 'mission' && current.key === mission.missionKey}
            onPress={() => onMission(mission.missionKey)}
          />
        ))}
      </SidebarStageGroup>
    )
  })
}

/** The rows under Acme in the sidebar: its missions by stage and, when asked, its Chats. */
export function SidebarMissionsFixture({
  current,
  dense,
  withChats,
  onMission,
  onChat,
}: {
  current: SidebarPlace
  dense: boolean
  withChats: boolean
  onMission: (key: string) => void
  onChat: (id: string) => void
}): ReactNode {
  const missions = dense
    ? SIDEBAR_MISSIONS.map((mission) =>
        mission.missionKey === MISSION.key ? { ...mission, title: LONG_TITLE } : mission,
      )
    : SIDEBAR_MISSIONS
  return (
    <>
      <SidebarMissionGroups missions={missions} current={current} onMission={onMission} />
      {withChats &&
        CHATS.map((chat) => (
          <SidebarChatRow
            key={chat.id}
            id={chat.id}
            title={chat.title}
            current={current.kind === 'chat' && current.id === chat.id}
            onPress={() => onChat(chat.id)}
          />
        ))}
    </>
  )
}
