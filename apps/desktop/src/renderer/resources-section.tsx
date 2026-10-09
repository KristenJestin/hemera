import type { Command } from '@hemera/ipc'
import type { SettingsForm } from '@hemera/ui'
import type { ReactNode } from 'react'

import type { Link } from './link.ts'

export interface ResourcesPartProps {
  link: Link
  engineReady: boolean
  projectId: string
  catalogue: ReadonlyArray<Command>
  show: (form: SettingsForm | null) => void
}

/** The exclusive resources of a Project, in its settings: drawn once they are built. */
export function ResourcesPart(_props: ResourcesPartProps): ReactNode {
  return null
}
