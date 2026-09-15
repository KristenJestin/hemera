#!/usr/bin/env node
/**
 * Portable package of the target this machine is (design D0-08).
 *
 * The three bundles are built, electron-builder assembles them, and what came out is read
 * back: what a package carries is checked on the package, not on the configuration that was
 * supposed to produce it. Nothing here signs, publishes or updates.
 *
 *   node tools/package-desktop.ts
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** Folders whose content has no business inside a package. */
export const REFUSED_IN_PACKAGE = ['spikes', 'src', 'node_modules'] as const

export interface PackageProblem {
  entry: string
  problem: string
}

function entriesUnder(root: string, from: string = root): string[] {
  const found: string[] = []
  for (const entry of readdirSync(root)) {
    const path = join(root, entry)
    found.push(relative(from, path).replaceAll('\\', '/'))
    if (statSync(path).isDirectory()) found.push(...entriesUnder(path, from))
  }
  return found
}

/** What a packaged tree carries that it should not. */
export function refusedEntries(entries: string[]): PackageProblem[] {
  return entries
    .filter((entry) =>
      REFUSED_IN_PACKAGE.some((refused) => entry === refused || entry.split('/').includes(refused)),
    )
    .map((entry) => ({ entry, problem: 'belongs to the sources, not to a package' }))
}

/**
 * Whether the locales the package carries are the one language it speaks.
 *
 * The folder is checked for being reduced and for existing: Electron refuses to start on an
 * empty one, so emptying it by hand trades 47 MB for a package that does not run.
 */
export function localesProblems(locales: string[]): PackageProblem[] {
  const packs = locales.filter((entry) => entry.endsWith('.pak'))
  if (packs.length === 0) {
    return [{ entry: 'locales', problem: 'is empty, and Electron will not start on that' }]
  }
  if (packs.length > 1) {
    return packs
      .filter((pack) => !pack.startsWith('en-US'))
      .map((pack) => ({ entry: pack, problem: 'is a locale the application does not speak' }))
  }
  return []
}

export function inspectPackage(unpacked: string): PackageProblem[] {
  const entries = entriesUnder(unpacked)
  const locales = join(unpacked, 'locales')
  return [
    ...refusedEntries(entries),
    ...localesProblems(existsSync(locales) ? readdirSync(locales) : []),
  ]
}

/** The folder electron-builder leaves the unpacked application in, per target. */
export function unpackedFolderOf(platform: string = process.platform): string {
  if (platform === 'win32') return 'win-unpacked'
  if (platform === 'linux') return 'linux-unpacked'
  return `${platform}-unpacked`
}

function run(command: string, cwd: string): void {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...environment } = process.env
  const result = spawnSync(command, { cwd, stdio: 'inherit', shell: true, env: environment })
  if (result.status !== 0) throw new Error(`\`${command}\` failed with ${String(result.status)}`)
}

if (import.meta.main) {
  const repository = resolve(import.meta.dirname, '..')
  const application = join(repository, 'apps', 'desktop')

  run('node build.ts', application)
  run('pnpm exec electron-builder --config electron-builder.yml', application)

  const unpacked = join(repository, 'dist', 'package', unpackedFolderOf())
  const problems = inspectPackage(unpacked)
  for (const problem of problems) {
    console.error(`${problem.entry}: ${problem.problem}`)
  }
  console.log(
    problems.length === 0
      ? `the package under ${unpacked} carries what it should and nothing else`
      : `${problems.length} problem(s) in the package`,
  )
  if (problems.length > 0) process.exit(1)
}
