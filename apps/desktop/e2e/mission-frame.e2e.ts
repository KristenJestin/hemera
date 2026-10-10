/**
 * A mission's frame in the running application: its header, the base of its stage, a view opened
 * over the base and the way back, and Cancel with the question it asks first.
 */

import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DecisionFields, MissionOwner } from '@hemera/core/domain'
import { $, browser, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'

const SPEC = 'mission-frame.e2e.ts'
/** Acme's main checkout: a folder of the run's own, which the headless run removes after it. */
const ACME = join(tmpdir(), 'hemera-e2e-mission-frame-acme')

const places = () => $('nav[aria-label="Places"]')
const trail = () => $('nav[aria-label="Where you are"]')
const heading = () => $('main h1')
const base = () => $('[data-base]')
const track = () => $('ol[aria-label="Stage"]')

const ROLES = DecisionFields.make({
  question: 'Who may read the audit log?',
  options: ['Admins only', 'Every member'],
  recommended: null,
})

describe('A mission’s frame', () => {
  let key = ''

  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('opens from its row on the Project’s page, with its key, its title and its stage', async () => {
    await waitForEngine()
    mkdirSync(ACME, { recursive: true })
    const project =
      (await browser.electron.execute(
        async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder),
        ACME,
      )) ?? ''
    const mission = await browser.electron.execute(
      async (_, id) => await globalThis.hemeraProbe?.createMission(id, 'An audit log'),
      project,
    )
    key = mission?.key ?? ''
    await browser.electron.execute(
      async (_, owner, fields) => await globalThis.hemeraProbe?.createNeed(owner, fields),
      MissionOwner.make({ projectId: project, missionId: mission?.id ?? '', taskId: null }),
      ROLES,
    )
    await places().$('button*=Acme').click()
    await $('ul[aria-label="Planning missions"]').$(`button*=${key}`).click()
    await expect(heading()).toHaveText('An audit log', { containing: true })
    await expect(trail()).toHaveText(key, { containing: true })
    await expect(track().$('li[aria-current="step"]')).toHaveText('Planning', { containing: true })
  })

  it('keeps the mission’s needs at the top, above the base', async () => {
    await expect($('ul[aria-label="Needs you"]')).toHaveText(/Who may read the audit log\?/)
    await expect(base()).toBeDisplayed()
  })

  // Needs a mission whose Ticket changed after the Freeze, which the probe cannot make yet.
  it.skip('opens what changed over the base, and closing it finds the base where it was', async () => {
    await base().execute((element) => {
      element.scrollTop = element.scrollHeight
    })
    const scrolled = await base().getProperty('scrollTop')
    await $('button=What changed').click()
    await expect($('section[data-view="difference"]')).toBeDisplayed()
    await expect(base()).toHaveAttribute('inert')
    await $('button[aria-label="Close What changed"]').click()
    await expect(base()).not.toHaveAttribute('inert')
    expect(await base().getProperty('scrollTop')).toBe(scrolled)
  })

  it('asks before cancelling, and says what stops and what is kept', async () => {
    await $('button=Cancel').click()
    const dialog = $('[role="dialog"]')
    await expect(dialog).toBeDisplayed()
    await expect(dialog).toHaveText(
      /stops its sessions, commands, services and delivery steps.*Workspace, the branches and the evidence stay/,
    )
    await dialog.$('button=Keep it going').click()
    await expect(dialog).not.toBeDisplayed()
    await expect(track().$('li[aria-current="step"]')).toHaveText('Planning', { containing: true })
  })

  it('cancels once confirmed: the track leaves its stages and Cancel goes', async () => {
    await $('button=Cancel').click()
    await $('button=Cancel the mission').click()
    await expect(track().$('li[aria-current="step"]')).toHaveText('Cancelled', {
      containing: true,
    })
    await expect($('button=Cancel')).not.toBeExisting()
  })
})
