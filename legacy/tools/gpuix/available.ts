/**
 * What of the renderer is present on this machine.
 *
 * The fork checkout and the compiled addon are build inputs, not sources: a machine that has
 * only cloned the monorepo has neither. The checks that read them run where they exist and say
 * so where they do not, rather than failing a checkout for something it was never given.
 */

import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repository = resolve(import.meta.dir, '..', '..')

/** The renderer fork, cloned beside the monorepo by the bootstrap. */
export const FORK_PATH = resolve(repository, '..', 'gpuix')

/** Where the addon is built, and where the product reads it from. */
export const NATIVE_PACKAGE = join(FORK_PATH, 'packages', 'native')

/** Whether the fork is checked out. */
export function forkCheckedOut(): boolean {
  return existsSync(join(FORK_PATH, '.git'))
}

/** Compiled addons of the fork, by file name. */
export function builtAddons(): string[] {
  if (!existsSync(NATIVE_PACKAGE)) return []
  return readdirSync(NATIVE_PACKAGE).filter((entry) => entry.endsWith('.node'))
}

/** Whether the native addon was compiled on this machine. */
export function nativeBuilt(): boolean {
  return builtAddons().length > 0
}

/**
 * Whether the addon installed here carries the GPU test renderer.
 *
 * Read from the addon rather than from a file name: the same file is the release build or
 * the test-support one depending on which script last produced it.
 */
export function testSupportBuilt(): boolean {
  try {
    const native = require('@gpuix/native') as { hasTestGpuixRenderer: () => boolean }
    return native.hasTestGpuixRenderer()
  } catch {
    return false
  }
}

/** Says once what is missing, so a skipped check is never a silent one. */
export function absent(what: string, command: string): string {
  const note = `${what} is not on this machine, so its checks are skipped; run ${command}`
  console.error(note)
  return note
}
