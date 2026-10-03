#!/usr/bin/env node
/**
 * Checks that the shared packages stay free of Electron and of React, and that the storage layer
 * stays in the engine.
 *
 * A package under `packages/` is read by every process: the renderer, main, the engine and the
 * agents' processes. One that imports Electron cannot be loaded by a page, and one that imports
 * React drags the interface into a process that has none. The applications import them; never
 * the other way round.
 *
 * The database is the engine's alone: a second program holding the same file is how a data folder
 * gets two writers. So `node:sqlite`, Drizzle and the Effect SQLite client are imported under
 * `apps/desktop/src/engine/` and nowhere else.
 *
 *   node tools/boundaries.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** What a shared package must never import, and why. */
export const FORBIDDEN = [
  {
    pattern: /^electron(\/|$)/,
    reason: 'Electron, which only main and its utility processes have',
  },
  { pattern: /^react(-dom)?(\/|$)/, reason: 'React, which only the renderer has' },
] as const

/** The one folder the storage layer may be imported from. */
export const ENGINE = 'apps/desktop/src/engine/'

const STORAGE = /^(node:sqlite|drizzle-orm|drizzle-kit|@effect\/sql-sqlite-node)(\/|$)/

export interface Refusal {
  file: string
  found: string
  problem: string
}

const SPECIFIERS = [
  /\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

/** Every module a source file names, in the order it names them. */
export function importsOf(source: string): string[] {
  const found: Array<{ at: number; specifier: string }> = []
  for (const pattern of SPECIFIERS) {
    for (const match of source.matchAll(pattern)) {
      found.push({ at: match.index, specifier: match[1]! })
    }
  }
  return found.toSorted((left, right) => left.at - right.at).map(({ specifier }) => specifier)
}

export function refusalsOf(file: string, source: string): Refusal[] {
  return importsOf(source).flatMap((specifier) =>
    FORBIDDEN.filter(({ pattern }) => pattern.test(specifier)).map(({ reason }) => ({
      file,
      found: specifier,
      problem: `a shared package imports ${reason}`,
    })),
  )
}

/** What a file outside the engine imports of the storage layer. */
export function storageRefusalsOf(file: string, source: string): Refusal[] {
  if (file.startsWith(ENGINE)) return []
  return importsOf(source)
    .filter((specifier) => STORAGE.test(specifier))
    .map((specifier) => ({
      file,
      found: specifier,
      problem: `the storage layer is imported outside ${ENGINE}`,
    }))
}

function sourceFilesOf(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap((entry) => {
    if (entry === 'node_modules') return []
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFilesOf(path)
    return /\.[cm]?tsx?$/.test(entry) ? [path] : []
  })
}

/** The source folders of the applications, each `apps/<name>/src`. */
function applicationSources(root: string): string[] {
  const apps = join(root, 'apps')
  if (!existsSync(apps)) return []
  return readdirSync(apps).map((name) => join(apps, name, 'src'))
}

/** Every refusal of the repository at `root`. */
export function analyze(root: string): Refusal[] {
  const named = (path: string) => relative(root, path).replaceAll('\\', '/')
  const shared = sourceFilesOf(join(root, 'packages')).flatMap((path) =>
    refusalsOf(named(path), readFileSync(path, 'utf8')),
  )
  const storage = [join(root, 'packages'), ...applicationSources(root)]
    .flatMap(sourceFilesOf)
    .flatMap((path) => storageRefusalsOf(named(path), readFileSync(path, 'utf8')))
  return [...shared, ...storage]
}

if (import.meta.main) {
  const refusals = analyze(resolve(import.meta.dirname, '..'))
  for (const { file, found, problem } of refusals) console.error(`${file}: ${found} — ${problem}`)
  if (refusals.length > 0) process.exit(1)
  console.log(
    'the shared packages import neither Electron nor React, and the storage layer stays in the engine',
  )
}
