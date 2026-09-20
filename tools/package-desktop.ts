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

import { extractFile, listPackage } from '@electron/asar'

/** Folders whose content has no business inside a package. */
export const REFUSED_IN_PACKAGE = ['spikes', 'src', 'node_modules'] as const

/** The three channels a package can be built as, and the one it is built as by default. */
export const CHANNELS = ['prod', 'beta', 'dev'] as const

export type Channel = (typeof CHANNELS)[number]

export const DEFAULT_CHANNEL: Channel = 'dev'

/** What the packaging is asked for, read from the arguments it was given. */
export function channelAsked(argv: readonly string[]): Channel | string {
  const flag = argv.indexOf('--channel')
  const asked =
    flag === -1
      ? argv.find((entry) => entry.startsWith('--channel='))?.slice('--channel='.length)
      : argv[flag + 1]
  return asked ?? DEFAULT_CHANNEL
}

/**
 * Why this machine may not build that channel, or null when it may.
 *
 * `prod` and `beta` are what the user runs on real data, and they are built by the pipeline
 * that tags and publishes them — never by a hand or by an agent on a working tree. What is
 * built here is `dev`, which opens the `dev` data folder and nothing else.
 */
export function refusalFor(
  asked: Channel | string,
  environment: Record<string, string | undefined>,
): string | null {
  // SAFETY: `asked` is compared against the declared channels before it is used as one.
  if (!CHANNELS.includes(asked as Channel)) {
    return `--channel ${asked}: there is no such channel; it is one of ${CHANNELS.join(', ')}`
  }
  if (asked === DEFAULT_CHANNEL) return null
  if (environment.CI === 'true') return null
  return `--channel ${asked}: only the continuous integration builds ${asked} packages; this machine builds ${DEFAULT_CHANNEL}`
}

/**
 * How the repository is asked what it is, as arguments and not as a line: a line goes through
 * a shell, and `cmd.exe` hands the quotes of `'beta-*'` to git as part of the pattern, so the
 * beta tags were never excluded on Windows and a beta was named after the previous one.
 */
export const DESCRIBE_ARGUMENTS = ['describe', '--tags', '--always', '--exclude', 'beta-*'] as const

/** The version a package carries, which is what the repository answers about itself. */
export function versionFrom(described: string): string {
  const label = described.trim().replace(/^v/, '')
  // A repository with no tag yet answers a bare commit hash, and a hash may start with a
  // letter: a Debian version must not, so the hash is carried behind a version that is one.
  return /^\d/.test(label) ? label : `0.0.0-${label}`
}

/**
 * What a channel calls itself, so two of them install beside each other rather than over.
 *
 * The executable is named too, and not left to be derived: what it would be derived from is the
 * package's own name, and `@hemera/desktop` sanitises to something Linux refuses to put in a
 * path. One name per channel, lowercase and hyphenated, is a name every target accepts.
 */
export interface PackageIdentity {
  appId: string
  productName: string
  executableName: string
}

export function identityOf(channel: Channel): PackageIdentity {
  if (channel === 'prod') {
    return { appId: 'dev.hemera.app', productName: 'Hemera', executableName: 'hemera' }
  }
  if (channel === 'beta') {
    return {
      appId: 'dev.hemera.app.beta',
      productName: 'Hemera Beta',
      executableName: 'hemera-beta',
    }
  }
  return { appId: 'dev.hemera.app.dev', productName: 'Hemera Dev', executableName: 'hemera-dev' }
}

/** Everything electron-builder is told that the configuration file does not already say. */
export function packagingOptions(channel: Channel, version: string): string[] {
  const identity = identityOf(channel)
  return [
    `--config.extraMetadata.version=${version}`,
    `--config.extraMetadata.hemera.channel=${channel}`,
    `--config.appId=${identity.appId}`,
    `--config.productName=${identity.productName}`,
    `--config.executableName=${identity.executableName}`,
  ]
}

/**
 * What a built package says it is, read back from the manifest it carries.
 *
 * The manifest is inside the archive the application is served from, not beside it, so it is
 * read the way Electron itself reads it. What a package carries is checked on the package.
 */
export function channelOfPackage(unpacked: string): string | null {
  try {
    const manifest = extractFile(join(unpacked, 'resources', 'app.asar'), 'package.json')
    // SAFETY: the manifest electron-builder wrote into the package, read for one field.
    return (
      (JSON.parse(manifest.toString('utf8')) as { hemera?: { channel?: string } }).hemera
        ?.channel ?? null
    )
  } catch {
    // No archive, or no manifest in it: either way the package does not say what it is.
    return null
  }
}

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

/**
 * Whether the migrations the application applies at start-up travelled with it.
 *
 * Looked for inside the archive, because that is where they are: what a package carries is
 * checked where the application will go looking for it, not where it was built from.
 */
export function migrationsProblems(entries: string[]): PackageProblem[] {
  const carried = entries.some((entry) => /(^|\/)drizzle\/.+\/migration\.sql$/.test(entry))
  return carried
    ? []
    : [
        {
          entry: 'drizzle',
          problem: 'is missing, and the data folder cannot be migrated without it',
        },
      ]
}

/** Everything the archive the application is served from carries. */
export function archiveEntries(unpacked: string): string[] {
  try {
    // Listed with the separators of the machine that built it, and read with one: the archive
    // is the same on both systems, and so is the question asked of it.
    return listPackage(join(unpacked, 'resources', 'app.asar'), { isPack: false }).map((entry) =>
      entry.replaceAll('\\', '/'),
    )
  } catch {
    return []
  }
}

/** Whether the package says it is the channel it was asked to be built as. */
export function channelProblems(found: string | null, asked: string): PackageProblem[] {
  if (found === asked) return []
  return [
    {
      entry: 'package.json',
      problem: `says the channel is ${found ?? 'nothing at all'}, and this package was built as ${asked}`,
    },
  ]
}

export function inspectPackage(
  unpacked: string,
  asked: Channel = DEFAULT_CHANNEL,
): PackageProblem[] {
  const entries = entriesUnder(unpacked)
  const locales = join(unpacked, 'locales')
  return [
    ...refusedEntries(entries),
    ...localesProblems(existsSync(locales) ? readdirSync(locales) : []),
    ...migrationsProblems(archiveEntries(unpacked)),
    ...channelProblems(channelOfPackage(unpacked), asked),
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

  const asked = channelAsked(process.argv.slice(2))
  const refusal = refusalFor(asked, process.env)
  if (refusal !== null) {
    console.error(refusal)
    process.exit(1)
  }
  // SAFETY: `refusalFor` answered null, which it only does for one of the declared channels.
  const channel = asked as Channel

  // `beta-*` tags are the pre-releases the pipeline cuts on every push to `dev`, one per build
  // and none of them a version: excluded here so a `git describe` never answers `beta-…-3-gabc`.
  const described = spawnSync('git', DESCRIBE_ARGUMENTS, { cwd: repository, encoding: 'utf8' })
  const version = versionFrom(described.status === 0 ? described.stdout : '0.0.0')

  run('node build.ts', application)
  run(
    `pnpm exec electron-builder --config electron-builder.yml ${packagingOptions(channel, version)
      .map((option) => JSON.stringify(option))
      .join(' ')}`,
    application,
  )

  const unpacked = join(repository, 'dist', 'package', unpackedFolderOf())
  const problems = inspectPackage(unpacked, channel)
  console.log(`packaged ${identityOf(channel).productName} ${version} as ${channel}`)
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
