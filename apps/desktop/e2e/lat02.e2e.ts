import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { browser } from '@wdio/globals'

import { waitForEngine } from './diagnostic.ts'

const ACME = join(tmpdir(), 'hemera-e2e-lat02-acme')

/** No rAF pump: a timer, and one lone rAF asked for at each tick. */
const watch = () =>
  new Promise<string[]>((resolve) => {
    const out: string[] = []
    const t0 = performance.now()
    const row = () => {
      const b = document.querySelector('button[aria-label$="the missions of Acme"]')
      const p = b?.parentElement?.parentElement?.parentElement
      return p ? Math.round(p.getBoundingClientRect().height) : -1
    }
    const tick = () => {
      const asked = performance.now()
      requestAnimationFrame(() => {
        out.push(
          `${Math.round(asked - t0)}ms: lone rAF after ${Math.round(performance.now() - asked)}ms, row ${row()}px`,
        )
      })
    }
    const timer = setInterval(tick, 100)
    setTimeout(() => {
      clearInterval(timer)
      setTimeout(() => resolve(out), 200)
    }, 4000)
  })

describe('latency', () => {
  it('asks for a frame while the project row grows in', async () => {
    await waitForEngine()
    mkdirSync(ACME, { recursive: true })
    await browser.electron.execute(
      async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder),
      ACME,
    )
    console.log(`lat02\n${(await browser.execute(watch)).join('\n')}`)
  })
})
