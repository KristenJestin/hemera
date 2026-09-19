/**
 * What a start leaves in the data folder, and what a refusal leaves there too (D3-09).
 *
 * Each suite is named after the scenario of `specs/application-foundation/spec.md` it covers.
 * Every test writes into a temporary folder: no data folder of this machine is ever opened.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  DIAGNOSTIC_FILE,
  diagnostic,
  openDiagnosticLog,
  writeDiagnosticTo,
} from '#main/diagnostic.ts'

let dataFolder: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-diagnostic-'))
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
})

function written(): string {
  return readFileSync(join(dataFolder, DIAGNOSTIC_FILE), 'utf8')
}

describe('Un démarrage ordinaire est tracé', () => {
  test('the log of the data folder carries the channel, the version, the path and the state', () => {
    const log = openDiagnosticLog(dataFolder, 'main')
    log('started on channel dev, version 0.3.0-12-gabc1')
    log(`data folder ${dataFolder}`)
    log('database up to date')

    const lines = written().trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    expect(written()).toContain('channel dev')
    expect(written()).toContain('0.3.0-12-gabc1')
    expect(written()).toContain(dataFolder)
    expect(written()).toContain('database up to date')
  })

  test('every line is dated and says which program wrote it', () => {
    openDiagnosticLog(dataFolder, 'main')('started')
    openDiagnosticLog(dataFolder, 'engine')('opened the database')

    const lines = written().trimEnd().split('\n')
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[main] started$/)
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[engine] opened the database$/)
  })

  test('a second start appends to the log rather than starting it over', () => {
    openDiagnosticLog(dataFolder, 'main')('first start')
    openDiagnosticLog(dataFolder, 'main')('second start')

    expect(written()).toContain('first start')
    expect(written()).toContain('second start')
  })
})

describe('Un refus est tracé même sans console', () => {
  test('a refusal reaches the log of the data folder, not a console nobody is looking at', () => {
    writeDiagnosticTo(openDiagnosticLog(dataFolder, 'main'))
    try {
      diagnostic('--data-dir: refused /home/someone/.local/share/hemera/prod')
      expect(written()).toContain('--data-dir: refused')
    } finally {
      // The next suite starts from a console again, as a process does before it knows its folder.
      writeDiagnosticTo((line) => {
        console.error(line)
      })
    }
  })
})
