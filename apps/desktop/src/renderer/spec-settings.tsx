import type { Project } from '@hemera/ipc'
import type { ReactNode } from 'react'

import type { Link } from './link.ts'

export interface SpecSettingsPartProps {
  link: Link
  engineReady: boolean
  projectId: string
  project: Project | null
}

/** The Spec settings of a Project (mode, language, sync, key prefix): drawn once they are built. */
export function SpecSettingsPart(_props: SpecSettingsPartProps): ReactNode {
  return null
}
