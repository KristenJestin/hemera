/**
 * How a bundled ACP adapter is started, and where it is found (D5-21, D5-04).
 *
 * Each suite is named after the scenario it covers. Nothing here starts a process: the supervisor
 * is handed a machine that records what it was asked to start, which is the whole question — a
 * package of this application has no Node to run a script with, so what the engine must never do
 * is name one, and what it must do is hand the script over as a script.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import { MachineEnvironment, machineEnvironmentLayer } from '#engine/agents/discovery.ts'
import {
  HostProcesses,
  type HostProcess,
  type HostProcessOptions,
  ProcessSupervisor,
  StderrSink,
  processSupervisorLayer,
} from '#engine/agents/supervisor.ts'

/** The adapter these suites look for, named as this application depends on it. */
const ADAPTER = '@agentclientprotocol/claude-agent-acp'

/** One thing the supervisor was asked to start, as the machine below heard it. */
interface Started {
  readonly command: string
  readonly args: readonly string[]
  readonly options: HostProcessOptions
}

/** A machine that starts nothing and remembers everything it was asked to start. */
function machineOf() {
  const started: Started[] = []
  const layer = Layer.succeed(HostProcesses, {
    start: (command, args, options): HostProcess => {
      started.push({ command, args, options })
      let spawned: (() => void) | undefined
      // The spawn is answered on the next turn, as a real one is: the supervisor attaches its
      // listeners before it waits, and a spawn announced inside `start` would be announced to
      // nobody.
      queueMicrotask(() => {
        spawned?.()
      })
      return {
        pid: 4242,
        write: () => true,
        end: () => undefined,
        signal: () => undefined,
        onSpawn: (listener) => {
          spawned = listener
        },
        onExit: () => undefined,
        onFailure: () => undefined,
        onStderr: () => undefined,
        onStdout: () => undefined,
      }
    },
    killTree: () => Effect.void,
  })
  return { layer, started }
}

/** The supervisor over such a machine, with a sink that keeps what a child says to itself. */
function supervising(layer: Layer.Layer<HostProcesses>) {
  return processSupervisorLayer.pipe(
    Layer.provide(layer),
    Layer.provide(Layer.succeed(StderrSink, { write: () => Effect.void })),
  )
}

describe('A bundled adapter is launched without running Electron as Node', () => {
  test('what is started is the script itself, handed over as one', async () => {
    const machine = machineOf()

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const supervisor = yield* ProcessSupervisor
          yield* supervisor.start('/opt/hemera/adapters/claude-agent-acp/dist/index.js', [], {
            cwd: '/home/ana/project',
            env: { PATH: '/usr/local/bin', CLAUDE_CODE_EXECUTABLE: '/usr/local/bin/claude' },
            script: true,
          })
        }),
      ).pipe(Effect.provide(supervising(machine.layer))),
    )

    const [started] = machine.started
    // The script is the command, and there is no interpreter in front of it: a package of this
    // application has none to name, and the fuse that would make Electron one is off.
    expect(started?.command).toBe('/opt/hemera/adapters/claude-agent-acp/dist/index.js')
    expect(started?.args).toEqual([])
    expect(started?.options.runtime).toBe('script')
    expect(started?.options.env?.ELECTRON_RUN_AS_NODE).toBeUndefined()
    // And it is never a group of its own: a utility process is not started detached, whatever
    // the platform, so a stop takes its tree down by pid rather than by signalling a group.
    expect(started?.options.detached).toBe(false)
  })

  test("an agent's own command is still spawned as a command", async () => {
    const machine = machineOf()

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const supervisor = yield* ProcessSupervisor
          yield* supervisor.start('/usr/local/bin/opencode', ['acp'], { cwd: '/home/ana/project' })
        }),
      ).pipe(Effect.provide(supervising(machine.layer))),
    )

    expect(machine.started[0]?.options.runtime).toBe('command')
  })
})

describe('A packaged adapter is found under the resources folder', () => {
  test('a package carries its adapters beside the archive, and the engine looks there first', async () => {
    const resources = mkdtempSync(join(tmpdir(), 'hemera-resources-'))
    const carried = join(resources, 'adapters', 'node_modules', ...ADAPTER.split('/'))
    mkdirSync(join(carried, 'dist'), { recursive: true })
    writeFileSync(join(carried, 'dist', 'index.js'), '')
    writeFileSync(
      join(carried, 'package.json'),
      JSON.stringify({ name: ADAPTER, bin: { 'claude-agent-acp': 'dist/index.js' } }),
    )

    // Electron sets it and declares it read-only; a suite runs on plain Node, where it is not
    // there at all and putting it there is how a package is read from a folder of one's own.
    const was = process.resourcesPath
    Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true })
    try {
      const found = await Effect.runPromise(
        Effect.gen(function* () {
          const machine = yield* MachineEnvironment
          return yield* machine.bundled(ADAPTER)
        }).pipe(Effect.provide(machineEnvironmentLayer)),
      )

      expect(found).toBe(join(carried, 'dist', 'index.js'))
    } finally {
      Object.defineProperty(process, 'resourcesPath', { value: was, configurable: true })
      rmSync(resources, { recursive: true, force: true })
    }
  })

  test('a development run falls back to the node_modules this repository has', async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const machine = yield* MachineEnvironment
        return yield* machine.bundled(ADAPTER)
      }).pipe(Effect.provide(machineEnvironmentLayer)),
    )

    expect(found).toContain('claude-agent-acp')
    expect(found).not.toContain('resources')
  })
})
