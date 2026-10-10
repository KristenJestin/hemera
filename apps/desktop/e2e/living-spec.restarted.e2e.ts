/**
 * Hemera started again on the data folder `living-spec.e2e.ts` left: Invoicing is still validated
 * with its two requirements, and Accounts still waits with the one that was not dropped.
 */

import { $, $$, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'

const SPEC = 'living-spec.restarted.e2e.ts'

const domains = () => $('nav[aria-label="Domains"]')
/** A domain of the list beside the page, by what it says to a screen reader. */
const domainLine = (words: string) => domains().$(`button[aria-label="${words}"]`)

describe('The living spec, found again after Hemera started anew', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('opens from the Project’s page with Invoicing validated', async () => {
    await waitForEngine()
    await $('nav[aria-label="Places"]').$('button*=Acme').click()
    await $('aside[aria-label="About Acme"]').$('button=Open').click()
    await expect(domainLine('Invoicing, validated')).toBeDisplayed()
    await domains().$('button*=Invoicing').click()
    await expect($$('article[aria-label$=", validated"]')).toBeElementsArrayOfSize(2)
  })

  it('keeps Accounts waiting, with the requirement that was not dropped', async () => {
    await expect(domainLine('Accounts, 1 waiting for you')).toBeDisplayed()
    await domains().$('button*=Accounts').click()
    await expect($$('article[aria-label$=", proposed"]')).toBeElementsArrayOfSize(1)
  })
})
