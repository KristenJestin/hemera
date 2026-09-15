import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { suiteViolations } from './business-suite.ts'

const repository = resolve(import.meta.dir, '..')

/** A repository holding one package, with the files a case needs. */
function fixture(script: string, tests: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'hemera-suite-'))
  const workspace = join(root, 'packages', 'runtime')
  mkdirSync(join(workspace, 'tests'), { recursive: true })
  writeFileSync(
    join(workspace, 'package.json'),
    JSON.stringify({ name: '@hemera/runtime', scripts: { test: script } }),
  )
  for (const [name, content] of Object.entries(tests)) {
    writeFileSync(join(workspace, 'tests', name), content)
  }
  // The other packages of the rule still have to exist.
  for (const other of ['apps/desktop', 'packages/core', 'packages/ui']) {
    mkdirSync(join(root, other), { recursive: true })
    writeFileSync(
      join(root, other, 'package.json'),
      JSON.stringify({ name: other, scripts: { test: 'bun test ./tests' } }),
    )
  }
  return root
}

describe('Vérification du socle sans fenêtre', () => {
  test('the business suite of this repository needs no GPU, no window and no credential', () => {
    expect(suiteViolations(repository)).toEqual([])
  })

  test('a business test that opens a window is refused', () => {
    const root = fixture('bun test ./tests', {
      'paint.test.ts': "import { createTestRoot } from '@gpuix/react/testing'\n",
    })
    try {
      const problems = suiteViolations(root).map((violation) => violation.problem)
      expect(problems.some((problem) => problem.includes('@gpuix/react'))).toBe(true)
      expect(problems.some((problem) => problem.includes('createTestRoot'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a business test that opens a profile of its own choosing is refused', () => {
    const root = fixture('bun test ./tests', {
      'store.test.ts': "import { homedir } from 'node:os'\nopenProfile({ directory: homedir() })\n",
    })
    try {
      expect(suiteViolations(root)[0]?.problem).toContain('temporary directory')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a test command that also matches the system tests is refused', () => {
    const root = fixture('bun test tests', {})
    try {
      expect(suiteViolations(root)[0]?.problem).toContain('does not name ./tests as a path')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a type-only import of the renderer is not a dependency on it', () => {
    const root = fixture('bun test ./tests', {
      'types.test.ts': "import type { EventPayload } from '@gpuix/react'\n",
    })
    try {
      expect(suiteViolations(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
