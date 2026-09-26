/**
 * The same build, in an application that was started again (designs D10-01, D10-09,
 * D10-11).
 *
 * A build is Hemera's and lives in its data folder: its phase, each task's state and dates, every
 * try with its checks and the files it changed. Only a second start proves it, so this is one:
 * `wdio.conf.ts` points this file at the data folder `builds.e2e.ts` wrote (`CONTINUED`), which
 * left the build mid-way — T1 done after a red try, T2 the user's, T3 waiting on it.
 *
 * Then the build ends where a build ends: the user marks T2 done from the view, the agent started
 * again is handed T3 and finishes it, the final checks pass and Accept closes the build, the Spec
 * staying in progress.
 *
 * Each suite is named after the scenario it covers.
 */

import { browser, expect } from '@wdio/globals'

import { APPROACH } from './agent/script.ts'
import { awaits, press, region } from './hand.ts'
import { buildNow, pressExactly, unfoldTasks } from './build-hand.ts'

const KEY = 'ATL-1'

const BUILD = 'New session'

describe('A restart resumes the build where it stood', () => {
  it('shows the same states, tries and evidence after the application started again', async () => {
    await awaits(BUILD)
    await press(BUILD)
    await awaits(APPROACH)

    const build = await buildNow(KEY)
    expect(build.phase).toBe('execute')
    expect(build.paused).toBe(false)
    expect(build.states).toEqual({ T1: 'done', T2: 'yours', T3: 'waiting' })
    expect(build.tries.T1).toEqual(['red', 'green'])
    await awaits('Yours: T2 · Sign the export format off')
  })
})

describe('Accept ends the build', () => {
  it('the user’s Done lets T3 go on; once the final checks pass, Accept ends the build', async () => {
    await pressExactly('Done')
    await browser.waitUntil(async () => (await buildNow(KEY)).canAccept, {
      timeout: 40_000,
      timeoutMsg: 'the build never offered Accept',
    })
    expect((await buildNow(KEY)).states).toEqual({ T1: 'done', T2: 'done', T3: 'done' })

    await pressExactly('Accept')
    await browser.waitUntil(async () => (await buildNow(KEY)).phase === 'accepted', {
      timeout: 10_000,
      timeoutMsg: 'the build was never accepted',
    })
    // The Spec stays in progress: delivery is a later lot's (D10-11).
    expect((await buildNow(KEY)).specStatus).toBe('in_progress')
    await awaits('Accepted')
    // The story and its three tasks are still drawn, T3 now done.
    await unfoldTasks()
    expect(await region('ol[aria-label^="Stories of"]')).toContain('T3')
  })
})
