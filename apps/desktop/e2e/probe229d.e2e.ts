import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { browser } from '@wdio/globals'

import { waitForEngine } from './diagnostic.ts'

const ACME = join(tmpdir(), 'hemera-e2e-probe229d-acme')

describe('probe', () => {
  it('samples the chevron after a project is created', async () => {
    await browser.execute(() => {
      const out: string[] = []
      Object.assign(window, { samples: out })
      const t0 = performance.now()
      let frames = 0
      const raf = () => {
        frames++
        requestAnimationFrame(raf)
      }
      requestAnimationFrame(raf)
      setInterval(() => {
        const b = document.querySelector('button[aria-label="Open the missions of Acme"]')
        const r = b?.getBoundingClientRect()
        const chain: string[] = []
        for (let e = b?.parentElement ?? null, i = 0; e && i < 4; e = e.parentElement, i++) {
          const q = e.getBoundingClientRect()
          chain.push(`${Math.round(q.height)}`)
        }
        out.push(
          `${Math.round(performance.now() - t0)}ms frames=${frames} vis=${document.visibilityState} focus=${document.hasFocus()} btn=${r ? `${Math.round(r.y)} ${Math.round(r.height)}` : 'none'} up=[${chain.join('|')}]`,
        )
      }, 100)
    })
    await waitForEngine()
    mkdirSync(ACME, { recursive: true })
    const mark = await browser.electron.execute(
      async (electron, folder) => {
        await globalThis.hemeraProbe?.createProject('Acme', folder)
        const w = electron.BrowserWindow.getAllWindows()[0]
        return `created; visible=${String(w?.isVisible())} bounds=${JSON.stringify(w?.getBounds())} minimized=${String(w?.isMinimized())}`
      },
      ACME,
    )
    await browser.pause(8000)
    const samples = await browser.execute(() => Reflect.get(window, 'samples') as string[])
    console.log(mark)
    console.log(samples.join('\n'))
  })
})
