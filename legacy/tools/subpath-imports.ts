#!/usr/bin/env bun
/**
 * Rewrites the imports that climb out of their folder into subpath imports.
 *
 * `../../tokens/primitives.ts` says where a file sits, not what it imports, and it has to be
 * recounted every time a file moves. `#tokens/primitives.ts` is the same module whatever the
 * folder, and both Bun and TypeScript resolve it from the `imports` field of the package.
 *
 * A sibling stays relative: `./use-modal.ts` is already the shortest true thing to write.
 *
 *   bun tools/subpath-imports.ts            report what would change
 *   bun tools/subpath-imports.ts --write    rewrite the files
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/** Packages that declare `#*` and the folder it points at. */
export const ROOTS = [
  { package: 'packages/ui', source: 'src' },
  { package: 'packages/core', source: 'src' },
  { package: 'packages/runtime', source: 'src' },
  { package: 'apps/desktop', source: 'src' },
] as const

const IMPORT = /(\bfrom\s+|\bimport\s*\(\s*)(['"])((?:\.\.\/)+[^'"]+)\2/g

function filesOf(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) found.push(...filesOf(path))
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) found.push(path)
  }
  return found
}

/** The subpath form of a relative import, or null when it leaves the source folder. */
export function subpathOf(fromFile: string, specifier: string, sourceRoot: string): string | null {
  const target = resolve(dirname(fromFile), specifier)
  const inside = relative(sourceRoot, target).replaceAll('\\', '/')
  if (inside.startsWith('..')) return null
  return `#${inside}`
}

export interface Rewrite {
  file: string
  from: string
  to: string
}

export function rewritesOf(repositoryRoot: string): Rewrite[] {
  const rewrites: Rewrite[] = []
  for (const root of ROOTS) {
    const packageRoot = join(repositoryRoot, root.package)
    const sourceRoot = join(packageRoot, root.source)
    for (const file of filesOf(packageRoot)) {
      const content = readFileSync(file, 'utf8')
      for (const match of content.matchAll(IMPORT)) {
        const specifier = match[3]!
        const subpath = subpathOf(file, specifier, sourceRoot)
        if (subpath !== null) rewrites.push({ file, from: specifier, to: subpath })
      }
    }
  }
  return rewrites
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, '..')
  const rewrites = rewritesOf(repositoryRoot)
  const byFile = new Map<string, Rewrite[]>()
  for (const rewrite of rewrites) {
    byFile.set(rewrite.file, [...(byFile.get(rewrite.file) ?? []), rewrite])
  }

  if (process.argv.includes('--write')) {
    for (const [file, entries] of byFile) {
      let content = readFileSync(file, 'utf8')
      for (const entry of entries) {
        content = content.replaceAll(`'${entry.from}'`, `'${entry.to}'`)
      }
      writeFileSync(file, content)
    }
    console.log(`rewrote ${rewrites.length} imports in ${byFile.size} files`)
  } else {
    console.log(`${rewrites.length} imports in ${byFile.size} files would become subpath imports`)
  }
}
