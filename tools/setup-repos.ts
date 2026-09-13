#!/usr/bin/env bun
/**
 * Prepares the two source repositories of Hemera as independent Git roots:
 * the product monorepo (this repository) and the renderer fork.
 *
 * The documentation folder that contains `sources/` is never initialized as a Git
 * repository, and an occupied destination is reported instead of being replaced.
 *
 *   bun tools/setup-repos.ts            report the state of both destinations
 *   bun tools/setup-repos.ts --apply    create what is missing, leave the rest intact
 */

import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/** Upstream of the renderer fork, from design D01. */
export const FORK_REMOTE = 'https://github.com/remorses/gpuix'

/** Commit the patch queue applies onto, from design D01. */
export const FORK_BASE_COMMIT = 'a24b4a42eb516c7b940eb8d34ecebb077df623bd'

export type DestinationState =
  /** Already a Git root; nothing to do. */
  | 'ready'
  /** Absent or empty; `--apply` may create it. */
  | 'pending'
  /** Holds local work that is not a Git root, or a Git root that is not the expected one. */
  | 'conflict'

export interface DestinationReport {
  name: string
  path: string
  state: DestinationState
  detail: string
}

export interface SetupReport {
  destinations: DestinationReport[]
  /** Distinct Git roots found among ready destinations. */
  gitRoots: string[]
}

function run(command: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
  return {
    ok: result.exitCode === 0,
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr).trim(),
  }
}

/** Git root owning `path`, or null when `path` is outside any repository. */
export function gitRootOf(path: string): string | null {
  if (!existsSync(path)) return null
  const result = run(['git', 'rev-parse', '--show-toplevel'], path)
  if (!result.ok) return null
  return resolve(result.stdout)
}

function isEmptyDirectory(path: string): boolean {
  return existsSync(path) && readdirSync(path).length === 0
}

/** Files the bootstrap deliberately places before the repository exists. */
const HEMERA_BOOTSTRAP_FILES = ['CLAUDE.md', 'AGENTS.md']

export function inspectMonorepo(path: string): DestinationReport {
  const name = basename(path)
  const root = gitRootOf(path)
  if (root !== null) {
    if (root !== resolve(path)) {
      return {
        name,
        path,
        state: 'conflict',
        detail: `already owned by the Git root ${root}; not re-initialized`,
      }
    }
    return { name, path, state: 'ready', detail: `Git root at ${root}` }
  }
  if (!existsSync(path) || isEmptyDirectory(path)) {
    return { name, path, state: 'pending', detail: 'empty destination, ready to initialize' }
  }
  const kept = readdirSync(path).filter((entry) => !HEMERA_BOOTSTRAP_FILES.includes(entry))
  return {
    name,
    path,
    state: 'pending',
    detail:
      kept.length === 0
        ? `holds the bootstrap files ${HEMERA_BOOTSTRAP_FILES.join(', ')}, kept by initialization`
        : `holds local work (${kept.join(', ')}), kept by initialization`,
  }
}

export function inspectFork(path: string): DestinationReport {
  const name = basename(path)
  const root = gitRootOf(path)
  if (root !== null) {
    if (root !== resolve(path)) {
      return {
        name,
        path,
        state: 'conflict',
        detail: `already owned by the Git root ${root}; not re-cloned`,
      }
    }
    const base = run(['git', 'cat-file', '-e', `${FORK_BASE_COMMIT}^{commit}`], path)
    if (!base.ok) {
      return {
        name,
        path,
        state: 'conflict',
        detail: `Git root at ${root} does not contain the base commit ${FORK_BASE_COMMIT}`,
      }
    }
    return { name, path, state: 'ready', detail: `Git root at ${root}, base commit present` }
  }
  if (!existsSync(path) || isEmptyDirectory(path)) {
    return {
      name,
      path,
      state: 'pending',
      detail: `empty destination, ready to clone ${FORK_REMOTE}`,
    }
  }
  return {
    name,
    path,
    state: 'conflict',
    detail: `holds local work (${readdirSync(path).join(', ')}) but is not a Git root; left intact`,
  }
}

/** Fails when the folder holding `sources/` is itself a Git repository. */
export function assertDocumentationRootIsNotARepository(sourcesDir: string): void {
  const documentationRoot = dirname(resolve(sourcesDir))
  const root = gitRootOf(documentationRoot)
  if (root !== null && root !== resolve(sourcesDir)) {
    throw new Error(
      `the documentation root ${documentationRoot} is a Git repository (${root}); ` +
        'sources must stay in their own repositories',
    )
  }
}

export function inspect(sourcesDir: string): SetupReport {
  const destinations = [
    inspectMonorepo(join(sourcesDir, 'hemera')),
    inspectFork(join(sourcesDir, 'gpuix')),
  ]
  const gitRoots = [
    ...new Set(
      destinations
        .filter((destination) => destination.state === 'ready')
        .map((destination) => resolve(destination.path)),
    ),
  ]
  return { destinations, gitRoots }
}

function applyMonorepo(report: DestinationReport): DestinationReport {
  if (report.state !== 'pending') return report
  const init = run(['git', 'init', '--initial-branch=main', report.path], dirname(report.path))
  if (!init.ok) {
    return { ...report, state: 'conflict', detail: `git init failed: ${init.stderr}` }
  }
  return inspectMonorepo(report.path)
}

function applyFork(report: DestinationReport): DestinationReport {
  if (report.state !== 'pending') return report
  const clone = run(
    ['git', 'clone', '--no-recurse-submodules', FORK_REMOTE, report.path],
    dirname(report.path),
  )
  if (!clone.ok) {
    return { ...report, state: 'conflict', detail: `git clone failed: ${clone.stderr}` }
  }
  return inspectFork(report.path)
}

export function apply(sourcesDir: string): SetupReport {
  assertDocumentationRootIsNotARepository(sourcesDir)
  const before = inspect(sourcesDir)
  const destinations = [applyMonorepo(before.destinations[0]!), applyFork(before.destinations[1]!)]
  const gitRoots = [
    ...new Set(
      destinations
        .filter((destination) => destination.state === 'ready')
        .map((destination) => resolve(destination.path)),
    ),
  ]
  return { destinations, gitRoots }
}

if (import.meta.main) {
  const sourcesDir = resolve(import.meta.dir, '..', '..')
  const shouldApply = process.argv.includes('--apply')
  assertDocumentationRootIsNotARepository(sourcesDir)
  const report = shouldApply ? apply(sourcesDir) : inspect(sourcesDir)
  for (const destination of report.destinations) {
    console.log(`${destination.state.padEnd(8)} ${destination.name}  ${destination.detail}`)
  }
  console.log(`distinct git roots: ${report.gitRoots.length}`)
  if (report.destinations.some((destination) => destination.state === 'conflict')) {
    process.exit(1)
  }
}
