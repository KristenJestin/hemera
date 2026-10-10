/**
 * Home in the real application: Recent lists a mission once it was opened, and leaving Home after
 * seeing it keeps what Since you left told from coming back as new. `home.restarted.e2e.ts` starts
 * Hemera again on the same data folder.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, browser, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'

const SPEC = 'home.e2e.ts'
/** Acme's main checkout: a folder of the run's own, which the headless run removes after it. */
const ACME = join(tmpdir(), 'hemera-e2e-home-acme')
/** What Home told before it was left, for the run that follows the restart. */
const SEEN = join(tmpdir(), 'hemera-e2e-home-seen.json')

const places = () => $('nav[aria-label="Places"]')
/** Home's place: named by its words alone until something waits, which its label then counts. */
const home = () => places().$('[data-mark="home"] > button')
const planning = () => $('ul[aria-label="Planning missions"]')
/** Recent's list once read: while it is on its way, its rows are skeletons of the same name. */
const recent = () => $('ul[aria-label="Recent"]:not([aria-busy])')
const sinceYouLeft = () => $('section[aria-label="Since you left"]')
/** The crumb of the page shown, at the end of the trail. */
const here = () => $('nav[aria-label="Where you are"] [aria-current="page"]')

describe('Home, coming back', () => {
  let key = ''

  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('has no Recent mission before one was opened', async () => {
    await waitForEngine()
    mkdirSync(ACME, { recursive: true })
    const project =
      (await browser.electron.execute(
        async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder),
        ACME,
      )) ?? ''
    const mission = await browser.electron.execute(
      async (_, id) => await globalThis.hemeraProbe?.createMission(id, 'Add roles'),
      project,
    )
    key = mission?.key ?? ''
    await home().click()
    await expect($('section[aria-label="Recent"]').$('p=No mission yet.')).toBeDisplayed()
  })

  it('leads Recent with the mission once it was opened', async () => {
    await places().$('button*=Acme').click()
    await planning().$(`button*=${key}`).click()
    await home().click()
    await expect(recent().$(`button*=${key}`)).toBeDisplayed()
    await expect(recent().$('button*=Add roles')).toBeDisplayed()
  })

  it('opens the mission from its row in Recent', async () => {
    await recent().$(`button*=${key}`).click()
    await expect(here()).toHaveText(key)
  })

  it('keeps what Since you left told in a file, then leaves Home', async () => {
    await home().click()
    await expect(sinceYouLeft()).toBeDisplayed()
    // Read once it has answered: its rows on their way are skeletons.
    await expect(sinceYouLeft().$('[aria-busy="true"]')).not.toBeExisting()
    // An event's line, whole even while it still unfolds: a card's events are the lines in it.
    const told = await sinceYouLeft()
      .$$('li li')
      .map(async (line) => String(await line.getProperty('textContent')))
    writeFileSync(SEEN, JSON.stringify({ key, told }))
    await expect($('section[aria-label="Questions"]')).not.toBeExisting()
    await places().$('button*=Acme').click()
    await expect(planning()).toBeDisplayed()
  })
})
