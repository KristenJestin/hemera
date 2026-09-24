/**
 * The Workspaces of a Project's settings, over the whole engine (D8-02, D8-04, D8-05, D8-06,
 * D8-14, D8-15, Decided 17).
 *
 * The page is drawn from the projects store and the Workspaces store: what is under test is that
 * what the settings write is what the engine then answers — the folder and the prefix of dedicated
 * Workspaces, a repository's place in them, a Workspace on a folder the user picked and its card,
 * the recipe and the variables — and that a refusal comes back in the engine's own words.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { fakeAgent } from '#engine/agents/fake.ts'
import { branchesKeptOf, workspaceRowsOf } from '#renderer/workspace-details.ts'
import {
  cleanUp,
  createOnFolder,
  readWorkspaces,
  workspacesOf,
} from '#renderer/workspaces-store.ts'
import {
  loadProjects,
  projectsSnapshot,
  setBranchPrefix,
  setRepositoryIncluded,
  setWorkspacesRoot,
} from '#renderer/projects-store.ts'

import { git, repository } from './repositories.ts'
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

/**
 * A dedicated Workspace `login-form` of the Project, made from its plan and prepared through the
 * channels the Spec panel will use, and waited for until the engine says it is `ready`.
 */
async function loginForm(engine: OpenWindow, projectId: string) {
  const plan = await engine.bridge.invoke('workspaces.plan', {
    projectId,
    key: 'HEM-7',
    slug: 'login-form',
  })
  const made = await engine.bridge.invoke('workspaces.create', {
    projectId,
    specId: null,
    name: 'login-form',
    repositories: plan.repositories.flatMap((one) =>
      one.base === null
        ? []
        : [{ relativePath: one.relativePath, branch: one.branch, base: one.base }],
    ),
  })
  await engine.bridge.invoke('preparation.prepare', { workspaceId: made.id })
  for (let waited = 0; waited < 100; waited += 1) {
    // oxlint-disable-next-line no-await-in-loop -- the preparation runs in the engine; its state is read until it ends
    const listed = await engine.bridge.invoke('workspaces.list', { projectId })
    const now = listed.find((one) => one.id === made.id)
    if (now?.state === 'ready') return now
    // oxlint-disable-next-line no-await-in-loop -- see above
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('login-form was never ready')
}

describe("A Workspace on a chosen folder takes the folder's name", () => {
  test('the folder picked is a Workspace named after it, ready, listed after main', async () => {
    const project = await atlas()
    const spike = join(elsewhere, 'spike')
    mkdirSync(spike)

    expect(await createOnFolder(project.id, spike, 'spike')).toBeNull()

    const rows = workspaceRowsOf(workspacesOf(project.id))
    expect(rows.map((one) => [one.name, one.state, one.main, one.dedicated])).toEqual([
      ['main', 'ready', true, false],
      ['spike', 'ready', false, false],
    ])
    // The same name again is the engine's refusal, said as it said it.
    expect(await createOnFolder(project.id, spike, 'spike')).toMatch(/spike/)
  })
})

describe('Cleanup removes the worktrees and keeps the branches', () => {
  test('the dialog names the branch kept, and the Workspace is cleaned up with it kept', async () => {
    const project = await atlas()
    const workspace = await loginForm(opened!, project.id)
    await readWorkspaces(project.id)

    expect(branchesKeptOf(workspace)).toEqual(['atlas/HEM-7-login-form'])
    expect(await cleanUp(project.id, workspace.id)).toBeNull()

    expect(workspacesOf(project.id).find((one) => one.id === workspace.id)?.state).toBe('cleaned')
    expect(git(join(main, 'api'), 'branch', '--list', 'atlas/HEM-7-login-form')).toContain(
      'atlas/HEM-7-login-form',
    )
  })
})

describe('Cleanup is refused while a service runs or Git refuses', () => {
  test("uncommitted changes are Git's refusal, said in its words, and nothing is removed", async () => {
    const project = await atlas()
    const workspace = await loginForm(opened!, project.id)
    writeFileSync(join(workspace.path, 'api', 'draft.txt'), 'not committed\n')

    const said = await cleanUp(project.id, workspace.id)

    expect(said).toMatch(/untracked|modified/)
    await readWorkspaces(project.id)
    expect(workspacesOf(project.id).find((one) => one.id === workspace.id)?.state).toBe('ready')
  })
})
