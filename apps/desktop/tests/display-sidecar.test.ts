/**
 * The hint the first frame is painted from, and what happens when it is wrong (design D3-07).
 *
 * Each suite is named after the scenario of `specs/display-preferences/spec.md` it covers.
 * Every test writes into a temporary folder; no profile of this machine is read or written.
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
}

let profile: string

beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), 'hemera-sidecar-'))
})

afterEach(() => {
  rmSync(profile, { recursive: true, force: true })
})

describe('Indication absente', () => {
  test('a profile that has never been started has no hint to go on', () => {
    expect(readSidecar(profile)).toBeNull()
  })

  test.each([
    ['not JSON at all', 'wearing dark, thanks'],
    ['JSON of the wrong shape', '{"theme":"sepia"}'],
    ['JSON that is not an object', '"dark"'],
    ['half of what is needed', '{"theme":"dark"}'],
  ])('a hint that is %s is read as no hint rather than as a failure', (_case, written) => {
    writeFileSync(join(profile, SIDECAR_FILE), written)
    expect(readSidecar(profile)).toBeNull()
  })
})

describe('Indication divergente', () => {
  test('what was written is what is read back, whole', () => {
    writeSidecar(profile, DARK)
    expect(readSidecar(profile)).toEqual(DARK)
  })

  test('writing it again replaces it, so the hint says what the database last said', () => {
    writeSidecar(profile, DARK)
    writeSidecar(profile, { theme: 'light', sidebar: { collapsed: false, width: null } })

    expect(readSidecar(profile)).toEqual({
      theme: 'light',
      sidebar: { collapsed: false, width: null },
    })
  })

  test('the hint is put in place whole, never half written', () => {
    writeSidecar(profile, DARK)

    // The file it was written through is gone: what is left is the hint and nothing beside it.
    expect(readdirSync(profile)).toEqual([SIDECAR_FILE])
    expect(existsSync(join(profile, `${SIDECAR_FILE}.writing`))).toBe(false)
    expect(readFileSync(join(profile, SIDECAR_FILE), 'utf8')).toContain('"theme": "dark"')
  })
})
