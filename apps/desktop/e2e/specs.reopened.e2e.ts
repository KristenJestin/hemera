/**
 * The same Spec, in an application that was started again (designs D7-01, D7-08, D7-11).
 *
 * A Spec is Hemera's and lives in its data folder: its sections with their versions, its phases
 * with their states, and the Session that holds its write right. Only a second start proves it,
 * so this is one:
 * `wdio.conf.ts` points this file at the data folder `specs.e2e.ts` wrote (`CONTINUED`).
 *
 * The restart is checked in `shape`, where that file left the Spec; "Phases survive a restart"
 * mid-`plan` is the engine's suite.
 *
 * Then the journey ends where a Spec ends: the writer Session's agent writes what the draft still
 * lacks through `spec_write`, declares `shape`, `plan` and `decompose` finished and attests the
 * contract through `spec_propose`, the human presses Mark ready, and the agent's next write is
 * refused on the frozen Spec.
 *
 * Each suite is named after the scenario it covers.
 */

import { browser, expect } from '@wdio/globals'

import {
  COMPLETE,
  COMPLETED,
  CONTRACT_VERSION,
  PROPOSAL,
  PROPOSE,
  REWRITE,
  REWRITE_ANSWER,
  WRITTEN,
} from './agent/script.ts'
import { awaits, control, press, pressIn, region, showPart, unfoldSpec, write } from './hand.ts'

/** The first Session of `specs.e2e.ts`, which is the title it is listed under. */
const ASKED = `The CSV export drops the date. ${PROPOSE}`

/** The second one, opened on the Spec, which took the write right. */
const OPENED = 'New session'

const KEY = 'ATL-1'
const PROBLEM = 'The CSV export leaves the invoice date column empty.'

const PANEL = `section[aria-label="Spec ${KEY}"]`

const THREAD = '[aria-label="The thread of this Session"]'

/** What the engine holds of the Spec: its status, its revision, a section, its phases. */
async function specNow() {
  return await browser.execute(async (key: string) => {
    const projects = await window.hemera.invoke('projects.list', {})
    const specs = await window.hemera.invoke('specs.list', { projectId: projects[0]?.id ?? '' })
    const specId = specs.find((one) => one.key === key)?.id ?? ''
    const read = await window.hemera.invoke('specs.read', { specId })
    const outcome = read.sections.find((one) => one.name === 'expected_outcome')
    return {
      status: read.spec.status,
      revision: read.revision.number,
      outcome: { body: outcome?.body ?? '', version: outcome?.version ?? 0 },
      outcomeBy: outcome?.author ?? '',
      phases: read.phases.map((one) => `${one.phase} ${one.state}`),
      attested: read.revision.attestedContentVersion === read.spec.contentVersion,
    }
  }, KEY)
}

/**
 * The heading of a phase's group in the rail — the group's first row — which says its state to a
 * screen reader.
 */
async function phaseHeading(phase: string): Promise<string> {
  return await browser.execute(
    (scope: string, name: string) =>
      document
        .querySelector(scope)
        ?.querySelector(`[role="group"][aria-label="${name}"] [data-heading]`)
        ?.getAttribute('aria-label') ?? '',
    `nav[aria-label="Parts of ${KEY}"]`,
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
    await unfoldSpec(KEY)

    const panel = await region(PANEL)
    expect(panel).toContain(PROPOSAL.title)
    expect(panel).toContain('draft')
    await showPart(KEY, 'Problem')
    expect(await region(PANEL)).toContain(PROBLEM)
    expect(await phaseHeading('Shape')).toBe('Shape phase, open, show all its parts')
    expect(await phaseHeading('Plan')).toBe('Plan phase, pending, show all its parts')
    expect(await phaseHeading('Decompose')).toBe('Decompose phase, pending, show all its parts')
    // The write right stayed with the Session that took it.
    expect(await region('[role="group"][aria-label="Write right"]')).toContain(`« ${OPENED} »`)
  })
})

describe('The button is offered only when the checks pass', () => {
  it('lets the agent write the rest, declare the three phases and attest, then offers Mark ready', async () => {
    await press(OPENED)
    await browser.waitUntil(async () => (await region(PANEL)) !== '', {
      timeout: 10_000,
      timeoutMsg: 'the Spec panel of the writer Session never opened',
    })
    await unfoldSpec(KEY)
    await write(COMPLETE)
    await press('Send')
    await awaits(COMPLETED, 60_000)
    await browser.pause(1500)

    // Written by the agent through `spec_write`, on the draft, with its provenance.
    const spec = await specNow()
    expect(spec.status).toBe('draft')
    expect(spec.outcome).toEqual({ body: WRITTEN.expected_outcome, version: CONTRACT_VERSION + 1 })
    expect(spec.outcomeBy).toBe('agent')
    expect(spec.phases).toEqual(
      expect.arrayContaining(['shape finished', 'plan finished', 'decompose finished']),
    )
    expect(spec.attested).toBe(true)
    // The attestation alone froze nothing: the gate is empty, and the human's press is left.
    expect(await region(PANEL)).toContain('Ready to freeze')
    expect(await control('Mark ready')).not.toBeNull()
  })

  it('freezes the Spec on the human’s Mark ready', async () => {
    await pressIn(PANEL, 'Mark ready')
    await browser.pause(1500)

    expect((await specNow()).status).toBe('ready')
    expect(await region(PANEL)).toContain('Frozen on')
    // And Mark ready is gone: a frozen Spec offers nothing to freeze.
    expect(await control('Mark ready')).toBeNull()
  })
})

describe('A write on a frozen Spec is refused through the tool', () => {
  it('refuses the agent’s spec_write with its reason, and the Spec stays ready', async () => {
    await write(REWRITE)
    await press('Send')
    await awaits(REWRITE_ANSWER)
    await browser.pause(1200)

    // The call is recorded like any other, refused with the reason, and nothing changed.
    expect(await region(THREAD)).toContain(`${KEY} is marked ready; only a draft can be changed`)
    const spec = await specNow()
    expect(spec.status).toBe('ready')
    expect(spec.revision).toBe(1)
    expect(spec.outcome).toEqual({ body: WRITTEN.expected_outcome, version: CONTRACT_VERSION + 1 })
  })
})
