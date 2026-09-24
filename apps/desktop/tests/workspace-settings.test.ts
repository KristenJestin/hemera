/**
 * The Workspaces of a Project's settings, over the whole engine (D8-02, D8-04, D8-05, D8-06,
 * D8-14, D8-15, Decided 17).
 *
 * The page is drawn from the projects store and the Workspaces store: what is under test is that
 * what the settings write is what the engine then answers — the folder and the prefix of dedicated
 * Workspaces, a repository's place in them, a Workspace on a folder the user picked and its card,
 * the recipe and the variables — and that a refusal comes back in the engine's own words.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { fakeAgent } from '#engine/agents/fake.ts'
import {
  loadProjects,
  projectsSnapshot,
  setBranchPrefix,
  setRepositoryIncluded,
  setWorkspacesRoot,
} from '#renderer/projects-store.ts'

import { repository } from './repositories.ts'
import { type OpenWindow, install, openWindow } from './window.ts'

let dataFolder: string
let main: string
let elsewhere: string
let opened: OpenWindow | null = null

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-workspace-settings-'))
  main = mkdtempSync(join(tmpdir(), 'hemera-workspace-settings-main-'))
  elsewhere = mkdtempSync(join(tmpdir(), 'hemera-workspace-settings-elsewhere-'))
})

afterEach(async () => {
  await opened?.close()
  opened = null
  for (const folder of [dataFolder, main, elsewhere])
    rmSync(folder, { recursive: true, force: true })
})

/** A window on a Project `Atlas` whose `main` holds the repository `api`. */
async function atlas() {
  opened = await openWindow(dataFolder, fakeAgent())
  install(opened.bridge)
  repository(join(main, 'api'))
  const made = await opened.bridge.invoke('projects.create', {
    name: 'Atlas',
    tone: 'primary',
    mainPath: main,
  })
  const project = await opened.bridge.invoke('repositories.add', {
    id: made.id,
    version: made.version,
    relativePath: 'api',
  })
  await loadProjects()
  return project
}

/** The Project as the store holds it now. */
function held(id: string) {
  const found = projectsSnapshot().projects.find((one) => one.id === id)
  if (found === undefined) throw new Error(`the store holds no Project ${id}`)
  return found
}

describe('The folder, the prefix and the inclusion of dedicated Workspaces are saved', () => {
  test('each is written with the version read, and a blank is the default again', async () => {
    const project = await atlas()
    const root = join(elsewhere, 'workspaces')
    mkdirSync(root)

    expect(await setWorkspacesRoot(held(project.id), root)).toBe(true)
    expect(await setBranchPrefix(held(project.id), 'kris')).toBe(true)
    expect(held(project.id)).toMatchObject({ workspacesRoot: root, branchPrefix: 'kris' })

    // A field cleared, or left with spaces, is the default: Hemera's folder and the slug.
    expect(await setWorkspacesRoot(held(project.id), '')).toBe(true)
    expect(await setBranchPrefix(held(project.id), '   ')).toBe(true)
    expect(held(project.id)).toMatchObject({ workspacesRoot: null, branchPrefix: null })
  })

  test("a folder inside main is refused in the engine's words, and nothing changes", async () => {
    const project = await atlas()

    expect(await setWorkspacesRoot(held(project.id), join(main, 'workspaces'))).toBe(false)
    expect(projectsSnapshot().refusal).toMatch(/main/)
    expect(held(project.id).workspacesRoot).toBeNull()
  })

  test('a repository left out of every Workspace by default is no longer included', async () => {
    const project = await atlas()
    // The location as the Project declares it, which is what the settings' line carries.
    expect(held(project.id).included).toEqual(['./api'])

    expect(await setRepositoryIncluded(held(project.id), './api', false)).toBe(true)
    expect(held(project.id).included).toEqual([])
  })
})
