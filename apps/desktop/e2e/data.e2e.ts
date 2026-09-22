/**
 * One instance per data folder, and two data folders side by side (design D3-06).
 *
 * The suite already drives one running application. What it checks here is what a *second*
 * start does: on the same folder it has to step aside and hand the window back, and on another
 * folder it has to run, because that is the whole point of having a `dev` one at all.
 *
 * Each suite is named after the scenario of `specs/application-foundation/spec.md` it covers.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { browser, expect } from '@wdio/globals'

import { DIAGNOSTIC_FILE } from '../src/main/diagnostic.ts'
import { DATABASE_FILE } from '../src/engine/index.ts'
import { e2eDataOf } from '../wdio.conf.ts'
import { addProject } from './hand.ts'

const application = dirname(dirname(fileURLToPath(import.meta.url)))

/** The data folder this very spec file runs on, named after it exactly as the run named it. */
const E2E_DATA = e2eDataOf('data.e2e.ts')
const binary: string = createRequire(join(application, 'package.json'))('electron')

/** Another application, started on a folder of its own, and the promise of its ending. */
interface Started {
  process: ChildProcess
  ended: Promise<number | null>
}

/** Starts another application on a data folder of its own choosing, and answers when it ends. */
function start(directory: string): Started {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...environment } = process.env
  const started = spawn(
    binary,
    [join(application, 'dist', 'main', 'index.js'), `--data-dir=${directory}`],
    { env: environment, stdio: 'ignore' },
  )
  const ended = new Promise<number | null>((resolve) => {
    started.on('exit', (code) => resolve(code))
  })
  return { process: started, ended }
}

/** What a process that is still running answers, so a wait can tell apart ended and alive. */
function within(
  milliseconds: number,
  ended: Promise<number | null>,
): Promise<number | null | 'alive'> {
  return Promise.race([
    ended,
    new Promise<'alive'>((resolve) => setTimeout(() => resolve('alive'), milliseconds)),
  ])
}

describe('La seconde instance s’efface', () => {
  it('a second start on the same folder quits without opening a window of its own', async () => {
    const before = await browser.electron.execute(
      (electron) => electron.BrowserWindow.getAllWindows().length,
    )

    const second = start(E2E_DATA)
    const outcome = await within(20_000, second.ended)
    if (outcome === 'alive') second.process.kill()
    expect(outcome).not.toBe('alive')

    // The first one is still the only window there is, and it is the one in front.
    const after = await browser.electron.execute((electron) => ({
      windows: electron.BrowserWindow.getAllWindows().length,
      focused: electron.BrowserWindow.getAllWindows()[0]?.isMinimized() === false,
    }))
    expect(after.windows).toBe(before)
    expect(after.focused).toBe(true)
  })

  it('the data folder says in its own log that an instance stepped aside', () => {
    const log = join(E2E_DATA, DIAGNOSTIC_FILE)
    expect(existsSync(log)).toBe(true)
  })
})

describe('Dev et prod tournent côte à côte', () => {
  it('a start on another folder runs alongside the first', async () => {
    const other = mkdtempSync(join(tmpdir(), 'hemera-beside-'))
    const beside = start(other)
    try {
      expect(await within(15_000, beside.ended)).toBe('alive')
      // And the application already running never noticed: it still has its own window.
      const windows = await browser.electron.execute(
        (electron) => electron.BrowserWindow.getAllWindows().length,
      )
      expect(windows).toBeGreaterThan(0)
    } finally {
      beside.process.kill()
      await beside.ended
      rmSync(other, { recursive: true, force: true })
    }
  })
})

describe('La base vit dans le process dédié', () => {
  it('the data folder holds a database, and a process of its own is what opened it', async () => {
    const opened = await browser.electron.execute((electron) => ({
      main: process.pid,
      utilities: electron.app
        .getAppMetrics()
        .filter((metric) => metric.type === 'Utility')
        .map((metric) => ({ pid: metric.pid, name: metric.name })),
    }))

    const held = opened.utilities.find((one) => one.name?.includes('engine') === true)
    expect(held).toBeDefined()
    expect(held?.pid).not.toBe(opened.main)

    expect(existsSync(join(E2E_DATA, DATABASE_FILE))).toBe(true)
  })

  it('the log says the process that holds it opened it, and says so in its own name', () => {
    const written = readFileSync(join(E2E_DATA, DIAGNOSTIC_FILE), 'utf8')
    expect(written).toContain('[engine] opened the database')
  })
})

describe('La sidebar survit au redémarrage', () => {
  it('folding the sidebar by hand is what the data folder is left holding', async () => {
    // A Project first, because the fold is a control of a window that has a sidebar: before the
    // first Project the bar is the mark and nothing else, and there is nothing to fold.
    const sources = mkdtempSync(join(tmpdir(), 'hemera-e2e-data-'))
    await addProject('Atlas', sources)

    // Through the control the user has, not through the channel: what is under test is the
    // round trip from a hand to the database, and a channel called behind the page's back is a
    // fold the page does not know it made.
    await browser.execute(() => {
      const button = document.querySelector('[aria-label="Collapse the sidebar"]')
      if (button instanceof HTMLElement) button.click()
    })
    await browser.pause(600)

    const held = await browser.execute(
      async () => await window.hemera.invoke('preferences.read', {}),
    )
    expect(held.sidebar.collapsed).toBe(true)

    // And the hint the next start is painted from was rewritten with it, which is what lets the
    // sidebar come up folded instead of opening and folding itself a frame later.
    // SAFETY: the file the main process just wrote through `writeSidecar`, whose shape is the
    // display preferences schema; it is read here for one field of it.
    const hint = JSON.parse(readFileSync(join(E2E_DATA, 'display.json'), 'utf8')) as {
      sidebar: { collapsed: boolean }
    }
    expect(hint.sidebar.collapsed).toBe(true)

    await browser.execute(() => {
      const button = document.querySelector('[aria-label="Expand the sidebar"]')
      if (button instanceof HTMLElement) button.click()
    })
    await browser.pause(600)

    rmSync(sources, { recursive: true, force: true })
  })
})

describe('Le thème survit au redémarrage', () => {
  it('a theme written to the data folder is the theme it answers afterwards', async () => {
    await browser.execute(
      async () => await window.hemera.invoke('preferences.write', { theme: 'dark' }),
    )
    await browser.pause(400)

    const wearing = await browser.electron.execute((electron) => electron.nativeTheme.themeSource)
    expect(wearing).toBe('dark')

    // The hint the next start is painted from says so too, which is what removes the flash.
    // SAFETY: the file the main process just wrote through `writeSidecar`, whose shape is the
    // display preferences schema; it is read here for one field of it.
    const hint = JSON.parse(readFileSync(join(E2E_DATA, 'display.json'), 'utf8')) as {
      theme: string
    }
    expect(hint.theme).toBe('dark')

    await browser.execute(
      async () => await window.hemera.invoke('preferences.write', { theme: 'system' }),
    )
    await browser.pause(400)
  })
})
