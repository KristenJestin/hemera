/**
 * The engine killed outright while a mission's agent writes in its Journal: every write the
 * agent made is an event, committed or not, and `memory-killed.restarted` starts Hemera again on
 * the same data folder to find exactly one Journal line per event.
 */

import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, browser, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'

const SPEC = 'memory-killed.e2e.ts'
/**
 * The veil over the sheet once the engine stopped, by its own mark: a page's own alert, such as
 * Home's when a read fails as the engine goes, stands before it in the page.
 */
const veil = () => $('[role="alert"][data-engine="stopped"]')

describe('An engine killed while an agent writes in the Journal', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('stops in the middle of the writes', async () => {
    await waitForEngine()
    const folder = join(tmpdir(), 'hemera-e2e-memory-killed-acme')
    mkdirSync(folder, { recursive: true })
    await browser.electron.execute(
      (_, main) => globalThis.hemeraProbe?.agentWrites(main, 2000),
      folder,
    )
    await browser.waitUntil(
      async () =>
        ((await browser.electron.execute(() => globalThis.hemeraProbe?.memory()))?.agentEvents ??
          0) >= 40,
      { timeout: 30_000, timeoutMsg: 'the agent never wrote 40 lines' },
    )
    const before = await browser.electron.execute(() => globalThis.hemeraProbe?.memory())
    await browser.electron.execute(() => {
      const pid = globalThis.hemeraProbe?.enginePid()
      if (pid !== undefined) process.kill(pid, 'SIGKILL')
    })
    await expect(veil()).toHaveText('Hemera stopped', { containing: true })
    console.log(`memory-killed, before the kill: ${JSON.stringify(before)}`)
    expect(before?.agentEvents ?? 0).toBeLessThan(2000)
  })
})
