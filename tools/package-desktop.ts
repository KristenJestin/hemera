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
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { extractFile, listPackage } from '@electron/asar'

/** Folders whose content has no business inside a package. */
export const REFUSED_IN_PACKAGE = ['spikes', 'src', 'node_modules'] as const

/**
 * Where a package carries the ACP adapters, and the one `node_modules` it is allowed (D5-21).
 *
 * The two adapters are Node scripts this application depends on and the reader never installs,
 * and a script has to be a file on disk to be forked: they travel outside the `asar`, under the
 * resources folder, in a `node_modules` laid out the way Node resolves one — which is why this
 * is the single exception to the rule above rather than a loosening of it. The engine looks for
 * them here first and falls back to its own `node_modules` for a development run
 * (`ADAPTERS_FOLDER` in `apps/desktop/src/engine/agents/discovery.ts`).
 */
export const ADAPTERS_FOLDER = 'adapters'

/** The two packages that expose an agent Hemera carries, and the roots of what travels with it. */
export const BUNDLED_ADAPTERS = [
  '@agentclientprotocol/claude-agent-acp',
  '@agentclientprotocol/codex-acp',
] as const

/**
 * The packages a package must never carry, however it came by them.
 *
 * Each adapter declares the agent itself as an optional dependency — a native binary per platform,
 * 223 MB for Claude Code on win32-x64 and more for Codex — and Hemera ships none of them: the
 * agent is the one the reader installed and signed in, and each adapter is handed its path in an
 * environment variable (D5-21). A closure that pulled one in would be a package that carries a
 * second copy of an agent nobody asked it for.
 */
export const REFUSED_ADAPTER_PACKAGES = [/^@anthropic-ai\/claude-agent-sdk-/, /^@openai\/codex/]

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

/** Where the adapters are allowed to be, and the only place a `node_modules` is one of them. */
const CARRIED_ADAPTERS = `resources/${ADAPTERS_FOLDER}/`

/** The flat `node_modules` the adapters are laid out in, under the folder that carries them. */
const CARRIED_MODULES = `${CARRIED_ADAPTERS}node_modules/`

/**
 * What a packaged tree carries that it should not.
 *
 * The adapters' own folder is the one exception, and it is an exception to `node_modules` alone:
 * everything under it is a package this application declares, pruned by the step that built it,
 * laid out where Node will resolve it. Anything else called `node_modules` is still refused.
 */
export function refusedEntries(entries: string[]): PackageProblem[] {
  return entries
    .filter((entry) => !entry.startsWith(CARRIED_ADAPTERS))
    .filter((entry) =>
      REFUSED_IN_PACKAGE.some((refused) => entry === refused || entry.split('/').includes(refused)),
    )
    .map((entry) => ({ entry, problem: 'belongs to the sources, not to a package' }))
}

/** One package of a closure: what the registry calls it, and where this machine keeps it. */
export interface CarriedPackage {
  readonly name: string
  readonly folder: string
}

/**
 * The runtime dependency closure of a set of packages, walked from their manifests.
 *
 * `dependencies` and nothing else: a `devDependency` is not loaded at run time, and an
 * `optionalDependency` of these two *is* the agent itself as a platform binary, which this
 * application does not ship (D5-21).
 *
 * Every package is walked from where it stands rather than from the application, because pnpm
 * puts a dependency next to the package that declares it and nowhere else. A name already found
 * is not walked again: a flat `node_modules` holds one folder per name, and the first one found
 * is the one the other packages will resolve to. The walk is its own function so that a suite can
 * drive it on a table rather than on a `node_modules`.
 */
export function closureOf(
  roots: readonly CarriedPackage[],
  dependenciesOf: (found: CarriedPackage) => readonly CarriedPackage[],
): CarriedPackage[] {
  const found: CarriedPackage[] = []
  const left = [...roots]
  while (left.length > 0) {
    // SAFETY: the loop runs only while there is something left to take off the list.
    const next = left.shift() as CarriedPackage
    if (found.some((already) => already.name === next.name)) continue
    found.push(next)
    left.push(...dependenciesOf(next))
  }
  return found
}

/** What such a closure carries that a package must not, named as the registry names it. */
export function refusedInClosure(closure: readonly string[]): PackageProblem[] {
  return closure
    .filter((packageName) => REFUSED_ADAPTER_PACKAGES.some((refused) => refused.test(packageName)))
    .map((packageName) => ({
      entry: packageName,
      problem: 'is an agent as a platform binary, and Hemera runs the one the reader installed',
    }))
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

/**
 * Whether the adapters the engine forks travelled with the application, and the program that
 * forks them travelled inside it.
 *
 * Two places and two questions: the bootstrap is a bundle like the other four and lives in the
 * `asar`, while an adapter is a script that has to be a file on disk and lives beside it.
 */
export function adaptersProblems(entries: string[], archived: string[]): PackageProblem[] {
  const problems: PackageProblem[] = []
  if (!archived.some((entry) => /(^|\/)dist\/adapter\/index\.js$/.test(entry))) {
    problems.push({
      entry: 'dist/adapter',
      problem: 'is missing, and an adapter cannot be forked without the program that forks it',
    })
  }
  for (const packageName of BUNDLED_ADAPTERS) {
    const carried = `${CARRIED_MODULES}${packageName}/package.json`
    if (!entries.includes(carried)) {
      problems.push({ entry: carried, problem: 'is missing, and its agent cannot be started' })
    }
  }
  const carried = entries
    .filter((entry) => entry.startsWith(CARRIED_MODULES) && entry.endsWith('/package.json'))
    .map((entry) => entry.slice(CARRIED_MODULES.length, -'/package.json'.length))
  return [...problems, ...refusedInClosure(carried)]
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
  const archived = archiveEntries(unpacked)
  const locales = join(unpacked, 'locales')
  return [
    ...refusedEntries(entries),
    ...localesProblems(existsSync(locales) ? readdirSync(locales) : []),
    ...migrationsProblems(archived),
    ...adaptersProblems(entries, archived),
    ...channelProblems(channelOfPackage(unpacked), asked),
  ]
}

/**
 * The adapters, and only what they need of themselves, laid out for a package to carry.
 *
 * `electron-builder` is handed a folder rather than a `node_modules`, because the one it would
 * be handed is pnpm's: a tree of links whose leaves are the platform binaries of the agents —
 * 223 MB for one of them on this machine — and a package that followed those links would carry
 * an agent it must not (D5-21). So the closure is walked from the two adapters' own manifests,
 * every package in it is copied without its own nested `node_modules`, and what comes out is a
 * flat `node_modules` Node resolves exactly as it would resolve an installed one.
 *
 * The agents themselves are cut out of the walk rather than tripped over: `codex-acp` declares
 * `@openai/codex` as a plain dependency and reaches for it only when nobody told it which
 * `codex` to run, which Hemera always does (D5-21). What is left out is therefore a package the
 * adapter will never load, and `refusedInClosure` checks the built tree for it all the same.
 *
 * It answers what it built, so that a build can say what it cost.
 */
export function buildAdapters(application: string, into: string): string[] {
  const closure = closureOf(
    BUNDLED_ADAPTERS.map((name) => folderOf(name, application)),
    (found) => {
      // SAFETY: an npm manifest, read for the one field this walk follows.
      const manifest = JSON.parse(readFileSync(join(found.folder, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
      }
      return Object.keys(manifest.dependencies ?? {})
        .filter((name) => !REFUSED_ADAPTER_PACKAGES.some((refused) => refused.test(name)))
        .map((name) => folderOf(name, found.folder))
    },
  )

  rmSync(into, { recursive: true, force: true })
  for (const { name, folder } of closure) {
    const to = join(into, 'node_modules', ...name.split('/'))
    mkdirSync(dirname(to), { recursive: true })
    cpSync(folder, to, {
      recursive: true,
      // pnpm links a package's own dependencies under it, and those links lead to the store:
      // followed, they bring in exactly what this folder exists to leave out.
      dereference: true,
      filter: (entry) => !relative(folder, entry).split(sep).includes('node_modules'),
    })
  }
  return closure.map((found) => found.name)
}

/**
 * Where this machine keeps one package, as seen from another.
 *
 * The folders are walked rather than `require.resolve`d, and for two reasons: a package may
 * declare `exports` without listing its own manifest, and it may declare an `import` condition
 * without a `require` one — both of which the adapters do, and either of which makes a resolve
 * from a tool fail on a package that loads perfectly well. Walking `node_modules` upwards is
 * what Node itself does before any of that, and what is wanted here is the folder.
 *
 * The answer is the real path, because pnpm's `node_modules` is links: the dependencies of a
 * package are next to it in the store and nowhere near the link that led to it.
 */
export function folderOf(name: string, from: string): CarriedPackage {
  let at = from
  for (;;) {
    const candidate = join(at, 'node_modules', ...name.split('/'))
    if (existsSync(join(candidate, 'package.json'))) {
      return { name, folder: realpathSync(candidate) }
    }
    const up = dirname(at)
    if (up === at) throw new Error(`${name} is not installed anywhere above ${from}`)
    at = up
  }
}

/** How much a folder weighs, in bytes, which is what a package grew by. */
export function weightOf(folder: string): number {
  if (!existsSync(folder)) return 0
  let total = 0
  for (const entry of readdirSync(folder)) {
    const path = join(folder, entry)
    const found = statSync(path)
    total += found.isDirectory() ? weightOf(path) : found.size
  }
  return total
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

  // Before electron-builder, because it is what electron-builder is then told to carry, and
  // inside the application: a fileset whose source sits above the project matches nothing at all.
  const adapters = join(application, ADAPTERS_FOLDER)
  const closure = buildAdapters(application, adapters)
  const megabytes = Math.round(weightOf(adapters) / 1024 / 1024)
  console.log(
    `the adapters travel as ${String(closure.length)} packages and ${String(megabytes)} MB: ${closure.join(', ')}`,
  )

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
