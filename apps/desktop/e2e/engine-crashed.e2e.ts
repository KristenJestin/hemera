/** An engine that crashes from inside (`process.crash()`): the same as one killed from outside. */

import { $, browser, expect } from '@wdio/globals'

import { waitForEngine, waitForLines } from './diagnostic.ts'

const SPEC = 'engine-crashed.e2e.ts'
/**
 * The veil over the sheet once the engine stopped, by its own mark: a page's own alert, such as
 * Home's when a read fails as the engine goes, stands before it in the page.
 */
const veil = () => $('[role="alert"][data-engine="stopped"]')

describe('An engine that crashes', () => {
  it('fails the window’s pending call and shows the sentence and the restart', async () => {
    await waitForEngine()
    await browser.electron.execute(() => globalThis.hemeraProbe?.crashEngine())
    await expect(veil()).toHaveText('Hemera stopped', { containing: true })
    await expect(veil()).toHaveText('Hemera’s engine stopped.', { containing: true })
    await expect($('button=Restart Hemera')).toBeDisplayed()
    await waitForLines(SPEC, /\[main\] the engine stopped with code/, 1)
  })
})
