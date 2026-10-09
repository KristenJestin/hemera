/**
 * The Spec settings of a Project in the real application: where Specs live changed to Linked and
 * the language to French, linked tickets checked every 30 minutes, a key prefix refused with its
 * reason under the field, then a valid one kept. `spec-settings.restarted.e2e.ts` starts Hemera
 * again on the same data folder and finds all four.
 */

import { $, browser, expect } from '@wdio/globals'

import { ACME, writeAcme } from './acme.ts'
import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import { choose, designSize, field, section, settingsOf, write } from './settings-page.ts'

const SPEC = 'spec-settings.e2e.ts'

const specs = () => $('section[aria-label="Specs"]')

describe('The Spec settings of a Project', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('shows Local Specs, English and the default prefix of a new Project', async () => {
    writeAcme()
    await waitForEngine()
    await designSize()
    await browser.electron.execute(
      async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder),
      ACME,
    )
    await $('nav[aria-label="Places"]').$('button*=Acme').click()
    await settingsOf('Acme')
    await section('Tickets and Specs', 'Specs')
    await expect(specs()).toHaveText(expect.stringContaining('The Spec lives in Hemera.'))
    await expect(specs().$('[aria-label="Spec language"]')).toHaveText(
      expect.stringContaining('English'),
    )
    await expect(field(specs(), 'Key prefix')).toHaveValue('ACME')
    await expect(specs().$('[aria-label="Check linked tickets"]')).not.toBeExisting()
  })

  it('offers Local and Linked, and never Remote', async () => {
    await specs().$('[aria-label="Where Specs live"]').click()
    await expect($('[role="option"]*=Local')).toBeDisplayed()
    await expect($('[role="option"]*=Linked')).toBeDisplayed()
    await expect($('[role="option"]*=Remote')).not.toBeExisting()
    await browser.keys('Escape')
  })

  it('changes where Specs live, and the language', async () => {
    await choose(specs(), 'Where Specs live', 'Linked')
    await expect(specs()).toHaveText(expect.stringContaining('follows its ticket'))
    await choose(specs(), 'Spec language', 'French')
    await expect(specs().$('[aria-label="Spec language"]')).toHaveText(
      expect.stringContaining('French'),
    )
  })

  it('checks linked tickets every hour, and keeps another interval', async () => {
    const interval = specs().$('[aria-label="Check linked tickets"]')
    await expect(interval).toHaveText(expect.stringContaining('Every hour'), { wait: 10_000 })
    await expect(specs()).toHaveText(expect.stringMatching(/Last checked at|Not checked yet/))
    await choose(specs(), 'Check linked tickets', 'Every 30 minutes')
    await expect(interval).toHaveText(expect.stringContaining('Every 30 minutes'))
  })

  it('refuses a key prefix that is not one, with the reason under the field', async () => {
    await write(field(specs(), 'Key prefix'), 'a')
    await expect(specs()).toHaveText(expect.stringContaining('cannot be a key prefix'), {
      wait: 10_000,
    })
  })

  it('keeps a valid key prefix, and says only the next missions change', async () => {
    await write(field(specs(), 'Key prefix'), 'shop')
    await expect(specs()).not.toHaveText(expect.stringContaining('cannot be a key prefix'), {
      wait: 10_000,
    })
    await expect(field(specs(), 'Key prefix')).toHaveValue('SHOP')
    await expect(specs()).toHaveText(expect.stringContaining('Missions already started keep their key'))
  })
})
