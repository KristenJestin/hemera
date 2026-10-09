/**
 * A mission started from the Project's field: from a sentence (the field searches, "Create a
 * mission" is the last choice and Enter does not take it while something else shows) and from a
 * ticket reference, with a fake `gh` that signs in and reads one issue. Nothing here reaches GitHub.
 *
 * The fake is a shell script on the `PATH` the launcher gives the application (`fake-gh.ts`): the
 * start from a ticket is skipped on Windows.
 */

import { $, browser, expect } from '@wdio/globals'

import { ACME, writeAcme } from './acme.ts'
import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import { RUNS_FAKE_GH, writeFakeGh } from './fake-gh.ts'
import { designSize, dialog, field, section, settingsOf, write } from './settings-page.ts'

const SPEC = 'start-mission.e2e.ts'

const ISSUE = JSON.stringify({
  data: {
    repository: {
      issueOrPullRequest: {
        __typename: 'Issue',
        number: 41,
        title: 'Export invoices as CSV',
        body: 'Finance asks for a CSV of the invoices.',
        state: 'OPEN',
        stateReason: null,
        url: 'https://github.com/acme/api/issues/41',
        updatedAt: '2026-10-01T10:00:00Z',
        author: { login: 'ada' },
        labels: { nodes: [] },
        comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
      },
    },
  },
})

const FAKE = `#!/bin/sh
case "$*" in
  *--version*) echo "gh version 2.81.0" ;;
  *auth*) exit 0 ;;
  *search/issues*) echo '{"items":[]}' ;;
  *graphql*) cat <<'JSON'
${ISSUE}
JSON
  ;;
  *) echo "fake gh: no answer for $*" >&2; exit 1 ;;
esac
`

writeFakeGh(SPEC, FAKE)

/** The fake `gh` is a shell script: not on Windows. */
const itWithFake = RUNS_FAKE_GH ? it : it.skip

const places = () => $('nav[aria-label="Places"]')
const start = () => $('aria/Start a mission in Acme')
const found = () => $('ul[aria-label="Found"]')

describe('A mission started from the Project’s field', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('finds the missions of the Project first and puts Create a mission last', async () => {
    writeAcme()
    await waitForEngine()
    await designSize()
    const project =
      (await browser.electron.execute(
        async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder),
        ACME,
      )) ?? ''
    await browser.electron.execute(
      async (_, id) => await globalThis.hemeraProbe?.createMission(id, 'Export the movements'),
      project,
    )
    await places().$('button=Acme').click()
    await write(start(), 'Export')
    await expect(found()).toBeDisplayed()
    await expect(found().$('li:first-child button')).toHaveText(
      expect.stringContaining('Export the movements'),
    )
    await expect(found().$('li:last-child button')).toHaveText(
      expect.stringContaining('Create a mission “Export”'),
    )
  })

  it('does not create when Enter is pressed while other results show', async () => {
    await browser.keys('Enter')
    await expect($('ul[aria-label="Planning missions"]').$$('button')).toBeElementsArrayOfSize({
      eq: 1,
    })
  })

  it('creates a mission from a sentence with the last choice', async () => {
    await found().$('button*=Create a mission').click()
    await expect($('ul[aria-label="Planning missions"]').$$('button')).toBeElementsArrayOfSize({
      eq: 2,
    })
  })

  itWithFake('adds a GitHub provider, then starts a mission from a ticket reference', async () => {
    await settingsOf('Acme')
    await section('Tickets and Specs')
    await $('button[aria-label="Add a provider"]').click()
    await $('[role="menuitem"]*=GitHub').click()
    const adding = dialog()
    await write(field(adding, 'Another repository'), 'acme/api')
    await browser.keys('Enter')
    await adding.$('button=Add').click()
    await expect(dialog()).not.toBeExisting()
    await places().$('button=Acme').click()
    await write(start(), 'acme/api#41')
    await expect(found().$('button*=acme/api#41')).toBeDisplayed()
    await expect(found().$('li:last-child button')).toHaveText(
      expect.stringContaining('Create a mission'),
    )
    await found().$('button*=acme/api#41').click()
    await expect(places().$('button*=Export invoices as CSV')).toBeDisplayed()
  })
})
