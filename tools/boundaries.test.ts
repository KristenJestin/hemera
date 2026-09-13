import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { PACKAGE_RULES, analyze, analyzePackage, cyclesOf, specifiersOf } from './boundaries.ts'

const repository = resolve(import.meta.dir, '..')

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'hemera-boundaries-'))
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

describe('Consommateur indépendant du desktop', () => {
  test('bundling the public core API pulls in no renderer, storage or platform module', async () => {
    const build = await Bun.build({
      entrypoints: [join(repository, 'packages', 'core', 'src', 'index.ts')],
      target: 'bun',
    })
    expect(build.success).toBe(true)
    const bundled = await Promise.all(build.outputs.map((output) => output.text()))
    const code = bundled.join('\n')
    for (const forbidden of [
      'bun:sqlite',
      'node:fs',
      'node:child_process',
      'drizzle-orm',
      '@gpuix/',
      'react-reconciler',
    ]) {
      expect(code).not.toContain(forbidden)
    }
  })

  test('the production configuration of core declares no ambient Bun types', () => {
    const production = JSON.parse(
      readFileSync(join(repository, 'packages', 'core', 'tsconfig.json'), 'utf8'),
    )
    expect(production.compilerOptions.types).toEqual([])
    expect(production.include).toEqual(['src/**/*.ts'])

    const tests = JSON.parse(
      readFileSync(join(repository, 'packages', 'core', 'tsconfig.test.json'), 'utf8'),
    )
    expect(tests.compilerOptions.types).toEqual(['bun'])
  })
})

describe("Import métier interdit dans le package d'interface", () => {
  test.each([
    ['@hemera/core', 'an Hemera package'],
    ['@hemera/runtime', 'an Hemera package'],
    ['bun:sqlite', 'a Bun built-in module'],
    ['node:fs', 'a file, process or network API'],
    ['node:child_process', 'a file, process or network API'],
    ['drizzle-orm', 'the SQLite storage layer'],
  ])('%p in the design system is reported with its file and its import', (specifier, reason) => {
    const root = fixture({
      'packages/ui/src/components/card/card.tsx': `import x from '${specifier}'\n`,
    })
    try {
      const violations = analyzePackage(root, PACKAGE_RULES[2]!)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.file).toBe('packages/ui/src/components/card/card.tsx')
      expect(violations[0]!.specifier).toBe(specifier)
      expect(violations[0]!.problem).toContain(reason)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the renderer and React stay allowed in the design system', () => {
    const root = fixture({
      'packages/ui/src/primitives/box.tsx': [
        "import { useState } from 'react'",
        "import type { StyleDesc } from '@gpuix/react'",
        '',
      ].join('\n'),
    })
    try {
      expect(analyzePackage(root, PACKAGE_RULES[2]!)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the design system rule is the one declared for @hemera/ui', () => {
    expect(PACKAGE_RULES[2]!.name).toBe('@hemera/ui')
    expect(PACKAGE_RULES[2]!.directory).toBe('packages/ui')
  })
})

describe('Frontières des packages', () => {
  test('the monorepo respects its declared boundaries', () => {
    expect(analyze(repository)).toEqual([])
  })

  test('a platform import in core is reported with its reason', () => {
    const root = fixture({
      'packages/core/src/index.ts': "import { Database } from 'bun:sqlite'\nexport { Database }\n",
    })
    try {
      const violations = analyzePackage(root, {
        name: '@hemera/core',
        directory: 'packages/core',
        forbidden: [{ pattern: /^bun:/, reason: 'a Bun built-in module' }],
      })
      expect(violations).toHaveLength(1)
      expect(violations[0]!.specifier).toBe('bun:sqlite')
      expect(violations[0]!.problem).toContain('a Bun built-in module')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('an import reaching into another package private src is reported', () => {
    const root = fixture({
      'apps/desktop/src/page.ts': "import { Button } from '@hemera/ui/src/components/button'\n",
    })
    try {
      const violations = analyzePackage(root, {
        name: '@hemera/desktop',
        directory: 'apps/desktop',
        forbidden: [],
      })
      expect(violations).toHaveLength(1)
      expect(violations[0]!.problem).toContain('private src')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a relative path escaping the package is reported', () => {
    const root = fixture({
      'packages/runtime/src/storage.ts': "import { x } from '../../core/src/domain'\n",
    })
    try {
      const violations = analyzePackage(root, {
        name: '@hemera/runtime',
        directory: 'packages/runtime',
        forbidden: [],
      })
      expect(violations).toHaveLength(1)
      expect(violations[0]!.problem).toContain('reaches outside @hemera/runtime')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a cycle between packages is detected', () => {
    const graph = new Map([
      ['@hemera/core', new Set(['@hemera/runtime'])],
      ['@hemera/runtime', new Set(['@hemera/core'])],
      ['@hemera/ui', new Set<string>()],
    ])
    const cycles = cyclesOf(graph)
    expect(cycles).toHaveLength(1)
    expect(cycles[0]).toContain('@hemera/core')
    expect(cycles[0]).toContain('@hemera/runtime')
  })

  test('static, bare and dynamic specifiers are all collected', () => {
    const source = [
      "import { a } from './a.ts'",
      "import 'bun:sqlite'",
      "export { b } from '@hemera/core'",
      "const c = await import('node:fs')",
    ].join('\n')
    expect(specifiersOf(source).toSorted()).toEqual([
      './a.ts',
      '@hemera/core',
      'bun:sqlite',
      'node:fs',
    ])
  })
})

describe('Frontières des packages — sous-chemins déclarés', () => {
  test('a subpath pattern of the exports is a public surface, not a reach into a src', () => {
    const root = fixture({
      'packages/ui/package.json': JSON.stringify({
        name: '@hemera/ui',
        exports: { '.': './src/index.ts', './fonts/*': './src/fonts/*' },
      }),
      'apps/desktop/package.json': JSON.stringify({ name: '@hemera/desktop' }),
      'apps/desktop/src/fonts.ts':
        "import regular from '@hemera/ui/fonts/inter/Inter-Regular.ttf' with { type: 'file' }\n",
    })
    try {
      const rule = PACKAGE_RULES.find((entry) => entry.name === '@hemera/desktop')!
      expect(analyzePackage(root, rule)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a path the exports do not declare is still refused', () => {
    const root = fixture({
      'packages/ui/package.json': JSON.stringify({
        name: '@hemera/ui',
        exports: { '.': './src/index.ts', './fonts/*': './src/fonts/*' },
      }),
      'apps/desktop/package.json': JSON.stringify({ name: '@hemera/desktop' }),
      'apps/desktop/src/reach.ts': "import { dark } from '@hemera/ui/src/theme/dark.ts'\n",
    })
    try {
      const rule = PACKAGE_RULES.find((entry) => entry.name === '@hemera/desktop')!
      expect(analyzePackage(root, rule)[0]?.problem).toContain('private src')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
