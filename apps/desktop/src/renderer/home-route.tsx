import { HomePage, type AppSection } from '@hemera/ui'
import type { ReactNode } from 'react'

import type { Link } from './link.ts'
import { handlersFor, needRowsOf, type NeedsState } from './needs.ts'
import type { ProjectsState } from './projects.ts'
import type { ShellActions } from './shell.tsx'

export interface HomeRouteProps {
  link: Link
  engineReady: boolean
  /** Today, as Home's header says it. */
  today: string
  /** Now, which each need's "when" is counted from. */
  now: Date
  projects: ProjectsState
  needs: NeedsState
  /** What the route asks Home to show: one Project's needs, one need unfolded. */
  focus: { projectId?: string | undefined; need?: string | undefined }
  /** Home before the first Project, while nothing waits: the agents and the ways in. */
  firstLaunch: ReactNode
  actions: {
    answer: ShellActions['answer']
    recheck: ShellActions['recheck']
    openSettings: (section: AppSection) => void
    addProject: () => void
    retry: () => void
    openMission: (projectId: string, key: string) => void
  }
}

/** Home: the needs that wait, and the lists of coming back as they are built. */
export function HomeRoute({
  today,
  now,
  projects,
  needs,
  focus,
  firstLaunch,
  actions,
}: HomeRouteProps): ReactNode {
  const listed = projects.kind === 'ready' ? projects.projects : []
  const rows = needRowsOf(needs, listed, now, focus.projectId)
  // Something waiting is read on Home, which says it; otherwise the first launch's ways in.
  if (
    projects.kind === 'ready' &&
    needs.kind === 'ready' &&
    listed.length === 0 &&
    rows.length === 0
  ) {
    return firstLaunch
  }
  const failure =
    projects.kind === 'failed'
      ? projects.sentence
      : needs.kind === 'failed'
        ? needs.sentence
        : undefined
  const tools = {
    answer: actions.answer,
    recheck: actions.recheck,
    openSettings: actions.openSettings,
  }
  return (
    <HomePage
      // A need led to by its notification is unfolded: the list opens on it.
      key={focus.need ?? ''}
      today={today}
      // Something waiting is shown even before the first Project: Git missing, say.
      hasProjects={projects.kind !== 'ready' || projects.projects.length > 0 || rows.length > 0}
      needsYou={{ rows: [] }}
      needs={{
        rows,
        projects: ['Hemera', ...listed.map((one) => one.name)],
        open: focus.need,
        on: (id) => {
          const need = needs.kind === 'ready' ? needs.needs.find((one) => one.id === id) : undefined
          return need === undefined ? {} : handlersFor(need, tools)
        },
      }}
      questions={{ rows: [] }}
      sinceYouLeft={{ rows: [] }}
      recent={{ rows: [] }}
      loading={projects.kind === 'loading' || needs.kind === 'loading'}
      error={failure}
      onOpen={() => undefined}
      onAddProject={actions.addProject}
      onRetry={actions.retry}
    />
  )
}
