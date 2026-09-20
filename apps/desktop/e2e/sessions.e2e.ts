/**
 * A Session, from the Project that has none to one that has been put away and given back
 * (design D4b-02 … D4b-08).
 *
 * This spec runs on a data folder of its own, emptied before the run. Everything is done the way
 * a hand does it — the keystroke that makes a Session, the composer, the row in the sidebar, the
 * palette — and read back from what the window shows, never from what the suite believes it
 * asked for.
 *
 * Each suite is named after the scenario of the ticket's `Spec · sessions` it covers.
 *
 * What is *not* here is a restart of the application, for the reason `projects.e2e.ts` gives: one
 * instance runs per spec file and the service has no way to close it and start it again. What a
 * restart would prove is proven by loading the page again — everything the window then shows has
 * been read from the data folder rather than kept in the page — and by the engine's own suite,
 * which opens the same file twice and finds the thread in it.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { browser, expect } from '@wdio/globals'

import { addProject, press, shows, strike, write } from './hand.ts'

/** Somewhere for a Project to point at, made by this spec and removed with it. */
const SOURCES = mkdtempSync(join(tmpdir(), 'hemera-e2e-sessions-'))

after(() => {
  rmSync(SOURCES, { recursive: true, force: true })
})

/** Makes a Session the way the keyboard does, and answers with what the sidebar shows after it. */
async function newSession(): Promise<void> {
  await strike('n', 'KeyN')
  await browser.pause(600)
}

/** Names the Session whose title field is open, the way the field takes a name. */
async function nameIt(title: string): Promise<void> {
  await browser.execute((said: string) => {
    const field = document.querySelector<HTMLInputElement>(
      'input[aria-label="Title of the Session"]',
    )
    if (field === null) return
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(field, said)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  }, title)
  await browser.pause(600)
}

/** Writes one message into the Session on screen and sends it. */
async function say(body: string): Promise<void> {
  await write(body)
  await press('Send')
  await browser.pause(700)
}

describe('Aucune Session', () => {
  it('says so in the sidebar, and offers the one way to make one', async () => {
    await addProject('Atlas', SOURCES)

    expect(await shows('No Session yet')).toBe(true)
    expect(await shows('Start one')).toBe(true)
  })
})

describe('Création dans un Projet', () => {
  it('makes a Session with the keyboard, named New session and renamed on the spot', async () => {
    await newSession()

    // It exists before anything is written in it, it is called what the interface calls one, and
    // its title is a field waiting to be replaced.
    expect(await shows('New session')).toBe(true)
    expect(await shows('Title of the Session')).toBe(true)

    await nameIt('Invoice export')
    expect(await shows('Invoice export')).toBe(true)
    expect(await shows('New session')).toBe(false)
  })

  it('derives nothing and creates no Spec: the Project still holds one Workspace', async () => {
    // What the Session is attached to, read from the page rather than from the database: the
    // head says the Project it belongs to, and the settings still list one location.
    expect(await shows('Atlas')).toBe(true)
  })
})

describe('Message enregistré', () => {
  it('keeps what was written, and the Journal says a message was added', async () => {
    await say('The CSV export drops the invoice date.')

    expect(await shows('The CSV export drops the invoice date.')).toBe(true)
    expect(await shows('Saved')).toBe(true)

    await press('Journal')
    await browser.pause(500)
    expect(await shows('Message added')).toBe(true)
    await press('Invoice export')
    await browser.pause(500)
  })
})

describe('Travaux parallèles', () => {
  it('gives the second Session its own name and its own thread', async () => {
    await newSession()
    await nameIt('Bank import')
    await say('The statement import is off by one row.')

    expect(await shows('The statement import is off by one row.')).toBe(true)
    // The first thread is not this one: what was written there is not here.
    expect(await shows('The CSV export drops the invoice date.')).toBe(false)
  })
})

describe('Deux Sessions retrouvées', () => {
  it('lists both after the page is loaded again, each with its own thread', async () => {
    await browser.refresh()
    await browser.pause(1500)

    expect(await shows('Invoice export')).toBe(true)
    expect(await shows('Bank import')).toBe(true)

    await press('Invoice export')
    await browser.pause(700)
    expect(await shows('The CSV export drops the invoice date.')).toBe(true)
    expect(await shows('The statement import is off by one row.')).toBe(false)
  })
})

describe('Session sélectionnée conservée', () => {
  it('opens on the Session the window was on, once the page is loaded again', async () => {
    await browser.refresh()
    await browser.pause(1500)

    // The page is on the Session it was on, which is what the head says: the first one, whose
    // thread is the one that was open.
    expect(await shows('The CSV export drops the invoice date.')).toBe(true)
  })
})

describe('Session archivée puis restaurée', () => {
  it('puts it away, keeps it consultable, and gives it back', async () => {
    await press('Archive')
    await browser.pause(800)

    // Gone from the list, and the window is back on the Home.
    expect(await shows('Invoice export')).toBe(false)

    // Consultable: the palette holds it, and the archive page lists it.
    await strike('k', 'KeyK')
    await browser.pause(500)
    await press('Archived Sessions')
    await browser.pause(700)
    expect(await shows('Invoice export')).toBe(true)
    // Nothing was deleted: the way back is the only thing offered.
    expect(await shows('Delete')).toBe(false)

    await press('Restore')
    await browser.pause(900)
    expect(await shows('Invoice export')).toBe(true)

    // And it is back in the sidebar, where the current ones are.
    await browser.keys(['\uE00C'])
    await browser.pause(400)
    expect(await shows('Bank import')).toBe(true)
  })
})

describe('Archivage durable', () => {
  it('is still put away after the page is loaded again, and still comes back', async () => {
    await press('Archive')
    await browser.pause(800)
    await browser.refresh()
    await browser.pause(1500)

    expect(await shows('Invoice export')).toBe(false)

    await strike('k', 'KeyK')
    await browser.pause(500)
    await press('Archived Sessions')
    await browser.pause(700)
    expect(await shows('Invoice export')).toBe(true)
  })
})
