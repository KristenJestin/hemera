/**
 * The same Spec, in an application that was started again (designs D7-01, D7-08, D7-11, D7-12).
 *
 * A Spec is Hemera's and lives in its data folder: its sections with their versions, its phases
 * with their states, the Session that holds its write right, and a human text refused on an
 * older version, kept until the human chooses. Only a second start proves it, so this is one:
 * `wdio.conf.ts` points this file at the data folder `specs.e2e.ts` wrote (`CONTINUED`).
 *
 * The issue asks for a restart in the middle of `plan`. `plan` opens once the agent declares
 * `shape` finished, which it does through Hemera's tools (phase 1b): until then the restart is
 * checked in `shape`, where that file left the Spec, and "Phases survive a restart" mid-`plan` is
 * the engine's suite.
 *
 * Each suite is named after the scenario it covers.
 */

import { browser, expect } from '@wdio/globals'

import { PROPOSAL, PROPOSE } from './agent/script.ts'
import { awaits, control, press, pressIn, region, textOf } from './hand.ts'

/** The first Session of `specs.e2e.ts`, which is the title it is listed under. */
const ASKED = `The CSV export drops the date. ${PROPOSE}`

/** The second one, opened on the Spec, which took the write right. */
const OPENED = 'New session'

const KEY = 'ATL-1'
const PROBLEM = 'The CSV export leaves the invoice date column empty.'
const THEIRS_AGAIN = 'The invoice CSV export, in every currency.'
const KEPT = 'Every CSV export of the billing module.'

const PANEL = `section[aria-label="Spec ${KEY}"]`

/** The heading of a phase's group in the document, which says its state to a screen reader. */
async function phaseHeading(phase: string): Promise<string> {
  return await browser.execute(
    (scope: string, name: string) =>
      [...(document.querySelector(scope)?.querySelectorAll('h3') ?? [])]
        .map((one) => one.textContent ?? '')
        .find((text) => text.startsWith(name)) ?? '',
    PANEL,
    phase,
  )
}

describe('Phases survive a restart', () => {
  it('finds the draft, its sections and its phases as they were', async () => {
    await awaits(ASKED)
    await press(ASKED)
    await browser.waitUntil(async () => (await region(PANEL)) !== '', {
      timeout: 10_000,
      timeoutMsg: 'the Spec panel never opened',
    })

    const panel = await region(PANEL)
    expect(panel).toContain(PROPOSAL.title)
    expect(panel).toContain('draft')
    expect(await textOf('Problem')).toBe(PROBLEM)
    expect(await phaseHeading('Shape')).toBe('Shape, open')
    expect(await phaseHeading('Plan')).toBe('Plan, pending')
    expect(await phaseHeading('Decompose')).toBe('Decompose, pending')
    // The write right stayed with the Session that took it.
    expect(await region('[role="group"][aria-label="Write right"]')).toContain(`« ${OPENED} »`)
  })
})

describe('A conflict keeps the human’s text', () => {
  it('still holds the text refused before the restart, and lets it go on Discard mine', async () => {
    expect(await region(PANEL)).toContain('Your text was written on v3; the section is at v4.')
    expect(await textOf('Scope, your text')).toBe(KEPT)

    await pressIn(PANEL, 'Discard mine')
    await browser.pause(1200)
    expect(await region(PANEL)).not.toContain('Your text was written on')
    expect(await control('Discard mine')).toBeNull()
    expect(await textOf('Scope')).toBe(THEIRS_AGAIN)
  })
})
