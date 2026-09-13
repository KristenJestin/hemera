import { describe, expect, spyOn, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { missingKeyMarker, t } from '../src/i18n/index.ts'

const desktop = resolve(import.meta.dir, '..')

describe("Textes de l'interface", () => {
  test('a declared key resolves to its English translation', () => {
    expect(t('app.name')).toBe('Hemera')
  })
})

describe('Clé de traduction manquante', () => {
  test('a key absent from the locale is reported and rendered as an identifiable marker', () => {
    const reported = spyOn(console, 'error').mockImplementation(() => {})
    try {
      // A key resolved dynamically escapes the compile-time check; the runtime must not
      // render an empty or misleading label.
      const rendered = t('session.title.unknown' as 'app.name')
      expect(rendered).toBe(missingKeyMarker('session.title.unknown'))
      expect(rendered).toContain('session.title.unknown')
      expect(reported).toHaveBeenCalledTimes(1)
      expect(reported.mock.calls[0]![0]).toContain('missing translation')
    } finally {
      reported.mockRestore()
    }
  })
})

describe('Aucune promesse multilingue', () => {
  test('a single locale is shipped', () => {
    expect(readdirSync(join(desktop, 'src', 'i18n', 'resources'))).toEqual(['en.ts'])
  })

  test('no language selector is exposed to the user', () => {
    const module = readFileSync(join(desktop, 'src', 'i18n', 'index.ts'), 'utf8')
    expect(module).not.toMatch(/setLocale|availableLocales|languageSelector/)
  })
})
