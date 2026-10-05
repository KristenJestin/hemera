/**
 * The tool that installed an agent, and the two things asked of it: the latest published version
 * ("check for updates") and the update itself.
 *
 * The tool is read from the path the command resolved to, never guessed from its name: Vite+,
 * npm, pnpm, bun and Homebrew each put a command in places of their own. A path none of them owns is
 * `unknown`, which is an answer: Hemera never updates what it cannot place, since the update is
 * the installer's own global one.
 *
 * Both moves leave this process (a registry over the network, a command that changes the
 * machine), so both are ports with a time limit; the update also caps what it keeps of its
 * output, and runs only when the user asks.
 */

import { spawn } from 'node:child_process'

import type { InstallerTool } from '@hemera/ipc'
import { Context, Effect, Layer, Option, Schema } from 'effect'

import { hostLookup, invocationOf } from '../command-line.ts'
import type { AgentAdapter, Environment } from './adapter.ts'

/** The installer of a command, from the path it resolved to. */
export function installerOf(path: string): InstallerTool {
  const placed = path.replaceAll('\\', '/')
  // Homebrew's cellar is a place of its own; Vite+, pnpm and bun keep a `node_modules` too, so
  // they are recognised before npm, whose prefix is any `node_modules`. Vite+ puts its shims and
  // its global packages under its own home.
  if (placed.includes('/.vite-plus/')) return 'vp'
  if (/\/(Cellar|homebrew|linuxbrew)\//.test(placed)) return 'brew'
  if (placed.includes('/.bun/') || placed.includes('/bun/install/global/')) return 'bun'
  if (placed.includes('/pnpm/') || placed.includes('pnpm-global')) return 'pnpm'
  if (/\/(node_modules|\.npm-global|nvm|\.nvm)\/|\/AppData\/Roaming\/npm\//.test(placed)) {
    return 'npm'
  }
  return 'unknown'
}

/** The installer's own global update of an agent, or null for an installer Hemera cannot place. */
export function updateCommandFor(
  adapter: AgentAdapter,
  installer: InstallerTool,
): ReadonlyArray<string> | null {
  switch (installer) {
    case 'vp':
      return ['vp', 'update', '--global', adapter.package]
    case 'npm':
      return ['npm', 'install', '--global', adapter.package]
    case 'pnpm':
      return ['pnpm', 'add', '--global', adapter.package]
    case 'bun':
      return ['bun', 'add', '--global', adapter.package]
    // Homebrew knows the agent by its command, as a formula.
    case 'brew':
      return ['brew', 'upgrade', adapter.command]
    case 'unknown':
      return null
  }
}

/** How a command ended, and the tail of what it printed. */
export interface CommandEnd {
  /** True when it exited 0 within its time limit. */
  readonly succeeded: boolean
  readonly output: string
}

/** A time limit and a cap on the output kept (its tail). */
export interface CommandLimits {
  readonly timeoutMs: number
  readonly outputChars: number
}

/**
 * Runs words as a command, without a shell (a Windows `.cmd` shim goes through `cmd.exe`, quoted
 * by `invocationOf`). It is stopped at its time limit, or when the effect is interrupted.
 */
export const runCommand = (
  words: ReadonlyArray<string>,
  env: Environment,
  platform: NodeJS.Platform,
  limits: CommandLimits,
): Effect.Effect<CommandEnd> =>
  Effect.callback<CommandEnd>((resume, signal) => {
    const invocation = invocationOf(words, platform, hostLookup(process.cwd(), env))
    if (invocation === null) return resume(Effect.succeed({ succeeded: false, output: '' }))
    let output = ''
    const keep = (chunk: string) => {
      output = (output + chunk).slice(-limits.outputChars)
    }
    const child = spawn(invocation.program, invocation.args, {
      env,
      signal,
      timeout: limits.timeoutMs,
      windowsHide: true,
      windowsVerbatimArguments: invocation.verbatim,
    })
    child.stdout.setEncoding('utf8').on('data', keep)
    child.stderr.setEncoding('utf8').on('data', keep)
    child.on('error', (error) =>
      resume(Effect.succeed({ succeeded: false, output: error.message })),
    )
    // Stopped at its time limit: answered at once, without waiting on a child of its own that
    // still holds its pipes.
    child.on('exit', (_code, killed) => {
      if (killed !== null) resume(Effect.succeed({ succeeded: false, output }))
    })
    child.on('close', (code) => resume(Effect.succeed({ succeeded: code === 0, output })))
  })

export interface AgentRegistryService {
  /** The latest published version, or null when the registry did not answer one in time. */
  readonly latest: (adapter: AgentAdapter, installer: InstallerTool) => Effect.Effect<string | null>
}

export class AgentRegistry extends Context.Service<AgentRegistry, AgentRegistryService>()(
  'AgentRegistry',
) {}

export interface AgentUpdaterService {
  /** Runs an update command to its end, or its time limit; answers what it printed. */
  readonly run: (words: ReadonlyArray<string>) => Effect.Effect<string>
}

export class AgentUpdater extends Context.Service<AgentUpdater, AgentUpdaterService>()(
  'AgentUpdater',
) {}

/** How long a registry is given to answer. */
export const REGISTRY_TIMEOUT_MS = 5_000

/** Where the two catalogues answer. */
export interface RegistryAddresses {
  readonly npm: string
  readonly brew: string
}

export const PUBLIC_REGISTRIES: RegistryAddresses = {
  npm: 'https://registry.npmjs.org',
  brew: 'https://formulae.brew.sh/api/formula',
}

const readNpm = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
)
const readFormula = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ versions: Schema.Struct({ stable: Schema.String }) })),
)

/** One registry read: the text answered, or null when it did not answer in time. */
const fetched = (address: string, timeoutMs: number): Effect.Effect<string | null> =>
  Effect.tryPromise(() =>
    fetch(address, { signal: AbortSignal.timeout(timeoutMs) }).then((answer) =>
      answer.ok ? answer.text() : null,
    ),
  ).pipe(Effect.orElseSucceed(() => null))

/**
 * Homebrew's catalogue for a Homebrew install, npm's for any other: a read, so even an agent of
 * an unknown installer can be compared with what was published. Offline, down or unpublished
 * are one answer: the latest version is not known.
 */
export const registryLayer = (
  addresses: RegistryAddresses = PUBLIC_REGISTRIES,
  timeoutMs: number = REGISTRY_TIMEOUT_MS,
): Layer.Layer<AgentRegistry> =>
  Layer.succeed(AgentRegistry, {
    latest: (adapter, installer) =>
      installer === 'brew'
        ? fetched(`${addresses.brew}/${adapter.command}.json`, timeoutMs).pipe(
            Effect.map((text) =>
              Option.getOrNull(Option.map(readFormula(text), (one) => one.versions.stable)),
            ),
          )
        : fetched(`${addresses.npm}/${adapter.package.replace('/', '%2F')}/latest`, timeoutMs).pipe(
            Effect.map((text) => Option.getOrNull(Option.map(readNpm(text), (one) => one.version))),
          ),
  })

/** How long an update is given, and how much of its output is kept. */
export const UPDATE_LIMITS: CommandLimits = { timeoutMs: 10 * 60_000, outputChars: 64 * 1024 }

/** The updater of this machine: the installer's own command, run as the user would. */
export const updaterLayer = (
  env: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
  limits: CommandLimits = UPDATE_LIMITS,
): Layer.Layer<AgentUpdater> =>
  Layer.succeed(AgentUpdater, {
    run: (words) =>
      runCommand(words, env, platform, limits).pipe(
        Effect.map(({ output }) =>
          output.trim() === '' ? 'The command printed nothing.' : output.trim(),
        ),
      ),
  })
