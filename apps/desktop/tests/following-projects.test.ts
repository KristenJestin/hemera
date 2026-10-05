/** The Projects as the window follows them: the list, its changes, and one Project for its page. */

import { StorageFailed, UnknownProject, type Project } from '@hemera/ipc'
import { describe, expect, test, vi } from 'vite-plus/test'

import type { Link } from '../src/renderer/link.ts'
import {
  followProject,
  followProjects,
  type ProjectState,
  type ProjectsState,
} from '../src/renderer/projects.ts'

const project = (id: string, name: string, version = 1): Project => ({
  id,
  name,
  mainCheckout: `/work/${id}`,
  workspacesRoot: null,
  branchPrefix: null,
  keyPrefix: name.toUpperCase().slice(0, 4),
  version,
  createdAt: '2026-10-04T08:00:00.000Z',
  updatedAt: '2026-10-04T08:00:00.000Z',
  repositories: [],
})

const ACME = project('acme', 'Acme')
const HEMERA = project('hemera', 'Hemera')

interface Pending<A> {
  readonly resolve: (value: A) => void
  readonly reject: (error: Error) => void
}

/** A link whose engine answers when the test says, with what the test says. */
function scripted() {
  const lists: Array<Pending<ReadonlyArray<Project>>> = []
  const gets: Array<Pending<Project>> = []
  const listeners = new Set<(project: Project) => void>()
  const asked: string[] = []
  const link: Pick<Link, 'projects' | 'project' | 'onProjectChanges'> = {
    projects: () =>
      new Promise((resolve, reject) => {
        asked.push('projects.list')
        lists.push({ resolve, reject })
      }),
    project: (id) =>
      new Promise((resolve, reject) => {
        asked.push(`projects.get ${id}`)
        gets.push({ resolve, reject })
      }),
    onProjectChanges: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    link,
    asked,
    listening: () => listeners.size,
    list: (projects: ReadonlyArray<Project>) => lists.shift()?.resolve(projects),
    refuseList: (error: Error) => lists.shift()?.reject(error),
    get: (found: Project) => gets.shift()?.resolve(found),
    refuseGet: (error: Error) => gets.shift()?.reject(error),
    change: (changed: Project) => {
      for (const listener of listeners) listener(changed)
    },
  }
}

describe('The sidebar follows the Projects', () => {
  test('they are on their way, then listed in the order the engine gives', async () => {
    const engine = scripted()
    const states: ProjectsState[] = []
    followProjects(engine.link, (state) => states.push(state))
    expect(states.at(-1)).toEqual({ kind: 'loading' })
    engine.list([ACME, HEMERA])
    await vi.waitFor(() =>
      expect(states.at(-1)).toEqual({ kind: 'ready', projects: [ACME, HEMERA] }),
    )
  })

  test('a Project created elsewhere is added at the end, without asking for the list again', async () => {
    const engine = scripted()
    const states: ProjectsState[] = []
    followProjects(engine.link, (state) => states.push(state))
    engine.list([ACME])
    await vi.waitFor(() => expect(states.at(-1)?.kind).toBe('ready'))
    engine.change(HEMERA)
    expect(states.at(-1)).toEqual({ kind: 'ready', projects: [ACME, HEMERA] })
    expect(engine.asked).toEqual(['projects.list'])
  })

  test('a renamed Project keeps its place', async () => {
    const engine = scripted()
    const states: ProjectsState[] = []
    followProjects(engine.link, (state) => states.push(state))
    engine.list([ACME, HEMERA])
    await vi.waitFor(() => expect(states.at(-1)?.kind).toBe('ready'))
    const renamed = project('acme', 'Acme Corp', 2)
    engine.change(renamed)
    expect(states.at(-1)).toEqual({ kind: 'ready', projects: [renamed, HEMERA] })
  })

  test('a change heard before the list answers is not lost', async () => {
    const engine = scripted()
    const states: ProjectsState[] = []
    followProjects(engine.link, (state) => states.push(state))
    engine.change(HEMERA)
    engine.list([ACME])
    await vi.waitFor(() =>
      expect(states.at(-1)).toEqual({ kind: 'ready', projects: [ACME, HEMERA] }),
    )
  })

  test('a list that cannot be read is said in words, and Try again reads it again', async () => {
    const engine = scripted()
    const states: ProjectsState[] = []
    const following = followProjects(engine.link, (state) => states.push(state))
    engine.refuseList(
      new StorageFailed({ sentence: 'The data folder refused while reading Projects.' }),
    )
    await vi.waitFor(() =>
      expect(states.at(-1)).toEqual({
        kind: 'failed',
        sentence: 'The data folder refused while reading Projects.',
      }),
    )
    following.retry()
    expect(states.at(-1)).toEqual({ kind: 'loading' })
    engine.list([ACME])
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ kind: 'ready', projects: [ACME] }))
  })

  test('stopping stops listening, and an answer that comes later says nothing', async () => {
    const engine = scripted()
    const states: ProjectsState[] = []
    const following = followProjects(engine.link, (state) => states.push(state))
    following.stop()
    expect(engine.listening()).toBe(0)
    engine.list([ACME])
    await Promise.resolve()
    expect(states).toEqual([{ kind: 'loading' }])
  })
})

describe('A Project’s page follows its Project', () => {
  test('it reads the Project, then follows its changes and no other’s', async () => {
    const engine = scripted()
    const states: ProjectState[] = []
    followProject(engine.link, 'acme', (state) => states.push(state))
    expect(states.at(-1)).toEqual({ kind: 'loading' })
    expect(engine.asked).toEqual(['projects.get acme'])
    engine.get(ACME)
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ kind: 'ready', project: ACME }))
    engine.change(project('hemera', 'Hemera itself', 2))
    expect(states.at(-1)).toEqual({ kind: 'ready', project: ACME })
    const renamed = project('acme', 'Acme Corp', 2)
    engine.change(renamed)
    expect(states.at(-1)).toEqual({ kind: 'ready', project: renamed })
  })

  test('a Project that no longer exists is said in words', async () => {
    const engine = scripted()
    const states: ProjectState[] = []
    followProject(engine.link, 'gone', (state) => states.push(state))
    engine.refuseGet(new UnknownProject({ id: 'gone' }))
    await vi.waitFor(() =>
      expect(states.at(-1)).toEqual({ kind: 'failed', sentence: 'This Project no longer exists.' }),
    )
  })
})
