import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { browser } from '@wdio/globals'

import { waitForEngine } from './diagnostic.ts'

const ACME = join(tmpdir(), 'hemera-e2e-corrT32-acme')
const SELECTOR = 'nav[aria-label="Places"] button[aria-label="Open the missions of Acme"]'

/** The state of the chevron and of the boxes that clip it, as the page sees it right now. */
const state = () => {
  const b = document.querySelector('nav[aria-label="Places"] button[aria-label="Open the missions of Acme"]')
  if (!b) return 'absent'
  const r = b.getBoundingClientRect()
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
  const boxes: string[] = []
  for (let e = b.parentElement, i = 0; e && i < 4; e = e.parentElement, i++) {
    boxes.push(String(Math.round(e.getBoundingClientRect().height)))
  }
  return `btn y=${Math.round(r.y)} h=${Math.round(r.height)} hit=${hit === b ? 'itself' : hit ? hit.tagName.toLowerCase() : 'none'} boxes=[${boxes.join('|')}]`
}

const RATE = 32

describe('correlation', () => {
  it('tries the chevron every 40ms and says what the page looked like each time', async () => {
    await waitForEngine()
    if (RATE > 1) {
      await browser.electron.execute(async (electron, rate) => {
        const contents = electron.BrowserWindow.getAllWindows()[0]?.webContents
        contents?.debugger.attach('1.3')
        await contents?.debugger.sendCommand('Emulation.setCPUThrottlingRate', { rate })
      }, RATE)
    }
    mkdirSync(ACME, { recursive: true })
    await browser.electron.execute(
      async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder),
      ACME,
    )
    const t0 = Date.now()
    const lines: string[] = []
    for (let attempt = 0; attempt < 60; attempt++) {
      const found = await browser.findElements('css selector', SELECTOR)
      const before = await browser.execute(state)
      if (found.length === 0) {
        lines.push(`${Date.now() - t0}ms no element yet | ${before}`)
        continue
      }
      const id = Object.values(found[0] ?? {})[0] ?? ''
      try {
        // The raw command, so that no wait of the framework hides the refusal.
        await browser.elementClick(id)
        lines.push(`${Date.now() - t0}ms CLICKED | ${before}`)
        break
      } catch (error) {
        lines.push(`${Date.now() - t0}ms refused (${String(error).slice(0, 40)}) | ${before}`)
      }
    }
    console.log(`corrT32\n${lines.join('\n')}`)
  })
})
