/**
 * Hemera started again on the data folder `setup.e2e.ts` left: Acme opens on its page rather than
 * the first launch, its cap is still one sub-agent, and Never run still holds its command.
 */

import { $, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import { designSize, section, settingsOf } from './settings-page.ts'

const SPEC = 'setup.restarted.e2e.ts'

describe('Acme’s agent settings, found again after Hemera started anew', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('keeps the cap at one sub-agent, and the command never run', async () => {
    await waitForEngine()
    await designSize()
    await $('nav[aria-label="Places"]').$('button*=acme').click()
    await settingsOf('acme')
    await section('Cap and budget')
    await expect($('aria/Sub-agents at once')).toHaveValue('1')
    await section('Commands')
    await expect($('ul[aria-label="Never run"]')).toHaveText(
      expect.stringContaining('terraform apply'),
    )
  })
})
