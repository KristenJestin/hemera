/** What the window draws for each state of the engine, the Projects and the route. */

import { ApplicationOwner, EnvironmentFields, ProjectOwner } from '@hemera/core/domain'
import {
  DatabaseOpen,
  DatabaseRefused,
  type EngineStatus,
  type Need,
  type Project,
} from '@hemera/ipc'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vite-plus/test'

import type { EngineState } from '../src/renderer/engine-start.ts'
import { START, go, open, type Route } from '../src/renderer/navigation.ts'
import type { NeedsState } from '../src/renderer/needs.ts'
import type { ProjectState, ProjectsState } from '../src/renderer/projects.ts'
import { HomeRoute } from '../src/renderer/home-route.tsx'
import { LivingSpecRoute } from '../src/renderer/living-spec-route.tsx'
import { MissionRoute } from '../src/renderer/mission-route.tsx'
import { ProjectRoute } from '../src/renderer/project-route.tsx'
import { Shell, type ShellProps } from '../src/renderer/shell.tsx'
import { SidebarMissions } from '../src/renderer/sidebar-missions.tsx'
import { StartFieldPart } from '../src/renderer/start-field-part.tsx'
import { AT_BASE } from '@hemera/ui'
import { SILENT_LINK } from './fake-link.ts'

const missionProps = {
  link: SILENT_LINK,
  engineReady: true,
  projectId: 'acme',
  missionKey: 'ACME-12',
  now: new Date('2026-10-04T12:00:00.000Z'),
  frame: AT_BASE,
  actions: {
    open: () => undefined,
    show: () => undefined,
    close: () => undefined,
    goProject: () => undefined,
    goMission: () => undefined,
    answer: () => undefined,
    recheck: () => undefined,
    openSettings: () => undefined,
  },
}

const OPEN = DatabaseOpen.make({
  lastMigration: null,
  writtenByVersion: '1.0.0',
  backups: { count: 0, latest: null },
  reconciliation: 'none',
})

const status = (database: EngineStatus['database'] = OPEN): EngineStatus => ({
  ready: true,
  version: '1.0.0',
  channel: 'dev',
  dataFolder: '/data',
  database,
})

const repository = (id: string, path: string) => ({
  id,
  projectId: 'acme',
  path,
  includedByDefault: true,
  remote: 'origin',
  baseBranch: 'main',
  lastFetchedAt: null,
})

const ACME: Project = {
  id: 'acme',
  name: 'Acme',
  mainCheckout: '/work/acme',
  workspacesRoot: null,
  branchPrefix: null,
  keyPrefix: 'ACME',
  version: 1,
  createdAt: '2026-10-04T08:00:00.000Z',
  updatedAt: '2026-10-04T08:00:00.000Z',
  repositories: [repository('r1', 'api'), repository('r2', 'web')],
}

const READY: EngineState = { kind: 'ready', status: status() }
const nothing = (): void => undefined
const NOW = new Date('2026-10-04T12:00:00.000Z')

interface Drawn {
  engine?: EngineState
  projects?: ProjectsState
  project?: ProjectState
  route?: Route
  folded?: boolean
  needs?: NeedsState
  opened?: ReadonlySet<string>
  /** The views opened over the mission shown, in order. */
  views?: readonly string[]
}

const drawn = ({
  engine = READY,
  projects = { kind: 'ready', projects: [ACME] },
  project = { kind: 'loading' },
  route = { kind: 'home' },
  folded = false,
  needs = { kind: 'ready', needs: [], missions: new Map(), answers: new Map() },
  opened = new Set(),
  views = [],
}: Drawn): string => {
  const props: ShellProps = {
    engine,
    projects,
    project,
    needs,
    navigation: views.reduce(open, go(START, route)),
    folded,
    opened,
    home: createElement(HomeRoute, {
      link: SILENT_LINK,
      engineReady: engine.kind === 'ready',
      today: 'Saturday 4 October',
      now: NOW,
      projects,
      needs,
      focus: route.kind === 'home' ? { projectId: route.projectId, need: route.need } : {},
      firstLaunch: createElement('p', null, 'Welcome, with the agents of this machine'),
      actions: {
        answer: nothing,
        recheck: nothing,
        openSettings: nothing,
        addProject: nothing,
        retry: nothing,
        openMission: nothing,
      },
    }),
    projectPage: createElement(ProjectRoute, {
      link: SILENT_LINK,
      engineReady: engine.kind === 'ready',
      id: route.kind === 'project' ? route.id : '',
      state: project,
      fallback: 'Acme',
      now: NOW,
      tasks: createElement('p', null, 'The tasks of the Project'),
      actions: {
        openSettings: nothing,
        retry: nothing,
        openMission: nothing,
        openChat: nothing,
        openLivingSpec: nothing,
      },
    }),
    mission: createElement(MissionRoute, {
      link: SILENT_LINK,
      engineReady: true,
      projectId: 'acme',
      missionKey: route.kind === 'mission' ? route.key : '',
      now: NOW,
      frame: AT_BASE,
      actions: {
        open: nothing,
        show: nothing,
        close: nothing,
        goProject: nothing,
        goMission: nothing,
        answer: nothing,
        recheck: nothing,
        openSettings: nothing,
      },
    }),
    livingSpec: createElement(LivingSpecRoute, {
      link: SILENT_LINK,
      engineReady: true,
      projectId: 'acme',
      projectName: 'Acme',
      actions: { openOrigin: nothing, openModels: nothing },
    }),
    actions: {
      go: nothing,
      show: nothing,
      fold: nothing,
      retryProjects: nothing,
      retryProject: nothing,
      relaunch: nothing,
      showLog: nothing,
      addProject: nothing,
      answer: nothing,
      recheck: nothing,
      open: nothing,
    },
    under: (id) => (id === 'acme' ? createElement('p', null, 'The Chats of Acme') : null),
    chat: createElement('p', null, 'The Chat on its page'),
    chatTitle: (id) => (id === 'invoices' ? 'Invoices export' : undefined),
    projectSettings: createElement('p', null, 'The settings of the Project'),
    addProject: createElement('p', null, 'The dialog that adds a Project'),
    appSettings: createElement('p', null, 'The choice of theme'),
    notices: createElement('p', null, 'The in-app notifications'),
  }
  return renderToStaticMarkup(createElement(Shell, props))
}

describe('The window waits for the engine before it mounts its pages', () => {
  test('while the engine starts, the sheet is veiled and holds no page', () => {
    const markup = drawn({ engine: { kind: 'starting' }, projects: { kind: 'loading' } })
    expect(markup).toContain('Starting Hemera')
    expect(markup).toContain('data-engine="starting"')
    expect(markup).not.toContain('Nothing waits for you.')
    expect(markup).toContain('aria-label="Places"')
  })

  test('past the maximum delay, it says so with the delay, and offers to try again', () => {
    const markup = drawn({ engine: { kind: 'late', dataFolder: null } })
    expect(markup).toContain('Hemera did not start')
    expect(markup).toContain('within 30 seconds')
    expect(markup).toContain('Try again')
    expect(markup).toContain('Show the log')
  })

  test('an engine that stopped says so, with Restart Hemera', () => {
    const markup = drawn({ engine: { kind: 'stopped' } })
    expect(markup).toContain('Hemera stopped')
    expect(markup).toContain('Hemera’s engine stopped.')
    expect(markup).toContain('Restart Hemera')
    expect(markup).not.toContain('Nothing waits for you.')
  })

  test('a data folder the engine could not open is said in its own sentence', () => {
    const sentence =
      'This data folder was written by a newer version of Hemera and cannot be opened by this one.'
    const markup = drawn({
      engine: { kind: 'ready', status: status(DatabaseRefused.make({ sentence })) },
    })
    expect(markup).toContain(sentence)
    expect(markup).toContain('Restart Hemera')
  })

  test('the in-app notifications are drawn once the engine answered, never under its veil', () => {
    expect(drawn({})).toContain('The in-app notifications')
    expect(drawn({ engine: { kind: 'stopped' } })).not.toContain('The in-app notifications')
  })

  test('once the engine answered, the veil is gone and Home is mounted', () => {
    const markup = drawn({})
    expect(markup).toContain('data-engine="ready"')
    expect(markup).not.toContain('Starting Hemera')
    expect(markup).toContain('Nothing waits for you.')
  })
})

describe('The sidebar and Home', () => {
  test('the Projects are on their way: their shape, and no way to add one yet', () => {
    const markup = drawn({ projects: { kind: 'loading' } })
    expect(markup).toContain('data-project-skeleton')
    expect(markup).not.toContain('Add a Project')
  })

  test('the Projects are listed by name, and Home is the current place', () => {
    const markup = drawn({})
    expect(markup).toMatch(/<button[^>]*aria-current="page"[^>]*>.*?Home/)
    expect(markup).toContain('>Acme<')
  })

  test('Home’s lists are rows’ shapes while their reads have not answered', () => {
    const markup = drawn({})
    expect(markup).toContain('<ul aria-label="Since you left" aria-busy="true"')
    expect(markup).toContain('<ul aria-label="Recent" aria-busy="true"')
    expect(markup).toContain('data-row-skeleton')
    expect(markup).not.toContain('No mission yet.')
    expect(markup).not.toContain('All quiet')
  })

  test('Projects that cannot be read are said in words, where they would be and on Home', () => {
    const sentence = 'The data folder refused while reading the Projects.'
    const markup = drawn({ projects: { kind: 'failed', sentence } })
    expect(markup.split(sentence).length - 1).toBeGreaterThanOrEqual(2)
    expect(markup).toContain('Try again')
  })

  test('the dialog that adds a Project is over the window once the engine answered', () => {
    expect(drawn({})).toContain('The dialog that adds a Project')
    expect(drawn({ engine: { kind: 'starting' } })).not.toContain('The dialog that adds a Project')
  })

  test('folded, the sidebar is a rail', () => {
    expect(drawn({ folded: true })).toContain('data-folded="true"')
  })
})

describe('The pages', () => {
  test('a Project’s page: its name, its repositories, the entry to its settings, its missions on their way', () => {
    const markup = drawn({
      route: { kind: 'project', id: 'acme' },
      project: { kind: 'ready', project: ACME },
    })
    expect(markup).toMatch(/<h1[^>]*>.*Acme.*<\/h1>/)
    expect(markup).toContain('>api<')
    expect(markup).toContain('>web<')
    expect(markup).toContain('Settings of Acme')
    // The missions are rows' shapes until their read answers, never "No mission yet" before it.
    expect(markup).toContain('<ul aria-label="Missions" aria-busy="true"')
    expect(markup).not.toContain('No mission yet')
  })

  test('a Project’s page on its way, and one that cannot be read', () => {
    const loading = drawn({ route: { kind: 'project', id: 'acme' } })
    expect(loading).toContain('aria-busy="true"')
    const failed = drawn({
      route: { kind: 'project', id: 'acme' },
      project: { kind: 'failed', sentence: 'This Project no longer exists.' },
    })
    expect(failed).toContain('This Project no longer exists.')
  })

  test('the Settings page, drawn by its own hooks, its place marked at the foot of the sidebar', () => {
    const markup = drawn({ route: { kind: 'settings' } })
    expect(markup).toContain('The choice of theme')
    expect(markup).toMatch(/<button[^>]*aria-current="page"[^>]*>.*?Settings/)
  })

  test('a Project’s settings: its settings page, and the trail leads back to the Project', () => {
    const markup = drawn({
      route: { kind: 'projectSettings', id: 'acme' },
      project: { kind: 'ready', project: ACME },
    })
    expect(markup).toContain('The settings of the Project')
    expect(markup).toMatch(/aria-label="Where you are".*<button[^>]*>.*Acme.*<\/button>.*Settings/)
  })

  test('an opened Project has its Chats under it in the sidebar; a closed one offers to open', () => {
    expect(drawn({ opened: new Set(['acme']) })).toContain('The Chats of Acme')
    const closed = drawn({})
    expect(closed).not.toContain('The Chats of Acme')
    expect(closed).toContain('aria-label="Open the missions of Acme"')
  })

  test('a Chat’s page, its trail the Project then the Chat’s title', () => {
    const markup = drawn({ route: { kind: 'chat', projectId: 'acme', id: 'invoices' } })
    expect(markup).toContain('The Chat on its page')
    expect(markup).toMatch(
      /aria-label="Where you are".*<button[^>]*>.*Acme.*<\/button>.*Invoices export/,
    )
  })

  test('a mission’s page is drawn by its own route, which draws nothing yet', () => {
    const markup = drawn({ route: { kind: 'mission', projectId: 'acme', key: 'ACME-12' } })
    expect(markup).toMatch(/aria-label="Where you are".*<button[^>]*>.*Acme.*<\/button>.*ACME-12/)
    expect(renderToStaticMarkup(createElement(MissionRoute, missionProps))).toBe('')
  })

  test('a view opened over a mission is named in the trail by its title, not its id', () => {
    const markup = drawn({
      route: { kind: 'mission', projectId: 'acme', key: 'ACME-12' },
      views: ['difference'],
    })
    expect(markup).toMatch(/aria-label="Where you are".*ACME-12.*What changed/)
    expect(markup).not.toContain('>difference<')
  })

  test('the living spec is a page under its Project, drawn by its own route', () => {
    const markup = drawn({ route: { kind: 'livingSpec', projectId: 'acme' } })
    expect(markup).toMatch(/<h1[^>]*>.*Living spec.*<\/h1>/)
    expect(markup).toMatch(
      /aria-label="Where you are".*<button[^>]*>.*Acme.*<\/button>.*Living spec/,
    )
  })

  test('the start field is drawn empty, with nothing found; the sidebar’s missions wait for their read', () => {
    const field = renderToStaticMarkup(
      createElement(StartFieldPart, {
        link: SILENT_LINK,
        engineReady: true,
        projectId: 'acme',
        projectName: 'Acme',
        onOpenMission: nothing,
        onOpenChat: nothing,
      }),
    )
    expect(field).toContain('Start a mission in Acme')
    expect(field).toContain('placeholder="A ticket, an idea…"')
    expect(field).not.toContain('aria-label="Found"')
    expect(
      renderToStaticMarkup(
        createElement(SidebarMissions, {
          link: SILENT_LINK,
          engineReady: true,
          projectId: 'acme',
          current: { kind: 'home' },
          onOpenMission: nothing,
        }),
      ),
    ).toBe('')
  })

  test('a Project’s page holds its tasks, under the field that starts a mission', () => {
    const markup = drawn({
      route: { kind: 'project', id: 'acme' },
      project: { kind: 'ready', project: ACME },
    })
    expect(markup).toMatch(/Start a mission in Acme.*The tasks of the Project/s)
  })
})

const docker = (id: string, owner: Need['owner'], settingsSection: string | null = null): Need => ({
  id,
  owner,
  fields: EnvironmentFields.make({
    missing: `Docker is not running (${id})`,
    action: 'Start Docker',
    settingsSection,
  }),
  choices: [],
  requestedBy: null,
  state: 'pending',
  answer: null,
  endedReason: null,
  createdAt: '2026-10-04T11:56:00.000Z',
  endedAt: null,
})

const withNeeds = (needs: ReadonlyArray<Need>): NeedsState => ({
  kind: 'ready',
  needs,
  missions: new Map(),
  answers: new Map(),
})

describe('Needs you, on Home and in the sidebar', () => {
  test('every pending need is a row of Home’s Needs you, and the sidebar counts them', () => {
    const markup = drawn({
      needs: withNeeds([
        docker('a', ApplicationOwner.make({})),
        docker('b', ProjectOwner.make({ projectId: 'acme' })),
      ]),
    })
    expect(markup).toContain('Docker is not running (a)')
    expect(markup).toContain('Docker is not running (b)')
    expect(markup).toContain('2 waiting')
    expect(markup).not.toContain('Nothing waits for you.')
  })

  test('with no Project and nothing waiting, Home is the first launch', () => {
    const markup = drawn({ projects: { kind: 'ready', projects: [] } })
    expect(markup).toContain('Welcome, with the agents of this machine')
    expect(drawn({})).not.toContain('Welcome, with the agents of this machine')
  })

  test('with no Project yet, Hemera’s own needs are still shown on Home', () => {
    const markup = drawn({
      projects: { kind: 'ready', projects: [] },
      needs: withNeeds([docker('a', ApplicationOwner.make({}))]),
    })
    expect(markup).toContain('Docker is not running (a)')
    expect(markup).toContain('1 waiting')
    expect(markup).not.toContain('Welcome, with the agents of this machine')
  })

  test('Home led to by a Project’s notification shows that Project’s needs only', () => {
    const markup = drawn({
      route: { kind: 'home', projectId: 'acme' },
      needs: withNeeds([
        docker('a', ApplicationOwner.make({})),
        docker('b', ProjectOwner.make({ projectId: 'acme' })),
      ]),
    })
    expect(markup).not.toContain('Docker is not running (a)')
    expect(markup).toContain('Docker is not running (b)')
    expect(markup).toMatch(/aria-label="Where you are".*<button[^>]*>.*Home.*<\/button>.*Acme/)
    // The sidebar still counts every need.
    expect(markup).toContain('2 waiting')
  })

  test('a need led to by its notification is unfolded on Home', () => {
    const markup = drawn({
      route: { kind: 'home', projectId: 'acme', need: 'b' },
      needs: withNeeds([docker('b', ProjectOwner.make({ projectId: 'acme' }), 'models')]),
    })
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('Open Settings › Models by role')
  })

  test('needs on their way are rows’ shapes; needs that cannot be read are said in words', () => {
    expect(drawn({ needs: { kind: 'loading' } })).toContain('data-row-skeleton')
    const failed = drawn({
      needs: { kind: 'failed', sentence: 'The data folder refused while reading the needs.' },
    })
    expect(failed).toContain('The data folder refused while reading the needs.')
  })
})
