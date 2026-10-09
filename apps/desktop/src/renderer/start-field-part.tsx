import type { ReactNode } from 'react'

import type { Link } from './link.ts'

export interface StartFieldPartProps {
  link: Link
  engineReady: boolean
  projectId: string
  projectName: string
  onOpenMission: (key: string) => void
  onOpenChat: () => void
}

/** The Project page's field that starts a mission: drawn by its own part once it is built. */
export function StartFieldPart(_props: StartFieldPartProps): ReactNode {
  return null
}
