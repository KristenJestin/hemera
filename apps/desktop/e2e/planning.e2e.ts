/**
 * A mission planned in the real application, its Planner the fake agent the suite scripts
 * (`planning-script.ts`): the vision that starts it, the draft it writes, two waves answered one
 * by one, a question put on hold with a note, a discussion closed on the decision it proposed, a
 * Probe's chip, the question on hold answered at last, the cold read's report, and Freeze offered.
 * `planning.restarted.e2e.ts` starts Hemera again on the same data folder, finds all of it, and
 * freezes the Spec.
 *
 * Every gesture waits for the mark the Planner's turn leaves on the page before the next one: two
 * gestures within one turn would reach the Planner as one prompt.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, browser, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import {
  COLD_READER,
  DECISION,
  DRAFTED,
  DRAFT_MARK,
  NOT_PROBED,
  PLANNER,
} from './planning-script.ts'
import { designSize } from './settings-page.ts'

const SPEC = 'planning.e2e.ts'
/** Acme's main checkout: a folder of the run's own, which the headless run removes after it. */
const ACME = join(tmpdir(), 'hemera-e2e-planning-acme')
/** The mission's key, for the run that starts Hemera again. */
export const PLANNED = join(tmpdir(), 'hemera-e2e-planning-mission.json')

const places = () => $('nav[aria-label="Places"]')
const spec = () => $('section[aria-label="Spec"]')
const rail = () => $('aside[aria-label="What calls for you"]')
/** A question's card in the rail, by its id. */
const card = (id: string) => rail().$(`article[aria-label^="${id} ·"]`)
const option = (id: string, letter: string) => card(id).$(`button[aria-label^="${letter} "]`)
/** The view of a discussion over the page. */
const view = () => $('[data-view^="discussion:"]')

/** Writes into a mention field and sends it with Enter. */
async function say(field: ReturnType<typeof $>, text: string): Promise<void> {
  await field.click()
  await field.addValue(text)
  await browser.keys('Enter')
}

describe('A mission planned with its Planner', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('opens a mission made from a sentence on its Planning page', async () => {
    await waitForEngine()
    await designSize()
    mkdirSync(ACME, { recursive: true })
    await browser.electron.execute(
      async (_, script) => await globalThis.hemeraProbe?.scriptAgent(script),
      PLANNER,
    )
    const project =
      (await browser.electron.execute(
        async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder),
        ACME,
      )) ?? ''
    const mission = await browser.electron.execute(
      async (_, id) => await globalThis.hemeraProbe?.createMission(id, 'Export notes'),
      project,
    )
    const key = mission?.key ?? ''
    writeFileSync(PLANNED, JSON.stringify({ key }))
    await places().$('button*=Acme').click()
    await $('ul[aria-label="Planning missions"]').$(`button*=${key}`).click()
    await expect(rail().$('section[aria-label="Your vision"]')).toBeDisplayed()
  })

  it('starts the Planner with a vision, which writes its draft and asks a first wave', async () => {
    await say(
      rail().$('[role="textbox"][aria-label="Your vision"]'),
      'Keep the export small: one note at a time.',
    )
    await expect(spec().$('section[aria-label="Why"]')).toHaveText(
      expect.stringContaining(DRAFT_MARK),
      { wait: 30_000 },
    )
    await expect(rail().$('ul[aria-label="Wave 1"]')).toBeDisplayed()
    await expect(card('Q2')).toBeDisplayed()
    await expect(rail().$('ul[aria-label="Your vision so far"]')).toHaveText(
      expect.stringContaining('one note at a time'),
    )
  })

  it('answers the first wave one question at a time, each answer integrated', async () => {
    await option('Q1', 'A').click()
    await expect(card('Q1').$('[data-input="integrated"]')).toBeExisting({ wait: 30_000 })
    await option('Q2', 'B').click()
    await expect(card('Q2').$('[data-input="integrated"]')).toBeExisting({ wait: 30_000 })
    await expect(rail().$('ul[aria-label="Wave 2"]')).toBeDisplayed({ wait: 30_000 })
  })

  it('puts a question on hold with a note, and is handed a drafted message', async () => {
    await card('Q3').$('button*=waiting on someone').click()
    const note = card('Q3').$('input')
    await note.click()
    await note.addValue('The archive team')
    await card('Q3').$('button=Wait').click()
    await expect(card('Q3')).toHaveText(expect.stringContaining(DRAFTED), { wait: 30_000 })
    await expect(card('Q3').$('button=Copy')).toBeDisplayed()
  })

  it('discusses a question, and closes the discussion on the decision proposed', async () => {
    await card('Q4').$('button*=Discuss').click()
    await say(view().$('[role="textbox"][aria-label="Your first message on Q4"]'), 'Why not both?')
    const proposed = view().$('[role="group"][aria-label="Proposed decision"]')
    await expect(proposed).toHaveText(expect.stringContaining(DECISION), { wait: 30_000 })
    await proposed.$('button=Accept').click()
    await expect(view()).toHaveText(expect.stringContaining('Closed on a decision'))
    await $('button[aria-label^="Close Discussion"]').click()
    await expect(card('Q4')).toHaveText(expect.stringContaining(`Moot: ${DECISION}`), {
      wait: 30_000,
    })
    await expect(spec().$('section[aria-label="Decisions"]')).toHaveText(
      expect.stringContaining(DECISION),
    )
  })

  it('shows the Probe the Planner launched as a chip that ends, and its report', async () => {
    const chip = rail().$('section[aria-label="Probes"]').$('button[data-live-chip]')
    await expect(chip).toHaveAttribute('data-state', 'failed', { wait: 30_000 })
    await expect(spec().$('section[aria-label="Risks & trade-offs"]')).toHaveText(
      expect.stringContaining(NOT_PROBED),
      { wait: 30_000 },
    )
    await chip.click()
    await expect($('[data-view^="probe:"]')).toHaveText(expect.stringContaining('no repository'))
    await $('button[aria-label^="Close Probe"]').click()
    await expect($('[data-view^="probe:"]')).not.toBeExisting()
  })

  it('answers the question on hold, after which the cold read reports and Freeze appears', async () => {
    // The Planner's session keeps its script; the cold read's, started after this, takes this one.
    await browser.electron.execute(
      async (_, script) => await globalThis.hemeraProbe?.scriptAgent(script),
      COLD_READER,
    )
    await option('Q3', 'A').click()
    await expect(card('Q3').$('[data-input="integrated"]')).toBeExisting({ wait: 30_000 })
    await expect($('button=Freeze')).toBeDisplayed({ wait: 45_000 })
    await expect(rail().$('section[aria-label="Cold read"]')).toHaveText(
      expect.stringContaining('Nothing found.'),
    )
  })
})
