import type { LivingDomain, Mission, Project } from '@hemera/ipc'
import { ProjectPage } from '@hemera/ui'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

import { flight, startChat } from './chat-actions.ts'
import type { Link } from './link.ts'
import { lineOf } from './missions.ts'
import { chatRowsOf, eventsOf, groupsOf, livingSpecOf } from './project-lines.ts'
import type { ProjectState } from './projects.ts'
import { StartFieldPart } from './start-field-part.tsx'
import { useChats } from './use-chats.ts'
import { useMissions } from './use-missions.ts'

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
export function repositoryName(project: Project, path: string): string {
  const folder = path === '.' ? project.mainCheckout : path
  return folder.split(/[\\/]/).findLast((part) => part !== '') ?? folder
}

const NO_EVENTS: ReadonlyMap<string, string> = new Map()

/**
 * The last event of each mission listed, read again when a mission changes. Kept while it is read
 * again, so a row never loses its second line to a refresh; none when the engine cannot say.
 */
export function useLastEvents(
  link: Link,
  engineReady: boolean,
  missions: ReadonlyArray<Mission>,
): ReadonlyMap<string, string> {
  const [events, setEvents] = useState(NO_EVENTS)
  const signature = missions.map((mission) => `${mission.id}@${mission.updatedAt}`).join(',')
  useEffect(() => {
    if (!engineReady || signature === '') return undefined
    let stopped = false
    link.journalTail(signature.split(',').map((entry) => entry.slice(0, entry.indexOf('@')))).then(
      (tails) => {
        if (!stopped) setEvents(eventsOf(tails))
      },
      () => undefined,
    )
    return () => {
      stopped = true
    }
  }, [link, engineReady, signature])
  return events
}

type DomainsState = { kind: 'loading' } | { kind: 'ready'; domains: ReadonlyArray<LivingDomain> }

/** A Project's living-spec domains as the page follows them; none if the engine cannot say. */
function useLivingDomains(link: Link, engineReady: boolean, projectId: string): DomainsState {
  const [state, setState] = useState<DomainsState>({ kind: 'loading' })
  useEffect(() => {
    if (!engineReady) return undefined
    const stop = link.onLivingSpec(
      projectId,
      (living) => setState({ kind: 'ready', domains: living.domains }),
      () => setState({ kind: 'ready', domains: [] }),
    )
    return () => {
      stop()
      setState({ kind: 'loading' })
    }
  }, [link, engineReady, projectId])
  return state
}

/** A Project's page: its header, its start field, its missions by stage, and the rail. */
export function ProjectRoute({
  link,
  engineReady,
  id,
  state,
  fallback,
  now,
  tasks,
  actions,
}: ProjectRouteProps): ReactNode {
  const project = state.kind === 'ready' ? state.project : null
  const missions = useMissions(link, engineReady, id)
  const chats = useChats(link, engineReady, id)
  const domains = useLivingDomains(link, engineReady, id)
  const events = useLastEvents(
    link,
    engineReady,
    missions.kind === 'ready' ? missions.missions : [],
  )
  const [newChat] = useState(() => flight())
  const lines = useMemo(() => {
    if (missions.kind !== 'ready') return []
    const names = new Map(
      (project?.repositories ?? []).map((repository) => [
        repository.id,
        project === null ? repository.path : repositoryName(project, repository.path),
      ]),
    )
    return missions.missions.map((mission) =>
      lineOf(mission, (repositoryId) => names.get(repositoryId) ?? repositoryId),
    )
  }, [missions, project])
  const name = project?.name ?? fallback
  return (
    <ProjectPage
      name={name}
      repositories={
        project?.repositories.map((repository) => ({
          name: repositoryName(project, repository.path),
        })) ?? []
      }
      start={
        <StartFieldPart
          link={link}
          engineReady={engineReady}
          projectId={id}
          projectName={name}
          onOpenMission={actions.openMission}
          onOpenChat={() => startChat(link, id, newChat, actions.openChat, () => undefined)}
        />
      }
      groups={groupsOf(lines, events, now)}
      livingSpec={domains.kind === 'ready' ? livingSpecOf(domains.domains, now) : null}
      chats={chats.kind === 'ready' ? chatRowsOf(chats.chats, now) : []}
      loading={state.kind === 'loading' || missions.kind === 'loading'}
      error={
        state.kind === 'failed'
          ? state.sentence
          : missions.kind === 'failed'
            ? missions.sentence
            : undefined
      }
      onOpenMission={actions.openMission}
      onOpenSettings={actions.openSettings}
      onOpenLivingSpec={actions.openLivingSpec}
      onOpenChat={actions.openChat}
      onNewChat={() => startChat(link, id, newChat, actions.openChat, () => undefined)}
      onRetry={actions.retry}
      tasks={tasks}
    />
  )
}
