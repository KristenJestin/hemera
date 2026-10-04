/**
 * Hemera started again on the data folder `project-settings.e2e.ts` left: Acme is there, with its
 * repositories and the base branch set, its commands, the service in the state it was left in,
 * and the command marked to run at each opening run by this start.
 */

import { $, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import { designSize, section, settingsOf } from './settings-page.ts'

const SPEC = 'project-settings.restarted.e2e.ts'

describe('Acme, found again after Hemera started anew', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('is in the sidebar, and its settings list its repositories, api on dev', async () => {
    await waitForEngine()
    await designSize()
    await $('nav[aria-label="Places"]').$('button*=acme').click()
    await settingsOf('acme')
    for (const path of ['api', 'web', 'services/billing']) {
      await expect($(`[data-repository="${path}"]`)).toBeDisplayed()
    }
    await expect($('[data-repository="api"]')).toHaveText(expect.stringContaining('origin/dev'))
  })

  it('keeps its commands', async () => {
    await section('Commands')
    await expect($('[data-command="web"]')).toBeDisplayed()
    await expect($('[data-command="greet"]')).toBeDisplayed()
  })

  it('shows the service as it was left, and the command run at this opening', async () => {
    await section('Services')
    await expect($('[data-run="web"]')).toHaveAttribute('data-state', 'stopped')
    await expect($('[data-run="greet"]')).toHaveAttribute('data-state', 'finished', {
      wait: 30_000,
    })
  })
})
