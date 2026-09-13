import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { analyzeComponents, catalogueFolders, componentNameOf } from './components.ts'

const repository = resolve(import.meta.dir, '..')

/** A catalogue holding one component folder with the files given. */
function catalogue(folder: string, files: Record<string, string>, registry: string): string {
  const root = mkdtempSync(join(tmpdir(), 'hemera-catalogue-'))
  const components = join(root, 'packages', 'ui', 'src', 'components')
  mkdirSync(join(components, folder), { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(components, folder, name), content)
  }
  writeFileSync(join(components, 'showcase.ts'), registry)
  return root
}

const COMPLETE = {
  'button.tsx': 'export const Button = () => null\n',
  'use-button.ts': 'export const useButton = () => ({ inert: false })\n',
  'button.test.tsx': 'export {}\n',
  'button.showcase.tsx': 'export const buttonShowcase = {}\n',
}

describe('Dossier de composant incomplet', () => {
  test('the catalogue of the monorepo is complete', () => {
    expect(analyzeComponents(repository)).toEqual([])
    expect(catalogueFolders(repository).length).toBeGreaterThan(0)
  })

  test('a missing file is reported by name', () => {
    const { 'button.test.tsx': _dropped, ...withoutTest } = COMPLETE
    const root = catalogue('button', withoutTest, 'buttonShowcase')
    try {
      const violations = analyzeComponents(root)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.component).toBe('Button')
      expect(violations[0]!.problem).toContain('button/button.test.tsx')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a complete folder registered in the showcase passes', () => {
    const root = catalogue('button', COMPLETE, 'buttonShowcase')
    try {
      expect(analyzeComponents(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Composant sans démonstration', () => {
  test('a component absent from the registry is refused by name', () => {
    const root = catalogue('button', COMPLETE, 'nothing here')
    try {
      const violations = analyzeComponents(root)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.component).toBe('Button')
      expect(violations[0]!.problem).toContain('no entry in the showcase registry')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Style écrit dans le hook', () => {
  test('a hook returning a visual value is refused', () => {
    const root = catalogue(
      'button',
      { ...COMPLETE, 'use-button.ts': 'export const useButton = () => ({ borderRadius: 8 })\n' },
      'buttonShowcase',
    )
    try {
      const violations = analyzeComponents(root)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.problem).toContain('borderRadius')
      expect(violations[0]!.problem).toContain('belongs to the component')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Nom de composant', () => {
  test('a kebab-case folder names its component', () => {
    expect(componentNameOf('button')).toBe('Button')
    expect(componentNameOf('icon-button')).toBe('IconButton')
  })
})
