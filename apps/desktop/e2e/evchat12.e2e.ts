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

const SPEC = 'evchat12.e2e.ts'
/** Acme's main checkout: a folder of the run's own, which the headless run removes after it. */
const ACME = join(tmpdir(), 'hemera-e2e-evchat12-acme')

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


describe('The Chat page', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('lists a Project’s Chats under it once it is opened, with the row that starts one', async () => {
    await browser.execute(sampler)
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
      console.log(`evchat12 clicked after ${Date.now() - started}ms`)
    } catch (error) {
      console.log(`evchat12 REFUSED after ${Date.now() - started}ms: ${String(error).slice(0, 80)}`)
      console.log(JSON.stringify(await browser.getWindowRect()))
      console.log((await browser.execute(evidence)).join('\n'))
      console.log((await browser.execute(() => Reflect.get(window, 'samples') as string[])).join('\n'))
      throw error
    }
    await expect(places().$('button*=New Chat')).toBeClickable()
  })

  it('starts a Chat: its page opens empty, under its Project in the trail, its row marked', async () => {
    await places().$('button*=New Chat').click()
    await expect($('[role="textbox"][aria-label="Message"]')).toBeDisplayed()
    await expect(trail()).toHaveText(/Acme\s*New Chat/)
    await expect(places().$('button[aria-current="page"]*=New Chat')).toBeDisplayed()
  })

  it('sends a message: the agent’s answer comes back, its read folded under it', async () => {
    await send('Where are the invoices exported?')
    await expect(conversation()).toHaveText(/It is in api\/export\.ts\./)
    const fold = conversation().$('button*=1 action')
    await fold.click()
    await expect(fold).toHaveAttribute('aria-expanded', 'true')
  })

  it('holds the read of .env until Allow once, then the agent goes on', async () => {
    await send('Read the .env file.')
    const card = $('section[aria-label*="asks to"]')
    await card.$('button=Allow once').click()
    await expect(card).not.toBeDisplayed()
    await expect(conversation()).toHaveText(/Read it: one token\./)
  })

  it('drafts a mission whose key leads to it', async () => {
    await send('Draft a mission for a JSON export.')
    await conversation().$('button=ACME-1').click()
    await expect(trail()).toHaveText(/Acme\s*ACME-1/)
  })
})
