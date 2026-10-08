/**
 * A Project added and set up in the real application: added from a folder that is not a
 * repository, with the two repositories found in it and a third added by hand; a base branch set
 * and fetched from its remote; a command of the catalogue refused while it holds shell syntax,
 * then saved as a service of the main checkout; a command run at each opening; and the service
 * started from the page, its address shown. `project-settings.restarted.e2e.ts` starts Hemera
 * again on the same data folder and finds all of it.
 */

import { $, browser, expect } from '@wdio/globals'

import { ACME, writeAcme } from './acme.ts'
import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import { choose, designSize, dialog, field, section, settingsOf, write } from './settings-page.ts'

const SPEC = 'project-settings.e2e.ts'

describe('A Project added and set up from its settings', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('adds Acme from its folder: the repositories found, and one added by hand', async () => {
    writeAcme()
    await waitForEngine()
    await designSize()
    await $('nav[aria-label="Places"]').$('button*=Add a Project').click()
    const adding = dialog()
    await write(field(adding, 'Folder'), ACME)
    await expect(adding.$('[data-found="api"]')).toBeDisplayed()
    await expect(adding.$('[data-found="web"]')).toBeDisplayed()
    await expect(adding.$('[data-found="services/billing"]')).not.toBeExisting()
    await write(field(adding, 'Add a repository by its path'), 'services/billing')
    await browser.keys('Enter')
    await expect(
      adding.$('[data-found="services/billing"]').$('[role="checkbox"]'),
    ).toHaveAttribute('aria-checked', 'true')
    await adding.$('button=Add acme').click()
    await expect(adding).not.toBeExisting()
    await expect($('main h1')).toHaveText('acme', { containing: true })
    // Nothing launched without being chosen: the engine holds no setup for it, and the Project's
    // page, which reads that, shows no task.
    const standing = await browser.electron.execute(
      async () => await globalThis.hemeraProbe?.setupStanding('acme'),
    )
    expect(standing).toBe('none')
    await expect($('[role="region"][aria-label="Tasks"]')).not.toBeExisting()
  })

  it('lists the three repositories in the Project’s settings', async () => {
    await settingsOf('acme')
    await Promise.all(
      ['api', 'web', 'services/billing'].map((path) =>
        expect($(`[data-repository="${path}"]`)).toBeDisplayed(),
      ),
    )
  })

  it('sets the base branch of api to dev, fetched from its remote', async () => {
    await $('[data-repository="api"]').$('button*=api').click()
    const api = dialog()
    await write(field(api, 'Base branch'), 'dev')
    await api.$('button=Save').click()
    await expect(api).not.toBeExisting()
    const row = $('[data-repository="api"]')
    await expect(row).toHaveText(expect.stringContaining('origin/dev'))
    await expect(row).toHaveText(expect.stringMatching(/fetched \d{2}:\d{2}/))
  })

  it('refuses a line holding shell syntax as it is typed, naming the token', async () => {
    await section('Commands')
    await $('button=Add a command').click()
    const command = dialog()
    await write(field(command, 'Name'), 'web')
    await write(field(command, 'Line'), 'a && b')
    await expect(command).toHaveText(expect.stringContaining('“&&” is shell syntax'))
    await command.$('button=Add').click()
    await expect(command).toBeDisplayed()
  })

  it('saves the command as a service of the main checkout once its line is one Hemera runs', async () => {
    const command = dialog()
    await write(field(command, 'Line'), 'node service.mjs')
    await choose(command, 'Type', 'Service')
    await choose(command, 'Runs', 'Once, in the main checkout')
    await command.$('button=Add').click()
    await expect(command).not.toBeExisting()
    await expect($('[data-command="web"]')).toBeDisplayed()
  })

  it('saves a command run at each opening', async () => {
    await $('button=Add a command').click()
    const command = dialog()
    await write(field(command, 'Name'), 'greet')
    await write(field(command, 'Line'), 'node greet.mjs')
    await command.$('aria/Runs at each opening').click()
    await command.$('button=Add').click()
    await expect(command).not.toBeExisting()
    await expect($('[data-command="greet"]')).toBeDisplayed()
  })

  it('starts the service from the page and shows its address', async () => {
    await section('Services')
    await $('button=Start web').click()
    const line = $('[data-run="web"][data-run-kind="live"]')
    await expect(line).toBeDisplayed()
    await line.$('button').click()
    await expect($('[data-glance]')).toHaveText(
      expect.stringMatching(/http:\/\/127\.0\.0\.1:\d+/),
      {
        wait: 30_000,
      },
    )
  })
})
