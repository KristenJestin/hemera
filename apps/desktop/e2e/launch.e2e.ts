/**
 * A Spec's build: the Workspace prepared for it, the launch that waits for it, then the Session it
 * opens (D8-12, D8-13).
 *
 * One journey over two Specs of one Project. On the first, `Prepare and start the build` asks for a
 * Workspace of its own: it is created, its preparation starts, and the launch waits on the step
 * that is running — named where the panel stands, `Preparing the Workspace · <the step>` — with no
 * Session started yet. The Workspace becomes ready and the build starts: the Session is the
 * launch's (mission `build`, the Spec, the Workspace the preparation made), the Spec is rendered in
 * its thread as its brief, and the panel says `Build started` and offers `Open`. A Rework then
 * takes the Spec on, and `Open` stays where it was: a build that is running is reached through it,
 * whatever the Spec is doing.
 *
 * On the second, the Rework arrives while its Workspace is still being prepared: that launch is
 * cancelled where it waits, its Workspace still reaches ready, and nothing is started in it.
 *
 * The preparation is held open by a step of the recipe that waits for a file this suite writes
 * (`GO`): `waiting` is a state a suite reads, not one it races a preparation for. The step runs
 * `process.execPath`, so nothing has to be on the machine's `PATH` — what `workspaces.e2e.ts` does
 * to hold its server open.
 *
 * Each suite is named after the scenario it covers.
 */

import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { browser, expect } from '@wdio/globals'

import { repository } from '../tests/repositories.ts'
import { fakeWorkspace } from './agent/install.ts'
import { AGENT, ANSWERS, COMPLETE, COMPLETED, MODELS, PROPOSAL, PROPOSE } from './agent/script.ts'
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
  unfoldSpec,
  write,
} from './hand.ts'

/** The folder of `main`, which holds the one repository this suite declares. */
const MAIN = fakeWorkspace('launch')

/** The repository of `main`, made in `before` and removed in `after`. */
const SOURCES = join(MAIN, 'sources')

/** The Project the journey is made in; its name gives the Specs their key prefix. */
const PROJECT = 'Launch'

/** The two Specs of the journey: the one that is built, and the one a Rework takes back. */
const BUILT = 'LAU-1'
const TAKEN = 'LAU-2'

/** What each define Session is asked with, which is also the title it is listed under. */
const ASKED_BUILT = `The CSV export drops the date. ${PROPOSE}`
const ASKED_TAKEN = `The invoice export drops the date. ${PROPOSE}`

/** The file the recipe's step waits for; written, the preparation of its Workspace goes on. */
const GO = join(tmpdir(), 'hemera-e2e-launch-go')

const THREAD = '[aria-label="The thread of this Session"]'
const PROPOSAL_CARD = '[role="group"][aria-label="Create a Spec"]'
const BUILD_GROUP = '[role="group"][aria-label="The build of this Spec"]'
const DIALOG = '[role="dialog"]'

/**
 * The line of the recipe's step: it holds the preparation of its Workspace open until `GO` exists,
 * so what the launch says while it waits is read here rather than guessed. Run through
 * `process.execPath`, so the machine needs nothing installed.
 */
function holdLine(): string {
  const go = GO.replaceAll('\\', '/')
  const script = `const f=require('fs');const t=setInterval(()=>{if(f.existsSync('${go}')){clearInterval(t);process.exit(0)}},200)`
  return `"${process.execPath}" -e "${script}"`
}

const HOLD = holdLine()

/** The panel of a Spec, the way `specs.e2e.ts` addresses it. */
function panelOf(key: string): string {
  return `section[aria-label="Spec ${key}"]`
}

/** The id of the Project the suite made, asked of the engine. */
async function projectId(): Promise<string> {
  return await browser.execute(async (name: string) => {
    const projects = await window.hemera.invoke('projects.list', {})
    return projects.find((one) => one.name === name)?.id ?? ''
  }, PROJECT)
}

/** The id of a Spec, by the key its Project's name gave it. */
async function specIdOf(key: string): Promise<string> {
  const project = await projectId()
  return await browser.execute(
    async (of: string, wanted: string) => {
      const specs = await window.hemera.invoke('specs.list', { projectId: of })
      return specs.find((one) => one.key === wanted)?.id ?? ''
    },
    project,
    key,
  )
}

/** What the engine holds of a Spec: its status, its revision, and the launch it was asked for. */
async function stateOf(key: string) {
  const specId = await specIdOf(key)
  return await browser.execute(async (id: string) => {
    const read = await window.hemera.invoke('specs.read', { specId: id })
    const asked = await window.hemera.invoke('launches.forSpec', { specId: id })
    return {
      status: read.spec.status,
      revision: read.revision.number,
      revisionId: read.revision.id,
      specWorkspaceId: read.spec.workspaceId,
      launch: asked.launch,
      step: asked.step,
      workspace: asked.workspace,
    }
  }, specId)
}

/** The Workspace a Spec's launch is set on, with the state of each step of its preparation. */
async function workspaceOf(key: string) {
  const project = await projectId()
  const specId = await specIdOf(key)
  return await browser.execute(
    async (of: string, id: string) => {
      const asked = await window.hemera.invoke('launches.forSpec', { specId: id })
      if (asked.workspace === null) return null
      const listed = await window.hemera.invoke('workspaces.list', { projectId: of })
      const steps = await window.hemera.invoke('preparation.steps', {
        workspaceId: asked.workspace.id,
      })
      return {
        id: asked.workspace.id,
        name: asked.workspace.name,
        state: listed.find((one) => one.id === asked.workspace?.id)?.state ?? '',
        steps: steps.map((one) => `${one.kind} ${one.state}`),
      }
    },
    project,
    specId,
  )
}

/** The build Sessions of a Spec: the engine's list, narrowed to the mission and the Spec. */
async function buildsOf(key: string) {
  const project = await projectId()
  const specId = await specIdOf(key)
  return await browser.execute(
    async (of: string, id: string) => {
      const sessions = await window.hemera.invoke('sessions.list', { projectId: of })
      return sessions
        .filter((one) => one.mission === 'build' && one.specId === id)
        .map((one) => ({
          id: one.id,
          provider: one.provider,
          workspaceId: one.workspaceId,
        }))
    },
    project,
    specId,
  )
}

/**
 * Asks for a Spec of this Project and writes it to ready, the way its writer does: a Session with
 * the agent, the draft it proposes, the writing that attests it, then the hand that freezes it.
 */
async function writeSpec(asked: string, key: string): Promise<void> {
  await press('New Session')
  await browser.pause(600)
  // The agent is chosen once per composer, and the composer of a Project keeps it: the second Spec
  // of the journey finds it there.
  if ((await control('Start chat'))?.said === 'Choose an agent first') {
    await press('Choose an agent')
    await press(AGENT)
    await awaits(MODELS[0].name)
    await browser.keys('Escape')
    await browser.pause(400)
  }
  await write(asked)
  await press('Start chat')
  await awaits(ANSWERS[0])
  await awaits('Create the Spec')
  await pressIn(PROPOSAL_CARD, 'Create')
  await awaits(`Created ${key}`)

  await unfoldSpec(key)
  await write(COMPLETE)
  await press('Send')
  await awaits(COMPLETED, 60_000)
  await browser.pause(1500)
  await pressIn(panelOf(key), 'Mark ready')
  await browser.pause(1500)
}

before(async () => {
  rmSync(SOURCES, { recursive: true, force: true })
  rmSync(GO, { force: true })
  repository(join(SOURCES, 'api'))
})

after(() => {
  rmSync(SOURCES, { recursive: true, force: true })
  rmSync(GO, { force: true })
})

describe('A Spec’s build waits for the Workspace prepared for it', () => {
  it('declares a repository and a recipe whose step holds the preparation open', async () => {
    await addProject(PROJECT, MAIN)
    await press('Project settings')
    await browser.pause(600)
    await pressTab('Repositories')
    await press('Add repository')
    await fill('Path', './sources/api')
    await pressIn(DIALOG, 'Add repository')
    await browser.pause(600)

    // Two steps: what the fake agent needs beside the repository checked out for it, then the line
    // that holds the preparation open until `GO` is written.
    await pressTab('Preparation')
    await press('Add step')
    await choose('Base', 'Workspace root')
    await fill('Path', 'acp')
    await pressIn(DIALOG, 'Add')
    await browser.pause(600)
    await awaits('copy acp at the root')

    await press('Add step')
    await choose('Step kind', 'Run a command')
    await choose('Command', 'A line of its own')
    await fill('Line', HOLD)
    await choose('Runs from', 'Workspace root')
    await pressIn(DIALOG, 'Add')
    await browser.pause(600)
    await awaits(`run ${HOLD}`)
  })

  it('takes a Spec to ready', async () => {
    await writeSpec(ASKED_BUILT, BUILT)
    expect((await stateOf(BUILT)).status).toBe('ready')
  })

  it('asks for the build, and names the step the preparation is on', async () => {
    // The Workspace is made from the recipe and its preparation starts; the launch waits on the
    // step that holds it open, which the panel names, and no Session has been started.
    await press('Prepare and start the build')
    await awaits('Nothing is fetched.')
    await pressIn(DIALOG, 'Create')
    await browser.pause(1200)

    await awaits(`Preparing the Workspace · ${HOLD}`, 60_000)
    const asked = await stateOf(BUILT)
    expect(asked.launch?.state).toBe('waiting')
    expect(asked.step).toBe(HOLD)
    expect(asked.launch?.sessionId).toBeNull()
    expect(asked.workspace?.id).toBe(asked.launch?.workspaceId)

    const made = await workspaceOf(BUILT)
    expect(made?.state).toBe('preparing')
    expect(made?.steps).toEqual(expect.arrayContaining(['copy done', 'run running']))
    expect(await buildsOf(BUILT)).toEqual([])
  })

  it('starts the build once the Workspace is ready, and offers its Session', async () => {
    writeFileSync(GO, 'go\n')
    await awaits('Build started', 60_000)

    const built = await stateOf(BUILT)
    expect(built.status).toBe('in_progress')
    expect(built.launch?.state).toBe('started')
    expect(built.launch?.sessionId).not.toBeNull()
    // The revision the launch names is the one the Spec was on when the build was asked for, and
    // it is that revision the Session's brief was rendered from (D8-13).
    expect(built.revision).toBe(1)
    expect(built.launch?.revisionId).toBe(built.revisionId)

    const made = await workspaceOf(BUILT)
    expect(made?.state).toBe('ready')
    expect(made?.steps).not.toContain('run running')

    const sessions = await buildsOf(BUILT)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.id).toBe(built.launch?.sessionId)
    expect(sessions[0]?.workspaceId).toBe(built.launch?.workspaceId)
    expect(sessions[0]?.provider).toBe('opencode')
    expect(await control('Open')).not.toBeNull()
  })

  it('opens the build Session, with the Spec as its brief', async () => {
    await pressIn(BUILD_GROUP, 'Open')
    await browser.pause(1500)

    // The panel belongs to the Session that defines the Spec, and this one is the build's: it has
    // none, its thread holds the brief alone, and not the words its writer was asked with.
    expect(await region(panelOf(BUILT))).toBe('')
    expect(await region(THREAD)).toContain('What the agent was told')
    expect(await region(THREAD)).not.toContain(ASKED_BUILT)

    // The brief is the Spec as it stood on the revision the launch names.
    await pressIn(THREAD, 'What the agent was told')
    await browser.pause(600)
    expect(await region(THREAD)).toContain(PROPOSAL.title)
  })

  it('keeps Open once a Rework takes the Spec on', async () => {
    // Back to the Session that defines it, where the panel is.
    await press(ASKED_BUILT)
    await browser.pause(800)
    await pressIn(panelOf(BUILT), 'Rework')
    await fill('Reason', 'The export drops the credit note date too.')
    await pressIn(DIALOG, 'Rework')
    await browser.pause(1500)

    // The Spec is a draft on a new revision; the build is the one that was started, and the panel
    // still leads to it — `Open` is the way back to a build that is running (D8-13).
    const now = await stateOf(BUILT)
    expect(now.status).toBe('draft')
    expect(now.revision).toBe(2)
    expect(now.launch?.state).toBe('started')
    expect(await region(panelOf(BUILT))).toContain('Build started')
    expect(await control('Open')).not.toBeNull()

    await pressIn(BUILD_GROUP, 'Open')
    await browser.pause(1500)
    expect(await region(panelOf(BUILT))).toBe('')
    expect(await region(THREAD)).toContain('What the agent was told')
  })
})

describe('A Rework takes a launch back where it waits', () => {
  it('asks for the build of a second Spec, which waits for its Workspace', async () => {
    await writeSpec(ASKED_TAKEN, TAKEN)
    expect((await stateOf(TAKEN)).status).toBe('ready')

    // `GO` exists from the first journey: removed, the second preparation waits as the first one.
    rmSync(GO, { force: true })
    await press('Prepare and start the build')
    await awaits('Nothing is fetched.')
    await pressIn(DIALOG, 'Create')
    await browser.pause(1200)

    await awaits(`Preparing the Workspace · ${HOLD}`, 60_000)
    const asked = await stateOf(TAKEN)
    expect(asked.launch?.state).toBe('waiting')
    expect(asked.step).toBe(HOLD)
  })

  it('cancels the launch the Spec is reworked away from, and starts nothing', async () => {
    await pressIn(panelOf(TAKEN), 'Rework')
    await fill('Reason', 'The export drops the due date too.')
    await pressIn(DIALOG, 'Rework')
    await browser.pause(1500)

    // The revision the launch waited on is gone: it is taken back where it waits, says what took
    // it back, and the panel says so too — a draft with a launch is not a draft with nothing.
    const taken = await stateOf(TAKEN)
    expect(taken.status).toBe('draft')
    expect(taken.launch?.state).toBe('cancelled')
    expect(taken.launch?.detail).toBe('reworked')
    expect(taken.launch?.sessionId).toBeNull()
    await awaits('Cancelled by the Rework')

    // The Workspace is not touched: its preparation goes to the end, and nothing is started in it.
    writeFileSync(GO, 'go\n')
    await browser.waitUntil(async () => (await workspaceOf(TAKEN))?.state === 'ready', {
      timeout: 60_000,
      interval: 500,
      timeoutMsg: 'the Workspace of the reworked Spec never became ready',
    })
    const made = await workspaceOf(TAKEN)
    expect(made?.steps).not.toContain('run running')
    expect(await buildsOf(TAKEN)).toEqual([])
    expect((await stateOf(TAKEN)).launch?.state).toBe('cancelled')
    expect(await region(panelOf(TAKEN))).toContain('Cancelled by the Rework')
  })
})
