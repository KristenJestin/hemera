import type { ReactNode } from 'react'

import { BallMark } from '../blocks/ball/ball-mark.tsx'
import { CHATS, LONG_TITLE, MISSION } from './shell-cast.ts'
import { SidebarChatRow, type SidebarPlace, SidebarRow } from './sidebar.tsx'

/** The rows under Acme in the sidebar: two missions and, when asked, its Chats. */
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
  return (
    <>
      <SidebarRow
        missionKey="ACME-12"
        title={dense ? LONG_TITLE : MISSION.title}
        trailing={<BallMark ball="you" />}
        current={current.kind === 'mission' && current.key === 'ACME-12'}
        onPress={() => onMission('ACME-12')}
      />
      <SidebarRow
        missionKey="ACME-15"
        title="Retry a failed webhook from its row"
        trailing={<BallMark ball="agent" />}
        current={current.kind === 'mission' && current.key === 'ACME-15'}
        onPress={() => onMission('ACME-15')}
      />
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
