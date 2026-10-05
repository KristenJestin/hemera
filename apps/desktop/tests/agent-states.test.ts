/**
 * The agents with their state, "check for updates" and "update": what the RPC group serves.
 *
 * Discovery, the registry and the updater are ports here. The real registry is asked of a server
 * on the loopback interface, the real updater runs small scripts: no network, no package manager.
 */

import { chmodSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'

import { AgentUpdateRefused, Qualified } from '@hemera/ipc'
import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { ADAPTERS } from '../src/engine/agents/adapters/index.ts'
import { type DiscoveredAgent, Discovery } from '../src/engine/agents/discovery.ts'
import {
  AgentRegistry,
  AgentUpdater,
  installerOf,
  registryLayer,
  updateCommandFor,
  updaterLayer,
} from '../src/engine/agents/installer.ts'
import { Agents, LATEST_STANDS_MS, agentsLayer } from '../src/engine/agents/service.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

afterEach(removeFolders)

const found = (
  id: DiscoveredAgent['id'],
  path: string | null,
  installer: DiscoveredAgent['installer'],
): DiscoveredAgent => ({
  id,
  label: ADAPTERS[id].label,
  installed: path !== null,
  path,
  version: path === null ? null : '1.0.0',
  signedIn: true,
  installer,
  qualification: Qualified.make({}),
  installHint: ADAPTERS[id].installHint,
  loginHint: ADAPTERS[id].loginHint,
})

const MACHINE = [
  found('claude', '/home/ana/Library/pnpm/claude', 'pnpm'),
  found('codex', null, 'unknown'),
  found('opencode', '/usr/local/bin/opencode', 'unknown'),
]

/** What the ports were asked, in order. */
interface Asked {
  readonly registry: string[]
  readonly updates: string[][]
  readonly probed: string[]
}

const service = (latest: string | null, answered: Effect.Effect<void> = Effect.void) => {
  const asked: Asked = {
    registry: [],
    updates: [],
    probed: [],
  }
  const layer = agentsLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Discovery, {
          list: Effect.succeed(MACHINE),
          probe: (path) =>
            Effect.sync(() => {
              asked.probed.push(path)
              return '2.0.0'
            }),
          resolve: () => Effect.die('not resolved here'),
        }),
        Layer.succeed(AgentRegistry, {
          latest: (adapter) =>
            Effect.sync(() => asked.registry.push(adapter.id)).pipe(
              Effect.andThen(answered),
              Effect.as(latest),
            ),
        }),
        Layer.succeed(AgentUpdater, {
          run: (words) =>
            Effect.sync(() => {
              asked.updates.push([...words])
              return 'added 1 package'
            }),
        }),
      ),
    ),
  )
  const run = <A, E>(program: Effect.Effect<A, E, Agents>) =>
    Effect.runPromise(Effect.provide(program, layer))
  return { asked, run }
}

describe('The installer is read from the path', () => {
  test.each([
    ['/home/ana/.vite-plus/bin/claude', 'vp'],
    ['/home/ana/.vite-plus/packages/@anthropic-ai/claude-code/node_modules/.bin/claude', 'vp'],
    ['C:\\Users\\ana\\.vite-plus\\bin\\codex.cmd', 'vp'],
    ['/opt/homebrew/bin/opencode', 'brew'],
    ['/usr/local/Cellar/opencode/0.9.1/bin/opencode', 'brew'],
    ['/home/linuxbrew/.linuxbrew/bin/codex', 'brew'],
    ['/Users/ana/.bun/bin/claude', 'bun'],
    ['/Users/ana/Library/pnpm/codex', 'pnpm'],
    ['/home/ana/.local/share/pnpm/global/5/node_modules/.bin/codex', 'pnpm'],
    ['/usr/local/lib/node_modules/@openai/codex/bin/codex.js', 'npm'],
    ['/home/ana/.nvm/versions/node/v22.0.0/bin/claude', 'npm'],
    ['C:\\Users\\ana\\AppData\\Roaming\\npm\\codex.cmd', 'npm'],
    ['/usr/local/bin/opencode', 'unknown'],
    ['/home/ana/bin/claude', 'unknown'],
  ] as const)('%s is %s', (path, installer) => {
    expect(installerOf(path)).toBe(installer)
  })
})

describe("The update is the installer's own global update", () => {
  test('per installer, with the agent’s package (or formula for brew), never for unknown', () => {
    expect(updateCommandFor(ADAPTERS.opencode, 'npm')).toEqual([
      'npm',
      'install',
      '--global',
      'opencode-ai',
    ])
    expect(updateCommandFor(ADAPTERS.claude, 'pnpm')).toEqual([
      'pnpm',
      'add',
      '--global',
      '@anthropic-ai/claude-code',
    ])
    expect(updateCommandFor(ADAPTERS.codex, 'bun')).toEqual([
      'bun',
      'add',
      '--global',
      '@openai/codex',
    ])
    expect(updateCommandFor(ADAPTERS.claude, 'vp')).toEqual([
      'vp',
      'update',
      '--global',
      '@anthropic-ai/claude-code',
    ])
    expect(updateCommandFor(ADAPTERS.opencode, 'brew')).toEqual(['brew', 'upgrade', 'opencode'])
    expect(updateCommandFor(ADAPTERS.opencode, 'unknown')).toBeNull()
  })
})

describe('The agents with their state', () => {
  test('listing waits on no registry, and gives each agent its state', async () => {
    const { run } = service('9.9.9', Effect.never)
    const agents = await run(Agents.use((one) => one.list))
    expect(agents.map((agent) => [agent.id, agent.installed, agent.version, agent.latest])).toEqual(
      [
        ['claude', true, '1.0.0', null],
        ['codex', false, null, null],
        ['opencode', true, '1.0.0', null],
      ],
    )
    expect(agents[0]).toMatchObject({
      label: 'Claude Code',
      signedIn: true,
      installer: 'pnpm',
      qualification: Qualified.make({}),
    })
  })

  test('listing checks for updates by itself, in the background, and a later list says what it found', async () => {
    const { asked, run } = service('9.9.9')
    const [first, later] = await run(
      Effect.gen(function* () {
        const before = yield* Agents.use((one) => one.list)
        yield* Effect.yieldNow
        return [before, yield* Agents.use((one) => one.list)] as const
      }),
    )
    expect(first.map((agent) => agent.latest)).toEqual([null, null, null])
    expect(later.map((agent) => agent.latest)).toEqual(['9.9.9', null, '9.9.9'])
    expect(asked.registry).toEqual(['claude', 'opencode'])
  })

  test('the registry is asked again only once its answer is stale, and never twice at a time', async () => {
    const { asked, run } = service('9.9.9')
    await run(
      Effect.gen(function* () {
        yield* Agents.use((one) => one.list)
        yield* Agents.use((one) => one.list)
        yield* Effect.yieldNow
        yield* Agents.use((one) => one.list)
        yield* Effect.yieldNow
        expect(asked.registry).toEqual(['claude', 'opencode'])
        yield* TestClock.adjust(LATEST_STANDS_MS)
        yield* Agents.use((one) => one.list)
        yield* Effect.yieldNow
      }).pipe(Effect.provide(TestClock.layer())),
    )
    expect(asked.registry).toEqual(['claude', 'opencode', 'claude', 'opencode'])
  })

  test('what a check found is what a later list says', async () => {
    const { asked, run } = service('9.9.9')
    const listed = await run(
      Effect.gen(function* () {
        yield* Agents.use((one) => one.checkUpdates)
        return yield* Agents.use((one) => one.list)
      }),
    )
    expect(listed.map((agent) => agent.latest)).toEqual(['9.9.9', null, '9.9.9'])
    expect(asked.registry).toEqual(['claude', 'opencode'])
  })

  test('checking for updates asks the registry of every installed agent, whatever its installer', async () => {
    const { asked, run } = service('9.9.9')
    const agents = await run(Agents.use((one) => one.checkUpdates))
    expect(asked.registry).toEqual(['claude', 'opencode'])
    expect(agents.map((agent) => agent.latest)).toEqual(['9.9.9', null, '9.9.9'])
  })

  test('update runs the installer’s update and answers what it printed and the new version', async () => {
    const { asked, run } = service(null)
    const done = await run(Agents.use((one) => one.update('claude')))
    expect(asked.updates).toEqual([['pnpm', 'add', '--global', '@anthropic-ai/claude-code']])
    expect(asked.probed).toEqual(['/home/ana/Library/pnpm/claude'])
    expect(done).toEqual({ output: 'added 1 package', version: '2.0.0' })
  })

  test('an agent installed by an unknown tool is never updated', async () => {
    const { asked, run } = service(null)
    const refused = await run(Effect.flip(Agents.use((one) => one.update('opencode'))))
    expect(refused).toBeInstanceOf(AgentUpdateRefused)
    expect(refused.message).toContain('OpenCode')
    expect(asked.updates).toEqual([])
  })

  test('an agent that is not installed is not updated', async () => {
    const { asked, run } = service(null)
    const refused = await run(Effect.flip(Agents.use((one) => one.update('codex'))))
    expect(refused.message).toContain('Codex is not installed')
    expect(asked.updates).toEqual([])
  })
})

describe('The registry is read with a time limit', () => {
  const serving = async (answer: (url: string) => string | null) => {
    const server = createServer((request, response) => {
      const body = answer(request.url ?? '')
      if (body !== null) response.end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    // SAFETY: a server listening on a TCP port answers its address as an object.
    const { port } = server.address() as AddressInfo
    const base = `http://127.0.0.1:${port}`
    return { addresses: { npm: `${base}/npm`, brew: `${base}/brew` }, close: () => server.close() }
  }

  test('npm for an npm install, the formula for a brew one', async () => {
    const published = new Map([
      ['/npm/@anthropic-ai%2Fclaude-code/latest', '{"version":"2.1.0"}'],
      ['/brew/opencode.json', '{"versions":{"stable":"1.20.0"}}'],
    ])
    const server = await serving((url) => published.get(url) ?? '{}')
    try {
      const latest = await Effect.runPromise(
        AgentRegistry.use((registry) =>
          Effect.all([
            registry.latest(ADAPTERS.claude, 'npm'),
            registry.latest(ADAPTERS.opencode, 'brew'),
            registry.latest(ADAPTERS.codex, 'npm'),
          ]),
        ).pipe(Effect.provide(registryLayer(server.addresses, 2_000))),
      )
      expect(latest).toEqual(['2.1.0', '1.20.0', null])
    } finally {
      server.close()
    }
  })

  test('a registry that does not answer in time leaves the latest version unknown', async () => {
    const server = await serving(() => null)
    try {
      const started = Date.now()
      const latest = await Effect.runPromise(
        AgentRegistry.use((registry) => registry.latest(ADAPTERS.claude, 'npm')).pipe(
          Effect.provide(registryLayer(server.addresses, 200)),
        ),
      )
      expect(latest).toBeNull()
      expect(Date.now() - started).toBeLessThan(3_000)
    } finally {
      server.close()
    }
  })
})

describe('The update runs with a time limit and an output cap', () => {
  const script = (body: string) => {
    const folder = temporaryFolder('agents-update')
    const path = join(folder, 'installer')
    writeFileSync(path, `#!${process.execPath}\n${body}\n`)
    chmodSync(path, 0o755)
    return path
  }

  test.skipIf(process.platform === 'win32')('only the tail of a long output is kept', async () => {
    const path = script(`process.stdout.write('x'.repeat(5000) + 'the end')`)
    const output = await Effect.runPromise(
      AgentUpdater.use((updater) => updater.run([path])).pipe(
        Effect.provide(updaterLayer(process.env, 'linux', { timeoutMs: 10_000, outputChars: 100 })),
      ),
    )
    expect(output).toHaveLength(100)
    expect(output.endsWith('the end')).toBe(true)
  })

  test.skipIf(process.platform === 'win32')(
    'an update past its time limit is stopped',
    async () => {
      const path = script(`console.log('started'); setTimeout(() => console.log('done'), 10000)`)
      const started = Date.now()
      const output = await Effect.runPromise(
        AgentUpdater.use((updater) => updater.run([path])).pipe(
          Effect.provide(updaterLayer(process.env, 'linux', { timeoutMs: 300, outputChars: 1000 })),
        ),
      )
      expect(output).toBe('started')
      expect(Date.now() - started).toBeLessThan(5_000)
    },
  )
})
