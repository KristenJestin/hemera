import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import {
  PACKAGE_RULES,
  type PackageRule,
  analyze,
  analyzePackage,
  cyclesOf,
  packageGraph,
  specifiersOf,
} from './boundaries.ts'

const repository = resolve(import.meta.dirname, '..')

function ruleFor(name: string): PackageRule {
  const rule = PACKAGE_RULES.find((entry) => entry.name === name)
  if (rule === undefined) throw new Error(`no boundary rule declares ${name}`)
  return rule
}

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'hemera-boundaries-'))
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

describe('Importation interdite', () => {
  test.each([
    [
      'core reaching for Electron',
      '@hemera/core',
      'packages/core/src/domain/window.ts',
      "import { app } from 'electron'\n",
      'Electron',
    ],
    [
      'core reaching for a Node platform module',
      '@hemera/core',
      'packages/core/src/domain/profile.ts',
      "import { readFileSync } from 'node:fs'\n",
      'a file, process or network API',
    ],
    [
      'the channel declaration reaching for the application',
      '@hemera/ipc',
      'packages/ipc/src/channels.ts',
      "import { main } from '@hemera/desktop'\n",
      'must not depend on',
    ],
    [
      'the application reaching past a public entry point',
      '@hemera/desktop',
      'apps/desktop/src/main/window.ts',
      "import { envReport } from '@hemera/ipc/src/channels.ts'\n",
      'private src',
    ],
  ])('%s is reported with its file and its import', (_case, name, path, source, reason) => {
    const root = fixture({ [path]: source })
    try {
      const violations = analyzePackage(root, ruleFor(name))
      expect(violations).toHaveLength(1)
      expect(violations[0]!.file).toBe(path)
      expect(violations[0]!.specifier).toBe(/'([^']+)'/.exec(source)![1])
      expect(violations[0]!.problem).toContain(reason)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the tree of this monorepo respects its declared boundaries', () => {
    expect(analyze(repository)).toEqual([])
  })

  test('the application may import the core and the channel declaration', () => {
    const root = fixture({
      'packages/core/package.json': JSON.stringify({ name: '@hemera/core' }),
      'packages/ipc/package.json': JSON.stringify({ name: '@hemera/ipc' }),
      'apps/desktop/package.json': JSON.stringify({ name: '@hemera/desktop' }),
      'apps/desktop/src/main/index.ts': [
        "import { projectName } from '@hemera/core'",
        "import { CHANNELS } from '@hemera/ipc'",
        '',
      ].join('\n'),
    })
    try {
      expect(analyzePackage(root, ruleFor('@hemera/desktop'))).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a declared subpath is a public surface, not a reach into a src', () => {
    const root = fixture({
      'packages/ipc/package.json': JSON.stringify({
        name: '@hemera/ipc',
        exports: { '.': './src/index.ts', './schemas/*': './src/schemas/*' },
      }),
      'apps/desktop/package.json': JSON.stringify({ name: '@hemera/desktop' }),
      'apps/desktop/src/main/report.ts': "import { report } from '@hemera/ipc/schemas/env.ts'\n",
    })
    try {
      expect(analyzePackage(root, ruleFor('@hemera/desktop'))).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Frontière du design system', () => {
  test.each([
    ['@hemera/core', 'must not depend on'],
    ['@hemera/ipc', 'must not depend on'],
    ['@hemera/desktop', 'must not depend on'],
    ['electron', 'Electron'],
  ])(
    'a component reaching for %s is reported with its file and its import',
    (specifier, reason) => {
      const path = 'packages/ui/src/components/button/button.tsx'
      const root = fixture({ [path]: `import { thing } from '${specifier}'\n` })
      try {
        const violations = analyzePackage(root, ruleFor('@hemera/ui'))
        expect(violations).toHaveLength(1)
        expect(violations[0]!.file).toBe(path)
        expect(violations[0]!.specifier).toBe(specifier)
        expect(violations[0]!.problem).toContain(reason)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )

  test('the application may import the design system through its declared subpaths', () => {
    const root = fixture({
      'packages/ui/package.json': JSON.stringify({
        name: '@hemera/ui',
        exports: {
          '.': './src/index.ts',
          './theme.css': './src/theme.css',
          './motion': './src/motion.ts',
          './window': './src/window.ts',
        },
      }),
      'apps/desktop/package.json': JSON.stringify({ name: '@hemera/desktop' }),
      'apps/desktop/src/renderer/main.tsx': [
        "import { Button } from '@hemera/ui'",
        "import { spring } from '@hemera/ui/motion'",
        "import '@hemera/ui/theme.css'",
        '',
      ].join('\n'),
      'apps/desktop/src/main/window.ts': "import { windowColors } from '@hemera/ui/window'\n",
    })
    try {
      expect(analyzePackage(root, ruleFor('@hemera/desktop'))).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Import direct refusé', () => {
  test('the catalogue alone may import the icon package', () => {
    const inside = 'packages/ui/src/icons.ts'
    const outside = 'packages/ui/src/components/button/button.tsx'
    const source = "import { IconCheck } from '@tabler/icons-react'\n"
    const root = fixture({ [inside]: source, [outside]: source })
    try {
      const violations = analyzePackage(root, ruleFor('@hemera/ui'))
      expect(violations).toHaveLength(1)
      expect(violations[0]!.file).toBe(outside)
      expect(violations[0]!.problem).toContain(inside)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the application never imports the icon package, catalogue or not', () => {
    const path = 'apps/desktop/src/renderer/application.tsx'
    const root = fixture({ [path]: "import { IconCheck } from '@tabler/icons-react'\n" })
    try {
      const violations = analyzePackage(root, ruleFor('@hemera/desktop'))
      expect(violations).toHaveLength(1)
      expect(violations[0]!.file).toBe(path)
      expect(violations[0]!.problem).toContain('packages/ui/src/icons.ts')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Frontières des packages', () => {
  test('a cycle between packages is detected', () => {
    const graph = new Map([
      ['@hemera/core', new Set(['@hemera/ipc'])],
      ['@hemera/ipc', new Set(['@hemera/core'])],
      ['@hemera/desktop', new Set<string>()],
    ])
    const cycles = cyclesOf(graph)
    expect(cycles).toHaveLength(1)
    expect(cycles[0]).toContain('@hemera/core')
    expect(cycles[0]).toContain('@hemera/ipc')
  })

  test('the graph of this monorepo is acyclic', () => {
    expect(cyclesOf(packageGraph(repository))).toEqual([])
  })

  test('a relative path escaping the package is reported', () => {
    const root = fixture({
      'packages/ipc/src/channels.ts': "import { x } from '../../core/src/domain'\n",
    })
    try {
      const violations = analyzePackage(root, ruleFor('@hemera/ipc'))
      expect(violations).toHaveLength(1)
      expect(violations[0]!.problem).toContain('reaches outside @hemera/ipc')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('static, bare and dynamic specifiers are all collected', () => {
    const source = [
      "import { a } from './a.ts'",
      "import 'electron'",
      "export { b } from '@hemera/core'",
      "const c = await import('node:fs')",
    ].join('\n')
    expect(specifiersOf(source).toSorted()).toEqual([
      './a.ts',
      '@hemera/core',
      'electron',
      'node:fs',
    ])
  })
})
