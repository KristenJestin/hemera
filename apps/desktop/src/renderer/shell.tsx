import { DatabaseRefused, type Project } from '@hemera/ipc'
import {
  ContentHeader,
  EngineVeil,
  HomePage,
  ProjectPage,
  Sidebar,
  WindowShell,
  type Crumb,
  type EngineState as VeilState,
} from '@hemera/ui'
import { Schema } from 'effect'
import type { ReactNode } from 'react'

import { ENGINE_START_LIMIT, type EngineState } from './engine-start.ts'
import { placeOf, trailOf, type Navigation, type Route, type Step } from './navigation.ts'
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
}

export interface ShellProps {
  engine: EngineState
  projects: ProjectsState
  /** The Project the page shows, when the route is one of a Project's. */
  project: ProjectState
  navigation: Navigation
  folded: boolean
  /** Today, as Home's header says it. */
  today: string
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

/** A page's frame with its title, for the pages whose sections later tickets add. */
function TitledPage({ title }: { title: string }): ReactNode {
  return (
    <div className="px-8 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
    </div>
  )
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
  nameOf: (id: string) => string | undefined
  today: string
  actions: ShellActions
}

/** The page of the route, on the sheet. A mission's page comes with the missions; nothing leads to one yet. */
function RoutePage({
  route,
  projects,
  project,
  nameOf,
  today,
  actions,
}: RoutePageProps): ReactNode {
  switch (route.kind) {
    case 'home':
      return (
        <HomePage
          today={today}
          hasProjects={projects.kind !== 'ready' || projects.projects.length > 0}
          needsYou={{ rows: [] }}
          questions={{ rows: [] }}
          sinceYouLeft={{ rows: [] }}
          recent={{ rows: [] }}
          loading={projects.kind === 'loading'}
          error={projects.kind === 'failed' ? projects.sentence : undefined}
          onOpen={() => undefined}
          onAddProject={() => undefined}
          onRetry={actions.retryProjects}
        />
      )
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
      return <TitledPage title={`Settings of ${nameOf(route.id) ?? 'this Project'}`} />
    case 'settings':
      return <TitledPage title="Settings" />
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
  navigation,
  folded,
  today,
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
  const crumbs: Crumb[] = trailOf(navigation, { project: nameOf, view: (id) => id }).map(
    ({ id, label, mono, step }) => ({
      id,
      label,
      mono,
      onPress: step === undefined ? undefined : () => stepTo(step),
    }),
  )
  const failure = projects.kind === 'failed' ? projects.sentence : undefined
  return (
    <div data-engine={engine.kind} className="contents">
      <WindowShell
        sidebar={
          <Sidebar
            folded={folded}
            waiting={0}
            projects={listed.map(({ id, name }) => ({ id, name }))}
            opened={new Set()}
            onOpen={() => undefined}
            loading={engine.kind !== 'ready' || projects.kind === 'loading'}
            error={failure}
            current={placeOf(route)}
            onHome={() => actions.go({ kind: 'home' })}
            onProject={(id) => actions.go({ kind: 'project', id })}
            onAddProject={() => undefined}
            onSettings={() => actions.go({ kind: 'settings' })}
          />
        }
        header={<ContentHeader folded={folded} onFold={actions.fold} crumbs={crumbs} />}
        overlay={
          veil === null ? undefined : (
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
            nameOf={nameOf}
            today={today}
            actions={actions}
          />
        )}
      </WindowShell>
    </div>
  )
}
