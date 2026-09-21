/**
 * The agents on this machine, and what the Agents page can say about them (D5-02, D5-17).
 *
 * Each suite is named after the scenario of the issue's `Spec · agent-runtime` section that it
 * covers. The machine is scripted here: the `PATH` lookup and the version probes are handed to
 * discovery, so a suite reads what the settings page reads without finding this machine's
 * agents, starting one of them, or downloading anything. What the scripted machine was asked is
 * recorded, which is how a suite can say that no other agent was reached for — the point of
 * D5-17 being that a missing agent is reported, never replaced.
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
  AgentNotInstalledError,
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

/** A machine that is a table of commands, and the questions it was asked, in order. */
interface Machine {
  readonly layer: Layer.Layer<MachineEnvironment>
  readonly asked: readonly string[]
}

/**
 * A machine that has exactly the commands it is given.
 *
 * A command this table does not hold is a command that is not on the `PATH`, which is what a
 * missing agent looks like from discovery's side.
 */
function machineOf(installed: Readonly<Record<string, Installed>>): Machine {
  const asked: string[] = []
  const layer = Layer.succeed(MachineEnvironment, {
    locate: (command: string) => {
      asked.push(command)
      return Effect.succeed(installed[command]?.path)
    },
    readVersion: (command: string) => {
      asked.push(`${command} --version`)
      return Effect.succeed(installed[command]?.version)
    },
  })
  return { layer, asked }
}

/** The version lines the three agents really print, as far as they matter here. */
const CLAUDE = { path: '/usr/local/bin/claude-agent-acp', version: 'claude-agent-acp 0.78.0' }
const CODEX = { path: '/usr/local/bin/codex-acp', version: '1.12.0' }
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
    const agents = await on(machineOf({ 'claude-agent-acp': CLAUDE, opencode: OPENCODE }), listing)

    expect(agents).toEqual([
      {
        id: 'claude',
        label: 'Claude Code',
        found: true,
        path: CLAUDE.path,
        version: '0.78.0',
        authenticated: false,
      },
      { id: 'codex', label: 'Codex', found: false, authenticated: false },
      {
        id: 'opencode',
        label: 'OpenCode',
        found: true,
        path: OPENCODE.path,
        version: '1.18.31',
        authenticated: false,
      },
    ])
    // What the page shows for the one that is missing is its adapter's own hint, which is the
    // only thing Hemera can tell someone whose machine does not have Codex.
    expect(codex.installHint).toBe('npm install -g @agentclientprotocol/codex-acp')
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
    })
  })

  test('nothing is claimed about signing in, because nothing has been started', async () => {
    const agents = await on(
      machineOf({ 'claude-agent-acp': CLAUDE, 'codex-acp': CODEX, opencode: OPENCODE }),
      listing,
    )

    expect(agents.map((agent) => agent.authenticated)).toEqual([false, false, false])
    expect(agents.map((agent) => agent.found)).toEqual([true, true, true])
  })

  test('the machine is asked about the three commands and no others: no npx, no download', async () => {
    const machine = machineOf({ 'claude-agent-acp': CLAUDE, opencode: OPENCODE })
    await on(machine, listing)

    // The three commands are looked for — that is how the page knows what this machine does not
    // have — and only the two that were found are asked a version. Nothing installs anything,
    // and the command is the agent's own binary rather than `npx`.
    expect([...machine.asked].sort()).toEqual([
      'claude-agent-acp',
      'claude-agent-acp --version',
      'codex-acp',
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
    const failure = await on(machineOf({ 'codex-acp': CODEX }), Effect.flip(resolving('opencode')))

    expect(failure).toBeInstanceOf(AgentNotInstalledError)
    expect(failure.id).toBe('opencode')
  })

  test('no other agent is offered in its place, and none other is even looked for', async () => {
    const machine = machineOf({ 'claude-agent-acp': CLAUDE })

    const failure = await on(machine, Effect.flip(resolving('codex')))

    expect(failure.id).toBe('codex')
    // Claude Code is on this machine; a client that falls back to what is there would have
    // looked it up, and the point of D5-17 is that it does not.
    expect(machine.asked).toEqual(['codex-acp'])
  })

  test('an agent that is there resolves to itself and to the command that starts it', async () => {
    const machine = machineOf({ opencode: OPENCODE })

    const resolved = await on(machine, resolving('opencode'))

    expect(resolved.adapter).toBe(opencode)
    expect(resolved.adapter.args).toEqual(['acp'])
    expect(resolved.path).toBe(OPENCODE.path)
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

      expect(found.path).toBe(join(directory, name))
      expect(found.output?.trim()).toBe('9.9.9')
    } finally {
      if (pathBefore === undefined) delete process.env.PATH
      else process.env.PATH = pathBefore
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
