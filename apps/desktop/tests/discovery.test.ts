/**
 * The agents on this machine, and what the Agents page can say about them (D5-02, D5-17).
 *
 * Each suite is named after the scenario of the issue's `Spec · agent-runtime` section that it
 * covers. The machine is scripted here: the `PATH` lookup, the version probes and the login files
 * are handed to discovery, so a suite reads what the settings page reads without finding this
 * machine's agents, starting one of them, or downloading anything. What the scripted machine was
 * asked is recorded, which is how a suite can say that no other agent was reached for — the point
 * of D5-17 being that a missing agent is reported, never replaced — and that the names on the
 * page are the agents' own (D5-21).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import type { AgentProvider } from '#engine/agents/adapter.ts'
import { codex } from '#engine/agents/adapters/codex.ts'
import { opencode } from '#engine/agents/adapters/opencode.ts'
import {
  AgentAdapterMissingError,
  AgentNotInstalledError,
  AgentNotSignedInError,
  Discovery,
  MachineEnvironment,
  discoveryLayer,
  machineEnvironmentLayer,
  shimsOf,
} from '#engine/agents/discovery.ts'

/** What a machine has of one command: where it is, and what it answers for a version. */
interface Installed {
  readonly path: string
  readonly version?: string | undefined
}

/** The home every scripted machine has, so that a suite can name the paths looked for. */
const HOME = '/home/ana'

/** A machine that is a table of commands, and the questions it was asked, in order. */
interface Machine {
  readonly layer: Layer.Layer<MachineEnvironment>
  readonly asked: readonly string[]
  /** Every path discovery looked for a login at, in the order it looked. */
  readonly logins: readonly string[]
  /** Every package of Hemera's own whose executable was asked for, in the order it was asked. */
  readonly resolved: readonly string[]
}

/** Where a scripted machine keeps the packages this application depends on. */
const MODULES = '/opt/hemera/node_modules'

/**
 * A machine that has exactly the commands and the login files it is given.
 *
 * A command this table does not hold is a command that is not on the `PATH`, which is what a
 * missing agent looks like from discovery's side. A login path it does not hold is a machine that
 * is not signed in — and only the path is asked for, because nothing reads what a login file
 * holds (D5-21).
 */
function machineOf(
  installed: Readonly<Record<string, Installed>>,
  logins: readonly string[] = [],
  carried: readonly string[] = CARRIED,
): Machine {
  const asked: string[] = []
  const sought: string[] = []
  const resolved: string[] = []
  const layer = Layer.succeed(MachineEnvironment, {
    home: HOME,
    env: { PATH: '/usr/local/bin' },
    locate: (command: string) => {
      asked.push(command)
      return Effect.succeed(installed[command]?.path)
    },
    bundled: (packageName: string) => {
      resolved.push(packageName)
      return Effect.succeed(
        carried.includes(packageName) ? join(MODULES, packageName, 'dist', 'index.js') : undefined,
      )
    },
    readVersion: (command: string) => {
      asked.push(`${command} --version`)
      return Effect.succeed(installed[command]?.version)
    },
    holds: (paths: readonly string[]) => {
      sought.push(...paths)
      return Effect.succeed(paths.some((path) => logins.includes(path)))
    },
    read: () => Effect.succeed(undefined),
  })
  return { layer, asked, logins: sought, resolved }
}

/** The adapters this application carries, which a machine has because Hemera does (D5-21). */
const CARRIED: readonly string[] = [
  '@agentclientprotocol/claude-agent-acp',
  '@agentclientprotocol/codex-acp',
]

/** The three agents' own commands, and the lines they really print, as far as they matter here. */
const CLAUDE = { path: '/usr/local/bin/claude', version: '2.0.31 (Claude Code)' }
const CODEX = { path: '/usr/local/bin/codex', version: 'codex-cli 0.154.0' }
const OPENCODE = { path: '/usr/local/bin/opencode', version: '1.18.31' }

/** Runs a program against a scripted machine. Discovery is the only service it asks for. */
async function on<A, E>(machine: Machine, program: Effect.Effect<A, E, Discovery>): Promise<A> {
  return await Effect.runPromise(
    Effect.provide(program, discoveryLayer.pipe(Layer.provide(machine.layer))),
  )
}

/** What the Agents page would be handed for this machine. */
const listing = Effect.gen(function* () {
  const discovery = yield* Discovery
  return yield* discovery.list()
})

/** What starting a Session on this agent would be handed, or the refusal to start one. */
function resolving(id: AgentProvider) {
  return Effect.gen(function* () {
    const discovery = yield* Discovery
    return yield* discovery.resolve(id)
  })
}

describe('The Agents page tells what is available', () => {
  test('each agent is reported found or missing, with the version of the ones that are there', async () => {
    const agents = await on(machineOf({ claude: CLAUDE, opencode: OPENCODE }), listing)

    expect(agents).toEqual([
      {
        id: 'claude',
        label: 'Claude Code',
        found: true,
        path: CLAUDE.path,
        version: '2.0.31',
        authenticated: false,
        installHint: 'npm install -g @anthropic-ai/claude-code',
        loginHint: 'claude auth login',
        // `/usr/local/bin` belongs to nobody: a command there was put by a package manager or by
        // hand, and the path does not tell them apart (D5-18).
        installer: 'unknown',
        latest: null,
      },
      {
        id: 'codex',
        label: 'Codex',
        found: false,
        authenticated: false,
        installHint: 'npm install -g @openai/codex',
        loginHint: 'codex login',
        installer: 'unknown',
        latest: null,
      },
      {
        id: 'opencode',
        label: 'OpenCode',
        found: true,
        path: OPENCODE.path,
        version: '1.18.31',
        authenticated: false,
        installHint: 'npm install -g opencode-ai',
        loginHint: 'opencode auth login',
        installer: 'unknown',
        latest: null,
      },
    ])
    // What the page shows for the one that is missing is the agent's own hint, which is the only
    // thing Hemera can tell someone whose machine does not have Codex — and it is the agent's
    // package, never the one Hemera spawns on its behalf (D5-21).
    expect(codex.installHint).toBe('npm install -g @openai/codex')
  })

  test('an agent that is there but answers no version is still found, without a version', async () => {
    const agents = await on(
      machineOf({ opencode: { path: '/home/ana/.local/bin/opencode' } }),
      listing,
    )

    expect(agents.find((agent) => agent.id === 'opencode')).toEqual({
      id: 'opencode',
      label: 'OpenCode',
      found: true,
      path: '/home/ana/.local/bin/opencode',
      authenticated: false,
      installHint: 'npm install -g opencode-ai',
      loginHint: 'opencode auth login',
      installer: 'unknown',
      latest: null,
    })
  })

  test('the tool a command came from is read off where it was found (D5-18)', async () => {
    const agents = await on(
      machineOf({ claude: { path: '/Users/ana/Library/pnpm/claude' } }),
      listing,
    )

    // Read from the path and never from the command's name, which says nothing about where it
    // came from: `claude` is the same string whichever tool installed it.
    expect(agents.find((agent) => agent.id === 'claude')).toMatchObject({
      found: true,
      installer: 'pnpm',
    })
    // Nobody has asked a registry: this is the machine's answer, and the network is asked for
    // when the Agents section is opened (D5-18).
    expect(agents.every((agent) => agent.latest === null)).toBe(true)
  })

  test('the agents section shows the agent, not its adapter (D5-21)', async () => {
    const machine = machineOf({ claude: CLAUDE, codex: CODEX, opencode: OPENCODE })
    const agents = await on(machine, listing)

    // The three agents, under their own names, with the command and the package their own
    // documentation gives — and never the package Hemera spawns on their behalf.
    expect(agents.map((agent) => agent.id)).toEqual(['claude', 'codex', 'opencode'])
    expect(agents.map((agent) => agent.label)).toEqual(['Claude Code', 'Codex', 'OpenCode'])
    expect(agents.map((agent) => agent.installHint)).toEqual([
      'npm install -g @anthropic-ai/claude-code',
      'npm install -g @openai/codex',
      'npm install -g opencode-ai',
    ])
    expect(agents.map((agent) => agent.loginHint)).toEqual([
      'claude auth login',
      'codex login',
      'opencode auth login',
    ])
    // Looking for the agent's command never reaches for an adapter's: the two packages that
    // expose Claude Code and Codex are Hemera's own business, and this page is about the
    // reader's machine (D5-21).
    expect(machine.asked.some((one) => one.includes('-acp'))).toBe(false)
  })

  test('signed in or not is read from the login file, as a presence and never as a value', async () => {
    const signedIn = join(HOME, '.claude', '.credentials.json')
    const machine = machineOf({ claude: CLAUDE, codex: CODEX, opencode: OPENCODE }, [signedIn])
    const agents = await on(machine, listing)

    expect(agents.map((agent) => agent.authenticated)).toEqual([true, false, false])
    expect(agents.map((agent) => agent.found)).toEqual([true, true, true])
    // Each agent is asked where it keeps the login its own command wrote, and the three paths are
    // the agents' own: nothing else about a login is read, and no file is ever opened.
    expect([...machine.logins].sort()).toEqual([
      join(HOME, '.claude', '.credentials.json'),
      join(HOME, '.codex', 'auth.json'),
      join(HOME, '.local', 'share', 'opencode', 'auth.json'),
    ])
  })

  test('the machine is asked about the three commands and no others: no npx, no download', async () => {
    const machine = machineOf({ claude: CLAUDE, opencode: OPENCODE })
    await on(machine, listing)

    // The three agents' own commands are looked for — that is how the page knows what this
    // machine does not have — and only the two that were found are asked a version. Nothing
    // installs anything, and the command is the agent's own binary rather than `npx`.
    expect([...machine.asked].sort()).toEqual([
      'claude',
      'claude --version',
      'codex',
      'opencode',
      'opencode --version',
    ])
  })

  test('the version is asked of the command itself, without the arguments that start it', async () => {
    const machine = machineOf({ opencode: OPENCODE })
    await on(machine, listing)

    expect(machine.asked).toContain('opencode --version')
    expect(machine.asked).not.toContain('opencode acp')
    expect(machine.asked).not.toContain('opencode acp --version')
  })
})

describe('A missing agent cannot be picked', () => {
  test('resolving an agent this machine does not have is refused, naming that agent', async () => {
    const failure = await on(machineOf({ codex: CODEX }), Effect.flip(resolving('opencode')))

    expect(failure).toBeInstanceOf(AgentNotInstalledError)
    expect(failure.id).toBe('opencode')
  })

  test('no other agent is offered in its place, and none other is even looked for', async () => {
    const machine = machineOf({ claude: CLAUDE }, [join(HOME, '.claude', '.credentials.json')])

    const failure = await on(machine, Effect.flip(resolving('codex')))

    expect(failure.id).toBe('codex')
    // Claude Code is on this machine and signed in; a client that falls back to what is there
    // would have looked it up, and the point of D5-17 is that it does not. What was asked about
    // is Codex's own command, and nothing else.
    expect(machine.asked).toEqual(['codex'])
    // And no adapter was reached for: there is no agent to expose.
    expect(machine.resolved).toEqual([])
  })

  test('an agent that is there resolves to itself and to the command that starts it', async () => {
    const machine = machineOf({ opencode: OPENCODE }, [
      join(HOME, '.local', 'share', 'opencode', 'auth.json'),
    ])

    const resolved = await on(machine, resolving('opencode'))

    // OpenCode speaks ACP itself, so what starts it is its own command with its own subcommand.
    expect(resolved.adapter).toBe(opencode)
    expect(resolved.source).toBe('agent')
    expect(resolved.command).toBe(OPENCODE.path)
    expect(resolved.args).toEqual(['acp'])
    expect(resolved.path).toBe(OPENCODE.path)
    // Nothing of Hemera's own was resolved for it: there is no adapter in the way.
    expect(machine.resolved).toEqual([])
  })

  test('A bundled adapter is found without PATH', async () => {
    // Claude Code is installed and signed in; `claude-agent-acp` is nowhere on the `PATH`,
    // because it is never installed by the reader — it is a dependency of this application.
    const machine = machineOf({ claude: CLAUDE }, [join(HOME, '.claude', '.credentials.json')])

    const resolved = await on(machine, resolving('claude'))

    expect(resolved.source).toBe('bundled')
    expect(machine.resolved).toEqual(['@agentclientprotocol/claude-agent-acp'])
    expect(resolved.path).toBe(
      join(MODULES, '@agentclientprotocol/claude-agent-acp', 'dist', 'index.js'),
    )
    // What is started is the adapter's own entry module, handed to the supervisor as the script
    // it is: nothing here names a Node, because a package of this application has none to name
    // and the fuse that would make Electron one is off.
    expect(resolved.command).toBe(resolved.path)
    expect(resolved.args).toEqual([])
    expect(resolved.env?.ELECTRON_RUN_AS_NODE).toBeUndefined()
    // And the reader's own environment goes with it, because the agent's login is read from it.
    expect(resolved.env?.PATH).toBe('/usr/local/bin')
    // The `PATH` was asked about the agent and never about the adapter (D5-21).
    expect(machine.asked.some((one) => one.includes('-acp'))).toBe(false)
  })

  test('The Claude adapter is told which Claude Code to run', async () => {
    const machine = machineOf({ claude: CLAUDE, codex: CODEX }, [
      join(HOME, '.claude', '.credentials.json'),
      join(HOME, '.codex', 'auth.json'),
    ])

    const claudeAgent = await on(machine, resolving('claude'))
    const codexAgent = await on(machine, resolving('codex'))

    // The adapters carry an optional dependency each that *is* the agent, as a platform binary of
    // a few hundred megabytes, and this application ships neither: each adapter reads one
    // variable to be told which agent to run instead, and it is the reader's own command (D5-21).
    expect(claudeAgent.env?.CLAUDE_CODE_EXECUTABLE).toBe(CLAUDE.path)
    expect(codexAgent.env?.CODEX_PATH).toBe(CODEX.path)
  })

  test('what a session starts is the command Hemera runs, not the one the reader installed', async () => {
    const machine = machineOf({ claude: CLAUDE, codex: CODEX }, [
      join(HOME, '.claude', '.credentials.json'),
      join(HOME, '.codex', 'auth.json'),
    ])

    const claudeAgent = await on(machine, resolving('claude'))
    const codexAgent = await on(machine, resolving('codex'))

    // Neither Claude Code nor Codex speaks ACP itself, so what a Session starts is the adapter
    // Hemera carries, and the agent's own command is only what the reader has (D5-21).
    expect(claudeAgent.path).toBe(
      join(MODULES, '@agentclientprotocol/claude-agent-acp', 'dist', 'index.js'),
    )
    expect(codexAgent.path).toBe(
      join(MODULES, '@agentclientprotocol/codex-acp', 'dist', 'index.js'),
    )
  })

  test('an agent nobody signed in is refused, and its adapter is never reached for', async () => {
    const machine = machineOf({ claude: CLAUDE })

    const failure = await on(machine, Effect.flip(resolving('claude')))

    expect(failure).toBeInstanceOf(AgentNotSignedInError)
    expect(failure.message).toBe('Claude Code is installed but not signed in.')
    expect(machine.resolved).toEqual([])
  })

  test('an installation of Hemera without its adapter says so, and does not blame the agent', async () => {
    const machine = machineOf({ claude: CLAUDE }, [join(HOME, '.claude', '.credentials.json')], [])

    const failure = await on(machine, Effect.flip(resolving('claude')))

    expect(failure).toBeInstanceOf(AgentAdapterMissingError)
    expect(failure.message).toContain('this installation of Hemera is missing')
  })

  test('the two adapters this application depends on are where it says they are', async () => {
    // The real resolution, out of this repository's own `node_modules`: the packages are
    // dependencies of `@hemera/desktop`, so their executables are there to be run.
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const environment = yield* MachineEnvironment
        return yield* Effect.forEach(
          ['@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/codex-acp'],
          (packageName) => environment.bundled(packageName),
        )
      }).pipe(Effect.provide(machineEnvironmentLayer)),
    )

    expect(found.every((path) => path !== undefined)).toBe(true)
    expect(found[0]).toContain('claude-agent-acp')
    expect(found[1]).toContain('codex-acp')
  })
})

describe('The command is looked for on the PATH the user already has', () => {
  test('on Windows, under the extensions Windows itself searches', () => {
    expect(shimsOf('claude-agent-acp', true, ['.COM', '.EXE', '.BAT', '.CMD'])).toEqual([
      'claude-agent-acp.COM',
      'claude-agent-acp.EXE',
      'claude-agent-acp.BAT',
      'claude-agent-acp.CMD',
      'claude-agent-acp',
    ])
  })

  test('a command that already names its file is looked for as it is', () => {
    expect(shimsOf('opencode.cmd', true, ['.COM', '.EXE', '.BAT', '.CMD'])).toEqual([
      'opencode.cmd',
    ])
  })

  test('anywhere else, a command is its own name and nothing more', () => {
    expect(shimsOf('opencode', false, ['.CMD'])).toEqual(['opencode'])
  })

  test('this process reads the real PATH, and asks the command it finds its version', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hemera-discovery-'))
    const windows = process.platform === 'win32'
    const name = windows ? 'fake-agent.cmd' : 'fake-agent'
    // A command that answers a version and nothing else: an agent, from the machine's side.
    const body = windows ? '@echo 9.9.9\r\n' : '#!/bin/sh\necho 9.9.9\n'
    writeFileSync(join(directory, name), body, { mode: 0o755 })
    const pathBefore = process.env.PATH
    process.env.PATH = directory

    try {
      const found = await Effect.runPromise(
        Effect.gen(function* () {
          const environment = yield* MachineEnvironment
          const path = yield* environment.locate('fake-agent')
          const output = yield* environment.readVersion('fake-agent')
          return { path, output }
        }).pipe(Effect.provide(machineEnvironmentLayer)),
      )

      // The name comes back as the file system spells it, on both platforms: Windows searches
      // `PATHEXT` against a file system that is not case-sensitive, and what a caller does with
      // what it finds is run it — a `fake-agent.CMD` a `.cmd` file only answers to by case is a
      // name `cmd` would look for and not find. The version is asked of the same file, through
      // the interpreter a `.cmd` needs there.
      const asWritten = join(directory, name)
      expect(found.path).toBe(asWritten)
      expect(found.output?.trim()).toBe('9.9.9')
    } finally {
      if (pathBefore === undefined) delete process.env.PATH
      else process.env.PATH = pathBefore
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
