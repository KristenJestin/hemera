import type { ReactNode } from 'react'

import { REPOSITORIES } from '../../shell/shell-cast.ts'
import {
  ProjectPage,
  type ProjectChat,
  type ProjectLivingSpec,
  type ProjectMissionRow,
  type ProjectStageGroup,
} from './project-page.tsx'
import { ProjectStartSlot } from './project-start-slot.tsx'

const LONG_TITLE =
  'Export invoices as CSV from the billing page, with the customer filters kept and a progress for the long ones'

/** The missions done in Acme, folded away at the end of its page. */
export const DONE_GROUP: ProjectStageGroup = {
  stage: 'Done',
  rows: [
    ['ACME-9', 'Export the movements', 'yesterday'],
    ['ACME-8', 'Sort invoices by due date', 'Monday'],
    ['ACME-7', 'A filter on the customer', 'Monday'],
    ['ACME-5', 'Rename the billing tab', 'last week'],
  ].map(([missionKey = '', title = '', when = '']) => ({
    missionKey,
    title,
    when,
    ball: 'idle' as const,
    event: 'Shipped',
  })),
}

/** One mission per stage, and every mark at least once. */
export const STAGE_GROUPS: readonly ProjectStageGroup[] = [
  {
    stage: 'Shipping',
    rows: [
      {
        missionKey: 'ACME-18',
        title: 'Release the invoices export to every customer',
        when: '08:31',
        ball: 'someone',
        event: 'Pull request opened in api and web',
        marks: [{ kind: 'waiting', on: 'CI on acme/shop#52' }],
      },
    ],
  },
  {
    stage: 'Review',
    rows: [
      {
        missionKey: 'ACME-12',
        title: 'Export invoices as CSV from the billing page',
        when: '08:58',
        ball: 'you',
        event: 'Round 1 addressed: 4 points, checks green',
        marks: [{ kind: 'needsYou' }, { kind: 'outside', repository: 'web' }, { kind: 'fixing' }],
      },
    ],
  },
  {
    stage: 'Building',
    rows: [
      {
        missionKey: 'ACME-15',
        title: 'Retry a failed webhook from its row',
        when: '09:02',
        ball: 'agent',
        event: 'T3 done in api, T4 started in web',
        percent: 60,
      },
      {
        missionKey: 'ACME-17',
        title: 'Move the invoice numbers to the shared sequence',
        when: '07:44',
        ball: 'blocked',
        event: 'Waiting for the shared database',
        percent: 20,
        marks: [{ kind: 'blocked', cause: 'shared database · ACME-15' }],
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
        ball: 'you',
        event: 'Two questions wait for you',
        marks: [{ kind: 'needsYou' }],
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
        event: 'Frozen, waits for ACME-9 to ship',
        marks: [{ kind: 'blocked', cause: 'ACME-9' }],
      },
      {
        missionKey: 'ACME-19',
        title: 'Paginate the customer list',
        when: 'Monday',
        ball: 'idle',
        event: 'The ticket changed after the freeze',
        marks: [{ kind: 'outdated' }],
      },
    ],
  },
  DONE_GROUP,
]

/** A mission cancelled, to be found in the group folded at the very end. */
export const CANCELLED_GROUP: ProjectStageGroup = {
  stage: 'Cancelled',
  rows: [
    {
      missionKey: 'ACME-6',
      title: 'Dark mode for the invoices',
      when: 'last week',
      ball: 'idle',
      event: 'Cancelled',
    },
  ],
}

/** Acme's Chats, as the rail lists them. */
export const PROJECT_CHATS: readonly ProjectChat[] = [
  { id: 'invoices', title: 'Invoices export', when: '08:20' },
  { id: 'release', title: 'Release notes for 2.4', when: 'yesterday' },
]

/** Acme's living spec: three domains, one of them waiting for the user. */
export const PROJECT_LIVING_SPEC: ProjectLivingSpec = {
  domains: [
    { id: 'billing', name: 'Billing', waiting: true },
    { id: 'customers', name: 'Customers', waiting: false },
    { id: 'exports', name: 'Exports', waiting: false },
  ],
  about: '3 domains · updated yesterday',
}

const STAGES_LIVED = ['Shipping', 'Review', 'Building', 'Planning', 'Ready'] as const

const BALLS = ['agent', 'you', 'someone', 'blocked', 'idle'] as const

/** Thirty missions across the stages, every title and event long. */
export function manyGroups(): readonly ProjectStageGroup[] {
  return STAGES_LIVED.map((stage, at) => ({
    stage,
    rows: Array.from({ length: 6 }, (_, index): ProjectMissionRow => ({
      missionKey: `ACME-${String(100 + at * 6 + index)}`,
      title: `${LONG_TITLE} (${String(at * 6 + index + 1)})`,
      when: `${String(8 + index)}:${String(10 + at)}`,
      ball: BALLS[(at + index) % BALLS.length] ?? 'idle',
      event: 'The agent wrote the tests of the export of every invoice of every customer at once',
      marks: index % 3 === 0 ? [{ kind: 'outdated' }, { kind: 'outside', repository: 'web' }] : [],
    })),
  }))
}

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
