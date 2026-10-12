/**
 * A Prototyper on the Planning page, in the real application, the Planner and the Prototyper the
 * fake agent the suite scripts (`planning-script.ts`): the user asks for a prototype, the Planner
 * launches the Prototyper, whose chip is in the stage card while it runs; its result is For you's
 * to look at, Validate records the verdict, and the result stays under the rest with it.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, browser, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import {
  PROTOTYPE_ASKED,
  PROTOTYPE_JUDGED,
  PROTOTYPE_MARK,
  PROTOTYPE_PLANNER,
  PROTOTYPE_TRIED,
  PROTOTYPER,
} from './planning-script.ts'
import { designSize } from './settings-page.ts'

const SPEC = 'planning-prototype.e2e.ts'
/** Acme's main checkout: a folder of the run's own, which the headless run removes after it. */
const ACME = join(tmpdir(), 'hemera-e2e-planning-prototype-acme')

const places = () => $('nav[aria-label="Places"]')
const spec = () => $('section[aria-label="Spec"]')
const rail = () => $('aside[aria-label="What calls for you"]')
const stageCard = () => rail().$('section[aria-label="Planning"]')
const forYou = () => rail().$('section[aria-label="For you"]')
const rest = () => rail().$('section[aria-label="Everything else"]')
/** A line of the rest, by its title, which unfolds what it summarises. */
const restLine = (title: string) => rest().$(`button*=${title}`)

/** Writes into a mention field and sends it with Enter. */
async function say(field: ReturnType<typeof $>, text: string): Promise<void> {
  await field.click()
  await field.addValue(text)
  await browser.keys('Enter')
}

describe('A prototype asked for, shown and judged on the Planning page', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('starts the Planner of a mission with a vision', async () => {
    await waitForEngine()
    await designSize()
    mkdirSync(ACME, { recursive: true })
    writeFileSync(join(ACME, '.env'), 'ACME_TOKEN=example\n')
    await browser.electron.execute(
      async (_, script) => await globalThis.hemeraProbe?.scriptAgent(script),
      PROTOTYPE_PLANNER,
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
    await places().$('button*=Acme').click()
    await $('ul[aria-label="Planning missions"]')
      .$(`button*=${mission?.key ?? ''}`)
      .click()
    await restLine('Your vision').click()
    await say(rail().$('[role="textbox"][aria-label="Your vision"]'), 'One note at a time.')
    await expect(spec().$('section[aria-label="Why"]')).toHaveText(
      expect.stringContaining(PROTOTYPE_MARK),
      { wait: 30_000 },
    )
  })

  it('asks for a prototype: the Prototyper the Planner launches shows its chip in the card', async () => {
    // The Planner's session keeps its script; the Prototyper's, started after this, takes this one.
    await browser.electron.execute(
      async (_, script) => await globalThis.hemeraProbe?.scriptAgent(script),
      PROTOTYPER,
    )
    await restLine('Prototypes').click()
    await say(rail().$('[role="textbox"][aria-label="Ask for a prototype"]'), PROTOTYPE_ASKED)
    await expect(
      stageCard().$('button[data-live-chip][aria-label^="Prototyper H1"]'),
    ).toBeDisplayed({
      wait: 30_000,
    })
  })

  it('shows its result to look at once it is let read, and Validate records the verdict', async () => {
    await forYou().$('button*=Permissions').click()
    await forYou().$('ul[aria-label="Permissions"]').$('button*=Prototyper').click()
    await forYou().$('button=Allow once').click()
    const line = forYou().$('button*=A prototype to look at')
    await expect(line).toBeDisplayed({ wait: 30_000 })
    await line.click()
    const list = forYou().$('ul[aria-label="Prototypes to look at"]')
    await list.$('button*=H1').click()
    await expect(list).toHaveText(expect.stringContaining(PROTOTYPE_TRIED), { wait: 30_000 })
    await list.$('button[aria-label="Validate H1"]').click()
    await expect(line).not.toBeDisplayed({ wait: 30_000 })
    await expect(restLine('Prototypes')).toHaveText(expect.stringContaining('1 validated'), {
      wait: 30_000,
    })
    await expect(spec().$('section[aria-label="Decisions"]')).toHaveText(
      expect.stringContaining(PROTOTYPE_JUDGED),
      { wait: 30_000 },
    )
  })
})
