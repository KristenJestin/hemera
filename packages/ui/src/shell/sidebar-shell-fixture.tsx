import type { ReactNode } from 'react'

import { STAGE_ORDER } from '../blocks/mission/vocabulary.ts'
import { CHATS, LONG_TITLE, MISSION } from './shell-cast.ts'
import { SidebarChatRow, type SidebarPlace, SidebarRow, SidebarStageGroup } from './sidebar.tsx'
import { type SidebarMissionEntry, SIDEBAR_MISSIONS } from './sidebar-missions.ts'

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
