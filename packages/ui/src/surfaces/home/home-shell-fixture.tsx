import type { ReactNode } from 'react'

import type { SidebarProject } from '../../shell/sidebar.tsx'
import { HomePage } from './home-page.tsx'
import {
  HOME_NEEDS,
  HOME_ROWS,
  denseSince,
  denseRows,
  denseQuestions,
} from './home-fixture-data.ts'

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
      questions={dense ? denseQuestions(6) : filled ? HOME_ROWS.questions : []}
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
