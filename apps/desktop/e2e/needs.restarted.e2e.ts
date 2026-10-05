/**
 * Hemera started again on the data folder `needs.e2e.ts` left: the need it created is still
 * pending, shown again, and nothing answered it on its own.
 */

import { browser, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'

const SPEC = 'needs.restarted.e2e.ts'

describe('A need, found again after Hemera started anew', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('is still pending, and was not answered', async () => {
    await waitForEngine()
    const pending = await browser.electron.execute(() => globalThis.hemeraProbe?.pendingNeeds())
    expect(pending).toHaveLength(1)
    expect(pending?.[0]).toMatchObject({ state: 'pending', answered: false })
  })
})
