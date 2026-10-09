import type { ReactNode } from 'react'

import type { Ball } from '../../blocks/ball/ball-mark.tsx'
import { LONG_TITLE, MISSION } from '../../shell/shell-cast.ts'
import type { SidebarProject } from '../../shell/sidebar.tsx'
import { HomePage, type HomeRow } from './home-page.tsx'

export const HOME_ROWS: Record<'needsYou' | 'questions' | 'sinceYouLeft' | 'recent', HomeRow[]> = {
  needsYou: [
    {
      id: 'n1',
      project: 'Acme',
      missionKey: 'ACME-12',
      title: 'Run the migration on the shared database',
      when: '08:56',
      ball: 'you',
    },
    {
      id: 'n2',
      project: 'Hemera',
      missionKey: 'HEM-58',
      title: 'A comment on the pull request waits for an answer',
      when: '08:47',
      ball: 'you',
    },
  ],
  questions: [
    {
      id: 'q1',
      project: 'Acme',
      missionKey: 'ACME-14',
      title: 'Who may read the audit log?',
      when: '08:41',
      ball: 'you',
    },
  ],
  sinceYouLeft: [
    {
      id: 's1',
      project: 'Acme',
      missionKey: 'ACME-12',
      title: 'Checks green after the second round',
      when: '08:58',
      ball: 'agent',
    },
    {
      id: 's2',
      project: 'Acme',
      missionKey: 'ACME-9',
      title: 'Shipped: the export of movements',
      when: 'yesterday',
      ball: 'idle',
    },
  ],
  recent: [
    {
      id: 'r1',
      project: 'Acme',
      missionKey: 'ACME-12',
      title: MISSION.title,
      when: '09:02',
      ball: 'agent',
    },
    {
      id: 'r2',
      project: 'Hemera',
      missionKey: 'HEM-62',
      title: 'Probe worktrees survive a restart',
      when: 'yesterday',
      ball: 'someone',
    },
  ],
}

const BALLS: readonly Ball[] = ['agent', 'you', 'someone', 'blocked', 'idle']

/**
 * A list many rows long, every title long. What waits for the user holds only rows that wait
 * for the user; the other lists hold missions in every state.
 */
export function denseRows(count: number, waiting = false): HomeRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `d${String(index)}`,
    project: index % 3 === 0 ? 'Hemera' : 'Acme',
    missionKey: `ACME-${String(100 + index)}`,
    title: `${LONG_TITLE} (${String(index + 1)})`,
    when: `${String(8 + (index % 10))}:${String(10 + index).padStart(2, '0')}`,
    ball: waiting ? 'you' : (BALLS[index % BALLS.length] ?? 'idle'),
  }))
}

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
  return (
    <HomePage
      today="Saturday 4 October"
      hasProjects={projects.length > 0 || loading}
      needsYou={{
        rows: dense ? denseRows(9, true) : projects.length > 0 ? HOME_ROWS.needsYou : [],
      }}
      questions={{
        rows: dense ? denseRows(6, true) : projects.length > 0 ? HOME_ROWS.questions : [],
      }}
      sinceYouLeft={{
        rows: dense ? denseRows(14) : projects.length > 0 ? HOME_ROWS.sinceYouLeft : [],
      }}
      recent={{ rows: dense ? denseRows(8) : projects.length > 0 ? HOME_ROWS.recent : [] }}
      loading={loading}
      error={error}
      onOpen={onOpen}
      onAddProject={() => {}}
      onRetry={() => {}}
    />
  )
}
