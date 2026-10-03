/**
 * The data folder in the real application: the engine process opens the 1.0 database in it, says
 * so in its own name, and the theme the user chooses is kept for the first frame of the next
 * start.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { browser, expect } from '@wdio/globals'

import { DATABASE_FILE } from '../src/engine/migrate.ts'
import { SIDECAR_FILE } from '../src/main/display-sidecar.ts'
import { e2eProfileOf } from '../wdio.conf.ts'
import { diagnosticOf, waitForEngine, waitForLines } from './diagnostic.ts'

const SPEC = 'data.e2e.ts'
const DATA = e2eProfileOf(SPEC)

describe('The database lives in the engine process', () => {
  it('the data folder holds hemera-1.sqlite, and the engine process is what opened it', async () => {
    await waitForEngine()
    const processes = await browser.electron.execute((electron) => ({
      main: process.pid,
      engine: globalThis.hemeraProbe?.enginePid(),
      utilities: electron.app
        .getAppMetrics()
        .filter((metric) => metric.type === 'Utility')
        .map((metric) => metric.pid),
    }))
    expect(processes.engine).toBeDefined()
    expect(processes.engine).not.toBe(processes.main)
    expect(processes.utilities).toContain(processes.engine)
    expect(existsSync(join(DATA, DATABASE_FILE))).toBe(true)
  })

  it('the log says the engine opened it, in its own name', async () => {
    await waitForLines(SPEC, /\[engine\] opened the database .*hemera-1\.sqlite/, 1)
    expect(diagnosticOf(SPEC).some((line) => line.includes('[main] opened the database'))).toBe(
      false,
    )
  })
})

describe('The theme survives a restart', () => {
  it('a theme written to the data folder is worn now and kept for the next first frame', async () => {
    await browser.electron.execute(async () => await globalThis.hemeraProbe?.changeTheme('dark'))
    const wearing = await browser.electron.execute((electron) => electron.nativeTheme.themeSource)
    expect(wearing).toBe('dark')
    // SAFETY: the file main writes through `writeSidecar`, whose shape is the preferences schema;
    // one field of it is read here.
    const hint = JSON.parse(readFileSync(join(DATA, SIDECAR_FILE), 'utf8')) as { theme: string }
    expect(hint.theme).toBe('dark')

    await browser.electron.execute(async () => await globalThis.hemeraProbe?.changeTheme('system'))
    expect(await browser.electron.execute((electron) => electron.nativeTheme.themeSource)).toBe(
      'system',
    )
  })
})
