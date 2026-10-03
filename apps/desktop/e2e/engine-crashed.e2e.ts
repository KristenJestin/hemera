/** An engine that crashes from inside (`process.crash()`): the same as one killed from outside. */

import { $, browser, expect } from '@wdio/globals'

import { waitForEngine, waitForLines } from './diagnostic.ts'

const SPEC = 'engine-crashed.e2e.ts'

describe('An engine that crashes', () => {
  it('fails the window’s pending call and shows the sentence and the restart', async () => {
    await waitForEngine()
    await browser.electron.execute(() => globalThis.hemeraProbe?.crashEngine())
    await expect($('[role="alert"]')).toHaveText('Hemera’s engine stopped.')
    await expect($('button=Restart Hemera')).toBeDisplayed()
    await waitForLines(SPEC, /\[main\] the engine stopped with code/, 1)
  })
})
