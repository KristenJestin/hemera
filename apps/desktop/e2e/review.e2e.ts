/**
 * A mission in Review in the real application (#496), its agents the fake agent the suite scripts:
 * planned whole and frozen (`building-script.ts`), built by a Builder that finishes its one task,
 * then documented and reviewed with nothing to say, so the mission moves to Review on its own.
 * The Review page then: the proof verified by hand validated, Ship offered and its confirmation,
 * a remark written with an image attached, Ship refused in the engine's words, Fix, the round's
 * view over the page and the page found intact behind it.
 *
 * The fake agent cannot tell its roles apart: every agent after the Freeze plays one script, and
 * the tools its role is not granted are refused. Every gesture waits for the mark the page shows
 * before the next one.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, browser, expect } from '@wdio/globals'

import { PLANNER } from './building-script.ts'
import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import { COLD_READER } from './planning-script.ts'
import { designSize } from './settings-page.ts'

const SPEC = 'review.e2e.ts'
/** Acme and its remote: folders the headless run removes after it. */
const WORK = join(tmpdir(), 'hemera-e2e-review-work')
const ACME = join(WORK, 'acme')
const REMOTE = join(WORK, 'api.git')
/** The image the remark carries: a PNG of one pixel. */
const IMAGE = join(WORK, 'header.png')
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/** Runs the machine's own `git`, with a plain, unsigned identity whatever its configuration. */
function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdio: 'ignore' },
  )
}

/** Acme's `api`, with `invoices.ts` the task changes and a bare repository as its remote. */
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
  writeFileSync(IMAGE, Buffer.from(PIXEL, 'base64'))
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

const uses = (id: string, tool: string, args: Record<string, Json>) =>
  ({ does: 'uses', id, tool, arguments: args }) as const

/** Why the documenter changed nothing, as the Review page says it. */
const NO_DOC = 'No page of the documentation mentions the invoices export.'

/**
 * Every agent after the Freeze: the Builder finishes its task, the documenter reports no change,
 * each reviewer reports no finding; what a role is not granted is refused, and it says it is done.
 * The Builder writes nothing: a write no rule of the Project allows would wait for the user.
 */
const ENDING = {
  steps: [
    uses('toolu_start', 'task_start', { task: 'T1' }),
    uses('toolu_read', 'fs_read', { repository: 'api', path: 'invoices.ts' }),
    uses('toolu_finished', 'task_finished', { task: 'T1', summary: 'T1 built.' }),
    uses('toolu_docs', 'docs_report', { changed: [], no_change_reason: NO_DOC }),
    uses('toolu_review', 'review_report', { findings: [] }),
    { does: 'says', text: 'Done.' },
  ],
} as const

const places = () => $('nav[aria-label="Places"]')
const track = () => $('ol[aria-label="Stage"]')
const planningRail = () => $('aside[aria-label="What calls for you"]')
/** The Review page's rail, and what in it waits for the user. */
const rail = () => $('[data-stage="review"] aside[aria-label="What happens"]')
const forYou = () => rail().$('section[aria-label="For you"]')
const feedback = () => $('section[aria-label="Feedback"]')
/** Ship in the head: Mark as delivered when the Project has no forge. */
const ship = () => $('//button[normalize-space()="Ship" or normalize-space()="Mark as delivered"]')

describe('A mission in Review', () => {
  let key = ''

  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('is planned, built, documented and reviewed, and moves to Review on its own', async function () {
    // Planning, Building, the documenter and both reviewers: longer than one gesture's minute.
    this.timeout(240_000)
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
    await browser.electron.execute(
      async (_, steps) => await globalThis.hemeraProbe?.scriptAgent(steps),
      ENDING,
    )
    await $('button=Launch').click()
    await expect(track().$('li[aria-current="step"]')).toHaveText('Review', {
      containing: true,
      wait: 180_000,
    })
  })

  it('shows the Review page: the proof to verify by hand, and why the documentation did not change', async () => {
    await expect(forYou().$('button*=a CSV file is saved')).toBeDisplayed({ wait: 30_000 })
    await rail().$('button*=Documentation').click()
    await expect(rail()).toHaveText(expect.stringContaining(NO_DOC), { wait: 30_000 })
  })

  it('validates the proof by hand, and Ship is offered: its confirmation, then Not now', async () => {
    await forYou().$('button*=a CSV file is saved').click()
    await forYou().$('button[aria-label="Validate R1.S1"]').click()
    // For you goes once nothing waits there: what is gone is looked for from the page, not in it.
    await expect(
      $('//section[@aria-label="For you"]//button[contains(., "a CSV file is saved")]'),
    ).not.toBeExisting({ wait: 30_000 })
    await expect(ship()).toBeDisplayed({ wait: 30_000 })
    await ship().click()
    const dialog = $('[role="dialog"]')
    await expect(dialog).toHaveText(expect.stringContaining(key), { wait: 30_000 })
    await dialog.$('button=Not now').click()
    await expect(dialog).not.toBeExisting({ wait: 30_000 })
  })

  it('writes a remark with an image: it waits for Fix, and Ship waits in the engine’s words', async () => {
    const field = feedback().$('[role="textbox"][aria-label="A remark from your live test"]')
    await expect(field).toBeDisplayed({ wait: 30_000 })
    await field.click()
    await field.addValue('The header says UTC.')
    await feedback().$('input[type="file"]').addValue(IMAGE)
    await expect(feedback().$('ul[aria-label="Images of the remark"]')).toHaveText(
      expect.stringContaining('header.png'),
      { wait: 30_000 },
    )
    await feedback().$('button[aria-label="Add the remark"]').click()
    const next = feedback().$('ul[aria-label="Next round"]')
    await expect(next).toHaveText(expect.stringContaining('The header says UTC.'), {
      wait: 30_000,
    })
    await expect(feedback().$('button*=Fix · round')).toBeDisplayed({ wait: 30_000 })
    await expect(ship()).not.toBeExisting({ wait: 30_000 })
    await expect($('p*=waits:')).toHaveText(expect.stringContaining('1 remark waits for a fix.'), {
      wait: 30_000,
    })
  })

  it('sends the remark with Fix: the round is worked on, and Fix is no longer offered', async () => {
    await feedback().$('button*=Fix · round').click()
    await expect(
      $('//section[@aria-label="Feedback"]//button[starts-with(normalize-space(), "Fix · round")]'),
    ).not.toBeExisting({ wait: 30_000 })
    await expect($('p*=waits:')).toHaveText(expect.stringContaining('is being worked on.'), {
      wait: 30_000,
    })
  })

  it('opens the round over the page, and going back finds the page as it was', async () => {
    await feedback().$('button*=Open round').click()
    const close = $('button[aria-label^="Close Round"]')
    await expect(close).toBeDisplayed({ wait: 30_000 })
    await close.click()
    await expect(close).not.toBeDisplayed({ wait: 30_000 })
    await expect(feedback()).toHaveText(expect.stringContaining('The header says UTC.'))
  })
})
