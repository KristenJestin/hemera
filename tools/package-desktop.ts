#!/usr/bin/env node
/**
 * Portable package of the target this machine is.
 *
 * The bundles are built, electron-builder assembles them, and what came out is read back:
 * what a package carries is checked on the package, not on the configuration that was supposed
 * to produce it. Nothing here signs, publishes or updates.
 *
 *   node tools/package-desktop.ts
 */

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { extractFile } from '@electron/asar'

/** Folders whose content has no business inside a package. */
export const REFUSED_IN_PACKAGE = ['spikes', 'src', 'node_modules'] as const

/**
 * The ACP adapters Hemera carries for Claude Code and Codex. A packaged Hemera forks them as Node
 * scripts, so they are files on disk beside the archive: `resources/adapters/node_modules`.
 */
export const ADAPTER_PACKAGES = [
  '@agentclientprotocol/claude-agent-acp',
  '@agentclientprotocol/codex-acp',
] as const

/** Where the adapters are gathered before electron-builder carries them, under the application. */
export const ADAPTERS_FOLDER = 'adapters'

/** Where a package carries them, from its unpacked folder. */
const CARRIED_ADAPTERS = 'resources/adapters/node_modules'

/**
 * Packages an adapter declares and never runs: `codex-acp` runs the user's own `codex` through
 * `CODEX_PATH`, so the Codex it depends on (its platform binary with it) is left out by name.
 */
const LEFT_OUT = ['@openai/codex']

/** The folders of the agents' own packages and platform binaries, which no package may carry. */
const AGENT_BINARIES = /^(@anthropic-ai\/claude-agent-sdk-[^/]+|@openai\/codex[^/]*)$/

/** Where `name` resolves from `folder`, the way Node resolves it, or null. */
function packageFolder(folder: string, name: string): string | null {
  for (let at = folder; ; at = dirname(at)) {
    const candidate = join(at, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    if (dirname(at) === at) return null
  }
}

interface Manifest {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function manifestOf(folder: string): Manifest {
  // SAFETY: an installed package's own manifest, read for the two fields above.
  return JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as Manifest
}

/**
 * The runtime closure of the adapters laid out as a `node_modules` Node resolves like an
 * installed one: each package by where it goes (`name`, or `parent/node_modules/name` when
 * another version holds the top), with the folder it is copied from. Their dependencies and peers
 * (`claude-agent-sdk` needs its peers at run time), never an optional dependency (the agents'
 * platform binaries), each resolved from the package that declares it, as pnpm keeps it. A peer
 * nobody installed is an optional one, and is skipped.
 */
export function adapterClosure(from: string, roots: ReadonlyArray<string>): Map<string, string> {
  const layout = new Map<string, string>()
  /** `chain`: where the package that needs `name` sits, and the places above it. */
  const visit = (name: string, folder: string | null, chain: ReadonlyArray<string>): void => {
    if (folder === null || LEFT_OUT.includes(name)) return
    const seen = [...chain.toReversed().map((place) => `${place}/node_modules/${name}`), name].find(
      (place) => layout.has(place),
    )
    if (seen !== undefined && layout.get(seen) === folder) return
    const parent = chain.at(-1)
    if (seen !== undefined && parent === undefined) {
      throw new Error(`${name} is asked for at two versions by the adapters themselves`)
    }
    const place = seen === undefined ? name : `${parent}/node_modules/${name}`
    layout.set(place, folder)
    const manifest = manifestOf(folder)
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    })) {
      visit(
        dependency,
        packageFolder(folder, dependency),
        seen === undefined ? [place] : [...chain, place],
      )
    }
  }
  for (const root of roots) {
    const folder = packageFolder(from, root)
    if (folder === null) throw new Error(`${root} is not installed in ${from}`)
    visit(root, folder, [])
  }
  return layout
}

/** Copies the closure into `out/node_modules`, each package without its own nested one. */
export function carryAdapters(from: string, roots: ReadonlyArray<string>, out: string): void {
  rmSync(out, { recursive: true, force: true })
  for (const [place, folder] of adapterClosure(from, roots)) {
    cpSync(folder, join(out, 'node_modules', ...place.split('/')), {
      recursive: true,
      dereference: true,
      filter: (source) => !relative(folder, source).split(sep).includes('node_modules'),
    })
  }
}

/** Whether the package carries both adapters, outside the archive, and no agent binary. */
export function adapterProblems(unpacked: string): PackageProblem[] {
  const carried = join(unpacked, ...CARRIED_ADAPTERS.split('/'))
  const missing = ADAPTER_PACKAGES.filter(
    (name) => !existsSync(join(carried, name, 'package.json')),
  ).map((name) => ({
    entry: `${CARRIED_ADAPTERS}/${name}`,
    problem: 'is missing from the package',
  }))
  const binaries = existsSync(carried)
    ? entriesUnder(carried)
        .filter((entry) => AGENT_BINARIES.test(entry))
        .map((entry) => ({ entry, problem: 'is an agent binary, which Hemera never ships' }))
    : []
  return [...missing, ...binaries]
}

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
  return (
    entries
      // The adapters are the one `node_modules` a package carries, on purpose.
      .filter((entry) => !entry.startsWith(`${CARRIED_ADAPTERS}/`) && entry !== CARRIED_ADAPTERS)
      .filter((entry) =>
        REFUSED_IN_PACKAGE.some(
          (refused) => entry === refused || entry.split('/').includes(refused),
        ),
      )
      .map((entry) => ({ entry, problem: 'belongs to the sources, not to a package' }))
  )
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
  const locales = join(unpacked, 'locales')
  return [
    ...refusedEntries(entriesUnder(unpacked)),
    ...localesProblems(existsSync(locales) ? readdirSync(locales) : []),
    ...channelProblems(channelOfPackage(unpacked), asked),
    ...adapterProblems(unpacked),
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

  // `beta-*` tags are the rolling pre-releases the pipeline once cut on every push to `dev`,
  // none of them a version: excluded here so a `git describe` never answers `beta-…-3-gabc`.
  // A beta is now `vX.Y.Z-beta.N`, and built from its tag it is named after it: `0.5.0-beta.1`.
  const described = spawnSync('git', DESCRIBE_ARGUMENTS, { cwd: repository, encoding: 'utf8' })
  const version = versionFrom(described.status === 0 ? described.stdout : '0.0.0')

  run('node build.ts', application)
  carryAdapters(application, ADAPTER_PACKAGES, join(application, ADAPTERS_FOLDER))

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
