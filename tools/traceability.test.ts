import { describe, expect, test } from 'bun:test'
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
  specsRootOf,
  suitesOf,
  uncovered,
} from './traceability.ts'

const repository = resolve(import.meta.dir, '..')
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
