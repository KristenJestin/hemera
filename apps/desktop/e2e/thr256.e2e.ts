import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, browser, expect } from '@wdio/globals'

import { waitForEngine } from './diagnostic.ts'

const ACME = join(tmpdir(), 'hemera-e2e-thr256-acme')
const RATE = 256

const places = () => $('nav[aria-label="Places"]')

describe('throttled chevron', () => {
  it('opens the missions of a Project that has just been created', async () => {
    await waitForEngine()
    await browser.electron.execute(async (electron, rate) => {
      const contents = electron.BrowserWindow.getAllWindows()[0]?.webContents
      contents?.debugger.attach('1.3')
      await contents?.debugger.sendCommand('Emulation.setCPUThrottlingRate', { rate })
    }, RATE)
    mkdirSync(ACME, { recursive: true })
    await browser.electron.execute(
      async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder),
      ACME,
    )
    const started = Date.now()
    try {
      await places().$('button[aria-label="Open the missions of Acme"]').click()
      console.log(`thr256 clicked after ${Date.now() - started}ms`)
    } catch (error) {
      console.log(`thr256 REFUSED after ${Date.now() - started}ms: ${String(error).slice(0, 60)}`)
      throw error
    }
    await expect(places().$('button*=New Chat')).toBeClickable()
  })
})
