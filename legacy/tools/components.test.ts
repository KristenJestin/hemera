import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  analyzeComponents,
  analyzeScreens,
  catalogueFolders,
  componentNameOf,
} from './components.ts'

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

/** A repository holding the catalogue given and the screens given. */
function repositoryWith(
  catalogueFiles: Record<string, Record<string, string>>,
  screens: Record<string, string>,
  ui: Record<string, string> = {},
): string {
  const root = mkdtempSync(join(tmpdir(), 'hemera-screens-'))
  const components = join(root, 'packages', 'ui', 'src', 'components')
  for (const [folder, files] of Object.entries(catalogueFiles)) {
    mkdirSync(join(components, folder), { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(components, folder, name), content)
    }
    const entry = folder.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
    writeFileSync(join(components, 'showcase.ts'), `export const SHOWCASE = [${entry}Showcase]\n`)
  }
  for (const [name, content] of Object.entries(ui)) {
    const path = join(root, 'packages', 'ui', 'src', name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, content)
  }
  const desktop = join(root, 'apps', 'desktop', 'src', 'ui')
  mkdirSync(desktop, { recursive: true })
  for (const [name, content] of Object.entries(screens)) {
    writeFileSync(join(desktop, name), content)
  }
  return root
}

const CATALOGUE_BUTTON = {
  button: {
    'button.tsx': 'export function Button() {\n  return null\n}\n',
    'use-button.ts': 'export const useButton = () => ({ inert: false })\n',
    'button.test.tsx': 'export {}\n',
    'button.showcase.tsx': 'export const buttonShowcase = {}\n',
  },
}

describe('Composant local dupliquant le catalogue', () => {
  test('a screen that defines its own Button is refused', () => {
    const root = repositoryWith(CATALOGUE_BUTTON, {
      'page.tsx': 'export function Button() {\n  return null\n}\n',
    })
    try {
      const problems = analyzeScreens(root).map((violation) => violation.problem)
      expect(problems.some((problem) => problem.includes('already delivers it'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("Composition de l'application depuis le package d'interface", () => {
  test('a screen taking its button from the design system is accepted', () => {
    const root = repositoryWith(
      CATALOGUE_BUTTON,
      { 'page.tsx': "import { Button } from '@hemera/ui'\n" },
      { 'components/button/button.tsx': 'export function Button() {\n  return null\n}\n' },
    )
    try {
      expect(analyzeScreens(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('every screen of this repository composes the catalogue', () => {
    expect(analyzeScreens(repository)).toEqual([])
  })
})

describe('Composant hors périmètre appelé', () => {
  test('a screen calling a component the catalogue does not deliver is named', () => {
    const root = repositoryWith(CATALOGUE_BUTTON, {
      'page.tsx': "import { Button, Sparkline } from '@hemera/ui'\n",
    })
    try {
      const violation = analyzeScreens(root).find((entry) => entry.component === 'Sparkline')
      expect(violation?.problem).toContain('delivers no such component')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Balisage recopié depuis le prototype', () => {
  test('a screen carrying a class name or an inline style string is refused', () => {
    const root = repositoryWith(CATALOGUE_BUTTON, {
      'page.tsx': '<div className="sidebar" style="padding: 8px" />\n',
    })
    try {
      const problems = analyzeScreens(root).map((violation) => violation.problem)
      expect(problems.some((problem) => problem.includes('a class name'))).toBe(true)
      expect(problems.some((problem) => problem.includes('an inline style string'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Composant non contrôlé', () => {
  test('a component keeping a prop in its own state is refused', () => {
    const root = catalogue(
      'field',
      {
        'field.tsx': [
          'export interface FieldProps {',
          '  value: string',
          '  onValueChange: (value: string) => void',
          '}',
          '',
          'export function Field({ value, onValueChange }: FieldProps) {',
          '  const [current, setCurrent] = useState(value)',
          '  return null',
          '}',
          '',
        ].join('\n'),
        'use-field.ts': 'export const useField = () => ({ inert: false })\n',
        'field.test.tsx': 'focus(root, "field")\nroot.renderer.nativeSimulateKeystrokes(1, "a")\n',
        'field.showcase.tsx': 'export const fieldShowcase = {}\n',
      },
      'export const SHOWCASE = [fieldShowcase]\n',
    )
    try {
      const violation = analyzeComponents(root).find((entry) =>
        entry.problem.includes('in its own state'),
      )
      expect(violation?.component).toBe('Field')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('no component of the catalogue keeps a prop of its own', () => {
    expect(
      analyzeComponents(repository).filter((entry) => entry.problem.includes('in its own state')),
    ).toEqual([])
  })
})

describe('Composant intégré sans test clavier', () => {
  test('an interactive component without focus and activation in its test is named', () => {
    const root = catalogue(
      'pill',
      {
        'pill.tsx': 'export function Pill({ onPress }) {\n  return null\n}\n',
        'use-pill.ts': 'export const usePill = () => ({ inert: false })\n',
        'pill.test.tsx': 'expect(true).toBe(true)\n',
        'pill.showcase.tsx': 'export const pillShowcase = {}\n',
      },
      'export const SHOWCASE = [pillShowcase]\n',
    )
    try {
      const problems = analyzeComponents(root).map((violation) => violation.problem)
      expect(problems).toContain('has no focus in its keyboard test')
      expect(problems).toContain('has no activation in its keyboard test')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Périmètre livré', () => {
  test('every component of the lot exists with its keyboard test and its demonstration', () => {
    const folders = catalogueFolders(repository)
    expect(folders.length).toBeGreaterThanOrEqual(18)
    expect(analyzeComponents(repository)).toEqual([])

    for (const folder of folders) {
      for (const file of [
        `${folder}.tsx`,
        `use-${folder}.ts`,
        `${folder}.test.tsx`,
        `${folder}.showcase.tsx`,
      ]) {
        expect(
          existsSync(join(repository, 'packages', 'ui', 'src', 'components', folder, file)),
        ).toBe(true)
      }
    }
  })
})
