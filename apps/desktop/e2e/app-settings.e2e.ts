/**
 * The application's settings in the real application (#50): every section down the left, and a
 * choice written to the engine and read back from it, the tester mode turned on in Developer.
 */

import { $, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'

const SPEC = 'app-settings.e2e.ts'

const places = () => $('nav[aria-label="Places"]')
const sections = () => $('nav[aria-label="Settings of Hemera"]')
/** The tester mode's box, found by the words of its label. */
const tester = () => $('label*=Tester mode').$('[role="checkbox"]')

describe('The application’s settings', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('opens at Appearance, every section down the left', async () => {
    await waitForEngine()
    await places().$('button=Settings').click()
    await Promise.all(
      ['Appearance', 'Agents', 'Models by role', 'Hemera Auto', 'Profile'].map((name) =>
        expect(sections().$(`button*=${name}`)).toBeDisplayed(),
      ),
    )
  })

  it('turns the tester mode on in Developer, and finds it on when it comes back', async () => {
    await sections().$('button*=Developer').click()
    await expect(tester()).toBeDisplayed()
    await tester().click()
    // The box ticks once the engine has kept the choice and it is read back: leaving before
    // that would leave before the write, and the section coming back would read the old value.
    await expect(tester()).toHaveAttribute('aria-checked', 'true')
    await sections().$('button*=Profile').click()
    await sections().$('button*=Developer').click()
    await expect(tester()).toHaveAttribute('aria-checked', 'true')
  })
})
