/**
 * Real Workspaces, from a dedicated one assembled out of two repositories to the services it runs
 * and the commands its Sessions keep (issue #20, designs D8-04, D8-05, D8-08, D8-09, D8-11).
 *
 * The Project declares `./sources/api` and `./sources/front`, two repositories made here with the
 * machine's own `git`, without a remote, and removed after the run. Its recipe copies the file the
 * agent is started from on Windows (`agent/install.ts`) at the root of every dedicated Workspace,
 * which a Session in one needs as much as one in `main`, and the `.env` of `api` into its
 * worktree. Everything is declared the way a hand does it: a section of the settings' navigation,
 * its "Add…" or pencil dialog, filled in and confirmed.
 *
 * `login-form` is made from the settings: "New Workspace", its name in the creation dialog, and
 * Create, which prepares it (D8-04, D8-05). `signup` is made **through the bridge** —
 * `workspaces.plan`, `workspaces.create`, then `preparation.prepare`, from the page — because its
 * failure is a branch that appears between the checks and the step, which no hand can slip in
 * between two clicks. Everything after that is read from the window: the settings page shows the
 * Workspaces, each row opening in place on its steps, its services and its variables.
 *
 * The agent is the suite's fake one (`agent/program.ts`): a turn that names `seed` proposes it for
 * the catalogue through Hemera's `commands_propose`, which only the human's click writes.
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
import { AGENT, ANSWERS, COMMAND_PROPOSAL, COMMAND_PROPOSE_ANSWER, MODELS } from './agent/script.ts'
import {
  addProject,
  awaits,
  choose,
  control,
  fill,
  press,
  pressIn,
  pressTab,
  region,
  shows,
  write,
} from './hand.ts'

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

/** A one-off line, run from the Commands panel; a one-off is named after its first word. */
const ONCE = `node -e "console.log('once')"`

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
  // What the recipe copies from `api` into its worktree: unversioned, as an `.env` is.
  writeFileSync(join(SOURCES, 'api', '.env'), 'PORT=3000\n')
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
      const reads = await Promise.all(
        plan.repositories.map((relativePath) =>
          window.hemera.invoke('workspaces.planRepository', {
            projectId: projectOf,
            key: keyOf,
            slug: slugOf,
            relativePath,
          }),
        ),
      )
      const made = await window.hemera.invoke('workspaces.create', {
        projectId: projectOf,
        specId: null,
        name: slugOf,
        repositories: reads.flatMap((one) =>
          one.included && one.base !== null
            ? [{ relativePath: one.relativePath, branch: one.branch, base: one.base }]
            : [],
        ),
      })
      return { id: made.id, path: made.path, branch: reads[0]?.branch ?? '' }
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

/** The names the Project's catalogue holds, asked of the engine. */
async function catalogue(): Promise<string[]> {
  const project = await projectId()
  return await browser.execute(async (id: string) => {
    const commands = await window.hemera.invoke('commands.list', { projectId: id })
    return commands.map((one) => one.name)
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

/** Waits until an element of the page says this, and says what it said instead when it never does. */
async function awaitsIn(selector: string, text: string, within = 20_000): Promise<void> {
  let said = ''
  await browser
    .waitUntil(
      async () => {
        said = await textOf(selector)
        return said.includes(text)
      },
      { timeout: within, interval: 200 },
    )
    .catch(() => {
      throw new Error(`${selector} never showed "${text}"; it said "${said}"`)
    })
}

/** The row of a Workspace in the settings' list, found by the button that opens it. */
function rowOf(name: string): string {
  return `ul[aria-label="Workspaces"] > li:has(button[aria-label="Details of ${name}"])`
}

const SERVICES = 'ul[aria-label="Services"]'

/** Opens the Project's settings on one section of their navigation. */
async function settings(section: string): Promise<void> {
  await press('Project settings')
  await browser.pause(600)
  await pressTab(section)
}

/**
 * Opens this Workspace's row in place, unless it is the one open already; from the Workspaces
 * section, which it goes to first when the page is on another one.
 */
async function show(name: string): Promise<void> {
  const details = `button[aria-label="Details of ${name}"]`
  if (!(await $(details).isExisting())) await pressTab('Workspaces')
  if ((await $(details).getAttribute('aria-expanded')) !== 'true') {
    await press(`Details of ${name}`)
  }
  await browser.pause(800)
}

/** Declares a repository from its section: "Add repository", its path, and the dialog's Add. */
async function declare(path: string): Promise<void> {
  await press('Add repository')
  await fill('Path', path)
  await pressIn('[role="dialog"]', 'Add repository')
  await browser.pause(600)
}

/** Adds a copy of `path` under `base` from the Preparation section's step dialog. */
async function copyStep(base: string, path: string): Promise<void> {
  await press('Add step')
  await choose('Base', base)
  await fill('Path', path)
  await pressIn('[role="dialog"]', 'Add')
  await browser.pause(600)
}

/** What a dedicated Workspace the list holds was made as, asked of the engine by its name. */
async function listed(name: string): Promise<Made> {
  const project = await projectId()
  return await browser.execute(
    async (projectOf: string, nameOf: string) => {
      const all = await window.hemera.invoke('workspaces.list', { projectId: projectOf })
      const made = all.find((one) => one.name === nameOf)
      return {
        id: made?.id ?? '',
        path: made?.path ?? '',
        branch: made?.repositories[0]?.branch ?? '',
      }
    },
    project,
    name,
  )
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
    await settings('Repositories')
    await declare('./sources/api')
    await declare('./sources/front')

    // The recipe (D8-05): the agent's entry file copied at the root, written as the engine keeps
    // a relative path, with its `./`.
    await pressTab('Preparation')
    await copyStep('Workspace root', 'acp')
    await awaits('copy ./acp at the root')
    // A copy from a repository whose source is not in main is refused in its dialog, in the
    // engine's words, and the dialog stays open on it until the path is one main holds.
    await copyStep('api', '.env.missing')
    expect(await region('[role="dialog"]')).toContain('does not exist in main')
    await fill('Path', '.env')
    await pressIn('[role="dialog"]', 'Add')
    await browser.pause(600)
    await awaits('copy ./.env from api')

    // A `serve` of scope `workspace`, one instance per Workspace (D8-07), run from `api`.
    await pressTab('Commands')
    await press('Add command')
    await fill('Name', 'dev')
    await fill('Line', serve)
    await choose('Type', 'Serve')
    await choose('Runs from', 'api')
    await pressIn('[role="dialog"]', 'Add command')
    await browser.pause(600)
    expect(await $('button[aria-label="Remove dev"]').isExisting()).toBe(true)
    // Its row says its name and its line, and none of the badges the four of them used to be:
    // the scope, the base and its folder are the dialog's (recette 2).
    const rows = await textOf('ul[aria-label="Commands"]')
    expect(rows).toContain('dev')
    expect(rows).toContain(`localhost:${String(port)}`)
    expect(rows).not.toContain('Per Workspace')
    expect(rows).not.toContain('Workspace root')
  })

  it("says on main's row what Git answers of its first repository", async () => {
    await pressTab('Workspaces')
    // `api` on its branch `main`, with the `.env` nobody committed.
    await awaitsIn(rowOf('main'), '1 untracked')
  })

  it('makes both worktrees on the plan, offline, and shows the Workspace ready on its branch', async () => {
    // From the settings, with no Spec: the branches follow the name under the prefix (D8-04).
    await press('New Workspace')
    // The dialog opens once the engine answered the plan.
    await awaits('Nothing is fetched.')
    await fill('Name', 'login-form')
    await pressIn('[role="dialog"]', 'Create')
    await awaitsIn(rowOf('login-form'), 'Ready')
    loginForm = await listed('login-form')
    const made = loginForm

    // In Hemera's own folder for this Project, under the data folder (D8-02), one worktree per
    // repository at the same relative path, each on the branch the name made (D8-04), and the
    // recipe's copy of `api`'s `.env` in its worktree (D8-05).
    expect(made.path).toContain(join(E2E_DATA, 'workspaces'))
    expect(made.branch).toBe('atlas/login-form')
    expect(existsSync(join(made.path, 'sources', 'api', '.env'))).toBe(true)
    for (const one of ['api', 'front']) {
      const worktree = join(made.path, 'sources', one)
      expect(existsSync(join(worktree, '.git'))).toBe(true)
      expect(git(worktree, 'branch', '--show-current')).toBe(made.branch)
    }

    // The page reads Git when it opens the Workspace (D8-15): both repositories on the branch.
    // Made from the settings, it was opened in the list as it was made.
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
    expect(steps).toHaveLength(4)
    expect(steps[0]).toContain('Done')
    expect(steps[1]).toContain('Failed')
    // Git's own message, in whatever language the machine speaks it: it names the branch.
    expect(steps[1]).toContain(`'${made.branch}'`)
    expect(steps[2]).toContain('Pending')
    expect(steps[3]).toContain('Pending')
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
    await settings('Workspaces')
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
    // The agent started in login-form: its Workspace is fixed now (D8-08), a plain label whose
    // tooltip says why (issue #128).
    expect(await $('[aria-label="Workspace: login-form"]').waitForExist()).toBe(true)
    await openCommands()
    await runLine('dev')
    await awaitsIn('[role="dialog"]', 'Running')
    await runLine('dev')
    await browser.keys('Escape')
    await browser.pause(400)

    // One instance per Workspace, each in its own folder.
    await settings('Workspaces')
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

describe('A proposal enters the catalogue only when accepted', () => {
  it('shows the proposal in the thread, and writes the catalogue on Accept only', async () => {
    await press('Serve the app in main.')
    await browser.pause(900)
    await write(`Keep the ${COMMAND_PROPOSAL.name} command, please.`)
    await press('Send')
    await awaits(COMMAND_PROPOSE_ANSWER)

    const proposal = `section[aria-label="Proposed command ${COMMAND_PROPOSAL.name}"]`
    expect(await $(proposal).isExisting()).toBe(true)
    // Proposed is not added: the catalogue is the human's to write (D8-11).
    expect(await catalogue()).not.toContain(COMMAND_PROPOSAL.name)

    await $(proposal).$('button=Accept').click()
    await awaitsIn(proposal, 'Added to the catalogue')

    await settings('Commands')
    expect(await $(`button[aria-label="Remove ${COMMAND_PROPOSAL.name}"]`).isExisting()).toBe(true)
  })
})

describe('A one-off execution stays out of the catalogue', () => {
  it('runs a line from the Commands panel as a one-off, and the catalogue is unchanged', async () => {
    await press('Serve the app in main.')
    await browser.pause(900)
    await openCommands()
    const held = await catalogue()
    await runLine(ONCE)
    await awaitsIn('[role="dialog"]', 'Exited 0')
    expect(await textOf('[role="dialog"]')).toContain('One-off')
    expect(await catalogue()).toEqual(held)
  })
})

describe('Add to catalogue', () => {
  it('keeps the one-off in the catalogue on the click, under its first word', async () => {
    // A one-off that exited 0 is folded, and the offer sits beside its command line, in its body.
    await $('[role="dialog"]').$('button*=One-off').click()
    await $('[role="dialog"]').$('button*=Add to catalogue').click()
    await browser.waitUntil(async () => (await catalogue()).includes('node'), {
      timeout: 10_000,
      interval: 200,
      timeoutMsg: 'the one-off never entered the catalogue',
    })
    await browser.keys('Escape')
    await browser.pause(400)

    await settings('Commands')
    expect(await $('button[aria-label="Remove node"]').isExisting()).toBe(true)
  })
})

/** The variables a scope holds, asked of the engine: the Project's own, or a Workspace's. */
async function variablesOf(workspaceId: string | null): Promise<string[]> {
  const project = await projectId()
  return await browser.execute(
    async (id: string, workspace: string | null) => {
      const variables = await window.hemera.invoke('variables.list', {
        projectId: id,
        workspaceId: workspace,
      })
      return variables.map((one) => `${one.key}=${one.value}`)
    },
    project,
    workspaceId,
  )
}

/** Writes a new value in the dialog the pencil of `key` opens, and saves it. */
async function edit(key: string, value: string): Promise<void> {
  await press(`Edit ${key}`)
  await fill('Value', value)
  await pressIn('[role="dialog"]', 'Save')
  await browser.pause(600)
}

describe('Setting an existing key rewrites its value', () => {
  it("rewrites the Project's PORT from its pencil, on the page and in the engine", async () => {
    const list = 'ul[aria-label="Variables of Atlas"]'
    await settings('Variables')
    await press('Add variable')
    await fill('Key', 'PORT')
    await fill('Value', '3000')
    await pressIn('[role="dialog"]', 'Add')
    await awaitsIn(list, '3000')

    await edit('PORT', '4000')

    await awaitsIn(list, '4000')
    expect(await textOf(list)).not.toContain('3000')
    expect(await variablesOf(null)).toEqual(['PORT=4000'])
  })

  it("rewrites a Workspace's own PORT over the Project's, in its row", async () => {
    const list = 'ul[aria-label="Variables of login-form"]'
    await show('login-form')
    await awaitsIn(list, 'inherited')
    await press('Override PORT')
    await fill('Value', '4001')
    await pressIn('[role="dialog"]', 'Add')
    await awaitsIn(list, 'Overrides 4000')

    await edit('PORT', '4002')

    await awaitsIn(list, '4002')
    expect(await textOf(list)).not.toContain('4001')
    expect(await variablesOf(loginForm.id)).toEqual(['PORT=4002'])
  })
})
