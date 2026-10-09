import type { MissionFrameState, AppSection } from '@hemera/ui'
import type { ReactNode } from 'react'

import type { Link } from './link.ts'
import type { ShellActions } from './shell.tsx'

export interface MissionRouteProps {
  link: Link
  engineReady: boolean
  projectId: string
  missionKey: string
  now: Date
  /** The base and the views over it, kept per mission by the navigation. */
  frame: MissionFrameState
  actions: {
    open: (view: string) => void
    show: (view: string | null) => void
    close: (view: string) => void
    goProject: () => void
    answer: ShellActions['answer']
    recheck: ShellActions['recheck']
    openSettings: (section: AppSection) => void
  }
}

/** A mission's page: its frame and its views, once they are built. */
export function MissionRoute(_props: MissionRouteProps): ReactNode {
  return null
}
