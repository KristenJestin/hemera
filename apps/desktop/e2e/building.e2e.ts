/**
 * A mission launched from its Ready page in the real application, its agents the fake agent the
 * suite scripts (`building-script.ts`): planned whole and frozen, then a commit pushed on `api`'s
 * remote that moves the file its task targets, so the pre-launch check says the Spec no longer
 * holds; Launch anyway, the preparation's steps, the move to Building, the Building page with its
 * stage card and the percentage beside the mission in the sidebar, and a service of the catalogue
 * started for the mission and stopped.
 *
 * Every gesture waits for the mark the page shows before the next one.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, browser, expect } from '@wdio/globals'

import { BUILDER, PLANNER, WHY } from './building-script.ts'
import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import { COLD_READER } from './planning-script.ts'
import { designSize } from './settings-page.ts'

const SPEC = 'building.e2e.ts'
/** Acme, its remote and a clone of someone else's: folders the headless run removes after it. */
const WORK = join(tmpdir(), 'hemera-e2e-building-work')
const ACME = join(WORK, 'acme')
const REMOTE = join(WORK, 'api.git')
const THEIRS = join(WORK, 'theirs')
const SERVICE = join(WORK, 'service.mjs')

/** Runs the machine's own `git`, with a plain, unsigned identity whatever its configuration. */
function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdio: 'ignore' },
  )
}

/** Acme's `api`, with `invoices.ts` the task targets and a bare repository as its remote. */
function writeAcme(): void {
  rmSync(WORK, { recursive: true, force: true })
  const api = join(ACME, 'api')
  mkdirSync(api, { recursive: true })
  git(api, 'init', '-q', '-b', 'main')
  writeFileSync(join(api, 'invoices.ts'), 'export const invoices = []\n')
  git(api, 'add', '.')
  git(api, 'commit', '-q', '-m', 'invoices')
  mkdirSync(REMOTE, { recursive: true })
  git(REMOTE, 'init', '-q', '--bare', '-b', 'main')
  git(api, 'remote', 'add', 'origin', REMOTE)
  git(api, 'push', '-q', '-u', 'origin', 'main')
  // A service that prints its address the way a dev server does, and ends on its own.
  writeFileSync(
    SERVICE,
    [
      "import { createServer } from 'node:http'",
      "const server = createServer((_, response) => response.end('Acme'))",
      "server.listen(0, '127.0.0.1', () => {",
      "  console.log('Local: http://127.0.0.1:' + server.address().port + '/')",
      '})',
      'setTimeout(() => process.exit(0), 120_000)',
      '',
    ].join('\n'),
  )
}

/** Someone else changes the file the task targets, and pushes it on the remote's base branch. */
function pushTheirs(): void {
  if (!existsSync(THEIRS)) git(WORK, 'clone', '-q', '-b', 'main', REMOTE, THEIRS)
  writeFileSync(join(THEIRS, 'invoices.ts'), 'export const invoices = [{ id: 1 }]\n')
  git(THEIRS, 'add', '.')
  git(THEIRS, 'commit', '-q', '-m', 'theirs')
  git(THEIRS, 'push', '-q', 'origin', 'main')
}

const places = () => $('nav[aria-label="Places"]')
const track = () => $('ol[aria-label="Stage"]')
/** The Planning page's rail, where the vision is given and the questions answered. */
const planningRail = () => $('aside[aria-label="What calls for you"]')
/** The Ready page's rail and its stage card's line. */
const launchRail = () => $('aside[aria-label="Launch"]')
const readyLine = () => launchRail().$('section[aria-label="Ready"] p[role="status"]')
/** The Building page's rail and its stage card's line. */
const buildingRail = () => $('aside[aria-label="What happens"]')
const buildingLine = () => buildingRail().$('section[aria-label="Building"] p[role="status"]')

/**
 * Waits until the page shows `selector` with `text` in it, asked of the page again on every
 * attempt. The assertions of `expect` resolve the element they are given once and ask that same
 * handle on every retry: the Ready page's rail is replaced as the launch begins, so a handle taken
 * a moment before stays stale until the wait ends, whatever the page shows by then.
 */
async function becomes(selector: string, text: string, within: number, said: string) {
  await browser.waitUntil(
    () =>
      browser.execute(
        (css, containing) => {
          const found = document.querySelector(css)
          if (found === null) return false
          const box = found.getBoundingClientRect()
          return box.width > 0 && box.height > 0 && (found.textContent ?? '').includes(containing)
        },
        selector,
        text,
      ),
    { timeout: within, timeoutMsg: said },
  )
}

/** What the Ready page's rail draws while the launch prepares the Workspace. */
const PREPARATION = 'aside[aria-label="Launch"] ul[aria-label="Preparation"] li'

/**
 * Has the page note, as it draws them, the steps of `selector`: a mark on the document the moment
 * one is on screen with room. The steps stand for a few dozen milliseconds before the mission
 * moves to Building, less than a round trip to the driver, so asking the page now and then can
 * miss them whatever the speed of the run; the page itself misses nothing.
 */
async function noteWhenDrawn(selector: string) {
  await browser.execute((css) => {
    const note = () => {
      const found = document.querySelector(css)
      if (found === null || found.getBoundingClientRect().height === 0) return
      document.documentElement.dataset.drawn = css
      observer.disconnect()
    }
    const observer = new MutationObserver(note)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true })
    note()
  }, selector)
}

/** Whether the page noted the steps of `selector` (see `noteWhenDrawn`). */
const wasDrawn = (selector: string) =>
  browser.execute((css) => document.documentElement.dataset.drawn === css, selector)

describe('A mission launched from its Ready page', () => {
  let key = ''

  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('plans a mission whole and freezes its Spec: the Ready page', async () => {
    await waitForEngine()
    await designSize()
    writeAcme()
    await browser.electron.execute(
      async (_, steps) => await globalThis.hemeraProbe?.scriptAgent(steps),
      PLANNER,
    )
    const project =
      (await browser.electron.execute(
        async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder, ['api']),
        ACME,
      )) ?? ''
    await browser.electron.execute(
      async (_, id, line) => await globalThis.hemeraProbe?.addService(id, 'preview', line),
      project,
      // Forward slashes: a command line reads a backslash as an escape, on Windows too.
      `node ${SERVICE.replaceAll('\\', '/')}`,
    )
    const mission = await browser.electron.execute(
      async (_, id) => await globalThis.hemeraProbe?.createMission(id, 'Export the invoices'),
      project,
    )
    key = mission?.key ?? ''
    await places().$('button*=Acme').click()
    await $('ul[aria-label="Planning missions"]').$(`button*=${key}`).click()
    await planningRail().$('button*=Your vision').click()
    const vision = planningRail().$('[role="textbox"][aria-label="Your vision"]')
    await vision.click()
    await vision.addValue('Export the invoices of the current filters.')
    await browser.keys('Enter')
    const question = planningRail().$('article[aria-label^="Q1 ·"]')
    await expect(question).toBeDisplayed({ wait: 30_000 })
    // The Planner keeps its script; the cold read, started once the Spec is declared, takes this.
    await browser.electron.execute(
      async (_, steps) => await globalThis.hemeraProbe?.scriptAgent(steps),
      COLD_READER,
    )
    await question.$('button[aria-label^="A "]').click()
    await expect($('button=Freeze')).toBeEnabled({ wait: 45_000 })
    await $('button=Freeze').click()
    await expect(track().$('li[aria-current="step"]')).toHaveText('Ready', {
      containing: true,
      wait: 30_000,
    })
    await expect(readyLine()).toHaveText(expect.stringContaining('Ready to launch · frozen today'))
    await expect($('section[aria-label="Frozen Spec"]')).toHaveText(expect.stringContaining(WHY))
    await expect($('button=Launch')).toBeDisplayed()
  })

  it('checks on Launch: the file the task targets moved, so the Spec no longer holds', async () => {
    pushTheirs()
    await $('button=Launch').click()
    await expect(readyLine()).toHaveText('The Spec no longer holds', { wait: 60_000 })
    await expect(launchRail().$('ul[aria-label="What moved since the Freeze"]')).toHaveText(
      expect.stringContaining('api/invoices.ts'),
    )
    await expect($('button=Back to Planning')).toBeDisplayed()
    await expect($('button=Launch')).not.toBeExisting()
  })

  it('launches anyway: the preparation’s steps, then the mission moves to Building', async () => {
    // The Builder, started once the Workspace is prepared, takes this script.
    await browser.electron.execute(
      async (_, steps) => await globalThis.hemeraProbe?.scriptAgent(steps),
      BUILDER,
    )
    await noteWhenDrawn(PREPARATION)
    await $('button=Launch anyway').click()
    await becomes(
      'ol[aria-label="Stage"] li[aria-current="step"]',
      'Building',
      90_000,
      'the mission never moved to Building',
    )
    expect(await wasDrawn(PREPARATION)).toBe(true)
  })

  it('shows the Building page: its stage card and its requirements', async () => {
    await expect(buildingLine()).toBeDisplayed({ wait: 30_000 })
    await expect($('section[aria-label="Requirements"]')).toHaveText(
      expect.stringContaining('Invoices export as CSV.'),
      { wait: 30_000 },
    )
  })

  it('opens the diff of the mission from its `…`, over the page, and goes back', async () => {
    await $(`button[aria-label="More for ${key}"]`).click()
    await $('[role="menuitem"]*=Diff').click()
    const close = $('button[aria-label="Close Diff"]')
    await expect(close).toBeDisplayed({ wait: 30_000 })
    await close.click()
    await expect(close).not.toBeDisplayed({ wait: 30_000 })
  })

  it('starts a service of the catalogue for the mission, and stops it', async () => {
    await buildingRail().$('button*=Services').click()
    await buildingRail().$('button=Start a service from the catalogue…').click()
    // The catalogue holds one service the mission does not run: it is the one option.
    await $('[role="listbox"][aria-label="The catalogue"] [role="option"]').click()
    const services = buildingRail().$('ul[aria-label="Services"]')
    await expect(services.$('button[aria-label="Stop preview"]')).toBeDisplayed({
      wait: 30_000,
    })
    await expect(services).toHaveText(expect.stringContaining('http://127.0.0.1:'), {
      wait: 30_000,
    })
    await services.$('button[aria-label="Stop preview"]').click()
    await expect(services.$('button[aria-label="Start preview"]')).toBeDisplayed({
      wait: 30_000,
    })
  })

  it('shows Building’s percentage beside the mission in the sidebar', async () => {
    // The sidebar lists a Project's missions by stage once it is opened: the percentage rides on the row.
    await places().$('button[aria-label="Open the missions of Acme"]').click()
    await expect(
      places().$('[role="group"][aria-label="Building"]').$(`button*=${key}`),
    ).toHaveText(expect.stringContaining('0%'), { wait: 30_000 })
  })
})
