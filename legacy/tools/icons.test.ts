import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  CATALOGUE,
  analyzeIconUsage,
  camelCaseOf,
  generateCatalogue,
  normaliseMarkup,
} from './icons.ts'

const repository = resolve(import.meta.dir, '..')

function fixture(relativePath: string, content: string): string {
  const root = mkdtempSync(join(tmpdir(), 'hemera-icon-usage-'))
  const full = join(root, relativePath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
  return root
}

describe('Emoji utilisé comme icône', () => {
  test('the interface uses no emoji or typographic glyph as an icon', () => {
    expect(analyzeIconUsage(repository)).toEqual([])
  })

  test('an emoji in a screen is reported with its file and line', () => {
    const root = fixture(
      'apps/desktop/src/ui/page.tsx',
      ['const a = 1', 'const icon = "🚀"', ''].join('\n'),
    )
    try {
      const violations = analyzeIconUsage(root)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.file).toBe('apps/desktop/src/ui/page.tsx')
      expect(violations[0]!.line).toBe(2)
      expect(violations[0]!.glyph).toBe('🚀')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('an arrow glyph standing in for an icon is reported', () => {
    const root = fixture('packages/ui/src/components/tab/tab.tsx', 'const chevron = "→"\n')
    try {
      expect(analyzeIconUsage(root)).toHaveLength(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Catalogue généré', () => {
  test('the committed catalogue matches what the generator produces', () => {
    const generated = generateCatalogue(repository)
    const committed = readFileSync(
      join(repository, 'packages', 'ui', 'src', 'icons', 'catalog.ts'),
      'utf8',
    )
    expect(committed).toBe(generated)
  })

  test('every declared icon is exported under a camel case name', () => {
    const committed = readFileSync(
      join(repository, 'packages', 'ui', 'src', 'icons', 'catalog.ts'),
      'utf8',
    )
    for (const name of CATALOGUE) {
      expect(committed).toContain(`export const ${camelCaseOf(name)} = `)
      expect(committed).toContain(`'${name}': ${camelCaseOf(name)},`)
    }
  })

  test('markup is normalised to one line without class or fixed size', () => {
    const markup = normaliseMarkup(
      [
        '<!-- @license lucide-static -->',
        '<svg',
        '  class="lucide lucide-plus"',
        '  width="24"',
        '  height="24"',
        '  stroke="currentColor"',
        '>',
        '  <path d="M5 12h14" />',
        '</svg>',
      ].join('\n'),
    )
    expect(markup).not.toContain('\n')
    expect(markup).not.toContain('class=')
    expect(markup).not.toContain('width="24"')
    expect(markup).not.toContain('currentColor')
    expect(markup).toContain('stroke="#000"')
    expect(markup).toContain('<path d="M5 12h14" />')
  })

  test('camel case follows the lucide name', () => {
    expect(camelCaseOf('archive-restore')).toBe('archiveRestore')
    expect(camelCaseOf('x')).toBe('x')
    expect(camelCaseOf('loader-circle')).toBe('loaderCircle')
  })
})
