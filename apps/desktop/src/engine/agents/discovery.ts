import { execFile } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, extname, join } from 'node:path'
import { Context, Data, Effect, Layer } from 'effect'

import { AGENT_PROVIDERS, type AgentAdapter, type AgentProvider } from './adapter.ts'
import { claude } from './adapters/claude.ts'
import { codex } from './adapters/codex.ts'
import { opencode } from './adapters/opencode.ts'

/**
 * The agents this machine has (D5-02).
 *
 * Everything else about an agent is a description; this is where the machine answers. Discovery
 * looks each adapter's command up on the `PATH` the user already has — `npx` never, a download
 * never (issue decision 93) — reads the version the command prints, and reports the three
 * agents in the order Hemera knows them, found or missing, each with what to install it when it
 * is not there.
 *
 * It picks nothing. An agent that is missing is reported missing, and the other two are not
 * offered in its place (D5-17). It starts nothing either, and that is why nothing here can say
 * an agent is signed in: being signed in is what an agent reports when it is asked to
 * `initialize`, which happens when a Session starts, not when this page is read.
 */

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
   * Whether the agent is signed in.
   *
   * `false` until a Session has started the agent: signing in is what the agent reports in its
   * `initialize` answer, and discovery starts nothing. A page that cannot know does not guess,
   * and the Session that finds out is the one that reports it (D5-17).
   */
  readonly authenticated: boolean
  /** What to tell someone who does not have this agent yet, in one sentence. */
  readonly installHint: string
}

/** An agent and the command that starts it: what a Session needs before it can exist. */
export interface ResolvedAgent {
  readonly adapter: AgentAdapter
  readonly path: string
}

/** Raised when a Session is asked for an agent this machine does not have. */
export class AgentNotInstalledError extends Data.TaggedError('AgentNotInstalledError')<{
  readonly id: AgentProvider
}> {}

/**
 * What discovery asks of the machine, which is two questions and no more.
 *
 * Both of them leave this process: one reads the `PATH` and the file system, the other starts
 * the command to ask it its version. They are handed in rather than reached for, so that a
 * suite drives them instead of finding a real agent on the machine running it (D5-16), the same
 * way the database and the clock are handed to the rest of the engine.
 */
export interface MachineEnvironmentService {
  /** Where a command resolves on the `PATH`, or `undefined` when it is not on it. */
  readonly locate: (command: string) => Effect.Effect<string | undefined>
  /** What the command answers to `--version`, or `undefined` when it does not answer. */
  readonly readVersion: (command: string) => Effect.Effect<string | undefined>
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
const ADAPTERS: Record<AgentProvider, AgentAdapter> = { claude, codex, opencode }

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

    /** One agent's answer: found or not, and the version the command had to give. */
    const probe = (adapter: AgentAdapter): Effect.Effect<DiscoveredAgent, never> =>
      Effect.gen(function* () {
        const path = yield* machine.locate(adapter.command)
        if (path === undefined) {
          return {
            id: adapter.id,
            label: adapter.label,
            found: false,
            authenticated: false,
            installHint: adapter.installHint,
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
            authenticated: false,
            installHint: adapter.installHint,
          }
        }
        return {
          id: adapter.id,
          label: adapter.label,
          found: true,
          path,
          version,
          authenticated: false,
          installHint: adapter.installHint,
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
          const path = yield* machine.locate(adapter.command)
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

/** Where a command resolves on this process's `PATH`, or `undefined` when it is not on it. */
function locate(command: string): string | undefined {
  const windows = process.platform === 'win32'
  const extensions = windows ? extensionsFrom(process.env.PATHEXT) : []
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (directory === '') continue
    for (const shim of shimsOf(command, windows, extensions)) {
      const candidate = join(directory, shim)
      if (runnable(candidate, windows)) return candidate
    }
  }
  return undefined
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
  // A `.cmd` shim is a batch file, and Windows runs one through its command interpreter.
  const shimmed = process.platform === 'win32' && SHIM.test(path)
  const executable = shimmed ? (process.env.ComSpec ?? 'cmd.exe') : path
  const args = shimmed ? ['/d', '/s', '/c', `"${path}" --version`] : ['--version']
  return new Promise((resolve) => {
    execFile(
      executable,
      args,
      { signal, timeout: VERSION_TIMEOUT_MS, windowsHide: true },
      (failure, stdout) => {
        resolve(failure === null ? stdout : undefined)
      },
    )
  })
}

/**
 * The machine as this process sees it: its `PATH`, its file system, and the commands themselves.
 *
 * Nothing here knows about agents, which is what lets a suite hand `discoveryLayer` a machine
 * that is a table of commands instead of the one running the tests.
 */
export const machineEnvironmentLayer = Layer.succeed(MachineEnvironment, {
  locate: (command) => Effect.sync(() => locate(command)),
  readVersion: (command) => Effect.promise((signal) => versionOf(command, signal)),
})
