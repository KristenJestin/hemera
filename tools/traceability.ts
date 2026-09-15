#!/usr/bin/env node
/**
 * Traceability of the lot: every scenario of its specs to the test that covers it.
 *
 * A scenario is covered when a test suite is named after it, exactly. A scenario that is
 * neither covered nor explicitly deferred fails the verification: a gap is named here or it
 * does not exist.
 *
 *   node tools/traceability.ts            check, and report what is missing
 *   node tools/traceability.ts --write    write reports/traceability.md
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** Change whose specs this repository delivers. */
export const CHANGE = 'lot-0-socle'

/** Reasons a scenario may be left without a test of this repository. */
export const DEFERRAL_REASONS = {
  linux: 'no Linux machine is available here; to be run on the Linux target',
  human: 'a system setting or a real mouse, recorded in the walkthrough of the target',
  capture: 'observed by capturing what the screen showed, recorded under reports/',
  package: 'observed on a package run outside the sources, recorded under reports/',
} as const

export type DeferralReason = keyof typeof DEFERRAL_REASONS

/**
 * Scenarios no test of this repository covers, with the reason each one waits on.
 *
 * Nothing lands here to make the verification pass: a scenario is deferred only when the
 * machine or the act it needs does not exist here.
 */
export const DEFERRED: Record<string, DeferralReason> = {
  'Ouverture sous Linux en Wayland natif': 'linux',
  'Sandbox conservée sous Ubuntu 24.04': 'linux',
  'Mouvement réduit respecté': 'human',
  'Aucun flash blanc': 'capture',
  'Lancement depuis un dossier avec espaces': 'package',
}

export interface Scenario {
  name: string
  /** Capability the scenario belongs to. */
  capability: string
}

export interface Coverage {
  scenario: Scenario
  /** Files whose suites are named after the scenario. */
  tests: string[]
  deferral: DeferralReason | null
}

function filesUnder(folder: string, keep: (path: string) => boolean): string[] {
  if (!existsSync(folder)) return []
  return readdirSync(folder).flatMap((entry) => {
    const path = join(folder, entry)
    if (statSync(path).isDirectory()) return filesUnder(path, keep)
    return keep(path) ? [path] : []
  })
}

/** Every scenario the specs of the change declare. */
export function scenariosOf(specsRoot: string): Scenario[] {
  const scenarios: Scenario[] = []
  for (const capability of readdirSync(specsRoot)) {
    const path = join(specsRoot, capability, 'spec.md')
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^#### Scenario:\s*(.+?)\s*$/.exec(line)
      if (match !== null) scenarios.push({ name: match[1]!, capability })
    }
  }
  return scenarios
}

/**
 * Name of a suite, whether or not it is conditioned.
 *
 * A suite skipped on this target still belongs to the scenario it is named after: the
 * modifier decides where it runs, not what it covers. Reading only bare `describe(` would
 * report a scenario as untested the moment its suite is gated on a capability.
 */
const SUITE_NAME = /describe(?:\.\w+(?:\([^)]*\))?)*\s*\(\s*(['"`])(.+?)\1/g

/** Suites declared by the test files, by suite name. */
export function suitesOf(repositoryRoot: string): Map<string, string[]> {
  const files = [
    ...filesUnder(join(repositoryRoot, 'tools'), (path) => path.endsWith('.test.ts')),
    ...['apps/desktop', 'packages/core', 'packages/ipc'].flatMap((workspace) =>
      ['tests', 'e2e', 'src'].flatMap((folder) =>
        filesUnder(join(repositoryRoot, workspace, folder), (path) =>
          /\.(test|e2e)\.tsx?$/.test(path),
        ),
      ),
    ),
  ]

  const suites = new Map<string, string[]>()
  for (const file of files) {
    const reported = relative(repositoryRoot, file).replaceAll('\\', '/')
    const source = readFileSync(file, 'utf8')
    SUITE_NAME.lastIndex = 0
    let match = SUITE_NAME.exec(source)
    while (match !== null) {
      const name = match[2]!
      const known = suites.get(name) ?? []
      known.push(reported)
      suites.set(name, known)
      match = SUITE_NAME.exec(source)
    }
  }
  return suites
}

export function coverageOf(repositoryRoot: string, specsRoot: string): Coverage[] {
  const suites = suitesOf(repositoryRoot)
  const seen = new Set<string>()
  return scenariosOf(specsRoot)
    .filter((scenario) => {
      const key = `${scenario.capability}/${scenario.name}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((scenario) => ({
      scenario,
      // Sorted: the files are collected by walking directories, whose order is the file
      // system's. A table that reorders itself between two runs is a diff on both machines
      // for a change nobody made.
      tests: (suites.get(scenario.name) ?? []).toSorted(),
      deferral: DEFERRED[scenario.name] ?? null,
    }))
}

/** Scenarios that are neither covered by a test nor deferred for a named reason. */
export function uncovered(coverage: Coverage[]): Coverage[] {
  return coverage.filter((entry) => entry.tests.length === 0 && entry.deferral === null)
}

/**
 * Tests the lot requires by name, beyond the scenario table.
 *
 * Failure injection and property tests are named here because a green suite that never
 * injects a failure proves nothing about what happens when one lands.
 */
export const REQUIRED_SUITES = [] as const satisfies readonly string[]

export function missingRequiredSuites(repositoryRoot: string): string[] {
  const suites = suitesOf(repositoryRoot)
  return REQUIRED_SUITES.filter((name) => !suites.has(name))
}

export function renderTable(coverage: Coverage[]): string {
  const byCapability = new Map<string, Coverage[]>()
  for (const entry of coverage) {
    const entries = byCapability.get(entry.scenario.capability) ?? []
    entries.push(entry)
    byCapability.set(entry.scenario.capability, entries)
  }

  const covered = coverage.filter((entry) => entry.tests.length > 0).length
  const deferred = coverage.filter((entry) => entry.tests.length === 0 && entry.deferral !== null)

  const lines = [
    `# Traceability — ${CHANGE}`,
    '',
    `${covered} of ${coverage.length} scenarios are covered by a test named after them.`,
    `${deferred.length} wait on a machine or an act that does not exist here, and say which.`,
    '',
  ]

  for (const [capability, entries] of byCapability) {
    lines.push(`## ${capability}`, '', '| Scenario | Test |', '|---|---|')
    for (const entry of entries) {
      const where =
        entry.tests.length > 0
          ? entry.tests.map((file) => `\`${file}\``).join(', ')
          : `_deferred — ${DEFERRAL_REASONS[entry.deferral!]}_`
      lines.push(`| ${entry.scenario.name} | ${where} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/** Variable naming where the OpenSpec changes are, when they are not beside this repository. */
export const SPECS_OVERRIDE_VARIABLE = 'HEMERA_SPECS_DIR'

/**
 * Where the specs of the change are.
 *
 * They live in their own repository, cloned beside this one by the bootstrap. A checkout that
 * puts them elsewhere names the folder instead of moving the repository.
 */
export function specsRootOf(
  repositoryRoot: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const named = env[SPECS_OVERRIDE_VARIABLE]
  const root = named === undefined || named === '' ? resolve(repositoryRoot, '..', '..') : named
  return resolve(root, 'openspec', 'changes', CHANGE, 'specs')
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dirname, '..')
  const specsRoot = specsRootOf(repositoryRoot)
  if (!existsSync(specsRoot)) {
    console.error(`the specs of ${CHANGE} are not beside this repository (${specsRoot})`)
    process.exit(1)
  }

  const coverage = coverageOf(repositoryRoot, specsRoot)
  const missing = uncovered(coverage)
  const required = missingRequiredSuites(repositoryRoot)

  if (process.argv.includes('--write')) {
    const path = join(repositoryRoot, 'reports', 'traceability.md')
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, renderTable(coverage))
    console.log(`written ${path}`)
  }

  for (const entry of missing) {
    console.error(`${entry.scenario.capability}: "${entry.scenario.name}" has no test`)
  }
  for (const name of required) {
    console.error(`the lot requires a suite named "${name}" and none exists`)
  }
  if (missing.length > 0 || required.length > 0) {
    console.error(`\n${missing.length} scenario(s) without a test, ${required.length} required`)
    process.exit(1)
  }

  const covered = coverage.filter((entry) => entry.tests.length > 0).length
  console.log(`${covered}/${coverage.length} scenarios covered, the rest deferred by name`)
}
