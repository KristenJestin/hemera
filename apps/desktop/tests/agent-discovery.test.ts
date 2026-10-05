/**
 * Discovery: the agents this machine has, found on the `PATH` (never `npx`), their versions read
 * in the background, signed in from their login files, the tool that installed them read from
 * their path; and what a session start resolves, or the typed refusal it meets.
 *
 * The machine is a port: most suites hand discovery a table of commands and record what it was
 * asked. The real machine is run against small scripts written into temporary folders.
 */

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  AgentAdapterMissing,
  AgentNotInstalled,
  AgentNotSignedIn,
  BareModeNotQualified,
  NotQualified,
  Qualified,
} from '@hemera/ipc'
import { Deferred, Effect, Layer, Schedule } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { opencode } from '../src/engine/agents/adapters/opencode.ts'
import { NOT_RUN_ON_LINUX } from '../src/engine/agents/adapters/opencode.ts'
import {
  Discovery,
  Machine,
  type MachineService,
  bundledEntry,
  discoveryLayer,
  machineLayer,
} from '../src/engine/agents/discovery.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

afterEach(removeFolders)

const HOME = '/home/ana'
const CLAUDE_LOGIN = join(HOME, '.claude', '.credentials.json')
const OPENCODE_LOGIN = join(HOME, '.local', 'share', 'opencode', 'auth.json')

/** What a scripted machine was asked, in order. */
interface Asked {
  readonly located: string[]
  readonly probed: string[]
  readonly bundled: string[]
}

/** A machine that has the commands, logins and bundled adapters it is given, and no others. */
const scripted = (
  commands: Readonly<Record<string, { readonly path: string; readonly prints?: string }>>,
  options: {
    readonly logins?: ReadonlyArray<string>
    readonly bundled?: ReadonlyArray<string>
    readonly platform?: NodeJS.Platform
    readonly files?: Readonly<Record<string, string>>
    /** Held until it completes: every version probe waits on it. */
    readonly gate?: Deferred.Deferred<void>
  } = {},
) => {
  const asked: Asked = { located: [], probed: [], bundled: [] }
  const service: MachineService = {
    home: HOME,
    env: {},
    platform: options.platform ?? 'win32',
    locate: (command) =>
      Effect.sync(() => {
        asked.located.push(command)
        return commands[command]?.path ?? null
      }),
    version: (path) =>
      Effect.gen(function* () {
        asked.probed.push(path)
        if (options.gate !== undefined) yield* Deferred.await(options.gate)
        return Object.values(commands).find((one) => one.path === path)?.prints ?? null
      }),
    exists: (paths) => Effect.succeed(paths.some((path) => options.logins?.includes(path))),
    read: (path) => Effect.succeed(options.files?.[path]),
    bundled: (packageName) =>
      Effect.sync(() => {
        asked.bundled.push(packageName)
        return (options.bundled ?? BUNDLED).includes(packageName)
          ? join('/opt/hemera', packageName, 'dist', 'index.js')
          : null
      }),
  }
  return { asked, layer: Layer.succeed(Machine, service) }
}

const BUNDLED = ['@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/codex-acp']

const CLAUDE = { path: '/home/ana/.npm-global/bin/claude', prints: '2.0.31 (Claude Code)' }
const CODEX = { path: '/usr/local/bin/codex', prints: 'codex-cli 0.154.0' }
const OPENCODE = { path: '/home/ana/.bun/bin/opencode', prints: '1.18.31' }

const on = <A, E>(
  machine: Layer.Layer<Machine>,
  program: Effect.Effect<A, E, Discovery>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(Effect.provide(program, discoveryLayer.pipe(Layer.provide(machine)))),
  )

/** Asks again until `done` holds of the answer. */
const until = <A, E, R>(ask: Effect.Effect<A, E, R>, done: (answer: A) => boolean) =>
  ask.pipe(
    Effect.filterOrFail(done, () => new Error('not yet')),
    Effect.retry({ times: 400, schedule: Schedule.spaced('5 millis') }),
    Effect.orDie,
  )

describe('Listing the agents', () => {
  test('each agent is installed or not, signed in from its login file, with its installer', async () => {
    const { layer } = scripted(
      { claude: CLAUDE, opencode: OPENCODE },
      { logins: [CLAUDE_LOGIN], platform: 'win32' },
    )
    const agents = await on(
      layer,
      Discovery.use((discovery) => discovery.list),
    )

    expect(
      agents.map((agent) => [agent.id, agent.installed, agent.signedIn, agent.installer]),
    ).toEqual([
      ['claude', true, true, 'npm'],
      ['codex', false, false, 'unknown'],
      ['opencode', true, false, 'bun'],
    ])
    expect(agents.map((agent) => agent.path)).toEqual([CLAUDE.path, null, OPENCODE.path])
    for (const agent of agents) expect(agent.qualification).toEqual(Qualified.make({}))
  })

  test('an agent not qualified on this OS is listed with its reason', async () => {
    const { layer } = scripted({ opencode: OPENCODE }, { platform: 'linux' })
    const agents = await on(
      layer,
      Discovery.use((discovery) => discovery.list),
    )
    expect(agents.find((agent) => agent.id === 'opencode')?.qualification).toEqual(
      NotQualified.make({ reason: NOT_RUN_ON_LINUX }),
    )
    expect(agents.find((agent) => agent.id === 'claude')?.qualification).toEqual(Qualified.make({}))
  })

  test('only the three agents’ own commands are looked for: no npx, no adapter', async () => {
    const { asked, layer } = scripted({ claude: CLAUDE })
    await on(
      layer,
      Discovery.use((discovery) => discovery.list),
    )
    expect([...asked.located].sort()).toEqual(['claude', 'codex', 'opencode'])
    expect(asked.bundled).toEqual([])
  })
})

describe('Listing the agents answers while a version probe is still running', () => {
  test('the first list has no version yet, a later one has it, and each path is probed once at a time', async () => {
    const gate = Deferred.makeUnsafe<void>()
    const { asked, layer } = scripted({ claude: CLAUDE, codex: CODEX }, { gate })

    const seen = await on(
      layer,
      Effect.gen(function* () {
        const discovery = yield* Discovery
        const first = yield* discovery.list
        const second = yield* discovery.list
        const probedWhileRunning = yield* until(
          Effect.sync(() => [...asked.probed]),
          (probed) => probed.length >= 2,
        )
        yield* Deferred.succeed(gate, undefined)
        const later = yield* until(discovery.list, (agents) =>
          agents.every((agent) => !agent.installed || agent.version !== null),
        )
        return { first, second, probedWhileRunning, later }
      }),
    )

    expect(seen.first.map((agent) => agent.version)).toEqual([null, null, null])
    expect(seen.second.map((agent) => agent.version)).toEqual([null, null, null])
    // Two lists, one probe per path: the second joined the one still running.
    expect(seen.probedWhileRunning.sort()).toEqual([CODEX.path, CLAUDE.path].sort())
    expect(seen.later.map((agent) => agent.version)).toEqual(['2.0.31', '0.154.0', null])
  })

  test('a known version is answered at once and refreshed in the background', async () => {
    const { asked, layer } = scripted({ claude: CLAUDE })
    const count = await on(
      layer,
      Effect.gen(function* () {
        const discovery = yield* Discovery
        yield* until(discovery.list, (agents) => agents[0]?.version === '2.0.31')
        yield* until(discovery.list, () => asked.probed.length >= 2)
        return asked.probed.length
      }),
    )
    expect(count).toBeGreaterThanOrEqual(2)
  })
})

describe('Resolving an agent for a session', () => {
  test('a bundled adapter is told which agent to run, and no version is asked', async () => {
    const { asked, layer } = scripted({ claude: CLAUDE }, { logins: [CLAUDE_LOGIN] })
    const resolved = await on(
      layer,
      Discovery.use((discovery) => discovery.resolve('claude')),
    )
    expect(resolved.from).toBe('bundled')
    expect(resolved.program).toBe(
      join('/opt/hemera', '@agentclientprotocol/claude-agent-acp', 'dist', 'index.js'),
    )
    expect(resolved.args).toEqual([])
    expect(resolved.env).toEqual({ CLAUDE_CODE_EXECUTABLE: CLAUDE.path })
    expect(asked.probed).toEqual([])
  })

  test("OpenCode is its own command with acp, and keeps the user's model", async () => {
    const configuration = join(HOME, '.config', 'opencode', 'opencode.json')
    const { asked, layer } = scripted(
      { opencode: OPENCODE },
      {
        logins: [OPENCODE_LOGIN],
        files: { [configuration]: '{"model":"anthropic/sonnet","provider":{"x":{"apiKey":"k"}}}' },
      },
    )
    const resolved = await on(
      layer,
      Discovery.use((discovery) => discovery.resolve('opencode')),
    )
    expect(resolved).toMatchObject({
      from: 'agent',
      program: OPENCODE.path,
      args: ['acp'],
      env: {},
    })
    expect(resolved.adapter).toBe(opencode)
    expect(resolved.own).toEqual({ model: 'anthropic/sonnet' })
    expect(asked.bundled).toEqual([])
  })

  test('an agent this machine does not have is refused as not installed, and no other is looked for', async () => {
    const { asked, layer } = scripted({ claude: CLAUDE }, { logins: [CLAUDE_LOGIN] })
    const refused = await on(
      layer,
      Effect.flip(Discovery.use((discovery) => discovery.resolve('codex'))),
    )
    expect(refused).toBeInstanceOf(AgentNotInstalled)
    expect(refused.message).toBe('Codex is not installed on this machine.')
    expect(asked.located).toEqual(['codex'])
  })

  test('an agent nobody signed in is refused as not signed in', async () => {
    const { asked, layer } = scripted({ claude: CLAUDE })
    const refused = await on(
      layer,
      Effect.flip(Discovery.use((discovery) => discovery.resolve('claude'))),
    )
    expect(refused).toBeInstanceOf(AgentNotSignedIn)
    expect(refused.message).toContain('claude auth login')
    expect(asked.bundled).toEqual([])
  })

  test('an installation of Hemera without its adapter is refused as adapter missing', async () => {
    const { layer } = scripted(
      { codex: CODEX },
      {
        logins: [join(HOME, '.codex', 'auth.json')],
        bundled: [],
      },
    )
    const refused = await on(
      layer,
      Effect.flip(Discovery.use((discovery) => discovery.resolve('codex'))),
    )
    expect(refused).toBeInstanceOf(AgentAdapterMissing)
    expect(refused.message).toContain('@agentclientprotocol/codex-acp')
  })

  test('an unqualified agent and OS pair is refused with its reason, before anything is looked for', async () => {
    const { asked, layer } = scripted(
      { opencode: OPENCODE },
      { logins: [OPENCODE_LOGIN], platform: 'linux' },
    )
    const refused = await on(
      layer,
      Effect.flip(Discovery.use((discovery) => discovery.resolve('opencode'))),
    )
    expect(refused).toBeInstanceOf(BareModeNotQualified)
    expect(refused.message).toContain(NOT_RUN_ON_LINUX)
    expect(asked.located).toEqual([])
  })
})

describe('The real machine', () => {
  const script = (folder: string, name: string, body: string) => {
    const path = join(folder, name)
    writeFileSync(path, `#!/bin/sh\n${body}\n`)
    chmodSync(path, 0o755)
    return path
  }

  test.skipIf(process.platform === 'win32')(
    'finds a command on the PATH and reads its version',
    async () => {
      const folder = temporaryFolder('agents-path')
      const path = script(folder, 'fake-agent', 'echo "fake-agent 9.9.9"')
      const found = await Effect.runPromise(
        Machine.use((machine) =>
          Effect.all([machine.locate('fake-agent'), machine.version(path), machine.locate('npx')]),
        ).pipe(Effect.provide(machineLayer({ PATH: folder }, 'linux'))),
      )
      expect(found).toEqual([path, 'fake-agent 9.9.9\n', null])
    },
  )

  test.skipIf(process.platform === 'win32')(
    'a version probe that does not answer in time is a version not known',
    async () => {
      const folder = temporaryFolder('agents-slow')
      const path = script(
        folder,
        'slow-agent',
        `"${process.execPath}" -e "setTimeout(() => console.log('1.0.0'), 5000)"`,
      )
      const started = Date.now()
      const version = await Effect.runPromise(
        Machine.use((machine) => machine.version(path)).pipe(
          Effect.provide(machineLayer({ PATH: folder }, 'linux', 200)),
        ),
      )
      expect(version).toBeNull()
      expect(Date.now() - started).toBeLessThan(4_000)
    },
  )

  test('on Windows, a command is found under PATHEXT, as its .cmd shim', async () => {
    const folder = temporaryFolder('agents-pathext')
    writeFileSync(join(folder, 'codex.cmd'), '@echo 1.0.0\r\n')
    const found = await Effect.runPromise(
      Machine.use((machine) => machine.locate('codex')).pipe(
        Effect.provide(machineLayer({ PATH: folder, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, 'win32')),
      ),
    )
    expect(found).toBe(join(folder, 'codex.cmd'))
  })

  test('the bundled adapters resolve from the development node_modules', () => {
    for (const packageName of BUNDLED) {
      const entry = bundledEntry(packageName, undefined)
      expect(entry).toContain(join(packageName, 'dist', 'index.js'))
    }
    expect(bundledEntry('@hemera/no-such-adapter', undefined)).toBeNull()
  })

  test('the bundled adapters resolve from the packaged resources first, outside the asar', () => {
    const resources = temporaryFolder('agents-resources')
    const carried = join(resources, 'adapters', 'node_modules', '@agentclientprotocol', 'codex-acp')
    mkdirSync(join(carried, 'dist'), { recursive: true })
    writeFileSync(join(carried, 'package.json'), '{"bin":{"codex-acp":"dist/index.js"}}')
    writeFileSync(join(carried, 'dist', 'index.js'), '')
    expect(bundledEntry('@agentclientprotocol/codex-acp', resources)).toBe(
      join(carried, 'dist', 'index.js'),
    )
  })
})
