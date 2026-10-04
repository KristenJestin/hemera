/**
 * The shell in the real application: it mounts once the engine has answered, follows the Projects
 * without a reload, and moves between Home, a Project's page, its settings and Settings.
 */

import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, browser, expect } from '@wdio/globals'

import { diagnosticOf, engineOfPage, markPage, waitForEngine } from './diagnostic.ts'

const SPEC = 'shell.e2e.ts'
/** Acme's main checkout: a folder of the run's own, which the headless run removes after it. */
const ACME = join(tmpdir(), 'hemera-e2e-shell-acme')

const places = () => $('nav[aria-label="Places"]')
const trail = () => $('nav[aria-label="Where you are"]')
const heading = () => $('main h1')

describe('The shell', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('mounts its pages once the engine has answered: Home, with no Project yet', async () => {
    expect(['starting', 'ready']).toContain(await engineOfPage())
    await waitForEngine()
    await expect($('[aria-label="Asleep"]')).toBeDisplayed()
    await expect(trail()).toHaveText('Home')
    await expect(places().$('button=Home')).toHaveAttribute('aria-current', 'page')
  })

  it('shows a Project created through the engine in the sidebar, without a reload', async () => {
    await markPage()
    mkdirSync(ACME, { recursive: true })
    await browser.electron.execute(
      async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder),
      ACME,
    )
    await expect(places().$('button*=Acme')).toBeDisplayed()
    expect(await browser.execute(() => Reflect.has(window, 'hemeraPreviousPage'))).toBe(true)
  })

  it('opens the Project’s page from the sidebar, with its name and the way to its settings', async () => {
    await places().$('button*=Acme').click()
    await expect(heading()).toHaveText('Acme', { containing: true })
    await expect(places().$('button*=Acme')).toHaveAttribute('aria-current', 'page')
    await expect(trail()).toHaveText('Acme')
  })

  it('goes to the Project’s settings, and back by the trail', async () => {
    await $('button[aria-label="Settings of Acme"]').click()
    await expect(heading()).toHaveText('Settings of Acme')
    await expect(trail()).toHaveText(/Acme\s*Settings/)
    await trail().$('button*=Acme').click()
    await expect(heading()).toHaveText('Acme', { containing: true })
  })

  it('opens Settings from the foot of the sidebar, and Home again', async () => {
    await places().$('button=Settings').click()
    await expect(heading()).toHaveText('Settings')
    await expect(places().$('button=Settings')).toHaveAttribute('aria-current', 'page')
    await places().$('button=Home').click()
    await expect(trail()).toHaveText('Home')
  })

  it('folds the sidebar to its rail with Ctrl+B, and opens it again', async () => {
    await browser.keys(['Control', 'b'])
    await expect(places()).toHaveAttribute('data-folded', 'true')
    await browser.keys(['Control', 'b'])
    await expect(places()).toHaveAttribute('data-folded', 'false')
  })
})
