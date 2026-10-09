/**
 * Hemera started again on the data folder `exclusive-resources.e2e.ts` left: the shared database
 * is still declared, with the command that uses it and the one that restores it.
 */

import { $, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import { designSize, dialog, section, settingsOf } from './settings-page.ts'

const SPEC = 'exclusive-resources.restarted.e2e.ts'

describe('An exclusive resource, found again after Hemera started anew', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('keeps the shared database, its command and its restore', async () => {
    await waitForEngine()
    await designSize()
    await $('nav[aria-label="Places"]').$('button*=Acme').click()
    await settingsOf('Acme')
    await section('Exclusive resources')
    const list = $('ul[aria-label="Exclusive resources"]')
    await expect(list).toHaveText(expect.stringContaining('Shared database'))
    await expect(list).toHaveText(expect.stringContaining('Seed the database'))
    await expect(list).toHaveText(expect.stringContaining('restored by Reset the database'))
  })

  it('opens it with its command ticked', async () => {
    await $('ul[aria-label="Exclusive resources"]').$('button*=Shared database').click()
    await expect(dialog().$('aria/Seed the database')).toHaveAttribute('aria-checked', 'true')
  })
})
