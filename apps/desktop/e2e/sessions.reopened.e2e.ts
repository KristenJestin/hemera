/**
 * The same Session, in an application that was started again (issue #17, designs D5-06, D5-07).
 *
 * A thread belongs to Hemera and not to the agent: it survives the window being closed, and the
 * conversation carries on where it left off. Nothing but a second start of the application
 * proves it — a page loaded again reads the data folder, but the engine, the pool and the agent's
 * own process are all still the ones the first turn used.
 *
 * So this is that second start: the service runs one instance per spec file, and `wdio.conf.ts`
 * points this file at the data folder `sessions.e2e.ts` wrote (`CONTINUED`). The Project, the
 * Session and its thread are what that file left; the agent is the same command on the `PATH`,
 * started again from nothing, and what it answers a second prompt is the second thing its script
 * says — which is how a conversation that carried on is told apart from a thread replayed.
 *
 * Each suite is named after the scenario it covers.
 */

import { browser, expect } from '@wdio/globals'

import { ANSWERS } from './agent/script.ts'
import { awaits, control, press, shows, strike, write } from './hand.ts'

/** What the first instance asked, which is what its thread opens with. */
const ASKED = 'The CSV export drops the invoice date.'

/** What it named the Session, which is what the sidebar of a window that just opened shows. */
const NAMED = 'Invoice export'

describe('App restart resumes the native session', () => {
  it('finds the Session and its thread, and answers the next prompt in it', async () => {
    // The sidebar of a window that has just opened: the Session is the one the previous instance
    // made, under the name it was given.
    await awaits(NAMED)

    await press(NAMED)
    await browser.pause(1200)

    // The thread as it was written: what was asked, and what the agent answered it.
    expect(await shows(ASKED)).toBe(true)
    expect(await shows(ANSWERS[0])).toBe(true)

    // And the conversation goes on: the agent is started again, its session is resumed on the id
    // and the folder the Session kept, and what comes back is the *next* thing it had to say.
    await write('Is it fixed?')
    await press('Send')
    await awaits(ANSWERS[1])
  })
})

describe('Archivage durable', () => {
  it('stays put away once it has been, and is still consultable', async () => {
    await press('Archive')
    await browser.pause(1000)
    expect(await shows('No Session yet')).toBe(true)

    // Read back from the data folder rather than from the page: everything the window shows
    // after a load is what the engine answered about the folder it opened.
    await browser.refresh()
    await browser.pause(2500)
    expect(await shows('No Session yet')).toBe(true)
    expect(await control(`Archive ${NAMED}`)).toBeNull()

    await strike('k', 'KeyK')
    await browser.pause(500)
    await press('Archived Sessions')
    await browser.pause(900)
    expect(await shows(NAMED)).toBe(true)
  })
})
