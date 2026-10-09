import type { ReactNode } from 'react'

import type { NeedRow } from '../../blocks/need/needs-you-list.tsx'
import { LONG_TITLE, MISSION } from '../../shell/shell-cast.ts'
import type { SidebarProject } from '../../shell/sidebar.tsx'
import {
  HomePage,
  type HomeQuestionRow,
  type HomeRecentRow,
  type HomeSinceGroup,
} from './home-page.tsx'

/** What waits across the Projects: the application's own first, then Acme's. */
export const HOME_NEEDS: readonly NeedRow[] = [
  {
    id: 'git',
    project: 'Hemera',
    need: {
      title: 'Git is not on the PATH',
      text: 'Install Git, then Retry.',
      when: '2 h',
      ask: { kind: 'environment' },
    },
  },
  {
    id: 'table',
    project: 'Acme',
    need: {
      title: 'Which table holds the invoices?',
      missionKey: 'ACME-14',
      when: '12 min',
      role: 'planner',
      ask: {
        kind: 'decision',
        options: [
          { label: 'invoices', recommended: 'the api already reads it' },
          { label: 'billing_invoices' },
        ],
      },
    },
  },
]

/** The morning after a night with failures and finishes: two questions, five missions that moved. */
export const HOME_ROWS: {
  questions: HomeQuestionRow[]
  since: HomeSinceGroup[]
  recent: HomeRecentRow[]
} = {
  questions: [
    {
      id: 'q1',
      missionId: 'm14',
      project: 'Acme',
      missionKey: 'ACME-14',
      title: 'Who may read the audit log?',
      when: 'yesterday',
      proposed: 'Admins only',
    },
    {
      id: 'q2',
      missionId: 'm14',
      project: 'Acme',
      missionKey: 'ACME-14',
      title: 'How long is the log kept?',
      when: 'yesterday',
    },
  ],
  since: [
    {
      id: 'm12',
      missionId: 'm12',
      project: 'Acme',
      missionKey: 'ACME-12',
      title: 'Export invoices as CSV from the billing page',
      ball: 'you',
      events: [
        { id: 'e1', tone: 'done', text: 'Round 1 addressed: 4 points', when: '23:51' },
        {
          id: 'e2',
          tone: 'ticket',
          text: 'acme/shop#41: a teammate answered on the ticket',
          when: '07:12',
        },
      ],
    },
    {
      id: 'm15',
      missionId: 'm15',
      project: 'Acme',
      missionKey: 'ACME-15',
      title: 'Retry a failed webhook from its row',
      ball: 'agent',
      events: [
        {
          id: 'e3',
          tone: 'failed',
          text: 'T3 failed: the retry test times out in api',
          when: '02:14',
        },
        { id: 'e4', tone: 'done', text: 'T3 fixed and green on the second try', when: '02:40' },
      ],
    },
    {
      id: 'm58',
      missionId: 'm58',
      project: 'Hemera',
      missionKey: 'HEM-58',
      title: 'Probe worktrees survive a restart',
      ball: 'blocked',
      events: [
        { id: 'e5', tone: 'failed', text: 'Checks failed after the merge: 2 tests', when: '01:03' },
      ],
    },
    {
      id: 'm16',
      missionId: 'm16',
      project: 'Acme',
      missionKey: 'ACME-16',
      title: 'Labels in French and English',
      ball: 'idle',
      events: [
        { id: 'e6', tone: 'lifted', text: 'No longer blocked: ACME-9 shipped', when: '00:22' },
      ],
    },
    {
      id: 'm9',
      missionId: 'm9',
      project: 'Acme',
      missionKey: 'ACME-9',
      title: 'Export the movements',
      ball: 'idle',
      events: [{ id: 'e7', tone: 'done', text: 'Shipped: api and web merged', when: '23:10' }],
    },
  ],
  recent: [
    {
      id: 'm12',
      project: 'Acme',
      missionKey: 'ACME-12',
      title: MISSION.title,
      when: '09:02',
      ball: 'you',
      event: 'Round 1 addressed: 4 points, checks green',
      marks: [{ kind: 'needsYou' }, { kind: 'outside', repository: 'web' }],
    },
    {
      id: 'm15',
      project: 'Acme',
      missionKey: 'ACME-15',
      title: 'Retry a failed webhook from its row',
      when: '08:31',
      ball: 'agent',
      event: 'T3 done in api, T4 started in web',
      percent: 60,
    },
    {
      id: 'm14',
      project: 'Acme',
      missionKey: 'ACME-14',
      title: 'An audit log of who read what',
      when: 'yesterday',
      ball: 'you',
      event: 'Two questions wait for you',
    },
  ],
}

/** Many groups, every title and event long: the page scrolls and no card grows. */
export function denseSince(count: number): HomeSinceGroup[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `d${String(index)}`,
    missionId: `d${String(index)}`,
    project: index % 3 === 0 ? 'Hemera' : 'Acme',
    missionKey: `ACME-${String(100 + index)}`,
    title: `${LONG_TITLE} (${String(index + 1)})`,
    ball: 'agent',
    events: [
      {
        id: `d${String(index)}-a`,
        tone: index % 4 === 0 ? 'failed' : 'done',
        text: `The agent wrote the tests of the export of every invoice of every customer at once (${String(index + 1)})`,
        when: `${String(8 + (index % 10))}:${String(10 + index).padStart(2, '0')}`,
      },
    ],
  }))
}

/** Rows many and long, in the shape Recent and Questions share. */
export function denseRows(count: number): HomeRecentRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `r${String(index)}`,
    project: index % 3 === 0 ? 'Hemera' : 'Acme',
    missionKey: `ACME-${String(100 + index)}`,
    title: `${LONG_TITLE} (${String(index + 1)})`,
    when: `${String(8 + (index % 10))}:${String(10 + index).padStart(2, '0')}`,
    ball: 'agent',
    event: 'The agent wrote the tests of the export of every invoice of every customer at once',
  }))
}

const noNeed = () => ({})

/** Home as the window draws it, on the fixtures' cast: for the shell's stories. */
export function HomeShellFixture({
  projects,
  loading,
  error,
  dense,
  onOpen,
}: {
  projects: readonly SidebarProject[]
  loading: boolean
  error: string | undefined
  dense: boolean
  onOpen: () => void
}): ReactNode {
  const filled = projects.length > 0
  return (
    <HomePage
      today="Saturday 4 October"
      hasProjects={filled || loading}
      needs={{ rows: filled ? HOME_NEEDS : [], projects: ['Acme', 'Hemera'], on: noNeed }}
      questions={dense ? denseRows(6).map(questionOf) : filled ? HOME_ROWS.questions : []}
      since={{
        groups: dense ? denseSince(14) : filled ? HOME_ROWS.since : [],
        more: dense,
        loadingMore: false,
        onMore: () => {},
      }}
      recent={dense ? denseRows(8) : filled ? HOME_ROWS.recent : []}
      loading={loading}
      error={error}
      onOpen={() => onOpen()}
      onAddProject={() => {}}
      onRetry={() => {}}
    />
  )
}

function questionOf(row: HomeRecentRow): HomeQuestionRow {
  return {
    id: row.id,
    missionId: row.id,
    project: row.project,
    missionKey: row.missionKey,
    title: row.title,
    when: row.when,
  }
}
