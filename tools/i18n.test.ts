import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { analyzeI18n } from './i18n.ts'
import { en } from '../apps/desktop/src/i18n/resources/en.ts'

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
    expect(analyzeI18n(repository, new Set(Object.keys(en)))).toEqual([])
  })

  test('literal JSX text is reported with its file and line', () => {
    const root = desktopFixture({
      'ui/page.tsx': ['export const Page = () => (', '  <div>Create a project</div>', ')'].join(
        '\n',
      ),
    })
    try {
      const violations = analyzeI18n(root, new Set(['app.name']))
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
      const violations = analyzeI18n(root, new Set(['app.name']))
      expect(violations).toHaveLength(1)
      expect(violations[0]!.problem).toContain('Message Hemera')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('punctuation and separators are not mistaken for a label', () => {
    const root = desktopFixture({ 'ui/sep.tsx': '<Text>{value}</Text>\n<Text> · </Text>\n' })
    try {
      expect(analyzeI18n(root, new Set(['app.name']))).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Clé de traduction manquante', () => {
  test('a key absent from the locale is reported where it is requested', () => {
    const root = desktopFixture({ 'ui/page.tsx': "<Text>{t('project.create')}</Text>\n" })
    try {
      const violations = analyzeI18n(root, new Set(['app.name']))
      expect(violations).toHaveLength(1)
      expect(violations[0]!.problem).toContain('"project.create" is missing')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a key present in the locale passes', () => {
    const root = desktopFixture({ 'ui/page.tsx': "<Text>{t('app.name')}</Text>\n" })
    try {
      expect(analyzeI18n(root, new Set(['app.name']))).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
