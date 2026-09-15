#!/usr/bin/env bun
/**
 * Keeps the business suite runnable without a graphical session and without a credential.
 *
 * The root `test` command is what a machine with no GPU, no window server and no provider key
 * runs. A test that opens a window, reaches a provider or migrates the profile the user works
 * in does not belong to it: it belongs to `test:system`, which is run where those things exist.
 *
 * What a test names is not the whole story. `@gpuix/react` loads its native addon when the
 * module is evaluated, so a test that imports a barrel which re-exports a component brings the
 * renderer in without ever naming it — and dies at load on a machine that has no addon for its
 * target. The chain is therefore followed through the workspace sources, not just read on the
 * surface of the test file.
 *
 *   bun tools/business-suite.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/** Packages whose `tests` folder the root command runs. */
const PACKAGES = ['apps/desktop', 'packages/core', 'packages/runtime', 'packages/ui']

/** What a business test may never name. */
const FORBIDDEN = [
  { pattern: 'createTestRoot', reason: 'it would open a window' },
  { pattern: 'captureScreenshot', reason: 'it would need a GPU' },
  { pattern: 'api.anthropic.com', reason: 'it would call a provider' },
  { pattern: 'api.openai.com', reason: 'it would call a provider' },
  { pattern: 'ANTHROPIC_API_KEY', reason: 'it would need a credential' },
]

/** What a business test may never reach, however many modules away. */
const UNREACHABLE = [
  {
    specifier: /^@gpuix\//,
    reason: 'the renderer loads its native addon as soon as the module is evaluated',
  },
]

export interface SuiteViolation {
  file: string
  problem: string
}

function filesUnder(folder: string): string[] {
  if (!existsSync(folder)) return []
  return readdirSync(folder).flatMap((entry) => {
    const path = join(folder, entry)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

/** The command a package answers `test` with. */
function testScriptOf(repositoryRoot: string, workspace: string): string {
  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, workspace, 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> }
  return manifest.scripts?.test ?? ''
}

/**
 * The source of a module, without the imports that are erased before it runs.
 *
 * A type-only import loads nothing, so it never brings the renderer in.
 */
function evaluatedSource(path: string): string {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => {
      const start = line.trimStart()
      return !start.startsWith('import type') && !start.startsWith('export type')
    })
    .join('\n')
}

const FROM_IMPORT = /(?:^|[\s;}])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g
const BARE_IMPORT = /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g

/** Every module a source evaluates at load time. */
export function loadedSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  for (const pattern of [FROM_IMPORT, BARE_IMPORT]) {
    pattern.lastIndex = 0
    let match = pattern.exec(source)
    while (match !== null) {
      specifiers.push(match[1]!)
      match = pattern.exec(source)
    }
  }
  return specifiers
}

/** Where a workspace package points a subpath of its `exports`. */
function exportsOf(repositoryRoot: string, name: string): Record<string, string> | null {
  const workspace = PACKAGES.find((candidate) => {
    const manifest = join(repositoryRoot, candidate, 'package.json')
    if (!existsSync(manifest)) return false
    return (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name === name
  })
  if (workspace === undefined) return null
  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, workspace, 'package.json'), 'utf8'),
  ) as { exports?: Record<string, string> }
  const resolved: Record<string, string> = {}
  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    resolved[subpath] = join(repositoryRoot, workspace, target)
  }
  return resolved
}

/**
 * The file a specifier loads, or null when it leaves the workspace.
 *
 * Only what this repository owns is followed: an external package is judged on its name.
 */
function fileOf(repositoryRoot: string, from: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    const target = resolve(dirname(from), specifier)
    return existsSync(target) ? target : null
  }

  const match = /^(@hemera\/[a-z-]+)(\/.*)?$/.exec(specifier)
  if (match === null) return null
  const map = exportsOf(repositoryRoot, match[1]!)
  if (map === null) return null

  const subpath = match[2] === undefined ? '.' : `.${match[2]}`
  const exact = map[subpath]
  if (exact !== undefined) return existsSync(exact) ? exact : null

  // A pattern such as `./fonts/*` points at a folder of files.
  for (const [declared, target] of Object.entries(map)) {
    if (!declared.includes('*')) continue
    const [before, after] = declared.split('*') as [string, string]
    if (!subpath.startsWith(before) || !subpath.endsWith(after)) continue
    const rest = subpath.slice(before.length, subpath.length - after.length)
    const file = target.replace('*', rest)
    return existsSync(file) ? file : null
  }
  return null
}

/** The chain of modules from a test to what it must not reach, or null when there is none. */
export function chainToUnreachable(
  repositoryRoot: string,
  entry: string,
): { chain: string[]; specifier: string; reason: string } | null {
  const seen = new Set<string>()
  const queue: { path: string; chain: string[] }[] = [{ path: entry, chain: [entry] }]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (seen.has(current.path)) continue
    seen.add(current.path)

    for (const specifier of loadedSpecifiers(evaluatedSource(current.path))) {
      const forbidden = UNREACHABLE.find((rule) => rule.specifier.test(specifier))
      if (forbidden !== undefined) {
        return {
          chain: current.chain.map((path) => relative(repositoryRoot, path).replaceAll('\\', '/')),
          specifier,
          reason: forbidden.reason,
        }
      }
      const next = fileOf(repositoryRoot, current.path, specifier)
      if (next !== null) queue.push({ path: next, chain: [...current.chain, next] })
    }
  }
  return null
}

export function suiteViolations(repositoryRoot: string): SuiteViolation[] {
  const violations: SuiteViolation[] = []

  for (const workspace of PACKAGES) {
    const script = testScriptOf(repositoryRoot, workspace)
    // A bare folder name is a substring filter: `tests` also matches `system-tests`.
    if (!script.includes('./tests')) {
      violations.push({
        file: join(workspace, 'package.json'),
        problem: `its test command is "${script}", which does not name ./tests as a path`,
      })
    }

    for (const path of filesUnder(join(repositoryRoot, workspace, 'tests'))) {
      if (!path.endsWith('.ts') && !path.endsWith('.tsx')) continue
      const file = relative(repositoryRoot, path).replaceAll('\\', '/')
      const source = evaluatedSource(path)

      for (const { pattern, reason } of FORBIDDEN) {
        if (source.includes(pattern)) {
          violations.push({ file, problem: `it names ${pattern}: ${reason}` })
        }
      }

      const reached = chainToUnreachable(repositoryRoot, path)
      if (reached !== null) {
        const through =
          reached.chain.length > 1 ? ` through ${reached.chain.slice(1).join(' -> ')}` : ''
        violations.push({
          file,
          problem: `it loads ${reached.specifier}${through}: ${reached.reason}`,
        })
      }

      // A test that opens a profile opens a temporary one, never the profile of the user.
      if (source.includes('openProfile(') && !source.includes('mkdtempSync')) {
        violations.push({
          file,
          problem: 'it opens a profile without creating a temporary directory for it',
        })
      }
    }
  }

  return violations
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, '..')
  const violations = suiteViolations(repositoryRoot)
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.file}: ${violation.problem}`)
    }
    console.error(`\n${violations.length} test(s) keep the business suite off a headless machine`)
    process.exit(1)
  }
  console.log('the business suite needs no GPU, no window and no credential')
}
