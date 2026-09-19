/**
 * The hint the first frame is painted from, and what happens when it is wrong (design D3-07).
 *
 * Each suite is named after the scenario of `specs/display-preferences/spec.md` it covers.
 * Every test writes into a temporary folder; no data folder of this machine is read or written.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { DisplayPreferences } from '@hemera/ipc'

import { SIDECAR_FILE, readSidecar, writeSidecar } from '#main/display-sidecar.ts'

const DARK: DisplayPreferences = {
  theme: 'dark',
  sidebar: { collapsed: true, width: 280 },
  activeProjectId: null,
}

let dataFolder: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-sidecar-'))
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
})

describe('Indication absente', () => {
  test('a data folder that has never been started has no hint to go on', () => {
    expect(readSidecar(dataFolder)).toBeNull()
  })

  test.each([
    ['not JSON at all', 'wearing dark, thanks'],
    ['JSON of the wrong shape', '{"theme":"sepia"}'],
    ['JSON that is not an object', '"dark"'],
    ['half of what is needed', '{"theme":"dark"}'],
  ])('a hint that is %s is read as no hint rather than as a failure', (_case, written) => {
    writeFileSync(join(dataFolder, SIDECAR_FILE), written)
    expect(readSidecar(dataFolder)).toBeNull()
  })
})

describe('Indication divergente', () => {
  test('what was written is what is read back, whole', () => {
    writeSidecar(dataFolder, DARK)
    expect(readSidecar(dataFolder)).toEqual(DARK)
  })

  test('writing it again replaces it, so the hint says what the database last said', () => {
    writeSidecar(dataFolder, DARK)
    writeSidecar(dataFolder, {
      theme: 'light',
      sidebar: { collapsed: false, width: null },
      activeProjectId: null,
    })

    expect(readSidecar(dataFolder)).toEqual({
      theme: 'light',
      sidebar: { collapsed: false, width: null },
      activeProjectId: null,
    })
  })

  test('the hint is put in place whole, never half written', () => {
    writeSidecar(dataFolder, DARK)

    // The file it was written through is gone: what is left is the hint and nothing beside it.
    expect(readdirSync(dataFolder)).toEqual([SIDECAR_FILE])
    expect(existsSync(join(dataFolder, `${SIDECAR_FILE}.writing`))).toBe(false)
    expect(readFileSync(join(dataFolder, SIDECAR_FILE), 'utf8')).toContain('"theme": "dark"')
  })
})
