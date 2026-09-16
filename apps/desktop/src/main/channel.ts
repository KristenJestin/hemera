/**
 * Which build this is, and which profile it therefore opens (design D3-06).
 *
 * The channel is engraved in the manifest of a package when the package is built, and read
 * from there and nowhere else: no environment variable and no argument can talk a package into
 * being another channel. An application that is not a package is `dev`, which is the channel a
 * development run, a test and an agent all get.
 *
 * `prod` and `beta` open the same profile on purpose — the beta is the application the user
 * runs every day, on real data. `dev` opens its own, and a `dev` build may be pointed at a
 * throwaway folder instead; it may not be pointed at the real one.
 *
 * Everything here that decides is pure and takes what it reads as arguments, so the rules can
 * be checked on every platform from one machine, without Electron and without a profile.
 */

import { readFileSync } from 'node:fs'
import { join, posix, win32 } from 'node:path'

import { type Channel, channelSchema } from '@hemera/ipc'

/** Where every profile of this application lives, under the system's own data folder. */
export const PROFILES_FOLDER = 'hemera'

/** The flag a `dev` build accepts so a test or a trial gets a profile of its own. */
export const PROFILE_DIRECTORY_FLAG = '--profile-dir'

/** Set by the development run to the label `git describe` gave the working tree. */
export const VERSION_VARIABLE = 'HEMERA_VERSION'

/**
 * What this running application is, read from the manifest it was loaded from.
 *
 * Both answers Electron has to give are taken as arguments rather than asked of Electron here,
 * so the rule can be checked from a plain Node test; the main process passes `app.isPackaged`
 * and `app.getAppPath()`. A manifest that names no channel is read as `dev`, which is the safe
 * direction: a package cannot become `prod` by forgetting to say what it is.
 */
export function channel(packaged: boolean, applicationPath: string): Channel {
  if (!packaged) return 'dev'
  const manifest = readFileSync(join(applicationPath, 'package.json'), 'utf8')
  // SAFETY: the manifest Electron loaded the application from, read for one field whose value
  // is then validated by the schema; JSON.parse answers untyped by definition.
  const carried = (JSON.parse(manifest) as { hemera?: { channel?: string } }).hemera?.channel
  const read = channelSchema.safeParse(carried)
  return read.success ? read.data : 'dev'
}

/** What a build says it is, resolved once at start-up and carried wherever it is reported. */
export interface ApplicationIdentity {
  version: string
  channel: Channel
}

/**
 * What this build calls itself.
 *
 * A package carries its version in the manifest it was built with, and that is the only thing
 * it answers — an environment variable does not get to rename a package. A development run has
 * no version of its own to carry, so the run hands it the label the repository answers.
 *
 * That label is a tag, and a tag is written `v0.3.0`; a version is not. It is stripped here,
 * which is the one place a version is decided, so a development run and a package report the
 * same thing rather than differing by a letter nobody meant to ship.
 */
export function applicationVersion(
  packaged: boolean,
  manifestVersion: string,
  environment: Record<string, string | undefined>,
): string {
  if (packaged) return manifestVersion
  const described = named(environment[VERSION_VARIABLE])
  return described === null ? manifestVersion : described.replace(/^v/, '')
}

/** The profile a channel opens: `prod` and `beta` share one, `dev` has its own. */
export function profileName(engraved: Channel): string {
  return engraved === 'dev' ? 'dev' : 'prod'
}

/**
 * Where the profile of a channel lives, per system.
 *
 * `LOCALAPPDATA` on Windows and `XDG_DATA_HOME` on Linux, which are the data folders — never
 * `APPDATA`, which roams a database across a network, and never `~/.config`, which is for
 * configuration and not for a database, its backups and its log.
 */
export function profileDirectory(
  engraved: Channel,
  platform: string,
  environment: Record<string, string | undefined>,
): string {
  // The separators of the platform asked about, not of the machine asking: the rule is checked
  // for Windows and for Linux from whichever of the two the suite happens to run on.
  const path = platform === 'win32' ? win32 : posix
  return path.join(
    dataDirectory(path, platform, environment),
    PROFILES_FOLDER,
    profileName(engraved),
  )
}

function dataDirectory(
  path: typeof posix,
  platform: string,
  environment: Record<string, string | undefined>,
): string {
  if (platform === 'win32') {
    return named(environment.LOCALAPPDATA) ?? path.join(home(environment), 'AppData', 'Local')
  }
  return named(environment.XDG_DATA_HOME) ?? path.join(home(environment), '.local', 'share')
}

/** A variable the system set to something, as opposed to one it set to nothing. */
function named(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value
}

function home(environment: Record<string, string | undefined>): string {
  return named(environment.HOME) ?? named(environment.USERPROFILE) ?? '.'
}

/** The folder a `--profile-dir` argument names, or null when there is no such argument. */
export function profileArgument(argv: readonly string[]): string | null {
  const flag = argv.indexOf(PROFILE_DIRECTORY_FLAG)
  if (flag !== -1) return named(argv[flag + 1])
  const joined = argv.find((entry) => entry.startsWith(`${PROFILE_DIRECTORY_FLAG}=`))
  return joined === undefined ? null : named(joined.slice(PROFILE_DIRECTORY_FLAG.length + 1))
}

/** Where a start ends up, or the reason it does not start at all. */
export type ProfileChoice =
  | { accepted: true; directory: string }
  | { accepted: false; reason: string }

/**
 * Whether two paths name the same folder, as the platform asked about would tell them apart.
 *
 * Windows does not tell case apart, and neither may the rule: `c:\users\kris\appdata\local\
 * hemera\prod` is the real profile as surely as the one Windows spells with capitals, and a
 * comparison that only knows `===` would hand it to a dev build.
 */
function samePath(one: string, other: string, platform: string): boolean {
  return platform === 'win32' ? one.toLowerCase() === other.toLowerCase() : one === other
}

/**
 * The folder this start opens, argument and all.
 *
 * A `prod` or `beta` package ignores the argument: what it opens is decided at build time. A
 * `dev` build honours it, except when the folder named resolves to the real profile — the one
 * thing the argument exists to keep away from.
 */
export function chooseProfile(
  engraved: Channel,
  platform: string,
  environment: Record<string, string | undefined>,
  argv: readonly string[],
): ProfileChoice {
  // Resolved by the platform asked about, as the folders themselves are, so the rule answers
  // the same thing from either machine rather than mixing one system's separators with the
  // other's `resolve`.
  const path = platform === 'win32' ? win32 : posix
  const own = profileDirectory(engraved, platform, environment)
  const asked = engraved === 'dev' ? profileArgument(argv) : null
  if (asked === null) return { accepted: true, directory: own }

  const wanted = path.resolve(asked)
  const real = profileDirectory('prod', platform, environment)
  if (samePath(wanted, path.resolve(real), platform)) {
    return {
      accepted: false,
      reason: `${PROFILE_DIRECTORY_FLAG}: refused ${wanted}, which is the ${real} profile a dev build must never open`,
    }
  }
  return { accepted: true, directory: wanted }
}
