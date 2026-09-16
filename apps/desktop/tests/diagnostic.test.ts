/**
 * What a start leaves in the profile, and what a refusal leaves there too (design D3-09).
 *
 * Each suite is named after the scenario of `specs/application-foundation/spec.md` it covers.
 * Every test writes into a temporary folder: no profile of this machine is opened or touched.
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

let profile: string

beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), 'hemera-diagnostic-'))
})

afterEach(() => {
  rmSync(profile, { recursive: true, force: true })
})

function written(): string {
  return readFileSync(join(profile, DIAGNOSTIC_FILE), 'utf8')
}

describe('Un démarrage ordinaire est tracé', () => {
  test('the log of the profile carries the channel, the version, the path and the state', () => {
    const log = openDiagnosticLog(profile, 'main')
    log('started on channel dev, version 0.3.0-12-gabc1')
    log(`profile ${profile}`)
    log('database up to date')

    const lines = written().trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    expect(written()).toContain('channel dev')
    expect(written()).toContain('0.3.0-12-gabc1')
    expect(written()).toContain(profile)
    expect(written()).toContain('database up to date')
  })

  test('every line is dated and says which program wrote it', () => {
    openDiagnosticLog(profile, 'main')('started')
    openDiagnosticLog(profile, 'profile')('opened the database')

    const lines = written().trimEnd().split('\n')
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[main] started$/)
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[profile] opened the database$/)
  })

  test('a second start appends to the log rather than starting it over', () => {
    openDiagnosticLog(profile, 'main')('first start')
    openDiagnosticLog(profile, 'main')('second start')

    expect(written()).toContain('first start')
    expect(written()).toContain('second start')
  })
})

describe('Un refus est tracé même sans console', () => {
  test('a refusal reaches the log of the profile, not a console nobody is looking at', () => {
    writeDiagnosticTo(openDiagnosticLog(profile, 'main'))
    try {
      diagnostic('--profile-dir: refused /home/kris/.local/share/hemera/prod')
      expect(written()).toContain('--profile-dir: refused')
    } finally {
      // The next suite starts again from a console, as a process does before it knows its profile.
      writeDiagnosticTo((line) => {
        console.error(line)
      })
    }
  })
})
