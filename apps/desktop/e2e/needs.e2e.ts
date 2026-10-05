/**
 * A need created in a running Hemera: pending in Needs you, with no answer. `needs.restarted`
 * starts Hemera again on the same data folder.
 */

import { browser, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'

const SPEC = 'needs.e2e.ts'

describe('A need created while Hemera runs', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('is pending in Needs you, and nothing answered it', async () => {
    await waitForEngine()
    const id = await browser.electron.execute(() => globalThis.hemeraProbe?.createNeed())
    const pending = await browser.electron.execute(() => globalThis.hemeraProbe?.pendingNeeds())
    expect(pending).toEqual([{ id, state: 'pending', answered: false }])
  })
})
