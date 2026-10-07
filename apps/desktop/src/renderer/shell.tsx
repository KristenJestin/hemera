import type { NeedAnswer } from '@hemera/core/domain'
import { DatabaseRefused, type Project } from '@hemera/ipc'
import {
  ContentHeader,
  EngineVeil,
  HomePage,
  ProjectPage,
  Sidebar,
  WindowShell,
  type AppSection,
  type Crumb,
  type EngineState as VeilState,
} from '@hemera/ui'
import { Schema } from 'effect'
import type { ReactNode } from 'react'

import { ENGINE_START_LIMIT, type EngineState } from './engine-start.ts'
import {
  linkedSettings,
  placeOf,
  trailOf,
  type Navigation,
  type Route,
  type Step,
} from './navigation.ts'
import { handlersFor, needRowsOf, waitingCount, type NeedsState } from './needs.ts'
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
  /** The setup page of the Project the route shows, drawn by its own hooks. */
  projectSetup?: ReactNode
  /** A Chat's title, when the window knows it: the last crumb of its page. */
  chatTitle?: (id: string) => string | undefined
  /** Today, as Home's header says it. */
  today: string
  /** Now, which each need's "when" is counted from. */
  now: Date
  /** The settings page of the Project the route shows, drawn by its own hooks. */
  projectSettings?: ReactNode
  /** The dialog that adds a Project, over the window. */
  addProject?: ReactNode
  /** What the application's Settings page holds under its title. */
  appSettings?: ReactNode
  /** Home before the first Project, while nothing waits: the agents and the ways in. */
  firstLaunch?: ReactNode
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

/** What a repository is called on its Project's page: its folder, the main checkout's for `.`. */
function repositoryName(project: Project, path: string): string {
  const folder = path === '.' ? project.mainCheckout : path
  return folder.split(/[\\/]/).findLast((part) => part !== '') ?? folder
}

interface ProjectRouteProps {
  id: string
  state: ProjectState
  /** The name the sidebar knows, while the page reads the Project. */
  fallback: string
  actions: ShellActions
}

/** A Project's page: its header from the engine; its start field and missions are later tickets'. */
function ProjectRoute({ id, state, fallback, actions }: ProjectRouteProps): ReactNode {
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
      onOpenSettings={() => actions.go({ kind: 'projectSettings', id })}
      onRetry={actions.retryProject}
    />
  )
}

interface RoutePageProps {
  route: Route
  projects: ProjectsState
  project: ProjectState
  needs: NeedsState
  now: Date
  nameOf: (id: string) => string | undefined
  today: string
  projectSettings: ReactNode
  appSettings: ReactNode
  firstLaunch: ReactNode
  chat: ReactNode
  projectSetup: ReactNode
  actions: ShellActions
}

/** The page of the route, on the sheet. A mission's page comes with the missions; nothing leads to one yet. */
function RoutePage({
  route,
  projects,
  project,
  needs,
  now,
  nameOf,
  today,
  projectSettings,
  appSettings,
  firstLaunch,
  chat,
  projectSetup,
  actions,
}: RoutePageProps): ReactNode {
  switch (route.kind) {
    case 'home': {
      const listed = projects.kind === 'ready' ? projects.projects : []
      const rows = needRowsOf(needs, listed, now, route.projectId)
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
        openSettings: (section: AppSection) => actions.go(linkedSettings(section)),
      }
      return (
        <HomePage
          // A need led to by its notification is unfolded: the list opens on it.
          key={route.need ?? ''}
          today={today}
          // Something waiting is shown even before the first Project: Git missing, say.
          hasProjects={projects.kind !== 'ready' || projects.projects.length > 0 || rows.length > 0}
          needsYou={{ rows: [] }}
          needs={{
            rows,
            projects: ['Hemera', ...listed.map((one) => one.name)],
            open: route.need,
            on: (id) => {
              const need =
                needs.kind === 'ready' ? needs.needs.find((one) => one.id === id) : undefined
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
          onRetry={actions.retryProjects}
        />
      )
    }
    case 'project':
      return (
        <ProjectRoute
          key={route.id}
          id={route.id}
          state={project}
          fallback={nameOf(route.id) ?? ''}
          actions={actions}
        />
      )
    case 'projectSettings':
      return projectSettings
    case 'settings':
      return appSettings
    case 'chat':
      return chat
    case 'projectSetup':
      return projectSetup
    case 'mission':
      return null
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
  projectSetup,
  today,
  now,
  projectSettings,
  addProject,
  appSettings,
  firstLaunch,
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
            projects={projects}
            project={project}
            needs={needs}
            now={now}
            nameOf={nameOf}
            today={today}
            projectSettings={projectSettings}
            appSettings={appSettings}
            firstLaunch={firstLaunch}
            chat={chat}
            projectSetup={projectSetup}
            actions={actions}
          />
        )}
      </WindowShell>
      {veil === null && addProject}
    </div>
  )
}
