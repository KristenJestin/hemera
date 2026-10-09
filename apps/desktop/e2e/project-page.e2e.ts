/**
 * A Project's missions in the real application: listed by stage on its page with a second line,
 * opened from a row of the page, then from the sidebar's rows under the Project, each by stage.
 */

import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, browser, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'

const SPEC = 'project-page.e2e.ts'
/** Acme's main checkout: a folder of the run's own, which the headless run removes after it. */
const ACME = join(tmpdir(), 'hemera-e2e-project-page-acme')

const places = () => $('nav[aria-label="Places"]')
const planning = () => $('ul[aria-label="Planning missions"]')

describe('A Project’s missions by stage', () => {
  let key = ''

  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('lists a new mission under Planning on the Project’s page', async () => {
    await waitForEngine()
    mkdirSync(ACME, { recursive: true })
    const project =
      (await browser.electron.execute(
        async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder),
        ACME,
      )) ?? ''
    const mission = await browser.electron.execute(
      async (_, id) => await globalThis.hemeraProbe?.createMission(id, 'Add roles'),
      project,
    )
    key = mission?.key ?? ''
    await places().$('button=Acme').click()
    await expect(planning().$(`button*=${key}`)).toBeDisplayed()
    await expect(planning().$(`button*=Add roles`)).toBeDisplayed()
  })

  it('opens the mission from its row on the page', async () => {
    await planning().$(`button*=${key}`).click()
    await expect(places().$(`button[data-mark="mission:${key}"]`)).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('opens it again from the sidebar, under the Project, in its stage', async () => {
    await places().$('button=Acme').click()
    await expect(planning()).toBeDisplayed()
    await places().$('button[aria-label="Open the missions of Acme"]').click()
    const group = places().$('[role="group"][aria-label="Planning"]')
    await expect(group).toBeDisplayed()
    await group.$(`button*=${key}`).click()
    await expect(places().$(`button[data-mark="mission:${key}"]`)).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
