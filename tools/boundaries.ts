#!/usr/bin/env bun
/**
 * Checks the dependency boundaries of the monorepo (design D03): who may import what,
 * that no import reaches into another package's private `src`, and that no cycle exists.
 *
 *   bun tools/boundaries.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export interface PackageRule {
  /** Package name as declared in its manifest. */
  name: string
  /** Path of the package relative to the repository root. */
  directory: string
  /** Bare specifiers this package must never import, with the reason to report. */
  forbidden: { pattern: RegExp; reason: string }[]
}

const NO_PLATFORM = [
  { pattern: /^bun:/, reason: 'a Bun built-in module' },
  {
    pattern: /^node:(fs|child_process|process|net|http|https|worker_threads)/,
    reason: 'a file, process or network API',
  },
  {
    pattern: /^(drizzle-orm|drizzle-kit|better-sqlite3)(\/|$)/,
    reason: 'the SQLite storage layer',
  },
]

const NO_RENDERER = [
  { pattern: /^react(-dom|-reconciler)?(\/|$)/, reason: 'the React renderer' },
  { pattern: /^@gpuix\//, reason: 'the GPUiX renderer' },
]

export const PACKAGE_RULES: PackageRule[] = [
  {
    name: '@hemera/core',
    directory: 'packages/core',
    forbidden: [
      ...NO_PLATFORM,
      ...NO_RENDERER,
      {
        pattern: /^@hemera\/(runtime|ui|desktop)(\/|$)/,
        reason: 'a package core must not depend on',
      },
    ],
  },
  {
    name: '@hemera/runtime',
    directory: 'packages/runtime',
    forbidden: [
      ...NO_RENDERER,
      { pattern: /^@hemera\/(ui|desktop)(\/|$)/, reason: 'a package runtime must not depend on' },
    ],
  },
  {
    name: '@hemera/ui',
    directory: 'packages/ui',
    forbidden: [
      ...NO_PLATFORM,
      { pattern: /^@hemera\//, reason: 'an Hemera package the design system must stay free of' },
    ],
  },
  {
    name: '@hemera/desktop',
    directory: 'apps/desktop',
    forbidden: [],
  },
]

export interface Violation {
  file: string
  specifier: string
  problem: string
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx']

function sourceFilesOf(directory: string): string[] {
  if (!existsSync(directory)) return []
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      found.push(...sourceFilesOf(path))
    } else if (
      SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension)) &&
      // Tests sit beside the component they cover and never ship; they may use the runner.
      !/.test.tsx?$/.test(entry)
    ) {
      found.push(path)
    }
  }
  return found
}

const STATIC_IMPORT = /(?:^|[\s;}])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g
const BARE_IMPORT = /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

/** Every module specifier a source file imports, static or dynamic. */
export function specifiersOf(source: string): string[] {
  const specifiers: string[] = []
  for (const pattern of [STATIC_IMPORT, BARE_IMPORT, DYNAMIC_IMPORT]) {
    pattern.lastIndex = 0
    let match = pattern.exec(source)
    while (match !== null) {
      specifiers.push(match[1]!)
      match = pattern.exec(source)
    }
  }
  return specifiers
}

/** Matches an import that reaches past a package's public export, such as `@hemera/ui/src/x`. */
const DEEP_HEMERA_IMPORT = /^@hemera\/[a-z-]+\/.+/

export function analyzePackage(repositoryRoot: string, rule: PackageRule): Violation[] {
  const violations: Violation[] = []
  const packageRoot = resolve(repositoryRoot, rule.directory)
  for (const file of sourceFilesOf(join(packageRoot, 'src'))) {
    const source = readFileSync(file, 'utf8')
    const reported = relative(repositoryRoot, file).replaceAll('\\', '/')
    for (const specifier of specifiersOf(source)) {
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier)
        if (relative(packageRoot, target).startsWith('..')) {
          violations.push({
            file: reported,
            specifier,
            problem: `reaches outside ${rule.name} through a relative path`,
          })
        }
        continue
      }
      if (DEEP_HEMERA_IMPORT.test(specifier)) {
        violations.push({
          file: reported,
          specifier,
          problem: 'reaches into the private src of another package instead of its exports',
        })
        continue
      }
      const forbidden = rule.forbidden.find((entry) => entry.pattern.test(specifier))
      if (forbidden !== undefined) {
        violations.push({
          file: reported,
          specifier,
          problem: `${rule.name} must not import ${forbidden.reason}`,
        })
      }
    }
  }
  return violations
}

/** Package-level import graph, keyed by package name. */
export function packageGraph(repositoryRoot: string): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()
  for (const rule of PACKAGE_RULES) {
    const edges = new Set<string>()
    const packageRoot = resolve(repositoryRoot, rule.directory)
    for (const file of sourceFilesOf(join(packageRoot, 'src'))) {
      for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
        const match = /^(@hemera\/[a-z-]+)/.exec(specifier)
        if (match !== null && match[1] !== rule.name) edges.add(match[1]!)
      }
    }
    graph.set(rule.name, edges)
  }
  return graph
}

/** Names forming an import cycle, empty when the graph is acyclic. */
export function cyclesOf(graph: Map<string, Set<string>>): string[][] {
  const cycles: string[][] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const walk = (node: string, path: string[]): void => {
    if (visiting.has(node)) {
      cycles.push([...path.slice(path.indexOf(node)), node])
      return
    }
    if (visited.has(node)) return
    visiting.add(node)
    for (const next of graph.get(node) ?? []) walk(next, [...path, node])
    visiting.delete(node)
    visited.add(node)
  }

  for (const node of graph.keys()) walk(node, [])
  return cycles
}

export function analyze(repositoryRoot: string): Violation[] {
  const violations = PACKAGE_RULES.flatMap((rule) => analyzePackage(repositoryRoot, rule))
  for (const cycle of cyclesOf(packageGraph(repositoryRoot))) {
    violations.push({
      file: cycle[0]!,
      specifier: cycle.join(' -> '),
      problem: 'forms an import cycle between packages',
    })
  }
  return violations
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, '..')
  const violations = analyze(repositoryRoot)
  for (const violation of violations) {
    console.error(`${violation.file}: "${violation.specifier}" ${violation.problem}`)
  }
  console.log(
    violations.length === 0
      ? 'package boundaries respected'
      : `${violations.length} boundary violations`,
  )
  if (violations.length > 0) process.exit(1)
}
