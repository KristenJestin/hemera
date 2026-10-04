/** What the window draws for each state of the engine, the Projects and the route. */

import { DatabaseOpen, DatabaseRefused, type EngineStatus, type Project } from '@hemera/ipc'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vite-plus/test'

import type { EngineState } from '../src/renderer/engine-start.ts'
import { START, go, type Route } from '../src/renderer/navigation.ts'
import type { ProjectState, ProjectsState } from '../src/renderer/projects.ts'
import { Shell, type ShellProps } from '../src/renderer/shell.tsx'

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
  version: 1,
  createdAt: '2026-10-04T08:00:00.000Z',
  updatedAt: '2026-10-04T08:00:00.000Z',
  repositories: [repository('r1', 'api'), repository('r2', 'web')],
}

const READY: EngineState = { kind: 'ready', status: status() }
const nothing = (): void => undefined

interface Drawn {
  engine?: EngineState
  projects?: ProjectsState
  project?: ProjectState
  route?: Route
  folded?: boolean
}

const drawn = ({
  engine = READY,
  projects = { kind: 'ready', projects: [ACME] },
  project = { kind: 'loading' },
  route = { kind: 'home' },
  folded = false,
}: Drawn): string => {
  const props: ShellProps = {
    engine,
    projects,
    project,
    navigation: go(START, route),
    folded,
    today: 'Saturday 4 October',
    actions: {
      go: nothing,
      show: nothing,
      fold: nothing,
      retryProjects: nothing,
      retryProject: nothing,
      relaunch: nothing,
      showLog: nothing,
    },
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

  test('no Project yet: Home is one empty state, Hemera asleep, with the way to add one', () => {
    const markup = drawn({ projects: { kind: 'ready', projects: [] } })
    expect(markup).toContain('aria-label="Asleep"')
    expect(markup).not.toContain('Needs you')
    expect(markup).toContain('Add a Project')
  })

  test('the Projects are listed by name, and Home is the current place', () => {
    const markup = drawn({})
    expect(markup).toMatch(/<button[^>]*aria-current="page"[^>]*>.*?Home/)
    expect(markup).toContain('>Acme<')
    expect(markup).toContain('No mission yet.')
  })

  test('Projects that cannot be read are said in words, where they would be and on Home', () => {
    const sentence = 'The data folder refused while reading the Projects.'
    const markup = drawn({ projects: { kind: 'failed', sentence } })
    expect(markup.split(sentence).length - 1).toBeGreaterThanOrEqual(2)
    expect(markup).toContain('Try again')
  })

  test('folded, the sidebar is a rail', () => {
    expect(drawn({ folded: true })).toContain('data-folded="true"')
  })
})

describe('The pages', () => {
  test('a Project’s page: its name, its repositories, the entry to its settings, no mission yet', () => {
    const markup = drawn({
      route: { kind: 'project', id: 'acme' },
      project: { kind: 'ready', project: ACME },
    })
    expect(markup).toMatch(/<h1[^>]*>.*Acme.*<\/h1>/)
    expect(markup).toContain('>api<')
    expect(markup).toContain('>web<')
    expect(markup).toContain('Settings of Acme')
    expect(markup).toContain('No mission yet')
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

  test('the Settings page, its place marked at the foot of the sidebar', () => {
    const markup = drawn({ route: { kind: 'settings' } })
    expect(markup).toMatch(/<h1[^>]*>Settings<\/h1>/)
    expect(markup).toMatch(/<button[^>]*aria-current="page"[^>]*>.*?Settings/)
  })

  test('a Project’s settings: the trail leads back to the Project', () => {
    const markup = drawn({
      route: { kind: 'projectSettings', id: 'acme' },
      project: { kind: 'ready', project: ACME },
    })
    expect(markup).toMatch(/<h1[^>]*>Settings of Acme<\/h1>/)
    expect(markup).toMatch(/aria-label="Where you are".*<button[^>]*>.*Acme.*<\/button>.*Settings/)
  })
})
