import type { NeedAnswer } from '@hemera/core/domain'
import { DatabaseRefused } from '@hemera/ipc'
import {
  ContentHeader,
  EngineVeil,
  Sidebar,
  WindowShell,
  type Crumb,
  type EngineState as VeilState,
} from '@hemera/ui'
import { Schema } from 'effect'
import type { ReactNode } from 'react'

import { ENGINE_START_LIMIT, type EngineState } from './engine-start.ts'
import { placeOf, trailOf, type Navigation, type Route, type Step } from './navigation.ts'
import { waitingCount, type NeedsState } from './needs.ts'
import type { ProjectState, ProjectsState } from './projects.ts'

const isRefused = Schema.is(DatabaseRefused)

/** What the window does when asked: the hooks of `main.tsx` answer each. */
export interface ShellActions {
  go: (route: Route) => void
  /** Within the mission shown: a view of its stack, or its base for null. */
  show: (view: string | null) => void
  fold: (folded: boolean) => void
  retryProjects: () => void
  retryProject: () => void
  relaunch: () => void
  showLog: () => void
  /** Opens the dialog that adds a Project. */
  addProject: () => void
  /** Answers a need from its card, known by its button's label while it is on its way. */
  answer: (id: string, label: string, answer: NeedAnswer) => void
  /** Checks a need of something missing again. */
  recheck: (id: string) => void
  /** Opens or closes a Project in the sidebar: what stands under it shows while it is open. */
  open: (id: string, open: boolean) => void
}

export interface ShellProps {
  engine: EngineState
  projects: ProjectsState
  /** The Project the page shows, when the route is one of a Project's. */
  project: ProjectState
  /** Every need that waits, for Home's Needs you and the sidebar's count. */
  needs: NeedsState
  navigation: Navigation
  folded: boolean
  /** The Projects open in the sidebar. */
  opened: ReadonlySet<string>
  /** What stands under an open Project in the sidebar: its Chats. */
  under?: (projectId: string) => ReactNode
  /** The page of the Chat the route shows, drawn by its own hooks. */
  chat?: ReactNode
  /** Home, drawn by its own route. */
  home?: ReactNode
  /** The page of the Project the route shows, drawn by its own route. */
  projectPage?: ReactNode
  /** The page of the mission the route shows, drawn by its own route. */
  mission?: ReactNode
  /** The living spec of the Project the route shows, drawn by its own route. */
  livingSpec?: ReactNode
  /** A Chat's title, when the window knows it: the last crumb of its page. */
  chatTitle?: (id: string) => string | undefined
  /** The settings page of the Project the route shows, drawn by its own hooks. */
  projectSettings?: ReactNode
  /** The dialog that adds a Project, over the window. */
  addProject?: ReactNode
  /** What the application's Settings page holds under its title. */
  appSettings?: ReactNode
  /** The in-app notifications, over the sheet's bottom corner. */
  notices?: ReactNode
  actions: ShellActions
}

interface Veil {
  state: VeilState
  reason?: string
}

/** The veil over the sheet while the engine cannot be shown: none once it answered. */
function veilOf(engine: EngineState): Veil | null {
  switch (engine.kind) {
    case 'starting':
      return { state: 'starting' }
    case 'late':
      return { state: 'late' }
    case 'stopped':
      return { state: 'stopped', reason: 'Hemera’s engine stopped.' }
    case 'ready':
      return isRefused(engine.status.database)
        ? { state: 'stopped', reason: engine.status.database.sentence }
        : null
  }
}

interface RoutePageProps {
  route: Route
  home: ReactNode
  projectPage: ReactNode
  mission: ReactNode
  livingSpec: ReactNode
  projectSettings: ReactNode
  appSettings: ReactNode
  chat: ReactNode
}

/** The page of the route, on the sheet: each is built by its own route, from its own hooks. */
function RoutePage({
  route,
  home,
  projectPage,
  mission,
  livingSpec,
  projectSettings,
  appSettings,
  chat,
}: RoutePageProps): ReactNode {
  switch (route.kind) {
    case 'home':
      return home
    case 'project':
      return projectPage
    case 'projectSettings':
      return projectSettings
    case 'livingSpec':
      return livingSpec
    case 'settings':
      return appSettings
    case 'chat':
      return chat
    case 'mission':
      return mission
  }
}

/**
 * The window: the sidebar, the sheet's header with the one breadcrumb, and the page of the route
 * — mounted only once the engine has answered; until then, and whenever it cannot be shown, the
 * engine's state veils the sheet and leaves the chrome alone.
 */
export function Shell({
  engine,
  projects,
  project,
  needs,
  navigation,
  folded,
  opened,
  under,
  chat,
  chatTitle,
  home,
  projectPage,
  mission,
  livingSpec,
  projectSettings,
  addProject,
  appSettings,
  notices,
  actions,
}: ShellProps): ReactNode {
  const listed = projects.kind === 'ready' ? projects.projects : []
  const nameOf = (id: string): string | undefined =>
    (project.kind === 'ready' && project.project.id === id ? project.project.name : undefined) ??
    listed.find((one) => one.id === id)?.name
  const veil = veilOf(engine)
  const { route } = navigation
  const stepTo = (step: Step): void =>
    'go' in step ? actions.go(step.go) : actions.show(step.show)
  const names = { project: nameOf, view: (id: string) => id, chat: (id: string) => chatTitle?.(id) }
  const crumbs: Crumb[] = trailOf(navigation, names).map(({ id, label, mono, step }) => ({
    id,
    label,
    mono,
    onPress: step === undefined ? undefined : () => stepTo(step),
  }))
  const failure = projects.kind === 'failed' ? projects.sentence : undefined
  return (
    <div data-engine={engine.kind} className="contents">
      <WindowShell
        sidebar={
          <Sidebar
            folded={folded}
            waiting={waitingCount(needs)}
            projects={listed.map(({ id, name }) => ({
              id,
              name,
              // Mounted by the sidebar only while the Project is open.
              under: under?.(id),
            }))}
            opened={opened}
            onOpen={actions.open}
            loading={engine.kind !== 'ready' || projects.kind === 'loading'}
            error={failure}
            current={placeOf(route)}
            onHome={() => actions.go({ kind: 'home' })}
            onProject={(id) => actions.go({ kind: 'project', id })}
            onAddProject={actions.addProject}
            onSettings={() => actions.go({ kind: 'settings' })}
          />
        }
        header={<ContentHeader folded={folded} onFold={actions.fold} crumbs={crumbs} />}
        overlay={
          veil === null ? (
            notices
          ) : (
            <EngineVeil
              state={veil.state}
              maxDelay={ENGINE_START_LIMIT / 1000}
              reason={veil.reason}
              onRestart={actions.relaunch}
              onShowLog={actions.showLog}
            />
          )
        }
      >
        {veil === null && (
          <RoutePage
            route={route}
            home={home}
            projectPage={projectPage}
            mission={mission}
            livingSpec={livingSpec}
            projectSettings={projectSettings}
            appSettings={appSettings}
            chat={chat}
          />
        )}
      </WindowShell>
      {veil === null && addProject}
    </div>
  )
}
