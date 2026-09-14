/**
 * What of the renderer is present on this machine.
 *
 * The fork checkout and the compiled addons are build inputs, not sources: a machine that has
 * only cloned the monorepo has neither. The checks that read them run where they exist and say
 * so where they do not, rather than failing a checkout for something it was never given.
 */

import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repository = resolve(import.meta.dir, '..', '..')

/** The renderer fork, cloned beside the monorepo by `bootstrap -WithFork`. */
export const FORK_PATH = resolve(repository, '..', 'gpuix')

function vendoredVersion(): string | null {
  const root = join(repository, 'vendor', 'gpuix')
  return existsSync(root) ? (readdirSync(root)[0] ?? null) : null
}

function builtInto(folder: string): boolean {
  const version = vendoredVersion()
  if (version === null) return false
  const directory = join(repository, 'vendor', 'gpuix', version, folder)
  return existsSync(directory) && readdirSync(directory).length > 0
}

/** Whether the fork is checked out, with its history and its patch queue. */
export function forkCheckedOut(): boolean {
  return existsSync(join(FORK_PATH, '.git'))
}

/** Whether the native addon was compiled on this machine. */
export function nativeBuilt(): boolean {
  return builtInto('native')
}

/** Whether the addon carrying the GPU test renderer was compiled on this machine. */
export function testSupportBuilt(): boolean {
  return builtInto('test-support')
}

/** Says once what is missing, so a skipped check is never a silent one. */
export function absent(what: string, command: string): string {
  const note = `${what} is not on this machine, so its checks are skipped; run ${command}`
  console.error(note)
  return note
}
