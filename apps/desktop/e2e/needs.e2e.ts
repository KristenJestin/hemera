/**
 * Needs created in a running Hemera: pending, on Home's Needs you and in the sidebar's count,
 * answered from their card, and the link of a need about a setting. `needs.restarted` starts
 * Hemera again on the same data folder.
 */

import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DecisionFields, EnvironmentFields, MissionOwner, ProjectOwner } from '@hemera/core/domain'
import { $, browser, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'

const SPEC = 'needs.e2e.ts'
/** Acme's main checkout: a folder of the run's own, which the headless run removes after it. */
const ACME = join(tmpdir(), 'hemera-e2e-needs-acme')

const places = () => $('nav[aria-label="Places"]')
const needsYou = () => $('ul[aria-label="Needs you"]')
const row = (id: string) => $(`li[data-need="${id}"]`)
const home = (waiting: number) =>
  places().$(`button[aria-label="Home, ${String(waiting)} waiting"]`)

const MODELS = EnvironmentFields.make({
  missing: 'The model of the builder is no longer offered',
  action: 'Choose another model for the builder.',
  settingsSection: 'models',
})

const TABLE = DecisionFields.make({
  question: 'Which table holds the invoices?',
  options: ['billing_invoices', 'invoices'],
  recommended: { option: 'invoices', reason: 'the api already reads it' },
})

describe('Needs created while Hemera runs', () => {
  let acme = ''

  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('is pending in Needs you, and nothing answered it', async () => {
    await waitForEngine()
    const id = await browser.electron.execute(() => globalThis.hemeraProbe?.createNeed())
    const pending = await browser.electron.execute(() => globalThis.hemeraProbe?.pendingNeeds())
    expect(pending).toEqual([{ id, state: 'pending', answered: false }])
  })

  it('shows on Home, Hemera’s own, and in the sidebar’s count', async () => {
    await expect(needsYou().$('li*=Docker is not running')).toBeDisplayed()
    await expect(home(1)).toBeDisplayed()
  })

  it('shows a need of a mission as it is created, with its mission’s key', async () => {
    mkdirSync(ACME, { recursive: true })
    acme =
      (await browser.electron.execute(
        async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder),
        ACME,
      )) ?? ''
    const mission = await browser.electron.execute(
      async (_, project) => await globalThis.hemeraProbe?.createMission(project, 'Add roles'),
      acme,
    )
    const id = await browser.electron.execute(
      async (_, owner, fields) => await globalThis.hemeraProbe?.createNeed(owner, fields),
      MissionOwner.make({ projectId: acme, missionId: mission?.id ?? '', taskId: null }),
      TABLE,
    )
    await expect(row(id ?? '')).toHaveText(/Which table holds the invoices\?/)
    await expect(row(id ?? '')).toHaveText(new RegExp(mission?.key ?? 'no key'))
    await expect(home(2)).toBeDisplayed()
  })

  it('answers it from its card: answered in place, then gone, and no longer counted', async () => {
    const table = needsYou().$('li*=Which table holds the invoices?')
    await table.$('button=Answer here').click()
    await table.$('button=invoices').click()
    await expect(table).toHaveText(/Applied/)
    await expect(home(1)).toBeDisplayed()
    await browser.waitUntil(async () => !(await table.isExisting()), {
      timeout: 10_000,
      timeoutMsg: 'the answered need never left the list',
    })
    const pending = await browser.electron.execute(() => globalThis.hemeraProbe?.pendingNeeds())
    expect(pending).toHaveLength(1)
  })

  it('opens the settings at its section from a need about a setting', async () => {
    const id =
      (await browser.electron.execute(
        async (_, owner, fields) => await globalThis.hemeraProbe?.createNeed(owner, fields),
        ProjectOwner.make({ projectId: acme }),
        MODELS,
      )) ?? ''
    await row(id).$('button=Retry here').click()
    await row(id).$('button=Open Settings › Models by role').click()
    await expect($('main h1')).toHaveText('Settings')
    await expect($('[data-settings-section="models"]')).toBeExisting()
    await home(2).click()
    await expect(row(id)).toBeDisplayed()
  })
})
