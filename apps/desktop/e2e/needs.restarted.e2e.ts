/**
 * Hemera started again on the data folder `needs.e2e.ts` left: the needs it left pending are
 * still pending, shown again on Home and counted, and nothing answered them on their own.
 */

import { $, browser, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'

const SPEC = 'needs.restarted.e2e.ts'

describe('Needs, found again after Hemera started anew', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('are still pending, and were not answered', async () => {
    await waitForEngine()
    const pending = await browser.electron.execute(() => globalThis.hemeraProbe?.pendingNeeds())
    expect(pending).toHaveLength(2)
    for (const need of pending ?? []) {
      expect(need).toMatchObject({ state: 'pending', answered: false })
    }
  })

  it('are shown again on Home and counted in the sidebar', async () => {
    const needsYou = $('ul[aria-label="Needs you"]')
    await expect(needsYou.$('li*=Docker is not running')).toBeDisplayed()
    await expect(needsYou.$('li*=The model of the builder is no longer offered')).toBeDisplayed()
    await expect(
      $('nav[aria-label="Places"]').$('button[aria-label="Home, 2 waiting"]'),
    ).toBeDisplayed()
  })
})
