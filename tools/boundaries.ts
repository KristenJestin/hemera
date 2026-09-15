#!/usr/bin/env node
/**
 * Checks the dependency boundaries of the monorepo (design D0-02): who may import what,
 * that no import reaches into another package's private `src`, and that no cycle exists.
 *
 *   node tools/boundaries.ts
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

const NO_ELECTRON = [{ pattern: /^electron(\/|$)/, reason: 'Electron' }]

const NO_RENDERER = [{ pattern: /^react(-dom)?(\/|$)/, reason: 'the React renderer' }]

export const PACKAGE_RULES: PackageRule[] = [
  {
    name: '@hemera/core',
    directory: 'packages/core',
    forbidden: [
      ...NO_PLATFORM,
      ...NO_ELECTRON,
      ...NO_RENDERER,
      {
        pattern: /^@hemera\/(ipc|desktop)(\/|$)/,
        reason: 'a package core must not depend on',
      },
    ],
  },
  {
    // The channel declaration is read by the main process and by the renderer alike: it
    // carries names and schemas, never an implementation, so it imports neither side.
    name: '@hemera/ipc',
    directory: 'packages/ipc',
    forbidden: [
      ...NO_PLATFORM,
      ...NO_ELECTRON,
      ...NO_RENDERER,
      {
        pattern: /^@hemera\/(core|desktop)(\/|$)/,
        reason: 'a package the channel declaration must not depend on',
      },
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

/**
 * Whether a specifier is a subpath a package declares in its `exports`.
 *
 * A declared subpath is a public surface, not a reach into a private `src`. A subpath pattern
 * covers every specifier it matches, exactly as the resolver reads it.
 */
function declaredSubpaths(repositoryRoot: string): (specifier: string) => boolean {
  const exact = new Set<string>()
  const patterns: RegExp[] = []
  for (const rule of PACKAGE_RULES) {
    const manifestPath = resolve(repositoryRoot, rule.directory, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      exports?: Record<string, string>
    }
    for (const subpath of Object.keys(manifest.exports ?? {})) {
      if (subpath === '.') continue
      const declared = `${rule.name}${subpath.slice(1)}`
      if (declared.includes('*')) {
        patterns.push(new RegExp(`^${declared.split('*').map(quoted).join('.+')}$`))
        continue
      }
      exact.add(declared)
    }
  }
  return (specifier) => exact.has(specifier) || patterns.some((pattern) => pattern.test(specifier))
}

/** A literal part of a subpath pattern, read as itself and not as a pattern. */
function quoted(part: string): string {
  return part.replaceAll(/[.*+?^${}()|[\]\\]/g, (match) => `\\${match}`)
}

export function analyzePackage(repositoryRoot: string, rule: PackageRule): Violation[] {
  const violations: Violation[] = []
  const packageRoot = resolve(repositoryRoot, rule.directory)
  const declared = declaredSubpaths(repositoryRoot)
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
      if (DEEP_HEMERA_IMPORT.test(specifier) && !declared(specifier)) {
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
  const repositoryRoot = resolve(import.meta.dirname, '..')
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
