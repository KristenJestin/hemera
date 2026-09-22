import { exec, execFile } from 'node:child_process'
import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, extname, join } from 'node:path'
import { Context, Data, Effect, Layer } from 'effect'

import type { InstallerTool } from '@hemera/ipc'

import {
  AGENT_PROVIDERS,
  type AgentAdapter,
  type AgentProvider,
  type Environment,
} from './adapter.ts'
import { claude } from './adapters/claude.ts'
import { codex } from './adapters/codex.ts'
import { opencode } from './adapters/opencode.ts'

/**
 * The agents this machine has, and which of them can be used (D5-02, D5-21).
 *
 * Everything else about an agent is a description; this is where the machine answers. Discovery
 * looks each agent's own command up on the `PATH` the user already has — `npx` never, a download
 * never (issue decision 93) — reads the version the command prints, looks for the login file the
 * agent's own command writes, and reports the three agents in the order Hemera knows them, found
 * or missing, each with what to install it and what signs it in.
 *
 * It picks nothing. An agent that is missing is reported missing, and the other two are not
 * offered in its place (D5-17). It never starts anything, and it never opens the file it looks
 * for: being signed in is the one bit of it this page shows, and the file belongs to the reader
 * (D5-21). What the word really is, the agent says when a Session asks it to `initialize`; this
 * is what can be said before one starts.
 */

/** A path, as one string, whichever separator the machine wrote it with. */
function asPosix(path: string): string {
  return path.replaceAll('\\', '/')
}

/**
 * The tool that owns a command, read off the path it was resolved to.
 *
 * The order is what matters here. A pnpm global directory holds a `node_modules` of its own and
 * so does a bun install, so the narrower tool has to be recognised before npm — which is the
 * last answer that is still an answer, because npm's own prefix is a `node_modules` and a
 * `.bin` like any other. Homebrew comes first for a different reason: its cellar is a place in
 * the filesystem rather than a package manager's prefix, and no other tool installs there.
 *
 * What this cannot place is left as `unknown` on purpose. A command in `/usr/local/bin` may have
 * been put there by npm's own prefix or by a script the user ran by hand, and the two are not
 * told apart by the path; guessing would offer an update that fails, which is worse than saying
 * that Hemera does not know.
 *
 * It lives here rather than with the update because it is a question about the machine, not
 * about the tool: it is the same `PATH` this file already reads, and it is answered without
 * running anything.
 */
export function installerOf(path: string): InstallerTool {
  const placed = asPosix(path)
  if (placed.includes('/Cellar/') || placed.includes('/homebrew/')) return 'brew'
  if (placed.includes('/linuxbrew/')) return 'brew'
  if (placed.includes('/.bun/') || placed.includes('/bun/install/global/')) return 'bun'
  if (placed.includes('/pnpm/') || placed.includes('pnpm-global')) return 'pnpm'
  if (
    placed.includes('/node_modules/') ||
    placed.includes('/.npm-global/') ||
    placed.includes('/nvm/') ||
    placed.includes('/.nvm/') ||
    placed.includes('/AppData/Roaming/npm/')
  ) {
    return 'npm'
  }
  return 'unknown'
}

/** One agent, as this machine answers for it. */
export interface DiscoveredAgent {
  readonly id: AgentProvider
  readonly label: string
  readonly found: boolean
  /** Where the command resolved on the `PATH`, when it was found. */
  readonly path?: string
  /** What the command answered to `--version`, when it answered with a version. */
  readonly version?: string
  /**
   * Whether the agent is signed in, as far as a file can say.
   *
   * The login the agent's own command wrote is looked for where that agent keeps it, and never
   * opened: the file is the reader's business, and signed in or not is the whole of what this
   * page shows of it (D5-21). An agent whose credentials no file answers for — the Keychain on
   * macOS, a keyring — reads as signed out here. The word that counts is the one the agent gives
   * to a Session that asks it to `initialize` (D5-17).
   */
  readonly authenticated: boolean
  /** What to tell someone who does not have this agent yet, in one sentence. */
  readonly installHint: string
  /** The command that signs this agent in, for the page to offer when it is not signed in. */
  readonly loginHint: string
  /**
   * The tool the command was installed with, read off the path it resolved to (D5-18).
   *
   * `unknown` when the command was not found, and when it was found somewhere no package
   * manager owns: an agent Hemera cannot place is one it will not offer to update.
   */
  readonly installer: InstallerTool
  /**
   * The version the registry of `installer` publishes, or null when nobody asked.
   *
   * Always null here: discovery reads the machine and never the network, and the registry is
   * asked only when the Agents section of the settings is opened (D5-18).
   */
  readonly latest: string | null
}

/** An agent and the command that starts it: what a Session needs before it can exist. */
export interface ResolvedAgent {
  readonly adapter: AgentAdapter
  readonly path: string
}

/** Raised when a Session is asked for an agent this machine does not have. */
export class AgentNotInstalledError extends Data.TaggedError('AgentNotInstalledError')<{
  readonly id: AgentProvider
}> {
  /**
   * What the window is told, in the agent's own name.
   *
   * A tagged error carries a field and no message, and a refusal without one crosses the port as
   * its own JSON. The agent is named as its documentation names it, never the package Hemera
   * spawns on its behalf (D5-21).
   */
  override get message(): string {
    return `${ADAPTERS[this.id].label} is not installed on this machine.`
  }
}

/**
 * What discovery asks of the machine: where a command is, what it answers, and what the reader's
 * own home and environment say about a login.
 *
 * All of them leave this process: one reads the `PATH` and the file system, one starts the
 * command to ask it its version, and two are what an agent's own directories are read against.
 * They are handed in rather than reached for, so that a suite drives them instead of finding a
 * real agent on the machine running it (D5-16), the same way the database and the clock are
 * handed to the rest of the engine.
 */
export interface MachineEnvironmentService {
  /** Where a command resolves on the `PATH`, or `undefined` when it is not on it. */
  readonly locate: (command: string) => Effect.Effect<string | undefined>
  /** What the command answers to `--version`, or `undefined` when it does not answer. */
  readonly readVersion: (command: string) => Effect.Effect<string | undefined>
  /** The home directory an agent's own paths are read against. */
  readonly home: string
  /** The environment those paths take their override from, which is the user's own. */
  readonly env: Environment
  /** Whether any of these files is there. None of them is ever opened. */
  readonly holds: (paths: readonly string[]) => Effect.Effect<boolean>
}

export class MachineEnvironment extends Context.Service<
  MachineEnvironment,
  MachineEnvironmentService
>()('MachineEnvironment') {}

/**
 * The adapters, each under its own agent's name.
 *
 * A record rather than a list: an agent missing from here is a compile error, and `list` walks
 * `AGENT_PROVIDERS` so that the page and the resolve can never disagree about which agents
 * exist.
 */
/**
 * The three agents, as this application describes them.
 *
 * Exported because the description is what more than discovery needs: the package an update
 * installs and the hint shown to someone who has none are the adapter's, not the machine's
 * (design D5-18).
 */
export const ADAPTERS: Record<AgentProvider, AgentAdapter> = { claude, codex, opencode }

/** What the Agents page asks of this machine, and what a Session asks before it starts. */
export interface DiscoveryService {
  /** The three agents, and what this machine can say about each of them. */
  readonly list: () => Effect.Effect<readonly DiscoveredAgent[], never>
  /** The agent and the command that starts it, or a refusal naming the agent that is missing. */
  readonly resolve: (id: AgentProvider) => Effect.Effect<ResolvedAgent, AgentNotInstalledError>
}

export class Discovery extends Context.Service<Discovery, DiscoveryService>()('Discovery') {}

/**
 * Discovery over the machine it is given.
 *
 * Nothing here is memoized: the `PATH` changes while the application is running, an agent can
 * be installed while the window is open, and the page is read rarely enough that asking again
 * is cheaper than being wrong.
 */
export const discoveryLayer = Layer.effect(
  Discovery,
  Effect.gen(function* () {
    const machine = yield* MachineEnvironment

    /** One agent's answer: found or not, signed in or not, and the version it gave. */
    const probe = (adapter: AgentAdapter): Effect.Effect<DiscoveredAgent, never> =>
      Effect.gen(function* () {
        // Asked before the command is looked for, because the answer does not depend on it: a
        // reader who signed in and then removed the command is still signed in.
        const authenticated = yield* machine.holds(adapter.loginFiles(machine.home, machine.env))
        const path = yield* machine.locate(adapter.command)
        if (path === undefined) {
          return {
            id: adapter.id,
            label: adapter.label,
            found: false,
            authenticated,
            installHint: adapter.installHint,
            loginHint: adapter.loginHint,
            installer: 'unknown',
            latest: null,
          }
        }
        const printed = yield* machine.readVersion(adapter.command)
        const version = printed === undefined ? undefined : adapter.readVersion(printed)
        if (version === undefined) {
          return {
            id: adapter.id,
            label: adapter.label,
            found: true,
            path,
            authenticated,
            installHint: adapter.installHint,
            loginHint: adapter.loginHint,
            installer: installerOf(path),
            latest: null,
          }
        }
        return {
          id: adapter.id,
          label: adapter.label,
          found: true,
          path,
          version,
          authenticated,
          installHint: adapter.installHint,
          loginHint: adapter.loginHint,
          installer: installerOf(path),
          latest: null,
        }
      })

    return {
      // The three commands are asked at once: the page waits for the slowest of them, which is
      // the difference between one command that will not answer and three of them in a row.
      list: () =>
        Effect.forEach(AGENT_PROVIDERS, (id) => probe(ADAPTERS[id]), { concurrency: 'unbounded' }),
      resolve: (id) =>
        Effect.gen(function* () {
          const adapter = ADAPTERS[id]
          // What a Session starts is the ACP command, which is Hemera's own and may not be the
          // one the reader installed (D5-21). An adapter nobody has is an agent this machine
          // cannot start either, and the refusal names the agent rather than the package.
          const path = yield* machine.locate(adapter.acp.command)
          if (path === undefined) return yield* Effect.fail(new AgentNotInstalledError({ id }))
          return { adapter, path }
        }),
    } satisfies DiscoveryService
  }),
)

/** How long a command is given to answer its version before it is taken as one that cannot. */
const VERSION_TIMEOUT_MS = 5_000

/** A file Windows only runs through its command interpreter. */
const SHIM = /\.(cmd|bat)$/i

/**
 * The file names a command can wear in one directory.
 *
 * On Windows the command npm installed is a `.cmd` shim beside the script it calls, and the
 * `PATH` holds the shim: looking for `opencode` alone would find nothing on a machine that has
 * it. `PATHEXT` is what Windows itself searches, so it is what is searched here, and the bare
 * name is kept last because a directory on the `PATH` may hold an executable by that name.
 * Anywhere else a command is its own name and nothing more.
 */
export function shimsOf(
  command: string,
  windows: boolean,
  extensions: readonly string[],
): readonly string[] {
  if (!windows) return [command]
  if (extname(command) !== '') return [command]
  return [...extensions.map((extension) => `${command}${extension}`), command]
}

/** The extensions Windows searches, in the order it searches them. */
function extensionsFrom(pathext: string | undefined): readonly string[] {
  return (pathext ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((extension) => extension !== '')
}

/** Whether a candidate is a file this platform would run: executable on Unix, present on Windows. */
function runnable(candidate: string, windows: boolean): boolean {
  try {
    if (!statSync(candidate).isFile()) return false
    if (windows) return true
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    // A `PATH` entry that is gone, or a file this process may not look at, is not the command.
    return false
  }
}

/**
 * Where a command resolves on this process's `PATH`, or `undefined` when it is not on it.
 *
 * On Windows the name that answers is not always the name that was asked for: `PATHEXT` is looked
 * up against a file system that does not care about case, so `fake-agent.cmd` answers to
 * `fake-agent.CMD`. What a caller needs back is the name the file is really called — running a
 * batch file means naming it to `cmd`, and a name that only matches by case is a name nothing
 * there resolves. The directory is listed for it, and the candidate is the entry that matched.
 */
function locate(command: string): string | undefined {
  const windows = process.platform === 'win32'
  const extensions = windows ? extensionsFrom(process.env.PATHEXT) : []
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (directory === '') continue
    for (const shim of shimsOf(command, windows, extensions)) {
      const candidate = join(directory, shim)
      if (!runnable(candidate, windows)) continue
      const written = windows ? spelledIn(directory, shim) : undefined
      return written === undefined ? candidate : join(directory, written)
    }
  }
  return undefined
}

/** The name one directory holds for a candidate, spelled as the file system spells it. */
function spelledIn(directory: string, shim: string): string | undefined {
  try {
    const wanted = shim.toLowerCase()
    return readdirSync(directory).find((name) => name.toLowerCase() === wanted)
  } catch {
    // A directory this process may not list is still one a candidate can be started from.
    return undefined
  }
}

/**
 * What a command answers to `--version`, or `undefined` when it says nothing.
 *
 * A version question is a courtesy and never a failure: a command that cannot be started, that
 * exits non-zero, or that never finishes is reported as a version Hemera does not know, never
 * as an agent that is not installed. The `signal` is Effect's, so that closing the window stops
 * a probe that is still running.
 */
function versionOf(command: string, signal: AbortSignal): Promise<string | undefined> {
  const path = locate(command)
  if (path === undefined) return Promise.resolve(undefined)
  // A `.cmd` shim is a batch file, and Windows runs one through its command interpreter. The line
  // is handed to `exec`, whose shell *is* that interpreter: Node wraps the whole line in the pair
  // of quotes `cmd /s /c` strips back off, so a path with a space in it survives. Building the
  // same line by hand and passing it as one argument of `execFile` does not — the argument is
  // escaped a second time on the way out — which is how a version probe answered nothing at all.
  const shimmed = process.platform === 'win32' && SHIM.test(path)
  return new Promise((resolve) => {
    const settle = (failure: Error | null, stdout: string) =>
      resolve(failure === null ? stdout : undefined)
    const options = { signal, timeout: VERSION_TIMEOUT_MS, windowsHide: true }
    if (shimmed) exec(`"${path}" --version`, options, settle)
    else execFile(path, ['--version'], options, settle)
  })
}

/**
 * The machine as this process sees it: its `PATH`, its file system, and the commands themselves.
 *
 * Nothing here knows about agents, which is what lets a suite hand `discoveryLayer` a machine
 * that is a table of commands instead of the one running the tests.
 */
export const machineEnvironmentLayer = Layer.succeed(MachineEnvironment, {
  home: homedir(),
  env: process.env,
  locate: (command) => Effect.sync(() => locate(command)),
  readVersion: (command) => Effect.promise((signal) => versionOf(command, signal)),
  holds: (paths) => Effect.sync(() => paths.some((path) => existsSync(path))),
})
