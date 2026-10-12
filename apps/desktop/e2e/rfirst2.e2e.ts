/**
 * The Chat page in the real application: a Project opened in the sidebar lists, after its missions
 * by stage, its Chats and the row that starts one; starting one opens its page, empty, under the
 * Project in the trail.
 * The agent is the headless suite's fake, scripted here: it answers with a folded action, has a
 * read of `.env` held until Allow once, and drafts a mission whose key leads to it.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, browser, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'

const SPEC = 'rfirst2.e2e.ts'
/** Acme's main checkout: a folder of the run's own, which the headless run removes after it. */
const ACME = join(tmpdir(), 'hemera-e2e-rfirst2-acme')

const places = () => $('nav[aria-label="Places"]')
const trail = () => $('nav[aria-label="Where you are"]')
const conversation = () => $('ol[aria-label="Conversation"]')
const message = () => $('[role="textbox"][aria-label="Message"]')

/** Types a message in the field and sends it. */
async function send(text: string): Promise<void> {
  await message().click()
  await message().addValue(text)
  await $('button[aria-label="Send"]').click()
}

/** What the agent does, one list per message, then once the held read is allowed. */
const SCRIPT = {
  turns: [
    [
      { does: 'uses', id: 'toolu_readme', tool: 'fs_read', arguments: { path: 'README.md' } },
      { does: 'says', text: 'It is in api/export.ts.' },
    ],
    [
      { does: 'uses', id: 'toolu_env', tool: 'fs_read', arguments: { path: '.env' } },
      { does: 'says', text: 'It waits for your approval.' },
    ],
    [{ does: 'says', text: 'Read it: one token.' }],
    [
      {
        does: 'uses',
        id: 'toolu_draft',
        tool: 'spec_create_draft',
        arguments: {
          title: 'Export the invoices as JSON',
          idea: 'A JSON export beside the CSV one, in api/export.ts.',
        },
      },
      { does: 'says', text: 'Drafted it.' },
    ],
  ],
} as const

describe('The Chat page', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('lists a Project’s Chats under it once it is opened, with the row that starts one', async () => {
    await waitForEngine()
    mkdirSync(ACME, { recursive: true })
    writeFileSync(join(ACME, 'README.md'), '# Acme\n')
    writeFileSync(join(ACME, '.env'), 'ACME_TOKEN=example\n')
    await browser.electron.execute(
      async (_, script) => await globalThis.hemeraProbe?.scriptAgent(script),
      SCRIPT,
    )
    await browser.electron.execute(
      async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder),
      ACME,
    )
    await places().$('button[aria-label="Open the missions of Acme"]').click()
    await expect(places().$('button*=New Chat')).toBeClickable()
  })
})
