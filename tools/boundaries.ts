#!/usr/bin/env node
/**
 * Checks that the shared packages stay free of Electron and of React.
 *
 * A package under `packages/` is read by every process: the renderer, main, the engine and the
 * agents' processes. One that imports Electron cannot be loaded by a page, and one that imports
 * React drags the interface into a process that has none. The applications import them; never
 * the other way round.
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

function sourceFilesOf(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap((entry) => {
    if (entry === 'node_modules') return []
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFilesOf(path)
    return /\.[cm]?tsx?$/.test(entry) ? [path] : []
  })
}

/** Every refusal in the shared packages of the repository at `root`. */
export function analyze(root: string): Refusal[] {
  return sourceFilesOf(join(root, 'packages')).flatMap((path) =>
    refusalsOf(relative(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')),
  )
}

if (import.meta.main) {
  const refusals = analyze(resolve(import.meta.dirname, '..'))
  for (const { file, found, problem } of refusals) console.error(`${file}: ${found} — ${problem}`)
  if (refusals.length > 0) process.exit(1)
  console.log('the shared packages import neither Electron nor React')
}
