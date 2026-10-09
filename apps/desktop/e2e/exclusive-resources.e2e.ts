/**
 * An exclusive resource declared from a Project's settings in the real application: two commands
 * of the catalogue, then a shared database that the first one uses and the second one restores,
 * shown as a line that names both. `exclusive-resources.restarted.e2e.ts` starts Hemera again on
 * the same data folder and finds it.
 */

import { $, browser, expect } from '@wdio/globals'

import { ACME, writeAcme } from './acme.ts'
import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import {
  checkbox,
  choose,
  designSize,
  dialog,
  field,
  section,
  settingsOf,
  write,
} from './settings-page.ts'

const SPEC = 'exclusive-resources.e2e.ts'

/** The list of the resources once read: while it is on its way, its skeleton rows wear its name. */
const list = () => $('ul[aria-label="Exclusive resources"]:not([aria-busy="true"])')

/** Adds a command to the catalogue from the Commands section. */
async function addCommand(name: string, line: string): Promise<void> {
  await $('button=Add a command').click()
  const command = dialog()
  await write(field(command, 'Name'), name)
  await write(field(command, 'Line'), line)
  await command.$('button=Add').click()
  await expect(command).not.toBeExisting()
}

describe('An exclusive resource declared from the settings of a Project', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('says there is no resource yet, in the section Exclusive resources', async () => {
    writeAcme()
    await waitForEngine()
    await designSize()
    await browser.electron.execute(
      async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder),
      ACME,
    )
    await $('nav[aria-label="Places"]').$('button*=Acme').click()
    await settingsOf('Acme')
    await section('Commands')
    await addCommand('Seed the database', 'node seed.mjs')
    await addCommand('Reset the database', 'node reset.mjs')
    await section('Exclusive resources')
    await expect($('section[aria-label="Exclusive resources"]')).toHaveText(
      'No exclusive resource',
      { containing: true },
    )
  })

  it('refuses a resource that has no command', async () => {
    await $('button*=Add a resource').click()
    const adding = dialog()
    await write(field(adding, 'Name'), 'Shared database')
    await adding.$('button=Add').click()
    await expect(adding).toHaveText(expect.stringContaining('Pick at least one command'))
  })

  it('declares the shared database from the commands of the catalogue', async () => {
    const adding = dialog()
    await write(field(adding, 'What it is'), 'The Postgres of the staging machine.')
    await checkbox(adding, 'Seed the database').click()
    await expect(checkbox(adding, 'Seed the database')).toHaveAttribute('aria-checked', 'true')
    await choose(adding, 'Restore command', 'Reset the database')
    await adding.$('button=Add').click()
    await expect(adding).not.toBeExisting()
    await expect(list()).toHaveText(expect.stringContaining('Shared database'))
    await expect(list()).toHaveText(expect.stringContaining('Seed the database'))
    await expect(list()).toHaveText(expect.stringContaining('restored by Reset the database'))
  })
})
