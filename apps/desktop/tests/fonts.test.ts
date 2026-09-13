import { describe, expect, test } from 'bun:test'
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EMBEDDED_FONTS, FONT_LICENCES, MONO_FAMILY, SANS_FAMILY } from '@hemera/ui'

import {
  embeddedFontsDirectory,
  missingFontDiagnostic,
  registerEmbeddedFonts,
} from '../src/platform/fonts.ts'

function fontsCopy(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hemera-fonts-'))
  cpSync(embeddedFontsDirectory(), directory, { recursive: true })
  return directory
}

describe('Typographie embarquée', () => {
  test('both families ship with their files and their open font licence', () => {
    const directory = embeddedFontsDirectory()
    for (const font of EMBEDDED_FONTS) {
      expect(existsSync(join(directory, font.file))).toBe(true)
    }
    for (const licence of FONT_LICENCES) {
      expect(existsSync(join(directory, licence))).toBe(true)
    }
    const families = [...new Set(EMBEDDED_FONTS.map((font) => font.family))]
    expect(families.toSorted()).toEqual([SANS_FAMILY, MONO_FAMILY].toSorted())
  })

  test('every embedded file is handed to the renderer in one call', () => {
    const calls: number[] = []
    const registration = registerEmbeddedFonts(embeddedFontsDirectory(), (fonts) => {
      calls.push(fonts.length)
    })
    expect(calls).toEqual([EMBEDDED_FONTS.length])
    expect(registration.registered).toHaveLength(EMBEDDED_FONTS.length)
    expect(registration.missing).toEqual([])
    expect(missingFontDiagnostic(registration)).toBeNull()
  })
})

describe('Police manquante au démarrage', () => {
  test('a removed font file is named in the diagnostic and the rest still registers', () => {
    const directory = fontsCopy()
    try {
      const removed = EMBEDDED_FONTS[0]!
      rmSync(join(directory, removed.file))

      let handed = 0
      const registration = registerEmbeddedFonts(directory, (fonts) => {
        handed = fonts.length
      })

      expect(registration.missing).toHaveLength(1)
      expect(registration.missing[0]!.font.file).toBe(removed.file)
      expect(registration.registered).toHaveLength(EMBEDDED_FONTS.length - 1)
      expect(handed).toBe(EMBEDDED_FONTS.length - 1)

      const diagnostic = missingFontDiagnostic(registration)
      expect(diagnostic).not.toBeNull()
      expect(diagnostic).toContain(removed.family)
      expect(diagnostic).toContain(removed.file)
      expect(diagnostic).toContain('system fallback family')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('a missing directory reports every family instead of failing', () => {
    const registration = registerEmbeddedFonts(join(tmpdir(), 'hemera-no-fonts-here'), () => {
      throw new Error('nothing should be handed to the renderer')
    })
    expect(registration.registered).toEqual([])
    expect(registration.missing).toHaveLength(EMBEDDED_FONTS.length)

    const diagnostic = missingFontDiagnostic(registration)!
    expect(diagnostic).toContain(SANS_FAMILY)
    expect(diagnostic).toContain(MONO_FAMILY)
  })
})
