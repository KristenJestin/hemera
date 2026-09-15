import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { FIRST_RANK, projectName, rankBetween } from '#index.ts'

import { PACKAGE_RULES, analyzePackage } from '../../../tools/boundaries.ts'

const core = resolve(import.meta.dirname, '..')
const repository = resolve(core, '..', '..')

describe("Cœur importé hors d'Electron", () => {
  test('the public surface answers in a plain Node process', () => {
    expect(projectName('Hemera')).toBe('Hemera')
    expect(rankBetween(null, null)).toBe(FIRST_RANK)
  })

  test.each(['electron', 'better-sqlite3', 'drizzle-orm'])(
    '%p does not resolve from the core package',
    (module) => {
      // Asked of a plain Node process rather than of the test runner: a bundler resolves
      // modules its own way, and what matters is what the core is installed beside. NODE_PATH
      // goes with it — the package manager points it at its own store while it runs a script,
      // and a machine starting the application has no such thing.
      const { NODE_PATH: _store, ...environment } = process.env
      const result = spawnSync(process.execPath, ['-e', `require.resolve('${module}')`], {
        cwd: core,
        encoding: 'utf8',
        env: environment,
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(`Cannot find module '${module}'`)
    },
  )

  test('the static analysis finds no platform, renderer or storage import in the core', () => {
    const rule = PACKAGE_RULES.find((entry) => entry.name === '@hemera/core')!
    expect(analyzePackage(repository, rule)).toEqual([])
  })

  test('the production configuration of the core declares no ambient platform type', () => {
    // The tests read the file system through the tooling, so their configuration names the
    // Node types; what ships is compiled without them and would not survive a `process`.
    // SAFETY: the core's own tsconfig, read for the two fields the test asserts on.
    const production = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '..', 'tsconfig.json'), 'utf8'),
    ) as { compilerOptions: { types: string[] }; include: string[] }
    expect(production.compilerOptions.types).toEqual([])
    expect(production.include).toEqual(['src/**/*.ts'])
  })
})
