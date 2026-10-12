import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, browser } from '@wdio/globals'

import { waitForEngine } from './diagnostic.ts'

const ACME = join(tmpdir(), 'hemera-e2e-vartimer1-acme')
const places = () => $('nav[aria-label="Places"]')

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


const timer = () => {
  setInterval(() => document.querySelectorAll('button').length, 200)
}

const pump = () => {
  const raf = () => requestAnimationFrame(raf)
  requestAnimationFrame(raf)
}

describe('variant timer', () => {
  it('clicks the chevron the way the Chat spec does', async () => {
    const mode: string = 'timer'
    if (mode === 'timer') await browser.execute(timer)
    if (mode === 'pump') await browser.execute(pump)
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
    const started = Date.now()
    try {
      await places().$('button[aria-label="Open the missions of Acme"]').click()
      console.log(`vartimer1 clicked after ${Date.now() - started}ms`)
    } catch (error) {
      console.log(`vartimer1 REFUSED after ${Date.now() - started}ms`)
      throw error
    }
  })
})
