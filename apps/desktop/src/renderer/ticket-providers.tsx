import type { Project } from '@hemera/ipc'
import type { SettingsForm } from '@hemera/ui'
import type { ReactNode } from 'react'

import type { Link } from './link.ts'

export interface ProvidersPartProps {
  link: Link
  engineReady: boolean
  projectId: string
  project: Project | null
  show: (form: SettingsForm | null) => void
  copy: (text: string) => void
}

/** The ticket providers of a Project, in its settings: drawn once they are built. */
export function ProvidersPart(_props: ProvidersPartProps): ReactNode {
  return null
}

/**
 * What is wrong with a Project's ticket providers, in a sentence, for the section's glyph in the
 * settings list; undefined when nothing is.
 */
export function useTicketProblem(
  _link: Link,
  _engineReady: boolean,
  _projectId: string | null,
): string | undefined {
  return undefined
}
