/**
 * A GitHub provider added from a Project's settings, with a fake `gh` in place of the real one:
 * the list says there is none, the menu adds GitHub with a repository written by hand, the line
 * says `gh` is not signed in and its dialog gives the command that mends it, and Check again,
 * once the fake is signed in, turns the line to ready. Nothing here reaches GitHub.
 *
 * The fake is a shell script on the `PATH` the launcher gives the application (`fake-gh.ts`): the
 * spec file is skipped on Windows.
 */

import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { $, browser, expect } from '@wdio/globals'

import { ACME, writeAcme } from './acme.ts'
import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import { RUNS_FAKE_GH, fakeGhOf, writeFakeGh } from './fake-gh.ts'
import { designSize, dialog, field, section, settingsOf, write } from './settings-page.ts'

const SPEC = 'ticket-providers.e2e.ts'

/** Exists once the fake is signed in; the fake answers `auth status` by it. */
const SIGNED_IN = join(fakeGhOf(SPEC), 'signed-in')

const FAKE = `#!/bin/sh
case "$1" in
  --version) echo "gh version 2.50.0" ;;
  auth)
    if [ -f "${SIGNED_IN}" ]; then exit 0; fi
    echo "You are not logged into any GitHub hosts." >&2
    exit 1 ;;
  *) echo "fake gh: no answer for $*" >&2; exit 1 ;;
esac
`

writeFakeGh(SPEC, FAKE)
rmSync(SIGNED_IN, { force: true })

const providers = () => $('section[aria-label="Ticket providers"]')

/** The list of the providers once read: while it is on its way, its skeleton rows wear its name. */
const list = () => providers().$('ul[aria-label="Ticket providers"]:not([aria-busy="true"])')

/** How long the dialog that adds GitHub waits before it asks which repositories to propose. */
const PROPOSALS_ASKED_MS = 500

/** The fake `gh` is a shell script: not on Windows. */
const describeWithFake = RUNS_FAKE_GH ? describe : describe.skip

describeWithFake('A GitHub provider added from the settings of a Project', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('says there is no provider yet, in the section Tickets and Specs', async () => {
    writeAcme()
    await waitForEngine()
    await designSize()
    await browser.electron.execute(
      async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder),
      ACME,
    )
    await $('nav[aria-label="Places"]').$('button*=Acme').click()
    await settingsOf('Acme')
    await section('Tickets and Specs', 'Ticket providers')
    await expect(providers()).toHaveText('No ticket provider', { containing: true })
  })

  it('adds GitHub from the menu, with a repository written by hand', async () => {
    await providers().$('button=Add a provider').click()
    await $('[role="menuitem"]*=GitHub').click()
    const adding = dialog()
    await expect(field(adding, 'Host')).toHaveValue('github.com')
    // The first answer about the repositories proposed for the host ticks them in place of what is
    // ticked: the repository is written once it came, so it is not unticked under the hand.
    await browser.pause(PROPOSALS_ASKED_MS * 3)
    await write(field(adding, 'Another repository'), 'acme/api')
    await browser.keys('Enter')
    await expect(adding.$('[role="checkbox"][aria-checked="true"]')).toBeDisplayed()
    await adding.$('button=Add').click()
    await expect(adding).not.toBeExisting()
    await expect(list()).toHaveText(expect.stringContaining('github.com'))
    await expect(list()).toHaveText(expect.stringContaining('acme/api'))
  })

  it('says gh is not signed in, and gives the command that mends it', async () => {
    await expect(list()).toHaveText(expect.stringContaining('GitHub CLI is not logged in'))
    await list().$('button*=github.com').click()
    const provider = dialog()
    await expect(provider).toHaveText(
      expect.stringContaining('gh auth login --hostname github.com'),
    )
    await expect(
      provider.$('button[aria-label="Copy gh auth login --hostname github.com"]'),
    ).toBeDisplayed()
  })

  it('turns the line to ready after Check again, once gh is signed in', async () => {
    writeFileSync(SIGNED_IN, '')
    const provider = dialog()
    await provider.$('button=Check again').click()
    await expect(provider).toHaveText(expect.stringContaining('is logged in to github.com'))
    await expect(provider.$('button=Check again')).not.toBeExisting()
    await provider.$('button=Save').click()
    await expect(dialog()).not.toBeExisting()
    await expect(list()).not.toHaveText(expect.stringContaining('not logged in'))
  })
})
