import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { FIRST_RANK, projectName, rankBetween } from '#index.ts'

import { PACKAGE_RULES, analyzePackage } from '../../../tools/boundaries.ts'

const repository = resolve(import.meta.dirname, '..', '..', '..')
const require = createRequire(import.meta.url)

describe("Cœur importé hors d'Electron", () => {
  test('the public surface answers in a plain Node process', () => {
    expect(projectName('Hemera')).toBe('Hemera')
    expect(rankBetween(null, null)).toBe(FIRST_RANK)
  })

  test.each(['electron', 'better-sqlite3', 'drizzle-orm'])(
    '%p does not resolve from the core package',
    (module) => {
      // The core is installed without them, so a file that reached for one would fail at
      // import time here rather than at the first start on a user's machine.
      expect(() => require.resolve(module)).toThrow()
    },
  )

  test('the static analysis finds no platform, renderer or storage import in the core', () => {
    const rule = PACKAGE_RULES.find((entry) => entry.name === '@hemera/core')!
    expect(analyzePackage(repository, rule)).toEqual([])
  })

  test('the production configuration of the core declares no ambient platform type', () => {
    // The tests read the file system through the tooling, so their configuration names the
    // Node types; what ships is compiled without them and would not survive a `process`.
    const production = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '..', 'tsconfig.json'), 'utf8'),
    ) as { compilerOptions: { types: string[] }; include: string[] }
    expect(production.compilerOptions.types).toEqual([])
    expect(production.include).toEqual(['src/**/*.ts'])
  })
})
