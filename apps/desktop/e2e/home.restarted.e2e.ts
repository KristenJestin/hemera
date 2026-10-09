/**
 * Hemera started again on the data folder `home.e2e.ts` left: Recent still lists the mission it
 * opened, and what Since you left told before Home was left is not told again.
 */

import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'

const SPEC = 'home.restarted.e2e.ts'
const SEEN = join(tmpdir(), 'hemera-e2e-home-seen.json')

const places = () => $('nav[aria-label="Places"]')
const home = () => places().$('button[aria-label^="Home"]')

describe('Home, found again after Hemera started anew', () => {
  const before = JSON.parse(readFileSync(SEEN, 'utf8')) as { key: string; told: string[] }

  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('still lists the mission it opened in Recent', async () => {
    await waitForEngine()
    await home().click()
    await expect($('ul[aria-label="Recent"]').$(`button*=${before.key}`)).toBeDisplayed()
  })

  it('does not tell again what it told before Home was left', async () => {
    await expect($('section[aria-label="Recent"]')).toBeDisplayed()
    const section = $('section[aria-label="Since you left"]')
    await expect(section).toBeDisplayed()
    const now = await section.getText()
    for (const line of before.told) {
      expect(now).not.toContain(line)
    }
  })
})
