import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, browser } from '@wdio/globals'

import { waitForEngine } from './diagnostic.ts'

const ACME = join(tmpdir(), 'hemera-e2e-ev12-acme')
const SELECTOR = 'button[aria-label="Open the missions of Acme"]'

const sampler = () => {
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
      chain.push(`${Math.round(e.getBoundingClientRect().height)}`)
    }
    out.push(
      `${Math.round(performance.now() - t0)}ms frames=${frames} vis=${document.visibilityState} btn=${r ? `${Math.round(r.y)} ${Math.round(r.height)}` : 'none'} up=[${chain.join('|')}]`,
    )
  }, 200)
}

const evidence = () => {
  const describe = (e: Element | null) =>
    e ? `${e.tagName.toLowerCase()}[${e.getAttribute('aria-label') ?? ''}].${String(e.className).slice(0, 60)}` : 'null'
  const all = document.querySelectorAll('button[aria-label="Open the missions of Acme"]')
  const b = all[0]
  const out: string[] = [`matches=${all.length} inner=${innerWidth}x${innerHeight} vv=${visualViewport?.width}x${visualViewport?.height} dpr=${devicePixelRatio} focus=${document.hasFocus()} vis=${document.visibilityState}`]
  if (!b) return out
  const r = b.getBoundingClientRect()
  out.push(`rect=${r.x},${r.y} ${r.width}x${r.height}`)
  out.push(`atCenter=${describe(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))}`)
  for (let e: Element | null = b, i = 0; e && i < 9; e = e.parentElement, i++) {
    const q = e.getBoundingClientRect()
    const s = getComputedStyle(e)
    out.push(`  ${describe(e)} ${Math.round(q.x)},${Math.round(q.y)} ${Math.round(q.width)}x${Math.round(q.height)} disp=${s.display} vis=${s.visibility} op=${s.opacity} filter=${s.filter} ovf=${s.overflowX}/${s.overflowY} pos=${s.position} tr=${s.transform}`)
  }
  out.push(`animations=${document.getAnimations().map((a) => `${a.playState}:${describe(a.effect instanceof KeyframeEffect ? a.effect.target : null)}`).join(' ; ')}`)
  return out
}

describe('evidence', () => {
  it('clicks the chevron of a project just created', async () => {
    await browser.execute(sampler)
    await waitForEngine()
    mkdirSync(ACME, { recursive: true })
    await browser.electron.execute(
      async (_, folder) => await globalThis.hemeraProbe?.createProject('Acme', folder),
      ACME,
    )
    const button = $(`nav[aria-label="Places"] ${SELECTOR}`)
    const started = Date.now()
    try {
      await button.click()
      console.log(`ev12 clicked after ${Date.now() - started}ms`)
    } catch (error) {
      console.log(`ev12 REFUSED after ${Date.now() - started}ms: ${String(error).slice(0, 80)}`)
      console.log(JSON.stringify(await browser.getWindowRect()))
      console.log(`displayed=${await button.isDisplayed()} clickable=${await button.isClickable()} enabled=${await button.isEnabled()}`)
      console.log((await browser.execute(evidence)).join('\n'))
      console.log((await browser.execute(() => Reflect.get(window, 'samples') as string[])).join('\n'))
      throw error
    }
  })
})
