/**
 * The three agents, as this machine and their registries answer for them (design D5-18).
 *
 * The two things that leave the machine are behind ports, so what is tested here is the
 * decision rather than the network: which tool a command was installed with, which agents are
 * worth asking a registry about, and when an update is refused rather than run.
 */

import { describe, expect, test } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import { ADAPTERS, type DiscoveredAgent, Discovery, installerOf } from '#engine/agents/discovery.ts'
import { AgentRegistry, AgentUpdater, updateCommandFor } from '#engine/agents/installer.ts'
import { Agents, agentsLayer } from '#engine/agents/service.ts'

/** A machine that has some of the three agents, at paths of this test's own. */
function machineWith(found: readonly DiscoveredAgent[]): Layer.Layer<Discovery> {
  return Layer.succeed(Discovery, {
    list: () => Effect.succeed(found),
    resolve: () => Effect.die('nothing in this file resolves an agent'),
  })
}

/** A registry that answers one version for whatever it is asked, and remembers being asked. */
function registryAnswering(latest: string | null) {
  const asked: string[] = []
  const layer = Layer.succeed(AgentRegistry, {
    latest: (adapter) => {
      asked.push(adapter.id)
      return Effect.succeed(latest)
    },
  })
  return { asked, layer }
}

/** An updater that answers what a run printed, and remembers being run. */
function updaterAnswering(output: string, version: string | null) {
  const ran: string[] = []
  const layer = Layer.succeed(AgentUpdater, {
    run: (adapter) => {
      ran.push(adapter.id)
      return Effect.succeed({ output, version })
    },
  })
  return { layer, ran }
}

/** The service over the three, run to its end. */
function running<A, E>(
  program: Effect.Effect<A, E, Agents>,
  discovery: Layer.Layer<Discovery>,
  registry: Layer.Layer<AgentRegistry>,
  updater: Layer.Layer<AgentUpdater>,
) {
  return Effect.runPromise(
    Effect.provide(
      program,
      agentsLayer.pipe(Layer.provide(discovery), Layer.provide(registry), Layer.provide(updater)),
    ),
  )
}

const CLAUDE_UNDER_PNPM: DiscoveredAgent = {
  id: 'claude',
  label: 'Claude Code',
  found: true,
  path: '/Users/kris/Library/pnpm/claude',
  version: '1.4.0',
  authenticated: false,
  installHint: 'npm install -g @agentclientprotocol/claude-agent-acp',
  installer: 'pnpm',
  latest: null,
}

const CODEX_ABSENT: DiscoveredAgent = {
  id: 'codex',
  label: 'Codex',
  found: false,
  authenticated: false,
  installHint: 'npm install -g @agentclientprotocol/codex-acp',
  installer: 'unknown',
  latest: null,
}

const OPENCODE_FROM_A_CURL: DiscoveredAgent = {
  id: 'opencode',
  label: 'OpenCode',
  found: true,
  path: '/usr/local/bin/opencode',
  version: '0.9.1',
  authenticated: false,
  installHint: 'npm install -g opencode-ai',
  installer: 'unknown',
  latest: null,
}

describe('Le tool avec lequel une commande a été installée', () => {
  test.each([
    ['/opt/homebrew/bin/opencode', 'brew'],
    ['/usr/local/Cellar/opencode/0.9.1/bin/opencode', 'brew'],
    ['/Users/kris/.bun/bin/claude', 'bun'],
    ['/Users/kris/Library/pnpm/codex', 'pnpm'],
    ['/Users/kris/.local/share/pnpm/global/5/node_modules/.bin/codex', 'pnpm'],
    ['/usr/local/lib/node_modules/@agentclientprotocol/codex-acp/dist/index.js', 'npm'],
    ['/Users/kris/.nvm/versions/node/v22.0.0/bin/claude', 'npm'],
    ['C:\\Users\\kris\\AppData\\Roaming\\npm\\codex.cmd', 'npm'],
    ['/usr/local/bin/opencode', 'unknown'],
    ['/home/kris/bin/claude', 'unknown'],
  ])('%s vient de %s', (path, tool) => {
    expect(installerOf(path)).toBe(tool)
  })
})

describe('La commande qui met un agent à jour', () => {
  test('npm installe le paquet publié, en global', () => {
    expect(updateCommandFor(ADAPTERS.opencode, 'npm')).toEqual([
      'npm',
      ['install', '--global', 'opencode-ai'],
    ])
  })

  test('brew monte de version la formule, qui porte le nom de la commande', () => {
    expect(updateCommandFor(ADAPTERS.opencode, 'brew')).toEqual(['brew', ['upgrade', 'opencode']])
  })

  test('un tool que Hemera ne sait pas placer n’a pas de commande', () => {
    expect(updateCommandFor(ADAPTERS.opencode, 'unknown')).toBeNull()
  })
})

describe('La liste des agents', () => {
  test('nomme le tool de chacun et ne publie encore aucune version', async () => {
    const registry = registryAnswering('2.0.0')
    const updater = updaterAnswering('', null)

    const listed = await running(
      Effect.flatMap(Agents, (agents) => agents.list()),
      machineWith([CLAUDE_UNDER_PNPM, CODEX_ABSENT, OPENCODE_FROM_A_CURL]),
      registry.layer,
      updater.layer,
    )

    expect(listed.map((agent) => [agent.id, agent.installer, agent.latest])).toEqual([
      ['claude', 'pnpm', null],
      ['codex', 'unknown', null],
      ['opencode', 'unknown', null],
    ])
    expect(registry.asked).toEqual([])
  })
})

describe('Le contrôle des versions publiées', () => {
  test('ne demande au registre que ce qui est là et plaçable', async () => {
    const registry = registryAnswering('1.9.0')
    const updater = updaterAnswering('', null)

    const checked = await running(
      Effect.flatMap(Agents, (agents) => agents.check()),
      machineWith([CLAUDE_UNDER_PNPM, CODEX_ABSENT, OPENCODE_FROM_A_CURL]),
      registry.layer,
      updater.layer,
    )

    expect(registry.asked).toEqual(['claude'])
    expect(checked.map((agent) => [agent.id, agent.version, agent.latest])).toEqual([
      ['claude', '1.4.0', '1.9.0'],
      ['codex', null, null],
      ['opencode', '0.9.1', null],
    ])
  })
})

describe('La mise à jour, qui n’a lieu que sur un clic', () => {
  test('monte la version de l’agent plaçable et rend ce que la commande a dit', async () => {
    const registry = registryAnswering(null)
    const updater = updaterAnswering('added 1 package', '2.0.0')

    const done = await running(
      Effect.flatMap(Agents, (agents) => agents.update('claude')),
      machineWith([CLAUDE_UNDER_PNPM, CODEX_ABSENT, OPENCODE_FROM_A_CURL]),
      registry.layer,
      updater.layer,
    )

    expect(updater.ran).toEqual(['claude'])
    expect(done).toEqual({ output: 'added 1 package', version: '2.0.0' })
  })

  test('refuse un agent qui n’est pas sur la machine, et ne lance rien', async () => {
    const registry = registryAnswering(null)
    const updater = updaterAnswering('', null)

    const refused = await running(
      Effect.flip(Effect.flatMap(Agents, (agents) => agents.update('codex'))),
      machineWith([CLAUDE_UNDER_PNPM, CODEX_ABSENT]),
      registry.layer,
      updater.layer,
    )

    expect(refused.reason).toContain('Codex')
    expect(updater.ran).toEqual([])
  })

  test('refuse une commande qu’il ne sait pas placer, et ne lance rien', async () => {
    const registry = registryAnswering(null)
    const updater = updaterAnswering('', null)

    const refused = await running(
      Effect.flip(Effect.flatMap(Agents, (agents) => agents.update('opencode'))),
      machineWith([OPENCODE_FROM_A_CURL]),
      registry.layer,
      updater.layer,
    )

    expect(refused.reason).toContain('opencode')
    expect(updater.ran).toEqual([])
  })
})
