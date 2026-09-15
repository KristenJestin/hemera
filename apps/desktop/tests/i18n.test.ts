import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import * as m from '#paraglide/messages.js'

const desktop = resolve(import.meta.dir, '..')

describe("Textes de l'interface", () => {
  test('a declared key resolves to its English translation', () => {
    expect(String(m.app_name())).toBe('Hemera')
    expect(String(m.project_new())).toBe('New project')
  })

  test('every message of the catalogue is a function of its own', () => {
    const catalogue = JSON.parse(
      readFileSync(join(desktop, 'messages', 'en.json'), 'utf8'),
    ) as Record<string, string>
    const declared = Object.keys(catalogue).filter((key) => !key.startsWith('$'))
    expect(declared.length).toBeGreaterThan(40)
    for (const key of declared) {
      expect(typeof (m as Record<string, unknown>)[key]).toBe('function')
    }
  })
})

describe('Clé de traduction manquante', () => {
  test('a key that does not exist is not something the application can call', () => {
    // There is no lookup to miss: a message is a compiled function, so an absent key is a
    // name that does not exist. The typecheck refuses it, and a call built dynamically
    // fails loudly here instead of painting an empty label.
    expect((m as Record<string, unknown>)['session_title_unknown']).toBeUndefined()
    expect(() =>
      (m as unknown as Record<string, () => string>)['session_title_unknown']!(),
    ).toThrow()
  })

  test('a message left empty in the catalogue is reported by name', () => {
    const catalogue = JSON.parse(
      readFileSync(join(desktop, 'messages', 'en.json'), 'utf8'),
    ) as Record<string, string>
    const empty = Object.entries(catalogue)
      .filter(([key]) => !key.startsWith('$'))
      .filter(([, value]) => value.trim().length === 0)
      .map(([key]) => key)
    expect(empty).toEqual([])
  })
})

describe('Aucune promesse multilingue', () => {
  test('a single locale is shipped', () => {
    expect(readdirSync(join(desktop, 'messages'))).toEqual(['en.json'])
    const settings = JSON.parse(
      readFileSync(join(desktop, 'project.inlang', 'settings.json'), 'utf8'),
    ) as { baseLocale: string; locales: string[] }
    expect(settings.locales).toEqual(['en'])
    expect(settings.baseLocale).toBe('en')
  })

  test('no language selector is exposed to the user', () => {
    const screens = [
      join(desktop, 'src', 'ui', 'sessions', 'sessions-page.tsx'),
      join(desktop, 'src', 'ui', 'sessions', 'dialogs.tsx'),
      join(desktop, 'src', 'ui', 'showcase', 'showcase-page.tsx'),
    ]
    for (const screen of screens) {
      const source = readFileSync(screen, 'utf8')
      expect(source).not.toMatch(/setLocale|locales|languageSelector/)
    }
  })
})
