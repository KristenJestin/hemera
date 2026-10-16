/**
 * The profile a fixture opens the application on (#420), and the checks that keep it away from
 * any real one.
 *
 * `pnpm fixtures <group>` builds a group's state in a folder of its own under one fixtures root,
 * leaves a marker file in it, and starts the application with `--fixture-profile=<folder>`. The
 * default profile never changes: without the flag, Hemera opens the profile it always opens. With
 * it, main opens the folder only when it is under the fixtures root, once links are followed,
 * carries the marker, and is neither the profile Hemera uses normally nor inside it nor around it.
 * A packaged build refuses the flag whatever the folder: it has no fixtures.
 */

import { existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { Result } from 'effect'

/** The flag that points the application at a fixture's profile. */
export const FIXTURE_FLAG = '--fixture-profile'

/** The file every fixture folder carries; the command writes it first, before anything else. */
export const FIXTURE_MARKER = '.hemera-fixture'

/** The one folder every fixture lives under: in the temporary directory, never in a profile. */
export const fixturesRoot = (temporary: string = tmpdir()): string =>
  join(temporary, 'hemera-fixtures')

export interface FixturePlaces {
  /** The fixtures root. */
  readonly root: string
  /** The profile the application opens when no flag says otherwise. */
  readonly normalProfile: string
}

/** A path with its links followed as far as it exists, so a link cannot lead out of the root. */
const real = (path: string): string => {
  const resolved = resolve(path)
  return existsSync(resolved) ? realpathSync.native(resolved) : resolved
}

/** Whether `path` is `folder` or inside it; without regard to case where the system has none. */
const within = (path: string, folder: string): boolean => {
  const fold = (text: string) => (process.platform === 'win32' ? text.toLowerCase() : text)
  const between = relative(fold(folder), fold(path))
  return between === '' || (!between.startsWith('..') && !isAbsolute(between))
}

/** The folder, followed to where it really is, when it may be opened; the reason otherwise. */
export function checkFixtureFolder(
  folder: string,
  places: FixturePlaces,
): Result.Result<string, string> {
  const path = real(folder)
  const root = real(places.root)
  if (!within(path, root) || relative(root, path) === '') {
    return Result.fail(`${folder} is not under the fixtures root ${places.root}.`)
  }
  const normal = real(places.normalProfile)
  if (within(path, normal) || within(normal, path)) {
    return Result.fail(`${folder} is the profile Hemera uses normally, or holds it.`)
  }
  if (!existsSync(join(path, FIXTURE_MARKER))) {
    return Result.fail(`${folder} carries no fixture marker (${FIXTURE_MARKER}).`)
  }
  return Result.succeed(path)
}

/** The folder the flag names, written `--fixture-profile=<folder>` or `--fixture-profile <folder>`. */
const flagged = (argv: ReadonlyArray<string>): string | null | undefined => {
  for (const [at, word] of argv.entries()) {
    if (word.startsWith(`${FIXTURE_FLAG}=`)) return word.slice(FIXTURE_FLAG.length + 1)
    if (word === FIXTURE_FLAG) {
      const next = argv[at + 1]
      return next === undefined || next.startsWith('--') ? null : next
    }
  }
  return undefined
}

/**
 * The fixture's profile the command line asks for: `null` when it asks for none, so the normal
 * profile opens; the checked folder, or the reason it is refused.
 */
export function fixtureProfileOf(
  asked: FixturePlaces & { readonly argv: ReadonlyArray<string>; readonly packaged: boolean },
): Result.Result<string, string> | null {
  const folder = flagged(asked.argv)
  if (folder === undefined) return null
  if (asked.packaged) {
    return Result.fail(`A packaged build of Hemera has no fixtures: ${FIXTURE_FLAG} is refused.`)
  }
  if (folder === null || folder === '') return Result.fail(`${FIXTURE_FLAG} names no folder.`)
  return checkFixtureFolder(folder, asked)
}
