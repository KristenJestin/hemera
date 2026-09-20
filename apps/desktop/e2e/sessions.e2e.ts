/**
 * A Session, from a Project that has none to one archived and brought back (design D4b-02).
 *
 * This spec runs on a data folder of its own, emptied before the run, so it starts on a real
 * first launch and makes its own Project. Everything after that is done the way a hand does it
 * — the sidebar, the row menus, the box at the foot of the thread — and read back from what
 * the window shows, never from what the suite believes it asked for.
 *
 * What is *not* here is a restart of the application, for the reason `projects.e2e.ts` gives:
 * the service drives one instance per spec file and has no way to close it and start it again.
 * The page is loaded again instead, which is what proves the claim all the same — a reloaded
 * page has kept nothing: it asks the engine for its preferences, for the Sessions of the
 * Project and for the thread of the one it is told to open, and every word it then shows came
 * back from the data folder.
 *
 * Each suite is named after the scenario of the spec « sessions » of HEM-57 it covers.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { browser, expect } from '@wdio/globals'

import { addProject, choose, press, shows } from './hand.ts'

/** Somewhere for the Project to point at, made by this spec and removed with it. */
const SOURCES = mkdtempSync(join(tmpdir(), 'hemera-e2e-sessions-'))

after(() => {
  rmSync(SOURCES, { recursive: true, force: true })
})

/**
 * Writes a message and sends it, without waiting for the one before it to be kept.
 *
 * Not `fill` and `press` of the hand: those wait long enough between two acts for a round trip
 * to the database, and a burst that waits is not a burst. What is left between the text and
 * the send is what React needs to have drawn it — the box is a controlled field, and a send
 * pressed in the same tick as the keystroke would send what was there before it.
 */
async function say(text: string): Promise<void> {
  await browser.execute((message: string) => {
    const box = document.querySelector('textarea[aria-label="Write in this Session…"]')
    if (!(box instanceof HTMLTextAreaElement)) return
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(box, message)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  }, text)
  await browser.pause(60)
  await browser.execute(() => {
    const send = [...document.querySelectorAll('button')].find(
      (one) => one.getAttribute('aria-label') === 'Send',
    )
    send?.click()
  })
}

/** The thread on screen, bubble by bubble, in the order the page draws them. */
async function thread(): Promise<string[]> {
  return await browser.execute(() =>
    [...document.querySelectorAll('[data-tone]')].map((one) => one.textContent?.trim() ?? ''),
  )
}

/** What the sidebar lists, which is the Sessions of the Project in front and its places. */
async function rows(): Promise<string[]> {
  return await browser.execute(() =>
    [...document.querySelectorAll('aside button')]
      .map((one) => one.getAttribute('aria-label') ?? one.textContent?.trim() ?? '')
      .filter((name) => name !== ''),
  )
}

/** Loads the page again, which is everything the window knows read back from the folder. */
async function again(): Promise<void> {
  await browser.refresh()
  await browser.pause(1600)
}

describe('Aucune Session', () => {
  it('says the Project has none and offers to open one, without a row that is not one', async () => {
    await addProject('Atlas', SOURCES)

    expect(await shows('No Session yet')).toBe(true)
    // Offered, and offered once: the empty state is what creates one while the list is empty.
    expect(await rows()).toContain('New session')
  })
})

describe('Session sélectionnée conservée', () => {
  it('keeps three messages written in a burst, in the order they were sent', async () => {
    await press('New session')
    await browser.pause(600)

    await say('the first thing')
    await say('the second thing')
    await say('the third thing')
    await browser.pause(1500)

    expect(await thread()).toEqual(['the first thing', 'the second thing', 'the third thing'])
    // And the title the engine derived from the first message is what the sidebar shows.
    expect(await rows()).toContain('the first thing')
  })

  it('is still the Session the window opens on, with its thread, after the page is loaded again', async () => {
    await again()

    expect(await thread()).toEqual(['the first thing', 'the second thing', 'the third thing'])
    const open = await browser.execute(
      () => document.querySelector('aside [aria-current="true"]')?.getAttribute('aria-label') ?? '',
    )
    expect(open).toBe('the first thing')
  })
})

describe('Deux Sessions retrouvées', () => {
  it('gives each one its own thread, and both come back with it', async () => {
    await press('New session')
    await browser.pause(600)
    await say('a thing said elsewhere')
    await browser.pause(1200)

    expect(await thread()).toEqual(['a thing said elsewhere'])

    await again()

    // Both are listed, and each one is read back from the folder with its own messages.
    const listed = await rows()
    expect(listed).toContain('a thing said elsewhere')
    expect(listed).toContain('the first thing')

    await press('the first thing')
    await browser.pause(800)
    expect(await thread()).toEqual(['the first thing', 'the second thing', 'the third thing'])

    await press('a thing said elsewhere')
    await browser.pause(800)
    expect(await thread()).toEqual(['a thing said elsewhere'])
  })
})

describe('Session archivée puis restaurée', () => {
  it('takes it out of the sidebar and brings it back whole', async () => {
    await press('Actions for a thing said elsewhere')
    await choose('Archive')
    await browser.pause(1000)

    expect(await rows()).not.toContain('a thing said elsewhere')
    expect(await shows('1 archived')).toBe(true)

    await press('1 archived')
    await browser.pause(600)
    expect(await shows('Archived Sessions')).toBe(true)

    await press('Restore')
    await browser.pause(1200)

    // Back in the list, opened where it was left, and with every message it had.
    expect(await rows()).toContain('a thing said elsewhere')
    expect(await thread()).toEqual(['a thing said elsewhere'])
  })

  it('wrote both down, which is what the Journal of the Project says', async () => {
    await press('Journal')
    await browser.pause(600)

    expect(await shows('Session archived')).toBe(true)
    expect(await shows('Session restored')).toBe(true)
    expect(await shows('Message recorded')).toBe(true)
  })
})
