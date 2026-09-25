/**
 * A build, from a ready Spec to the user's task, in the built application (designs D10-02
 * to D10-12).
 *
 * The Project `Atlas` points at a `main` holding one repository, `./sources/api`, made here with
 * the machine's own `git` and removed after the run. Its one check is a line of the user's, run at
 * the Workspace root after each task: it is red while `fixed.txt` is missing there.
 *
 * The Spec is written the way a Spec is: a Session made on the Project, turned `define` by
 * `specs.create`, its agent asked to write a Spec a build can run and to attest it, and the human's
 * Mark ready — all through the bridge, the calls the window's own controls make. Its three tasks
 * depend each on the one before, and the second is the user's. The build is asked for through
 * `launches.request`, the call the Spec's launch action will make; everything after that is read
 * from the window and pressed in it: the build Session in the sidebar, its view, Pause and Resume.
 *
 * The agent is the suite's fake one (`agent/program.ts`): it answers the `prepare` brief with its
 * approach, finishes every task an `execute` delivery hands it, and writes `fixed.txt` only on the
 * try that follows a red one. This file leaves the build with the user's task waiting;
 * `builds.reopened.e2e.ts` starts the application again on the same data folder and ends it.
 *
 * Each suite is named after the scenario of the issue's Spec it covers.
 */

import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { browser, expect } from '@wdio/globals'

import { repository } from '../tests/repositories.ts'
import { fakeWorkspace } from './agent/install.ts'
import { APPROACH, BUILDABLE, BUILDABLE_SECTIONS, FIXED } from './agent/script.ts'
import { addProject, awaits, press, pressIn, region, shows, sidebar } from './hand.ts'
import { buildNow, pressExactly } from './build-hand.ts'

/** The folder of `main`, kept for the second instance, which goes on in it. */
const MAIN = fakeWorkspace('builds')

/** The Spec's key: the Project's prefix, and the first number. */
const KEY = 'ATL-1'

/** What the build Session is listed under: it has no message of the user's to be named after. */
const BUILD = 'New session'

/**
 * The check: a line of the user's, red while the file is missing at the Workspace root. Node's own
 * binary, which is on the machine whatever runs the suite; single quotes only inside.
 */
const CHECK_LINE = `"${process.execPath}" -e "process.exit(require('fs').existsSync('${FIXED}')?0:1)"`

before(() => {
  rmSync(join(MAIN, 'sources'), { recursive: true, force: true })
  rmSync(join(MAIN, FIXED), { force: true })
  repository(join(MAIN, 'sources', 'api'))
})

/**
 * The ready Spec, through the bridge: the Project's repository and its check, a Session made
 * `define`, its agent's contract and attestation, and the human's Mark ready.
 */
async function aReadySpec(): Promise<{ readonly specId: string; readonly workspaceId: string }> {
  return await browser.execute(
    async (asked: string, line: string) => {
      const projects = await window.hemera.invoke('projects.list', {})
      const project = projects.find((one) => one.name === 'Atlas')
      if (project === undefined) throw new Error('no Project Atlas')
      await window.hemera.invoke('repositories.add', {
        id: project.id,
        version: project.version,
        relativePath: './sources/api',
      })
      await window.hemera.invoke('checks.save', {
        projectId: project.id,
        id: null,
        draft: {
          name: 'fixed',
          commandId: null,
          line,
          where: 'root',
          repository: null,
          when: 'task',
          expect: null,
          files: null,
        },
      })
      const writer = await window.hemera.invoke('sessions.create', {
        projectId: project.id,
        provider: 'opencode',
      })
      const made = await window.hemera.invoke('specs.create', {
        sessionId: writer.id,
        type: 'feature',
        title: 'Export the Journal',
      })
      await window.hemera.invoke('agents.prompt', { sessionId: writer.id, text: asked })
      const attested = await window.hemera.invoke('specs.read', { specId: made.snapshot.spec.id })
      await window.hemera.invoke('specs.markReady', {
        specId: attested.spec.id,
        expectedRevisionId: attested.spec.currentRevisionId,
        expectedContentVersion: attested.spec.contentVersion,
        sessionId: writer.id,
      })
      const workspaces = await window.hemera.invoke('workspaces.list', { projectId: project.id })
      return {
        specId: attested.spec.id,
        workspaceId: workspaces.find((one) => one.main)?.id ?? '',
      }
    },
    BUILDABLE,
    CHECK_LINE,
  )
}

describe('A build prepares before it executes', () => {
  it('asked for on a ready Spec, runs as its own Session, the agent’s approach shown', async () => {
    await addProject('Atlas', MAIN)
    const { specId, workspaceId } = await aReadySpec()
    const status = await browser.execute(
      async (spec: string) =>
        (await window.hemera.invoke('specs.read', { specId: spec })).spec.status,
      specId,
    )
    expect(status).toBe('ready')

    const launch = await browser.execute(
      async (spec: string, workspace: string) =>
        await window.hemera.invoke('launches.request', { specId: spec, workspaceId: workspace }),
      specId,
      workspaceId,
    )
    expect(launch.state).toBe('started')

    await browser.waitUntil(async () => (await sidebar()).includes(BUILD), {
      timeout: 20_000,
      timeoutMsg: 'the build Session is never listed',
    })
    await press(BUILD)
    await awaits(APPROACH)
    expect(await shows(`BUILD · opencode`)).toBe(true)
    expect(await shows(KEY)).toBe(true)
  })
})

describe("The agent's signal is not a verdict", () => {
  it('a red check sends T1 back to the agent, whose second try is green', async () => {
    await browser.waitUntil(async () => (await buildNow(KEY)).states.T1 === 'done', {
      timeout: 30_000,
      timeoutMsg: 'T1 never came out of its checks green',
    })
    const build = await buildNow(KEY)
    expect(build.tries.T1).toEqual(['red', 'green'])
    // The Spec moved to in progress with its first task started (D10-10).
    expect(build.specStatus).toBe('in_progress')
  })
})

describe('The build view shows the tasks by state', () => {
  it('lists the tasks grouped by state with their times, and T1 opens on its tries, checks and files', async () => {
    await browser.waitUntil(async () => (await buildNow(KEY)).states.T2 === 'yours', {
      timeout: 20_000,
      timeoutMsg: 'T2 never became the user’s',
    })
    const groups = await browser.execute(() =>
      [...document.querySelectorAll('[aria-label="Tasks"] [role="group"]')].map(
        (group) => group.getAttribute('aria-label') ?? '',
      ),
    )
    // What needs the user first, then what waits, then what is over.
    expect(groups).toEqual(['Yours, 1', 'Waiting, 1', 'Done, 1'])
    const rows = await browser.execute(() =>
      [...document.querySelectorAll('[aria-label="Tasks"] button[data-row]')].map(
        (row) => row.getAttribute('aria-label') ?? '',
      ),
    )
    expect(rows.find((row) => row.startsWith('T1 Write the exporter, '))).toMatch(/, \S/)

    // Its evidence is on its stage: the red try said in plain words, and the file it changed.
    await pressIn('[aria-label="Tasks"]', 'T1')
    await awaits('exited with 1')
    await awaits('src/export.ts')
  })
})

describe('A human task waits for the user', () => {
  it('T2 is the user’s, said in the view and above the composer, and never handed to the agent', async () => {
    await browser.waitUntil(async () => (await buildNow(KEY)).states.T2 === 'yours', {
      timeout: 20_000,
      timeoutMsg: 'T2 never became the user’s',
    })
    await awaits('Yours: T2 · Sign the export format off')
    const build = await buildNow(KEY)
    expect(build.states).toEqual({ T1: 'done', T2: 'yours', T3: 'waiting' })
    expect(build.handed.T2).toBe(false)
  })
})

describe('The Spec is read only in a build', () => {
  it('opens the frozen revision beside the view, with no edit control', async () => {
    await pressExactly('Spec')
    await awaits('read only')
    const panel = `section[aria-label="Spec ${KEY}"]`
    expect(await region(panel)).toContain(BUILDABLE_SECTIONS.problem)
    const editable = await browser.execute(
      (scope: string) =>
        document.querySelector(scope)?.querySelectorAll('textarea, input, [contenteditable="true"]')
          .length ?? -1,
      panel,
    )
    expect(editable).toBe(0)
    expect(await region(panel)).not.toContain('Mark ready')
    expect(await region(panel)).not.toContain('Rework')

    await pressIn(panel, 'Close the Spec')
    expect(await region(panel)).toBe('')
  })
})

describe('Pause stops at the next safe point', () => {
  it('Pause holds the build, and Resume lets it go on where it stood', async () => {
    await pressExactly('Pause')
    await browser.waitUntil(async () => (await buildNow(KEY)).paused, {
      timeout: 10_000,
      timeoutMsg: 'the build was never paused',
    })
    await awaits('Paused')
    expect((await buildNow(KEY)).states.T2).toBe('yours')

    await pressExactly('Resume')
    await browser.waitUntil(async () => !(await buildNow(KEY)).paused, {
      timeout: 10_000,
      timeoutMsg: 'the build was never resumed',
    })
    expect((await buildNow(KEY)).states).toEqual({ T1: 'done', T2: 'yours', T3: 'waiting' })
    // Left here: the next file starts the application again, mid-build.
    expect(await region('[aria-label="Tasks"]')).toContain('T3')
  })
})
