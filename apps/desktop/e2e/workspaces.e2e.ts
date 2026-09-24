/**
 * Real Workspaces, from a dedicated one assembled out of two repositories to the services it runs
 * and the commands its Sessions keep (issue #20, designs D8-04, D8-05, D8-08, D8-09, D8-11).
 *
 * The Project declares `./sources/api` and `./sources/front`, two repositories made here with the
 * machine's own `git`, without a remote, and removed after the run. Its recipe copies one file at
 * the root of every dedicated Workspace: the file the agent is started from on Windows
 * (`agent/install.ts`), which a Session in a dedicated Workspace needs as much as one in `main`.
 *
 * A dedicated Workspace is made **through the bridge** — `workspaces.plan`, `workspaces.create`,
 * then `preparation.prepare`, from the page — and not through a button: the one that opens the
 * creation dialog is the Spec panel's (D8-12), which waits for the Spec lot. Everything after
 * that is read from the window: the settings page shows it, its steps, its services.
 *
 * Each suite is named after the scenario of the issue's Spec it covers.
 */

import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { type AddressInfo, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, browser, expect } from '@wdio/globals'

import { git, repository } from '../tests/repositories.ts'
import { e2eDataOf } from '../wdio.conf.ts'
import { fakeWorkspace } from './agent/install.ts'
import { AGENT, ANSWERS, MODELS } from './agent/script.ts'
import { addProject, awaits, choose, control, fill, press, pressTab, shows, write } from './hand.ts'

/** The folder of `main`, which holds both repositories; kept for the reason `install.ts` gives. */
const MAIN = fakeWorkspace('workspaces')

/** The two repositories of `main`, made in `before` and removed in `after`. */
const SOURCES = join(MAIN, 'sources')

/** The data folder this spec runs on, under which Hemera makes its own Workspaces (D8-02). */
const E2E_DATA = e2eDataOf('workspaces.e2e.ts')

/**
 * The file whose appearance makes the `dev` server listen: until then it has printed its address
 * and nothing answers there, which is the "starting" the scenario is about (D8-09).
 */
const GO = join(tmpdir(), 'hemera-e2e-workspaces-go')

/** The port `dev` publishes, free when the suite starts; both instances publish it. */
let port = 0

/** The `serve` command of the catalogue, once the port is known. */
let serve = ''

/** A port nobody holds right now, asked of the system. */
async function freePort(): Promise<number> {
  return await new Promise((resolve) => {
    const server = createServer()
    server.listen(0, () => {
      // SAFETY: a server listening on a TCP port answers its address and port; only one listening
      // on a pipe answers a string, and null is a server that is not listening.
      const { port: free } = server.address() as AddressInfo
      server.close(() => resolve(free))
    })
  })
}

/**
 * A server that prints its address at once and only listens once `GO` exists; the second one to
 * listen finds the port taken and stays up without listening, as a process that lost the port
 * but was not told to end. Single quotes only: the whole script is one double-quoted word.
 */
function serveLine(published: number): string {
  const go = GO.replaceAll('\\', '/')
  const script = [
    "const h=require('http'),f=require('fs')",
    "const s=h.createServer((q,r)=>r.end('up'))",
    "s.on('error',()=>{})",
    'setInterval(()=>{},60000)',
    `console.log('http://localhost:${String(published)}')`,
    `const t=setInterval(()=>{if(f.existsSync('${go}')){clearInterval(t);s.listen(${String(published)})}},200)`,
  ].join(';')
  return `"${process.execPath}" -e "${script}"`
}

before(async () => {
  rmSync(SOURCES, { recursive: true, force: true })
  rmSync(GO, { force: true })
  repository(join(SOURCES, 'api'))
  repository(join(SOURCES, 'front'))
  port = await freePort()
  serve = serveLine(port)
})

after(() => {
  rmSync(SOURCES, { recursive: true, force: true })
  rmSync(GO, { force: true })
})

/** The id of the Project the suite made, asked of the engine. */
async function projectId(): Promise<string> {
  return await browser.execute(async () => {
    const projects = await window.hemera.invoke('projects.list', {})
    return projects.find((one) => one.name === 'Atlas')?.id ?? ''
  })
}

/** What a dedicated Workspace was made as: where it is, and the branch its worktrees are on. */
interface Made {
  readonly id: string
  readonly path: string
  readonly branch: string
}

/**
 * Plans and creates a dedicated Workspace from the plan as proposed, through the bridge (D8-04):
 * every repository `main` holds, on its local HEAD, on the branch the plan names. Nothing is
 * prepared yet: the Workspace is `preparing`, with its steps pending.
 */
async function dedicated(key: string, slug: string): Promise<Made> {
  const project = await projectId()
  return await browser.execute(
    async (projectOf: string, keyOf: string, slugOf: string) => {
      const plan = await window.hemera.invoke('workspaces.plan', {
        projectId: projectOf,
        key: keyOf,
        slug: slugOf,
      })
      const made = await window.hemera.invoke('workspaces.create', {
        projectId: projectOf,
        specId: null,
        name: slugOf,
        repositories: plan.repositories.flatMap((one) =>
          one.included && one.base !== null
            ? [{ relativePath: one.relativePath, branch: one.branch, base: one.base }]
            : [],
        ),
      })
      return { id: made.id, path: made.path, branch: plan.repositories[0]?.branch ?? '' }
    },
    project,
    key,
    slug,
  )
}

/** Starts the preparation of a Workspace; the engine answers at once and carries on (D8-05). */
async function prepare(workspaceId: string): Promise<void> {
  await browser.execute(async (id: string) => {
    await window.hemera.invoke('preparation.prepare', { workspaceId: id })
  }, workspaceId)
}

/** How many Sessions the Project holds, of any mission. */
async function sessionCount(): Promise<number> {
  const project = await projectId()
  return await browser.execute(async (id: string) => {
    const sessions = await window.hemera.invoke('sessions.list', { projectId: id })
    return sessions.length
  }, project)
}

/** What an element of the page says, or the empty string when there is none. */
async function textOf(selector: string): Promise<string> {
  return await browser.execute(
    (css: string) => document.querySelector(css)?.textContent ?? '',
    selector,
  )
}

/** What each item of a list of the page says, in order. */
async function itemsOf(selector: string): Promise<string[]> {
  return await browser.execute(
    (css: string) => [...document.querySelectorAll(css)].map((one) => one.textContent ?? ''),
    selector,
  )
}

/** Waits until an element of the page says this. */
async function awaitsIn(selector: string, text: string, within = 20_000): Promise<void> {
  await browser.waitUntil(async () => (await textOf(selector)).includes(text), {
    timeout: within,
    interval: 200,
    timeoutMsg: `${selector} never showed "${text}"`,
  })
}

/** The row of a Workspace in the settings' list, found by the button that shows it. */
function rowOf(name: string): string {
  return `ul[aria-label="Workspaces"] li:has(button[aria-label="Show ${name}"])`
}

const SERVICES = 'ul[aria-label="Services"]'

/** Shows this Workspace under the list, unless it is the one shown already. */
async function show(name: string): Promise<void> {
  const button = await $(`button[aria-label="Show ${name}"]`)
  if ((await button.getAttribute('aria-pressed')) !== 'true') await press(`Show ${name}`)
  await browser.pause(800)
}

/**
 * Starts a Session in this Workspace from the Home's composer, with the suite's agent, and waits
 * for its first answer.
 */
async function startSession(workspace: string, said: string): Promise<void> {
  await press('New Session')
  await browser.pause(600)
  if ((await control('Start chat'))?.said === 'Choose an agent first') {
    await press('Choose an agent')
    await press(AGENT)
    await awaits(MODELS[0].name)
    await browser.keys('Escape')
    await browser.pause(400)
  }
  await choose('Workspace', workspace)
  await write(said)
  await press('Start chat')
  await awaits(said)
  await awaits(ANSWERS[0])
}

/** Opens the Commands tab of the Session details. */
async function openCommands(): Promise<void> {
  await press('Session details')
  await browser.pause(400)
  await pressTab('Commands')
}

/**
 * Runs a line from the Commands panel: a catalogue name runs that command, anything else is a
 * one-off. "Run" is pressed inside the details, where a hand would: the thread behind it draws
 * the same runs, and their summaries say "Running".
 */
async function runLine(line: string): Promise<void> {
  await fill('Run a line', line)
  await $('[role="dialog"]').$('button=Run').click()
  await browser.pause(600)
}

/** The dedicated Workspace the services run in beside `main`. */
let loginForm: Made

describe('A dedicated Workspace assembles one worktree per repository', () => {
  it('declares two repositories, a recipe and a serve command in the settings', async () => {
    await addProject('Atlas', MAIN)
    await press('Project settings')
    await browser.pause(600)
    await fill('Add a path', './sources/api')
    await press('Add a path')
    await browser.pause(400)
    await fill('Add a path', './sources/front')
    await press('Add a path')
    await browser.pause(400)

    // The recipe: the agent's entry file copied at the root (D8-05).
    await fill('File', 'acp')
    await $('button=Add').click()
    // Written as the engine keeps a relative path: from the root, with its `./`.
    await awaits('copy ./acp at the root')

    // A `serve` of scope `workspace`: one instance per Workspace (D8-07).
    await fill('Command name', 'dev')
    await fill('Default line', serve)
    await choose('Type', 'Serve')
    await press('Add a command')
    await browser.pause(600)
    expect(await $('button[aria-label="Remove dev"]').isExisting()).toBe(true)
  })

  it('makes both worktrees on the plan, offline, and shows the Workspace ready on its branch', async () => {
    loginForm = await dedicated('HEM-7', 'login-form')
    const made = loginForm
    await prepare(made.id)
    await awaitsIn(rowOf('login-form'), 'Ready')

    // In Hemera's own folder for this Project, under the data folder (D8-02), one worktree per
    // repository at the same relative path, each on the branch of the plan (D8-04).
    expect(made.path).toContain(join(E2E_DATA, 'workspaces'))
    expect(made.branch).toBe('atlas/HEM-7-login-form')
    for (const one of ['api', 'front']) {
      const worktree = join(made.path, 'sources', one)
      expect(existsSync(join(worktree, '.git'))).toBe(true)
      expect(git(worktree, 'branch', '--show-current')).toBe(made.branch)
    }

    // The page reads Git when it shows the Workspace (D8-15): both repositories on the branch.
    await show('login-form')
    await awaitsIn('ul[aria-label="Repositories of login-form"]', made.branch)
    const repositories = await itemsOf('ul[aria-label="Repositories of login-form"] li')
    expect(repositories).toHaveLength(2)
    for (const line of repositories) expect(line).toContain(made.branch)
  })
})

describe('A failed step keeps what succeeded', () => {
  let made: Made

  it('stops on the second worktree with Git message, keeps the first, and offers Resume', async () => {
    made = await dedicated('HEM-8', 'signup')
    // The branch appears in `sources/front` after the checks and before the step: Git refuses the
    // second worktree when it comes to it.
    git(join(SOURCES, 'front'), 'branch', made.branch)
    await prepare(made.id)
    await awaitsIn(rowOf('signup'), 'Failed')

    await show('signup')
    await awaitsIn('ul[aria-label="Steps"]', 'Failed')
    const steps = await itemsOf('ul[aria-label="Steps"] li')
    expect(steps).toHaveLength(3)
    expect(steps[0]).toContain('Done')
    expect(steps[1]).toContain('Failed')
    // Git's own message, in whatever language the machine speaks it: it names the branch.
    expect(steps[1]).toContain(`'${made.branch}'`)
    expect(steps[2]).toContain('Pending')
    expect(existsSync(join(made.path, 'sources', 'api', '.git'))).toBe(true)
    expect(await shows('Resume')).toBe(true)

    // Nothing was made to wait for it: no Session at all, so no `build` one (D8-05).
    expect(await sessionCount()).toBe(0)
  })
})

describe('Resuming re-checks before retrying', () => {
  it('retries the failed worktree once its cause is gone, and ends ready', async () => {
    git(join(SOURCES, 'front'), 'branch', '-D', 'atlas/HEM-8-signup')
    await press('Resume')
    await awaitsIn(rowOf('signup'), 'Ready')

    await awaitsIn('ul[aria-label="Steps"] li:last-child', 'Done')
    const steps = await itemsOf('ul[aria-label="Steps"] li')
    for (const step of steps) expect(step).toContain('Done')
    expect(await sessionCount()).toBe(0)
  })
})

describe('A URL is ready only after it answers', () => {
  it('runs dev from a Session in main, starting until something listens there, then ready', async () => {
    await startSession('main', 'Serve the app in main.')
    await openCommands()
    await runLine('dev')
    await awaitsIn('[role="dialog"]', 'Running')
    await browser.keys('Escape')
    await browser.pause(400)

    // A Workspace's services are shown with it in the settings (D8-08).
    await press('Project settings')
    await browser.pause(600)
    await show('main')
    await awaitsIn(SERVICES, `http://localhost:${String(port)}`)
    expect(await textOf(SERVICES)).toContain('starting')
    await browser.pause(1500)
    // Still nothing listening, still starting: printing an address is not answering on it.
    expect(await textOf(SERVICES)).toContain('starting')
    expect(await textOf(SERVICES)).not.toContain('ready')

    writeFileSync(GO, '')
    await awaitsIn(SERVICES, 'ready')
  })
})

describe('Two Workspaces run the same command as two instances', () => {
  it('runs dev from a Session in login-form too, where running it again joins it', async () => {
    await startSession('login-form', 'Serve the app in login-form.')
    // The agent started in login-form: its Workspace is fixed now (D8-08).
    expect(await shows('The Workspace is fixed once the agent has started.')).toBe(true)
    await openCommands()
    await runLine('dev')
    await awaitsIn('[role="dialog"]', 'Running')
    await runLine('dev')
    await browser.keys('Escape')
    await browser.pause(400)

    // One instance per Workspace, each in its own folder.
    await press('Project settings')
    await browser.pause(600)
    await show('login-form')
    await awaitsIn(SERVICES, 'dev')
    const here = await itemsOf(`${SERVICES} > li`)
    expect(here).toHaveLength(1)
    expect(here[0]).toContain('Running')
    expect(here[0]).toContain(loginForm.path)

    await show('main')
    const there = await itemsOf(`${SERVICES} > li`)
    expect(there).toHaveLength(1)
    expect(there[0]).toContain('Running')
    expect(there[0]).toContain(MAIN)
  })
})

describe('A port conflict names its holder', () => {
  it('names the holder on the second run, and the second run on the holder', async () => {
    await show('login-form')
    await awaitsIn(SERVICES, `Port ${String(port)} is held by dev in main`)
    await show('main')
    await awaitsIn(SERVICES, `Port ${String(port)} is also published by dev in login-form`)
  })
})

describe('Stopping one instance leaves the other running', () => {
  it('stops dev in login-form and leaves dev in main running', async () => {
    await show('login-form')
    await press('Stop dev in login-form')
    await awaits('No service is running')

    await show('main')
    const left = await itemsOf(`${SERVICES} > li`)
    expect(left).toHaveLength(1)
    expect(left[0]).toContain('Running')

    // Put away, so the port is free again once the suite ends.
    await press('Stop dev in main')
    await awaits('No service is running')
  })
})
