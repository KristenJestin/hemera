/**
 * The Workspaces of a Project's settings, over the whole engine (D8-02, D8-04, D8-05, D8-06,
 * D8-14, D8-15, Decided 17).
 *
 * The page is drawn from the projects store and the Workspaces store: what is under test is that
 * what the settings write is what the engine then answers — the folder and the prefix of dedicated
 * Workspaces, a repository's place in them, a Workspace on a folder the user picked and its card,
 * the recipe and the variables — and that a refusal comes back in the engine's own words.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { fakeAgent } from '#engine/agents/fake.ts'
import { repositoryLinesOf } from '#renderer/project-lines.ts'
import {
  branchOfName,
  branchesKeptOf,
  planLinesOf,
  recipeAddOf,
  recipeLinesOf,
  runDetailsOf,
  serviceLinesOf,
  stepLinesOf,
  workspaceCardOf,
  workspaceRowsOf,
  workspaceVariablesOf,
  worktreesOf,
} from '#renderer/workspace-details.ts'
import {
  addRecipeStep,
  cleanUp,
  createDedicated,
  createOnFolder,
  listenToWorkspaces,
  moveRecipeStep,
  planDedicated,
  readMainStatus,
  readProjectVariables,
  readRecipe,
  readWorkspaces,
  recipeOf,
  removeRecipeStep,
  setVariable,
  showStepRun,
  showWorkspace,
  stopService,
  updateRecipeStep,
  workspacesOf,
  workspacesSnapshot,
} from '#renderer/workspaces-store.ts'
import {
  loadProjects,
  projectsSnapshot,
  setBranchPrefix,
  setRepositoryIncluded,
  setWorkspacesRoot,
  updateRepository,
} from '#renderer/projects-store.ts'

import { git, repository } from './repositories.ts'
import { type OpenWindow, install, openWindow } from './window.ts'

let dataFolder: string
let main: string
let elsewhere: string
let opened: OpenWindow | null = null

beforeEach(() => {
  // The engine spells a path the way the filesystem does — `realpathSync.native`, the long form
  // of a short name under a Windows runner — so the fixture is settled the same way before use.
  dataFolder = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-workspace-settings-')))
  main = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-workspace-settings-main-')))
  elsewhere = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'hemera-workspace-settings-elsewhere-')),
  )
})

afterEach(async () => {
  await showWorkspace(null)
  await opened?.close()
  opened = null
  // A window closed at the end of a test may still hold its engine and the repositories under
  // main, and a Windows runner runs the ten seconds a hook is given out: this suite's own timeout,
  // and the retry agent-tools.test.ts uses.
  for (const folder of [dataFolder, main, elsewhere])
    rmSync(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}, 60_000)

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
async function loginForm(
  engine: OpenWindow,
  projectId: string,
  ends: 'ready' | 'failed' = 'ready',
) {
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
    if (now?.state === ends && !now.live) return now
    // oxlint-disable-next-line no-await-in-loop -- see above
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`login-form was never ${ends}`)
}

describe("A Workspace on a chosen folder takes the folder's name", () => {
  test('the folder picked is a Workspace named after it, ready, listed after main', async () => {
    const project = await atlas()
    const spike = join(elsewhere, 'spike')
    mkdirSync(spike)

    // No name given: the engine names it after the folder (D8-02).
    expect(await createOnFolder(project.id, spike)).toBeNull()

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
  test("a running service, then uncommitted changes, are refused in the engine's words", async () => {
    const project = await atlas()
    const workspace = await loginForm(opened!, project.id)
    const { bridge } = opened!
    await bridge.invoke('commands.create', {
      projectId: project.id,
      name: 'dev',
      line: printsOnly(43918),
      type: 'serve',
      lineWindows: null,
      lineLinux: null,
      scope: 'workspace',
      portless: false,
      portlessName: null,
      folderBase: null,
      folder: null,
    })
    const session = await bridge.invoke('sessions.create', {
      projectId: project.id,
      provider: 'claude',
      workspaceId: workspace.id,
    })
    const dev = await bridge.invoke('commands.run', { sessionId: session.id, name: 'dev' })

    // A service of it runs: the refusal names it, and nothing is removed.
    expect(await cleanUp(project.id, workspace.id)).toBe('the service dev of login-form is running')
    await readWorkspaces(project.id)
    expect(workspacesOf(project.id).find((one) => one.id === workspace.id)?.state).toBe('ready')

    // Stopped, the service no longer holds it; a change nobody committed does, in Git's words.
    await bridge.invoke('commands.stopService', { projectId: project.id, runId: dev.id })
    writeFileSync(join(workspace.path, 'api', 'draft.txt'), 'not committed\n')

    const said = await cleanUp(project.id, workspace.id)

    expect(said).toMatch(/untracked|modified/)
    await readWorkspaces(project.id)
    expect(workspacesOf(project.id).find((one) => one.id === workspace.id)?.state).toBe('ready')
  })
})

/** Waits for the store to hold what is waited for, in real time. */
async function until(ready: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !ready(); tries += 1) {
    // oxlint-disable-next-line no-await-in-loop -- a poll: each look waits for the one before it
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('A Workspace is shown under the list with its Git state, steps and variables', () => {
  test("its card says Git's branch, its steps are done, and its PORT overrides the Project's", async () => {
    const project = await atlas()
    const workspace = await loginForm(opened!, project.id)
    await readWorkspaces(project.id)

    // Scenario: "A Workspace's variable overrides the Project's", as the editors write it.
    expect(await setVariable(project.id, null, 'PORT', '3000')).toBeNull()
    await readProjectVariables(project.id)
    await showWorkspace(workspace)
    expect(await setVariable(project.id, workspace.id, 'PORT', '3001')).toBeNull()

    const shown = workspacesSnapshot().shown!
    // Scenario: "Each repository shows its branch, commit and changes", read when shown.
    const [api] = workspaceCardOf(workspace, shown.status).repositories
    expect(api).toMatchObject({
      path: './api',
      git: { ok: true, branch: 'atlas/HEM-7-login-form' },
    })
    expect(stepLinesOf(shown.steps).map((one) => [one.kind, one.state])).toEqual([
      ['worktree', 'done'],
    ])
    expect(
      workspaceVariablesOf(shown.variables, workspacesSnapshot().variables.get(project.id) ?? []),
    ).toEqual([{ key: 'PORT', value: '3001', overrides: '3000' }])
    // A key a shell would have to quote is the engine's refusal too, in its words.
    expect(await setVariable(project.id, workspace.id, 'api-url', 'x')).not.toBeNull()
  })
})

describe('Setting an existing key rewrites its value', () => {
  test("the editors rewrite the Project's PORT, a Workspace's and main's, and show the new one", async () => {
    const project = await atlas()
    const workspace = await loginForm(opened!, project.id)
    await readWorkspaces(project.id)
    const own = workspacesOf(project.id).find((one) => one.main)!
    const valuesOf = (variables: readonly { key: string; value: string }[]) =>
      variables.map((one) => [one.key, one.value])
    /** A Workspace shown, its PORT set then set again: what the editor and the engine hold. */
    const editedIn = async (shown: typeof workspace) => {
      await showWorkspace(shown)
      expect(await setVariable(project.id, shown.id, 'PORT', '3001')).toBeNull()
      expect(await setVariable(project.id, shown.id, 'PORT', '4001')).toBeNull()
      return {
        editor: valuesOf(workspacesSnapshot().shown!.variables),
        engine: valuesOf(
          await opened!.bridge.invoke('variables.list', {
            projectId: project.id,
            workspaceId: shown.id,
          }),
        ),
      }
    }

    expect(await setVariable(project.id, null, 'PORT', '3000')).toBeNull()
    expect(await setVariable(project.id, null, 'PORT', '4000')).toBeNull()
    expect(valuesOf(workspacesSnapshot().variables.get(project.id) ?? [])).toEqual([
      ['PORT', '4000'],
    ])

    // One key, its last value, in the editor as in the engine: a dedicated Workspace, then main.
    const one = { editor: [['PORT', '4001']], engine: [['PORT', '4001']] }
    expect(await editedIn(workspace)).toEqual(one)
    expect(await editedIn(own)).toEqual(one)
    // The Project's own value is untouched by the Workspaces' edits.
    expect(valuesOf(workspacesSnapshot().variables.get(project.id) ?? [])).toEqual([
      ['PORT', '4000'],
    ])
  })
})

/** A line that prints an address on `port` and stays up, never listening on it. */
const printsOnly = (port: number) =>
  `"${process.execPath}" -e "console.log('http://localhost:${String(port)}');setInterval(()=>{},1000)"`

describe('A port conflict names its holder', () => {
  test('the services of each Workspace say the conflict, and one instance is stopped alone', async () => {
    const project = await atlas()
    const stop = listenToWorkspaces()
    try {
      const workspace = await loginForm(opened!, project.id)
      await readWorkspaces(project.id)
      const { bridge } = opened!
      await bridge.invoke('commands.create', {
        projectId: project.id,
        name: 'dev',
        line: printsOnly(43917),
        type: 'serve',
        lineWindows: null,
        lineLinux: null,
        scope: 'workspace',
        portless: false,
        portlessName: null,
        folderBase: null,
        folder: null,
      })
      const inMain = await bridge.invoke('sessions.create', {
        projectId: project.id,
        provider: 'claude',
      })
      const inLoginForm = await bridge.invoke('sessions.create', {
        projectId: project.id,
        provider: 'claude',
        workspaceId: workspace.id,
      })
      const mainMade = workspacesOf(project.id).find((one) => one.main)!
      await showWorkspace(mainMade)
      const holder = await bridge.invoke('commands.run', { sessionId: inMain.id, name: 'dev' })
      await until(() => (workspacesSnapshot().shown?.services[0]?.url ?? null) !== null)
      await bridge.invoke('commands.run', { sessionId: inLoginForm.id, name: 'dev' })

      // The holder's side, derived as the list is read again on the push (Decided 12).
      await until(() => (workspacesSnapshot().shown?.services[0]?.heldAgainst.length ?? 0) > 0)
      expect(serviceLinesOf(workspacesSnapshot().shown!.services, [])).toMatchObject([
        {
          id: holder.id,
          workspace: 'main',
          heldAgainst: [{ port: 43917, run: 'dev', workspace: 'login-form' }],
        },
      ])

      // The second's side, in its own Workspace.
      await showWorkspace(workspace)
      await until(() => (workspacesSnapshot().shown?.services[0]?.portConflict ?? null) !== null)
      const [second] = serviceLinesOf(workspacesSnapshot().shown!.services, [])
      expect(second).toMatchObject({
        workspace: 'login-form',
        portConflict: { port: 43917, holderRun: 'dev', holderWorkspace: 'main' },
      })

      // Scenario: "Stopping one instance leaves the other running", from the settings.
      await stopService(second!.id)
      expect(workspacesSnapshot().shown?.services).toEqual([])
      const still = await bridge.invoke('commands.services', {
        projectId: project.id,
        workspaceId: null,
      })
      expect(still.map((one) => one.id)).toEqual([holder.id])
    } finally {
      stop()
    }
  })
})

describe('The steps follow the recipe in order', () => {
  test('the recipe written in the settings is the order a new Workspace is prepared in', async () => {
    const project = await atlas()
    const { bridge } = opened!
    const installing = await bridge.invoke('commands.create', {
      projectId: project.id,
      name: 'install',
      line: `"${process.execPath}" -e ""`,
      type: 'script',
      lineWindows: null,
      lineLinux: null,
      scope: 'workspace',
      portless: false,
      portlessName: null,
      folderBase: null,
      folder: null,
    })
    await readRecipe(project.id)
    expect(recipeOf(project.id)).toEqual([])

    const run = recipeAddOf({
      kind: 'run',
      base: null,
      path: null,
      commandId: installing.id,
      line: null,
      lineWindows: null,
      lineLinux: null,
    })
    expect(await addRecipeStep(project.id, run)).toBeNull()
    // The source is in main: the engine accepts a copy only then.
    writeFileSync(join(main, '.env'), 'PORT=3000\n')
    const copy = recipeAddOf({
      kind: 'copy',
      base: null,
      path: '.env',
      commandId: null,
      line: null,
      lineWindows: null,
      lineLinux: null,
    })
    expect(await addRecipeStep(project.id, copy)).toBeNull()
    // A path that leaves the Workspace is the engine's refusal, in its words.
    const outside = recipeAddOf({
      kind: 'link',
      base: null,
      path: '../elsewhere',
      commandId: null,
      line: null,
      lineWindows: null,
      lineLinux: null,
    })
    expect(await addRecipeStep(project.id, outside)).not.toBeNull()
    const [first, second] = recipeOf(project.id)
    await moveRecipeStep(project.id, second!.id, 'up')
    expect(recipeLinesOf(recipeOf(project.id)).map((one) => one.kind)).toEqual(['copy', 'run'])

    const workspace = await loginForm(opened!, project.id)
    const steps = await bridge.invoke('preparation.steps', { workspaceId: workspace.id })
    expect(stepLinesOf(steps).map((one) => [one.kind, one.target])).toEqual([
      ['worktree', './api'],
      // The path as the engine keeps it, relative to the root.
      ['copy', './.env'],
      ['run', 'install'],
    ])

    await removeRecipeStep(project.id, first!.id)
    expect(recipeOf(project.id).map((one) => one.kind)).toEqual(['copy'])
    expect(workspacesSnapshot().refusal).toBeNull()

    // A step that is not there any more is the engine's refusal, kept for the page to say.
    await removeRecipeStep(project.id, first!.id)
    expect(workspacesSnapshot().refusal).not.toBeNull()
    expect(recipeOf(project.id).map((one) => one.kind)).toEqual(['copy'])
  })
})

describe('A run step fails on a non-zero exit', () => {
  test('its step says the exit, and opening it shows the run with its output and code', async () => {
    const project = await atlas()
    const { bridge } = opened!
    const failing = await bridge.invoke('commands.create', {
      projectId: project.id,
      name: 'install',
      line: `"${process.execPath}" -e "console.log('lockfile out of date');process.exit(1)"`,
      type: 'script',
      lineWindows: null,
      lineLinux: null,
      scope: 'workspace',
      portless: false,
      portlessName: null,
      folderBase: null,
      folder: null,
    })
    expect(
      await addRecipeStep(
        project.id,
        recipeAddOf({
          kind: 'run',
          base: null,
          path: null,
          commandId: failing.id,
          line: null,
          lineWindows: null,
          lineLinux: null,
        }),
      ),
    ).toBeNull()

    const workspace = await loginForm(opened!, project.id, 'failed')
    await showWorkspace(workspace)
    const failed = stepLinesOf(workspacesSnapshot().shown!.steps).find((one) => one.kind === 'run')
    // The step line sums the run up; the run itself is one no Session asked for (Decided 11).
    expect(failed).toMatchObject({ state: 'failed', message: 'exit 1' })
    expect(failed?.runId).toBeDefined()

    await showStepRun(failed!.runId!)

    const details = runDetailsOf(workspacesSnapshot().shown!.run!)
    expect(details).toMatchObject({ name: 'install', state: 'failed', exitCode: 1 })
    expect(details.output).toContain('lockfile out of date')

    // Another Project's run, or none, is the engine's refusal, said on the page.
    await showStepRun('no-such-run')
    expect(workspacesSnapshot().refusal).toContain('no-such-run')
    await showStepRun(null)
    expect(workspacesSnapshot().shown?.run).toBeNull()
  })
})

describe('A dedicated Workspace is made from the settings with no Spec', () => {
  test('its branch is the prefix and the name, it is prepared, and main says its Git state', async () => {
    const project = await atlas()
    const stop = listenToWorkspaces()
    try {
      await readWorkspaces(project.id)
      await readMainStatus(project.id)
      // main's row: the repository api on its branch, nothing changed.
      const [mainRow] = workspaceRowsOf(
        workspacesOf(project.id),
        workspacesSnapshot().mainStatus.get(project.id) ?? null,
      )
      expect(mainRow?.summary).toMatchObject({ changes: 'clean' })

      const plan = await planDedicated(project.id)
      expect(plan).not.toBeNull()
      // What the dialog hands over once named: every repository of the plan, on the branch the
      // name makes.
      const branch = branchOfName(plan!.branchPrefix)('Spike one')
      const worktrees = worktreesOf({
        name: 'spike-one',
        repositories: planLinesOf(plan!).map((one) => ({
          path: one.path,
          base: one.base!,
          branch,
        })),
      })

      expect(await createDedicated(project.id, 'spike-one', worktrees)).toBeNull()

      const made = workspacesOf(project.id).find((one) => one.name === 'spike-one')!
      expect(workspacesSnapshot().shown?.workspaceId).toBe(made.id)
      await until(
        () => workspacesOf(project.id).find((one) => one.id === made.id)?.state === 'ready',
      )
      expect(workspacesOf(project.id).find((one) => one.id === made.id)).toMatchObject({
        specId: null,
        state: 'ready',
        repositories: [{ relativePath: './api', branch: 'atlas/spike-one' }],
      })
      // The same name again is refused before anything is written, in the engine's words.
      expect(await createDedicated(project.id, 'spike-one', worktrees)).toMatch(/spike-one/)
    } finally {
      stop()
    }
  })
})

describe('A recipe step is edited where it stands', () => {
  test('its path is rewritten in place, and a source absent from main is refused by name', async () => {
    const project = await atlas()
    writeFileSync(join(main, '.env'), 'PORT=3000\n')
    writeFileSync(join(main, '.env.local'), 'PORT=3001\n')
    const copy = recipeAddOf({
      kind: 'copy',
      base: null,
      path: '.env',
      commandId: null,
      line: null,
      lineWindows: null,
      lineLinux: null,
    })
    expect(await addRecipeStep(project.id, copy)).toBeNull()
    const [step] = recipeOf(project.id)

    const local = recipeAddOf({
      kind: 'copy',
      base: null,
      path: '.env.local',
      commandId: null,
      line: null,
      lineWindows: null,
      lineLinux: null,
    })
    expect(await updateRecipeStep(project.id, step!.id, local)).toBeNull()
    expect(recipeOf(project.id)).toMatchObject([
      { id: step!.id, path: expect.stringContaining('.env.local') },
    ])

    const absent = recipeAddOf({
      kind: 'copy',
      base: null,
      path: '.env.prod',
      commandId: null,
      line: null,
      lineWindows: null,
      lineLinux: null,
    })
    expect(await updateRecipeStep(project.id, step!.id, absent)).toMatch(/\.env\.prod/)
    expect(recipeOf(project.id)).toMatchObject([{ path: expect.stringContaining('.env.local') }])
  })
})

describe('A repository is rewritten from its dialog', () => {
  test('its icon and its inclusion are saved, and the row wears them', async () => {
    const project = await atlas()

    expect(
      await updateRepository(held(project.id), './api', {
        path: './api',
        icon: 'server',
        included: false,
      }),
    ).toBe(true)

    expect(held(project.id)).toMatchObject({
      included: [],
      repositoryIcons: { './api': 'server' },
    })
    const [line] = repositoryLinesOf(
      [{ path: './api', git: 'main', exists: true }],
      held(project.id),
    )
    expect(line).toMatchObject({ icon: 'server', includedByDefault: false })
  })
})
