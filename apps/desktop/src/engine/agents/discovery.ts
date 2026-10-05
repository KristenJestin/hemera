/**
 * The agents this machine has, and what a session start resolves for one of them.
 *
 * Each agent's own command is looked for on the user's `PATH` (Windows `PATHEXT` and `.cmd`
 * shims included); never `npx`, never a download. Being signed in is read from the agent's login
 * file, as a presence, never opened. The installer is read from the path.
 *
 * The version is the one question that starts a process (`--version`, under a time limit), so a
 * list never waits on it: what each path printed is cached, and every list refreshes it in the
 * background, one probe per path at a time. A list answers from what is known.
 *
 * A resolve refuses before it starts anything, each refusal typed: not qualified to run bare on
 * this OS, not installed, not signed in, or (for Claude Code and Codex) the adapter Hemera carries
 * missing from this installation. No other agent is ever offered in place of a missing one.
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { AGENT_PROVIDERS, type AgentProvider } from '@hemera/core/domain'
import {
  AgentAdapterMissing,
  AgentNotInstalled,
  AgentNotSignedIn,
  type BareModeNotQualified,
  type InstallerTool,
  type Qualification,
} from '@hemera/ipc'
import { Context, Effect, FiberSet, Layer, Option, Schema } from 'effect'

import { findOnPath, hostLookup } from '../command-line.ts'
import { type AgentAdapter, type Environment, versionIn } from './adapter.ts'
import { ADAPTERS } from './adapters/index.ts'
import { qualificationOf, refusedUnlessQualified } from './bare.ts'
import { installerOf, runCommand } from './installer.ts'

/** What discovery asks of the machine; a port, so a suite hands it a table of commands. */
export interface MachineService {
  readonly home: string
  /** The user's environment: the `PATH`, and the agents' own overrides. */
  readonly env: Environment
  readonly platform: NodeJS.Platform
  /** Where a command resolves on the `PATH`, or null. */
  readonly locate: (command: string) => Effect.Effect<string | null>
  /** What the command at this path printed for `--version`, or null (failed, or too slow). */
  readonly version: (path: string) => Effect.Effect<string | null>
  /** Whether any of these files is there; none is opened. */
  readonly exists: (paths: ReadonlyArray<string>) => Effect.Effect<boolean>
  /** A file of the user's an adapter keeps settings from, or undefined. */
  readonly read: (path: string) => Effect.Effect<string | undefined>
  /** The entry script of an adapter package Hemera carries, or null when it is missing. */
  readonly bundled: (packageName: string) => Effect.Effect<string | null>
}

export class Machine extends Context.Service<Machine, MachineService>()('Machine') {}

/** One agent as this machine answers for it. */
export interface DiscoveredAgent {
  readonly id: AgentProvider
  readonly label: string
  readonly installed: boolean
  /** Where its command resolved; null when it is not installed. */
  readonly path: string | null
  readonly version: string | null
  readonly signedIn: boolean
  readonly installer: InstallerTool
  readonly qualification: Qualification
  readonly installHint: string
  readonly loginHint: string
}

/** What starting an agent takes: the program, its arguments and environment, the user's settings. */
export interface ResolvedAgent {
  readonly adapter: AgentAdapter
  /** `bundled`: a Node script of Hemera's to fork. `agent`: the agent's own command to spawn. */
  readonly from: 'bundled' | 'agent'
  readonly program: string
  readonly args: ReadonlyArray<string>
  /** Added to the user's environment: for an adapter, which agent it runs. */
  readonly env: Readonly<Record<string, string>>
  /** What of the user's own settings the agent keeps in bare mode. */
  readonly own: Readonly<Partial<Record<string, string>>>
}

export type UnusableAgent =
  | BareModeNotQualified
  | AgentNotInstalled
  | AgentNotSignedIn
  | AgentAdapterMissing

export interface DiscoveryService {
  /** The three agents, answered without waiting on a version probe. */
  readonly list: Effect.Effect<ReadonlyArray<DiscoveredAgent>>
  /** The version the agent at this path answers now, waited for; the cache is updated. */
  readonly probe: (path: string) => Effect.Effect<string | null>
  /** The agent and how to start it, or why it cannot be. No version is asked. */
  readonly resolve: (id: AgentProvider) => Effect.Effect<ResolvedAgent, UnusableAgent>
}

export class Discovery extends Context.Service<Discovery, DiscoveryService>()('Discovery') {}

export const discoveryLayer = Layer.effect(
  Discovery,
  Effect.gen(function* () {
    const machine = yield* Machine
    const probes = yield* FiberSet.make()
    /** The version each path answered last. */
    const versions = new Map<string, string | null>()
    /** The paths a probe runs for now. */
    const probing = new Set<string>()

    const probe = (path: string) =>
      machine.version(path).pipe(
        Effect.map((printed) => (printed === null ? null : versionIn(printed))),
        Effect.tap((version) => Effect.sync(() => versions.set(path, version))),
      )

    /** Probes in the background, unless a probe for this path is already running. */
    const refresh = (path: string) =>
      Effect.suspend(() => {
        if (probing.has(path)) return Effect.void
        probing.add(path)
        return FiberSet.run(
          probes,
          probe(path).pipe(Effect.ensuring(Effect.sync(() => probing.delete(path)))),
        ).pipe(Effect.asVoid)
      })

    const discovered = (adapter: AgentAdapter) =>
      Effect.gen(function* () {
        const signedIn = yield* machine.exists(adapter.loginFiles(machine.home, machine.env))
        const path = yield* machine.locate(adapter.command)
        if (path !== null) yield* refresh(path)
        return {
          id: adapter.id,
          label: adapter.label,
          installed: path !== null,
          path,
          version: path === null ? null : (versions.get(path) ?? null),
          signedIn,
          installer: path === null ? 'unknown' : installerOf(path),
          qualification: qualificationOf(adapter, machine.platform, machine.env),
          installHint: adapter.installHint,
          loginHint: adapter.loginHint,
        } satisfies DiscoveredAgent
      })

    const ownOf = (adapter: AgentAdapter) => {
      const own = adapter.ownSettings
      if (own === undefined) return Effect.succeed({})
      return Effect.forEach(own.files(machine.home, machine.env), machine.read).pipe(
        Effect.map(own.kept),
      )
    }

    const resolve = (id: AgentProvider) =>
      Effect.gen(function* () {
        const adapter = ADAPTERS[id]
        const { label } = adapter
        yield* refusedUnlessQualified(adapter, machine.platform, machine.env)
        const path = yield* machine.locate(adapter.command)
        if (path === null) return yield* new AgentNotInstalled({ agent: id, label })
        if (!(yield* machine.exists(adapter.loginFiles(machine.home, machine.env)))) {
          return yield* new AgentNotSignedIn({ agent: id, label, loginHint: adapter.loginHint })
        }
        const own = yield* ownOf(adapter)
        const acp = adapter.acp
        if (acp.from === 'agent') {
          return { adapter, from: acp.from, program: path, args: acp.args, env: {}, own }
        }
        const program = yield* machine.bundled(acp.package)
        if (program === null) {
          return yield* new AgentAdapterMissing({ agent: id, label, package: acp.package })
        }
        // The adapter is told which agent to run: the user's own, the one just found.
        return {
          adapter,
          from: acp.from,
          program,
          args: [],
          env: { [acp.agentVariable]: path },
          own,
        } satisfies ResolvedAgent
      })

    return Discovery.of({
      list: Effect.forEach(AGENT_PROVIDERS, (id) => discovered(ADAPTERS[id]), {
        concurrency: 'unbounded',
      }),
      probe,
      resolve,
    })
  }),
)

/** How long `--version` is given before the version is taken as not known. */
export const VERSION_TIMEOUT_MS = 5_000

/** A package manifest, as far as its executable goes: one path, or one per name. */
const readSingleBin = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ bin: Schema.String })),
)
const readNamedBins = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ bin: Schema.Record(Schema.String, Schema.String) })),
)

/** The executable a manifest declares; the adapters declare one each, under their own name. */
const declaredBin = (manifest: string): string | undefined =>
  Option.getOrUndefined(
    Option.orElse(
      Option.map(readSingleBin(manifest), ({ bin }) => bin),
      () =>
        Option.flatMap(readNamedBins(manifest), ({ bin }) =>
          Option.fromUndefinedOr(Object.values(bin)[0]),
        ),
    ),
  )

/** Where a package carried with Hemera is unpacked, under the resources folder. */
export const ADAPTERS_FOLDER = 'adapters'

/**
 * The entry script of an adapter package Hemera carries, or null when it is missing. A package
 * carries the adapters under its resources folder, outside the asar (a script to fork must be a
 * file on disk); a development run has none, and the adapter resolves from `node_modules`.
 */
export function bundledEntry(packageName: string, resources: string | undefined): string | null {
  const carried =
    resources === undefined
      ? undefined
      : join(resources, ADAPTERS_FOLDER, 'node_modules', packageName, 'package.json')
  const manifest =
    carried !== undefined && existsSync(carried) ? carried : developmentManifest(packageName)
  if (manifest === null) return null
  const declared = declaredBin(readFileSync(manifest, 'utf8'))
  if (declared === undefined) return null
  const entry = join(dirname(manifest), declared)
  return existsSync(entry) ? entry : null
}

function developmentManifest(packageName: string): string | null {
  try {
    return createRequire(import.meta.url).resolve(`${packageName}/package.json`)
  } catch {
    // Not installed: the caller answers it as a missing adapter.
    return null
  }
}

/** The machine this engine runs on. The arguments exist for the suites. */
export const machineLayer = (
  env: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
  versionTimeoutMs: number = VERSION_TIMEOUT_MS,
): Layer.Layer<Machine> => {
  const home = homedir()
  // Electron sets it; a suite on plain Node has none.
  const resources: string | undefined = process.resourcesPath
  return Layer.succeed(Machine, {
    home,
    env,
    platform,
    locate: (command) => Effect.sync(() => findOnPath(command, hostLookup(home, env), platform)),
    version: (path) =>
      runCommand([path, '--version'], env, platform, {
        timeoutMs: versionTimeoutMs,
        outputChars: 4096,
      }).pipe(Effect.map(({ succeeded, output }) => (succeeded ? output : null))),
    exists: (paths) => Effect.sync(() => paths.some((path) => existsSync(path))),
    read: (path) =>
      Effect.sync(() => {
        try {
          return readFileSync(path, 'utf8')
        } catch {
          // Not there, or not readable: nothing is kept of it.
          return undefined
        }
      }),
    bundled: (packageName) => Effect.sync(() => bundledEntry(packageName, resources)),
  })
}
