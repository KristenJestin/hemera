import { describe, expect, test } from 'vite-plus/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  CHANGE,
  DEFERRAL_REASONS,
  DEFERRED,
  REQUIRED_SUITES,
  coverageOf,
  missingRequiredSuites,
  renderTable,
  scenariosOf,
  SPECS_OVERRIDE_VARIABLE,
  specsRootOf,
  suitesOf,
  uncovered,
} from './traceability.ts'

const repository = resolve(import.meta.dirname, '..')
const specs = specsRootOf(repository)

/** A change holding one capability with the scenarios given, and one test file. */
function fixture(scenarios: string[], suites: string[]): { specs: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'hemera-traceability-'))
  const capability = join(root, 'specs', 'sessions')
  mkdirSync(capability, { recursive: true })
  writeFileSync(
    join(capability, 'spec.md'),
    scenarios.map((name) => `#### Scenario: ${name}\n`).join('\n'),
  )
  mkdirSync(join(root, 'tools'), { recursive: true })
  writeFileSync(
    join(root, 'tools', 'covered.test.ts'),
    suites.map((name) => `describe('${name}', () => {})\n`).join(''),
  )
  return { specs: join(root, 'specs'), root }
}

describe('Table de traçabilité', () => {
  test('every scenario of the lot is covered by a test named after it, or deferred by name', () => {
    const coverage = coverageOf(repository, specs)
    expect(coverage.length).toBeGreaterThan(100)
    expect(uncovered(coverage)).toEqual([])

    for (const reason of Object.values(DEFERRED)) {
      expect(Object.keys(DEFERRAL_REASONS)).toContain(reason)
    }
  })

  test('a scenario without a test fails the verification', () => {
    const { specs: specsRoot, root } = fixture(
      ['Travaux parallèles', 'Jamais couvert'],
      ['Travaux parallèles'],
    )
    try {
      const coverage = coverageOf(root, specsRoot)
      const missing = uncovered(coverage)
      expect(missing).toHaveLength(1)
      expect(missing[0]!.scenario.name).toBe('Jamais couvert')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the table names the test file of each scenario', () => {
    const { specs: specsRoot, root } = fixture(['Travaux parallèles'], ['Travaux parallèles'])
    try {
      const table = renderTable(coverageOf(root, specsRoot))
      expect(table).toContain(`# Traceability — ${CHANGE}`)
      expect(table).toContain('Travaux parallèles')
      expect(table).toContain('tools/covered.test.ts')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the written table is the one this repository stands behind', () => {
    const path = join(repository, 'reports', 'traceability.md')
    expect(existsSync(path)).toBe(true)

    const written = readFileSync(path, 'utf8')
    const scenarios = scenariosOf(specs)
    expect(written).toContain(`# Traceability — ${CHANGE}`)
    for (const scenario of scenarios.slice(0, 20)) {
      expect(written).toContain(scenario.name)
    }
  })
})

describe('Suite conditionnée à une capacité', () => {
  test('a suite is found by its name whether or not it carries a modifier', () => {
    const root = mkdtempSync(join(tmpdir(), 'hemera-traceability-'))
    mkdirSync(join(root, 'tools'), { recursive: true })
    // The modifier decides where a suite runs, never what it covers. A pattern that reads
    // `describe(` alone drops every suite the moment one is gated on a capability, and the
    // table then reports covered scenarios as untested without anything failing.
    writeFileSync(
      join(root, 'tools', 'covered.test.ts'),
      [
        "describe('Suite nue', () => {})",
        "describe.skipIf(!PAINTS)('Suite conditionnée', () => {})",
        "describe.skip('Suite désactivée', () => {})",
        "describe.each([1, 2])('Suite répétée', () => {})",
        '',
      ].join('\n'),
    )
    try {
      const suites = suitesOf(root)
      for (const name of ['Suite nue', 'Suite conditionnée', 'Suite désactivée', 'Suite répétée']) {
        expect(suites.has(name)).toBe(true)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("Tests d'injection d'échec et de propriétés", () => {
  test('the suites the lot requires by name all exist and are named as required', () => {
    expect(missingRequiredSuites(repository)).toEqual([])

    const suites = suitesOf(repository)
    for (const name of REQUIRED_SUITES) {
      expect(suites.get(name)?.length ?? 0).toBeGreaterThan(0)
    }
  })

  test('a repository missing a required suite is reported by name', () => {
    const { root } = fixture(['Travaux parallèles'], ['Travaux parallèles'])
    try {
      expect(missingRequiredSuites(root)).toEqual([...REQUIRED_SUITES])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Specs à côté du dépôt', () => {
  test('the specs are read beside the repository when nothing names them', () => {
    expect(specsRootOf(repository, {})).toBe(specs)
    expect(specsRootOf(repository, { [SPECS_OVERRIDE_VARIABLE]: '' })).toBe(specs)
  })

  test('a checkout that keeps them elsewhere names the folder instead of moving anything', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'hemera-specs-'))
    try {
      expect(specsRootOf(repository, { [SPECS_OVERRIDE_VARIABLE]: elsewhere })).toBe(
        join(elsewhere, 'openspec', 'changes', CHANGE, 'specs'),
      )
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })
})

describe('Table stable entre deux exécutions', () => {
  test('a scenario covered twice lists its files in a fixed order', () => {
    const { specs: specsRoot, root } = fixture(['Deux fois couvert'], [])
    try {
      // Two files cover it; on disk they are found in whatever order the walk returns.
      mkdirSync(join(root, 'packages', 'core', 'tests'), { recursive: true })
      writeFileSync(
        join(root, 'tools', 'zebra.test.ts'),
        "describe('Deux fois couvert', () => {})\n",
      )
      writeFileSync(
        join(root, 'packages', 'core', 'tests', 'alpha.test.ts'),
        "describe('Deux fois couvert', () => {})\n",
      )
      writeFileSync(
        join(root, 'packages', 'core', 'package.json'),
        JSON.stringify({ name: '@hemera/core', scripts: { typecheck: 'tsc -p tsconfig.json' } }),
      )

      const covered = coverageOf(root, specsRoot)[0]!
      expect(covered.tests).toEqual([...covered.tests].toSorted())
      expect(covered.tests).toHaveLength(2)
      expect(renderTable(coverageOf(root, specsRoot))).toBe(
        renderTable(coverageOf(root, specsRoot)),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
