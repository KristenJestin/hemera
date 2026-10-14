import type { ReactNode } from 'react'

import { REPOSITORIES } from '../../shell/shell-cast.ts'
import { ProjectPage } from './project-page.tsx'
import { ProjectStartSlot } from './project-start-slot.tsx'
import { STAGE_GROUPS, PROJECT_CHATS, PROJECT_LIVING_SPEC } from './project-fixture-data.ts'

/** A Project's page as the window draws it: filled with Acme's missions, or empty. */
export function ProjectShellFixture({
  name,
  filled,
  onOpenMission,
}: {
  name: string
  filled: boolean
  onOpenMission: (key: string) => void
}): ReactNode {
  return (
    <ProjectPage
      name={name}
      repositories={REPOSITORIES}
      start={<ProjectStartSlot name={name} />}
      groups={filled ? STAGE_GROUPS : []}
      livingSpec={filled ? PROJECT_LIVING_SPEC : null}
      chats={filled ? PROJECT_CHATS : []}
      onOpenMission={onOpenMission}
      onOpenSettings={() => {}}
      onOpenLivingSpec={() => {}}
      onOpenChat={() => {}}
      onNewChat={() => {}}
      onRetry={() => {}}
    />
  )
}
