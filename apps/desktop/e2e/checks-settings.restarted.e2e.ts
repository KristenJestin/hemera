/**
 * Hemera started again on the data folder `checks-settings.e2e.ts` left: the checks accepted and
 * added, and the doc recipe accepted, are still there.
 */

import { $, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import { designSize, section, settingsOf } from './settings-page.ts'

const SPEC = 'checks-settings.restarted.e2e.ts'

describe('The checks and the doc recipes, found again after Hemera started anew', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('restart and find the checks', async () => {
    await waitForEngine()
    await designSize()
    await $('nav[aria-label="Places"]').$('button*=acme').click()
    await settingsOf('acme')
    await section('Checks')
    const checks = $('section[aria-label="Checks"]')
    await Promise.all(
      ['lint', 'build', 'coverage'].map((name) =>
        expect(checks.$(`button[aria-label^="${name},"]`)).toBeDisplayed(),
      ),
    )
    await expect(checks).not.toHaveText(expect.stringContaining('Nothing is kept'))
  })

  it('restart and find the doc recipe', async () => {
    await section('Documentation')
    await expect(
      $('section[aria-label="Documentation"]').$('button[aria-label^="README.md in api"]'),
    ).toBeDisplayed()
  })
})
