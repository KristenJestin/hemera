/**
 * An engine killed from outside: what the window waited on fails with `EngineGone`, the window
 * says so in one sentence with a way to restart Hemera, and main writes the death down.
 */

import { $, browser, expect } from '@wdio/globals'

import { waitForEngine, waitForLines } from './diagnostic.ts'

const SPEC = 'engine-killed.e2e.ts'

describe('An engine killed from outside', () => {
  it('fails the window’s pending call and shows the sentence and the restart', async () => {
    await waitForEngine()
    await browser.electron.execute(() => {
      const pid = globalThis.hemeraProbe?.enginePid()
      if (pid !== undefined) process.kill(pid)
    })
    await expect($('[role="alert"]')).toHaveText('Hemera stopped', { containing: true })
    await expect($('[role="alert"]')).toHaveText('Hemera’s engine stopped.', { containing: true })
    await expect($('button=Restart Hemera')).toBeDisplayed()
    await waitForLines(SPEC, /\[main\] the engine stopped with code/, 1)
    await waitForLines(
      SPEC,
      /\[main\] engine\.statusChanges: failed: Hemera’s engine stopped\.$/,
      1,
    )
  })
})
