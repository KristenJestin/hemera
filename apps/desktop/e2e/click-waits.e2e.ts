/**
 * A click on a control that is still entering: the Project that has just been created grows into
 * the sidebar on a spring, and until it has, its chevron stands in a box clipped to nothing, with
 * whatever lies beneath it where the chevron will be. A runner short of processors draws few
 * frames, and the spring then takes seconds rather than a third of one.
 *
 * The page here is made slow in the plainest way: the clipping box is held shut for longer than
 * WebDriver's own patience with a refused click (five seconds), then let go. The click has to wait
 * for the chevron to be where it can be pressed, and press it, not give up, and not press what
 * lies beneath.
 */

import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, browser, expect } from '@wdio/globals'

import { waitForEngine } from './diagnostic.ts'

/** Acme's main checkout: a folder of the run's own, which the headless run removes after it. */
const ACME = join(tmpdir(), 'hemera-e2e-click-waits-acme')

/** Longer than the five seconds a refused click is retried for. */
const HELD_FOR = 7_000

const places = () => $('nav[aria-label="Places"]')

/**
 * Shuts every clipping box around the chevron for `milliseconds`, which a spring would otherwise
 * open in a moment. A rule of a style sheet, because the spring writes the height inline on every
 * frame and only an `!important` of a sheet outranks that. The page lets go by itself: WebDriver
 * runs one command at a time, so a second one could not reach the page while the click waits.
 */
function holdShut(milliseconds: number): void {
  const sheet = document.createElement('style')
  sheet.textContent = '[data-held-shut] { height: 0 !important; }'
  document.head.append(sheet)
  const chevron = document.querySelector('button[aria-label="Open the missions of Acme"]')
  for (let box = chevron?.parentElement; box; box = box.parentElement) {
    if (getComputedStyle(box).overflowY === 'clip') box.setAttribute('data-held-shut', '')
  }
  setTimeout(() => sheet.remove(), milliseconds)
}

describe('A click on a control that is still entering', () => {
  it('waits for the Project’s chevron to be pressable, however long its entry takes', async () => {
    await waitForEngine()
    mkdirSync(ACME, { recursive: true })
    await browser.electron.execute(
      async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder),
      ACME,
    )
    await places().$('button[aria-label="Open the missions of Acme"]').waitForExist()
    await browser.execute(holdShut, HELD_FOR)

    await places().$('button[aria-label="Open the missions of Acme"]').click()

    await expect(places().$('button*=New Chat')).toBeClickable()
  })
})
