import type { ReactNode } from 'react'

import { MISSION, REPOSITORIES } from '../../shell/shell-cast.ts'
import { ProjectPage, type ProjectStageGroup } from './project-page.tsx'

/** The missions done in Acme, folded away at the end of its page. */
export const DONE_GROUP: ProjectStageGroup = {
  stage: 'Done',
  fold: 'folded',
  rows: [
    { missionKey: 'ACME-9', title: 'Export the movements', when: 'yesterday', ball: 'idle' },
    { missionKey: 'ACME-8', title: 'Sort invoices by due date', when: 'Monday', ball: 'idle' },
    { missionKey: 'ACME-7', title: 'A filter on the customer', when: 'Monday', ball: 'idle' },
    { missionKey: 'ACME-5', title: 'Rename the billing tab', when: 'last week', ball: 'idle' },
  ],
}

export const STAGE_GROUPS: readonly ProjectStageGroup[] = [
  {
    stage: 'Review',
    rows: [{ missionKey: 'ACME-12', title: MISSION.title, when: '09:02', ball: 'you' }],
  },
  {
    stage: 'Building',
    rows: [
      {
        missionKey: 'ACME-15',
        title: 'Retry a failed webhook from its row',
        when: '08:40',
        ball: 'agent',
      },
    ],
  },
  {
    stage: 'Planning',
    rows: [
      {
        missionKey: 'ACME-14',
        title: 'An audit log of who read what',
        when: 'yesterday',
        ball: 'someone',
      },
    ],
  },
  {
    stage: 'Ready',
    rows: [
      {
        missionKey: 'ACME-16',
        title: 'Labels in French and English',
        when: 'yesterday',
        ball: 'blocked',
      },
    ],
  },
  DONE_GROUP,
]

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
      groups={filled ? STAGE_GROUPS : []}
      onStart={() => {}}
      onOpenMission={onOpenMission}
      onOpenSettings={() => {}}
      onRetry={() => {}}
    />
  )
}
