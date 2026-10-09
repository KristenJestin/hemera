import type { Project } from '@hemera/ipc'
import { ProjectPage } from '@hemera/ui'
import type { ReactNode } from 'react'

import type { Link } from './link.ts'
import type { ProjectState } from './projects.ts'

export interface ProjectRouteProps {
  link: Link
  engineReady: boolean
  id: string
  state: ProjectState
  /** The name the sidebar knows, while the page reads the Project. */
  fallback: string
  now: Date
  /** Its tasks, under the field that starts a mission. */
  tasks?: ReactNode
  actions: {
    openSettings: () => void
    retry: () => void
    openMission: (key: string) => void
    openChat: (chatId: string) => void
    openLivingSpec: () => void
  }
}

/** What a repository is called on its Project's page: its folder, the main checkout's for `.`. */
function repositoryName(project: Project, path: string): string {
  const folder = path === '.' ? project.mainCheckout : path
  return folder.split(/[\\/]/).findLast((part) => part !== '') ?? folder
}

/** A Project's page: its header from the engine; its start field and missions are to come. */
export function ProjectRoute({ state, fallback, tasks, actions }: ProjectRouteProps): ReactNode {
  const project = state.kind === 'ready' ? state.project : null
  return (
    <ProjectPage
      name={project?.name ?? fallback}
      repositories={
        project?.repositories.map((repository) => ({
          name: repositoryName(project, repository.path),
        })) ?? []
      }
      groups={[]}
      loading={state.kind === 'loading'}
      error={state.kind === 'failed' ? state.sentence : undefined}
      onStart={() => undefined}
      onOpenMission={() => undefined}
      onOpenSettings={actions.openSettings}
      onRetry={actions.retry}
      tasks={tasks}
    />
  )
}
