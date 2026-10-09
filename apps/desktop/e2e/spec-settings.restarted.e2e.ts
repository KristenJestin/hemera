/**
 * Hemera started again on the data folder `spec-settings.e2e.ts` left: Acme keeps its Linked
 * Specs, their French language and the key prefix SHOP.
 */

import { $, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import { designSize, field, section, settingsOf } from './settings-page.ts'

const SPEC = 'spec-settings.restarted.e2e.ts'

describe('The Spec settings of Acme, found again after Hemera started anew', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('keeps the mode, the language and the key prefix', async () => {
    await waitForEngine()
    await designSize()
    await $('nav[aria-label="Places"]').$('button*=Acme').click()
    await settingsOf('Acme')
    await section('Tickets and Specs')
    const specs = $('section[aria-label="Specs"]')
    await expect(specs).toHaveText(expect.stringContaining('follows its ticket'))
    await expect(specs.$('[aria-label="Spec language"]')).toHaveText(
      expect.stringContaining('French'),
    )
    await expect(field(specs, 'Key prefix')).toHaveValue('SHOP')
  })
})
