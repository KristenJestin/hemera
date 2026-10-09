/**
 * The living spec in the real application (#104): a Project added, the bootstrap read by the
 * fake agent the headless suite scripts, the page opened from the Project's page, one domain
 * validated and one proposed requirement dropped in another. `living-spec.restarted.e2e.ts`
 * starts Hemera again on the same data folder and finds all of it.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, $$, browser, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'

const SPEC = 'living-spec.e2e.ts'
/** Acme's main checkout: a folder of the run's own, which the headless run removes after it. */
const ACME = join(tmpdir(), 'hemera-e2e-living-spec-acme')

const places = () => $('nav[aria-label="Places"]')
const domains = () => $('nav[aria-label="Domains"]')

const SCENARIO = [{ when: 'the user exports the invoices', then: 'a CSV file is saved' }]

const domain = (id: string, name: string) =>
  ({
    does: 'uses',
    id: `toolu_domain_${id}`,
    tool: 'living_domain_propose',
    arguments: { name, summary: `What ${name} covers.` },
  }) as const

const requirement = (id: string, name: string, text: string) =>
  ({
    does: 'uses',
    id: `toolu_requirement_${id}`,
    tool: 'living_requirement_propose',
    arguments: { domain: name, text, scenarios: SCENARIO },
  }) as const

/** What the reading agent proposes: two domains, two requirements each, then done. */
const SCRIPT = {
  steps: [
    domain('1', 'Invoicing'),
    requirement('1', 'Invoicing', 'An invoice is numbered when it is made.'),
    requirement('2', 'Invoicing', 'An invoice can be exported as CSV.'),
    domain('2', 'Accounts'),
    requirement('3', 'Accounts', 'A member signs in with an email.'),
    requirement('4', 'Accounts', 'A member can leave an account.'),
    {
      does: 'uses',
      id: 'toolu_done',
      tool: 'living_spec_done',
      arguments: { summary: 'Proposed what I read.' },
    },
  ],
} as const

/** Opens a domain from the list beside the page, by its name. */
async function openDomain(name: string): Promise<void> {
  await domains().$(`button*=${name}`).click()
  await expect($(`section[aria-labelledby]`).$('h2')).toHaveText(name)
}

describe('The living spec read, then reviewed', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('adds Acme: the agent reads it, and the Project’s page offers the living spec', async () => {
    await waitForEngine()
    mkdirSync(ACME, { recursive: true })
    writeFileSync(join(ACME, 'README.md'), '# Acme\n')
    await browser.electron.execute(
      async (_, script) => await globalThis.hemeraProbe?.scriptAgent(script),
      SCRIPT,
    )
    await browser.electron.execute(
      async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder),
      ACME,
    )
    await places().$('button*=Acme').click()
    const card = $('section*=Living spec')
    await expect(card.$('ul[aria-label="Domains"]')).toBeDisplayed({ wait: 60_000 })
    await card.$('button=Open').click()
    await expect($('h1=Living spec')).toBeDisplayed()
  })

  it('lists both domains, each waiting for the user', async () => {
    await expect(domains().$('button*=Invoicing, 2 waiting for you')).toBeDisplayed()
    await expect(domains().$('button*=Accounts, 2 waiting for you')).toBeDisplayed()
  })

  it('draws a proposed requirement as a draft, never as a validated one', async () => {
    await openDomain('Invoicing')
    await expect($$('article[aria-label$=", proposed"]')).toBeElementsArrayOfSize(2)
    await expect($$('article[aria-label$=", validated"]')).toBeElementsArrayOfSize(0)
  })

  it('validates Invoicing: its requirements become what the Project does today', async () => {
    await $('button=Validate this domain').click()
    await expect($$('article[aria-label$=", validated"]')).toBeElementsArrayOfSize(2)
    await expect(domains().$('button*=Invoicing, validated')).toBeDisplayed()
  })

  it('drops one proposed requirement of Accounts, the other stays proposed', async () => {
    await openDomain('Accounts')
    await $$('button[aria-label^="Drop "]')[0]?.click()
    await expect($$('article[aria-label$=", proposed"]')).toBeElementsArrayOfSize(1)
    await expect(domains().$('button*=Accounts, 1 waiting for you')).toBeDisplayed()
  })
})
