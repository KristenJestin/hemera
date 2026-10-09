import { Page, PageHeader, ProjectMark } from '@hemera/ui'
import type { ReactNode } from 'react'

import type { Link } from './link.ts'

export interface LivingSpecRouteProps {
  link: Link
  engineReady: boolean
  projectId: string
  projectName: string
  actions: {
    /** Opens the mission that wrote a requirement, at its Spec. */
    openOrigin: (missionKey: string) => void
    /** Opens the Project's settings at the models by role. */
    openModels: () => void
  }
}

/** A Project's living spec: the page and its title, until its domains are drawn. */
export function LivingSpecRoute({ projectName }: LivingSpecRouteProps): ReactNode {
  return (
    <Page>
      <PageHeader lead={<ProjectMark name={projectName} />} title="Living spec" />
    </Page>
  )
}
