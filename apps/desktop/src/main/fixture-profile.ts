/**
 * The profile a fixture opens the application on (#420), and the checks that keep it away from
 * any real one.
 *
 * `pnpm fixtures <group>` builds a group's state in a folder of its own under one fixtures root,
 * leaves a marker file in it, and starts the application with `--fixture-profile=<folder>`. The
 * default profile never changes: without the flag, Hemera opens the profile it always opens. With
 * it, main opens the folder only when the root is the user's own folder, the folder is under it
 * once links are followed and carries the marker, and it is neither a profile a build of Hemera
 * opens normally nor inside one nor around one. A packaged build refuses the flag whatever the
 * folder: it has no fixtures.
 */

import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, posix, resolve, win32 } from 'node:path'

import { Result, Schema } from 'effect'

import { FORGE_TOKEN_VARIABLES } from '../engine/permissions/defence.ts'

/** The flag that points the application at a fixture's profile. */
export const FIXTURE_FLAG = '--fixture-profile'

/** The file every fixture folder carries; the command writes it first, before anything else. */
export const FIXTURE_MARKER = '.hemera-fixture'

/**
 * The file, in a fixture's profile, that says where its fake `gh` and `bkt` are: the application
 * opened on the fixture runs them, never the real ones, whoever starts it.
 */
export const FIXTURE_FORGE = '.hemera-fixture-forge.json'

/**
 * The one folder every fixture lives under, the user's own: on Linux in the user's cache folder,
 * since the temporary directory there is every account's; elsewhere in the temporary directory,
 * which Windows and macOS give each user.
 */
export const fixturesRoot = (
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string => {
  if (platform === 'win32' || platform === 'darwin') return join(tmpdir(), 'hemera-fixtures')
  const cache = env['XDG_CACHE_HOME']
  // A relative XDG_CACHE_HOME is to be ignored, the specification says.
  const base = cache !== undefined && isAbsolute(cache) ? cache : join(homedir(), '.cache')
  return join(base, 'hemera-fixtures')
}

/**
 * The profiles the builds of Hemera open in `appData` when no flag says otherwise: a development
 * run's, named after the package, and each channel's, named after its product.
 */
export const profilesIn = (appData: string): ReadonlyArray<string> =>
  ['@hemera/desktop', 'Hemera', 'Hemera Beta', 'Hemera Dev'].map((name) => join(appData, name))

/** What the checks need to know of a path, as found, without following it. */
export interface PathStat {
  readonly link: boolean
  readonly owner: number
  readonly mode: number
}

/** The system as the checks see it. */
export interface FixtureSystem {
  /** The account running the check; `null` where the system has no POSIX owner (Windows). */
  readonly user: number | null
  /** The path as found, its link not followed; `null` when nothing is there. */
  readonly stat: (path: string) => PathStat | null
}

const SYSTEM: FixtureSystem = {
  user: process.getuid?.() ?? null,
  stat: (path) => {
    const found = lstatSync(path, { throwIfNoEntry: false })
    return found === undefined
      ? null
      : { link: found.isSymbolicLink(), owner: found.uid, mode: found.mode }
  },
}

export interface FixturePlaces {
  /** The fixtures root. */
  readonly root: string
  /** The profiles the builds of Hemera open normally: no fixture is one, inside one, or holds one. */
  readonly normalProfiles: ReadonlyArray<string>
  /** The system the root is checked on; this one otherwise. */
  readonly system?: FixtureSystem
}

/**
 * A path with its links followed as far as it exists, so a link cannot lead out of the root: the
 * part that does not exist yet is put back on what its deepest existing folder really is.
 */
const real = (path: string): string => {
  const resolved = resolve(path)
  if (existsSync(resolved)) return realpathSync.native(resolved)
  const parent = dirname(resolved)
  return parent === resolved ? resolved : join(real(parent), basename(resolved))
}

/**
 * Whether `path` is `folder` or inside it, as the platform compares paths: without regard to case
 * on Windows, and never across two of its drives.
 */
export const isWithin = (
  path: string,
  folder: string,
  platform: NodeJS.Platform = process.platform,
): boolean => {
  const paths = platform === 'win32' ? win32 : posix
  const fold = (text: string) => (platform === 'win32' ? text.toLowerCase() : text)
  const between = paths.relative(fold(folder), fold(path))
  return between === '' || (!between.startsWith('..') && !paths.isAbsolute(between))
}

/**
 * The fixtures root, when it may hold fixtures: a folder of its own, not a link. Where the system
 * has owners, it belongs to the user running the check and no other account can write to it;
 * Windows has no owner Node reads, so there the root's protection is the user's own temporary
 * directory it is in.
 */
export function checkFixturesRoot(
  root: string,
  system: FixtureSystem = SYSTEM,
): Result.Result<string, string> {
  const found = system.stat(root)
  if (found === null) return Result.fail(`The fixtures root ${root} does not exist.`)
  if (found.link) {
    return Result.fail(`The fixtures root ${root} is a link: it must be a folder of its own.`)
  }
  if (system.user !== null && found.owner !== system.user) {
    return Result.fail(`The fixtures root ${root} belongs to another account.`)
  }
  if (system.user !== null && (found.mode & 0o022) !== 0) {
    return Result.fail(`The fixtures root ${root} is one other accounts can write to.`)
  }
  return Result.succeed(root)
}

/**
 * Whether a fixture may be at `folder`, whether anything is there yet or not: under the fixtures
 * root once links are followed, and neither a normal profile, nor inside one, nor around one.
 */
export function checkFixturePlace(
  folder: string,
  places: FixturePlaces,
): Result.Result<string, string> {
  const path = real(folder)
  const root = real(places.root)
  if (!isWithin(path, root) || isWithin(root, path)) {
    return Result.fail(`${folder} is not under the fixtures root ${places.root}.`)
  }
  for (const normalProfile of places.normalProfiles) {
    const normal = real(normalProfile)
    if (isWithin(path, normal) || isWithin(normal, path)) {
      return Result.fail(`${folder} is the profile Hemera uses normally, or holds it.`)
    }
  }
  return Result.succeed(path)
}

/** The folder, followed to where it really is, when it may be opened; the reason otherwise. */
export function checkFixtureFolder(
  folder: string,
  places: FixturePlaces,
): Result.Result<string, string> {
  const root = checkFixturesRoot(places.root, places.system)
  if (Result.isFailure(root)) return root
  const place = checkFixturePlace(folder, places)
  if (Result.isFailure(place)) return place
  if (!existsSync(join(place.success, FIXTURE_MARKER))) {
    return Result.fail(`${folder} carries no fixture marker (${FIXTURE_MARKER}).`)
  }
  return place
}

const ForgeFile = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String))

/** The variables the fake forge is opened with: each one a place inside the fixture. */
export const FORGE_KEYS = ['PATH', 'GH_CONFIG_DIR', 'FAKE_FORGE_RULES', 'FAKE_FORGE_LOG'] as const

/** The forge CLIs the fakes stand for; their folder must hold both. */
const FAKE_CLIS = ['gh', 'bkt'] as const

/** The fake forge's environment, read from the profile when it is the shape the command writes. */
const forgeOf = (profile: string): Result.Result<Readonly<Record<string, string>>, string> => {
  const file = join(profile, FIXTURE_FORGE)
  const found = lstatSync(file, { throwIfNoEntry: false })
  if (found === undefined) {
    return Result.fail(
      `${profile} has no fake forge (${FIXTURE_FORGE}): pnpm fixtures <group> writes it.`,
    )
  }
  if (found.isSymbolicLink()) return Result.fail(`${file} is a link: the fake forge is refused.`)
  const decoded = Schema.decodeUnknownResult(ForgeFile)(readFileSync(file, 'utf8'))
  if (Result.isFailure(decoded)) return Result.fail(`${file} is not a fake forge's environment.`)
  const forge = decoded.success
  const fixture = dirname(real(profile))
  const unknown = Object.keys(forge).find((key) => !FORGE_KEYS.some((known) => known === key))
  if (unknown !== undefined) return Result.fail(`${unknown} is not a variable of the fake forge.`)
  for (const key of FORGE_KEYS) {
    const value = forge[key]
    if (value === undefined) return Result.fail(`${file} names no ${key}.`)
    const place = real(value)
    if (value.includes(delimiter) || !isWithin(place, fixture) || isWithin(fixture, place)) {
      return Result.fail(`${key} is not inside the fixture ${fixture}: ${value}`)
    }
  }
  const fakes = forge['PATH'] ?? ''
  const shims = (cli: string) => (process.platform === 'win32' ? [`${cli}.cmd`] : [cli])
  const missing = FAKE_CLIS.find((cli) => !shims(cli).some((name) => existsSync(join(fakes, name))))
  if (missing !== undefined) return Result.fail(`${fakes} holds no fake ${missing}.`)
  return Result.succeed(forge)
}

/**
 * The environment the application runs in on a fixture's profile: the fixture's fake `gh` and
 * `bkt` first on the `PATH` (the same key, `Path` on Windows), with the account and the log they
 * keep, and every forge token of the user's environment emptied. A profile whose fake forge is
 * missing, a link, of another shape, or names a place outside the fixture is refused, so the real
 * CLIs never run on a fixture.
 */
export function fixtureEnvironment(
  profile: string,
  env: NodeJS.ProcessEnv,
): Result.Result<Readonly<Record<string, string>>, string> {
  return Result.map(forgeOf(profile), ({ PATH: fakes = '', ...forge }) => {
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'
    const emptied = Object.fromEntries(FORGE_TOKEN_VARIABLES.map((name) => [name, '']))
    return { ...emptied, ...forge, [pathKey]: [fakes, env[pathKey] ?? ''].join(delimiter) }
  })
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

/**
 * What the application opens on when the command line asks for a fixture: its checked profile,
 * and the environment that puts the fixture's fake forge first. `null` when it asks for none.
 */
export function fixtureOpenedBy(
  asked: Parameters<typeof fixtureProfileOf>[0] & { readonly env: NodeJS.ProcessEnv },
): Result.Result<
  { readonly profile: string; readonly env: Readonly<Record<string, string>> },
  string
> | null {
  const profile = fixtureProfileOf(asked)
  if (profile === null) return null
  return Result.flatMap(profile, (checked) =>
    Result.map(fixtureEnvironment(checked, asked.env), (env) => ({ profile: checked, env })),
  )
}
