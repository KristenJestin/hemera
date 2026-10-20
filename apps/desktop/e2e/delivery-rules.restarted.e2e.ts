/**
 * Hemera started again on the data folder `delivery-rules.e2e.ts` left: the preset set, the step
 * overridden and the step put back are as they were saved.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { $, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import { GH_SIGNED_IN_BY_FILE, RUNS_FAKE_GH, writeFakeGh } from './fake-gh.ts'
import { designSize, section, settingsOf } from './settings-page.ts'

const SPEC = 'delivery-rules.restarted.e2e.ts'

// The application started again asks `gh` too: the fake, signed in this time.
const ghFolder = writeFakeGh(SPEC, GH_SIGNED_IN_BY_FILE)
if (RUNS_FAKE_GH) writeFileSync(join(ghFolder, 'signed-in'), '')

const rules = () => $('section[aria-label="Delivery rules"]')
const line = (path: string) => rules().$(`button[aria-label^="${path}, "]`)

const describeWithFake = RUNS_FAKE_GH ? describe : describe.skip

describeWithFake('The delivery rules, found again after Hemera started anew', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('restart and find the rules unchanged', async () => {
    await waitForEngine()
    await designSize()
    await $('nav[aria-label="Places"]').$('button*=acme').click()
    await settingsOf('acme')
    await section('Delivery rules')
    await expect(line('api')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/^api, Library, 1 change/),
    )
    await expect(line('web')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/^web, Application, as the preset/),
    )
    await expect(line('shared')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/^shared, Local, as the preset/),
    )
    await line('api').click()
    await expect(
      rules().$('ul[aria-label="Steps of api"]').$('button[aria-label^="CI,"]'),
    ).toHaveAttribute('aria-label', expect.stringContaining('changed here, waits for your click'))
    await expect(rules().$('[role="alert"]')).not.toBeExisting()
  })
})
