import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { analyzeI18n, catalogueOf, staleMessages } from './i18n.ts'

const repository = resolve(import.meta.dir, '..')

function desktopFixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'hemera-i18n-'))
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, 'apps', 'desktop', 'src', path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

describe("Textes de l'interface", () => {
  test('the desktop application holds no hard-coded visible text', () => {
    expect(analyzeI18n(repository, catalogueOf(repository))).toEqual([])
  })

  test('literal JSX text is reported with its file and line', () => {
    const root = desktopFixture({
      'ui/page.tsx': ['export const Page = () => (', '  <div>Create a project</div>', ')'].join(
        '\n',
      ),
    })
    try {
      const violations = analyzeI18n(root, new Set(['app_name']))
      expect(violations).toHaveLength(1)
      expect(violations[0]!.file).toBe('apps/desktop/src/ui/page.tsx')
      expect(violations[0]!.line).toBe(2)
      expect(violations[0]!.problem).toContain('Create a project')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a literal passed to a visible prop is reported', () => {
    const root = desktopFixture({
      'ui/field.tsx': '<Input placeholder="Message Hemera" />\n',
    })
    try {
      const violations = analyzeI18n(root, new Set(['app_name']))
      expect(violations).toHaveLength(1)
      expect(violations[0]!.problem).toContain('Message Hemera')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('punctuation and separators are not mistaken for a label', () => {
    const root = desktopFixture({ 'ui/sep.tsx': '<Text>{value}</Text>\n<Text> · </Text>\n' })
    try {
      expect(analyzeI18n(root, new Set(['app_name']))).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Clé de traduction manquante', () => {
  test('a message absent from the catalogue is reported where it is called', () => {
    const root = desktopFixture({ 'ui/page.tsx': '<Text>{m.project_create()}</Text>\n' })
    try {
      const violations = analyzeI18n(root, new Set(['app_name']))
      expect(violations).toHaveLength(1)
      expect(violations[0]!.problem).toContain('"project_create" is missing')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a message the catalogue declares passes', () => {
    const root = desktopFixture({ 'ui/page.tsx': '<Text>{m.app_name()}</Text>\n' })
    try {
      expect(analyzeI18n(root, new Set(['app_name']))).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the compiled messages are the ones the catalogue declares', () => {
    // They are committed, so nothing regenerates them on a checkout: a catalogue edited
    // without recompiling would leave the application calling a message that is gone.
    expect(staleMessages(repository)).toEqual([])
  })
})
