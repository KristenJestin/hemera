import type { SidebarPlace } from '@hemera/ui'
import type { ReactNode } from 'react'

import type { Link } from './link.ts'

export interface SidebarMissionsProps {
  link: Link
  engineReady: boolean
  projectId: string
  current: SidebarPlace
  onOpenMission: (key: string) => void
}

/** The missions listed under an open Project in the sidebar, once they are built. */
export function SidebarMissions(_props: SidebarMissionsProps): ReactNode {
  return null
}
