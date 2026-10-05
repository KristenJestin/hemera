/**
 * Hemera started again on the data folder `memory-killed.e2e.ts` left, its engine killed while an
 * agent wrote in the Journal: once the Memory caught up, the Journal holds exactly one line per
 * write the agent made, and the mission's markdown files are written again from the database.
 */

import { browser, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'

const SPEC = 'memory-killed.restarted.e2e.ts'

describe('The Journal, found again after the engine was killed', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('holds one line per event, and the markdown files say the same', async () => {
    await waitForEngine()
    await browser.waitUntil(
      async () => {
        const state = await browser.electron.execute(() => globalThis.hemeraProbe?.memory())
        const [mission] = state?.files ?? []
        return state !== undefined && mission?.names.includes('journal.md') === true
      },
      { timeout: 30_000, timeoutMsg: 'the Memory never wrote its files again' },
    )
    const after = await browser.electron.execute(() => globalThis.hemeraProbe?.memory())
    console.log(`memory-killed, after the restart: ${JSON.stringify(after)}`)
    expect(after?.agentEvents ?? 0).toBeGreaterThan(0)
    expect(after?.agentLines).toBe(after?.agentEvents)
    const [mission] = after?.files ?? []
    expect(mission?.names).toEqual(['journal.md', 'notes.md', 'now.md'])
    expect(mission?.journalFileLines).toBe(after?.journalLines)
  })
})
