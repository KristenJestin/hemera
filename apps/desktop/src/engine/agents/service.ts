/**
 * The agents as the window reads them, and the two moves on them: what the agents' RPC group
 * calls.
 *
 * `list` is local and never waits on a version probe nor on a registry: it answers the latest
 * published version last read, and reads it again in the background, once per agent at a time,
 * when that answer is older than `LATEST_STANDS_MS` — so an agent out of date is said without
 * the user asking. `checkUpdates` reads every installed agent's registry now, whatever installed
 * it (a read), and waits for the answers. `update` changes the machine,
 * only when the user asks: it runs the installer's own global update, and refuses an agent that
 * is not installed or whose installer Hemera cannot place.
 */

import type { AgentProvider } from '@hemera/core/domain'
import { type AgentState, type AgentUpdate, AgentUpdateRefused } from '@hemera/ipc'
import { Clock, Context, Effect, FiberSet, Layer } from 'effect'

import { ADAPTERS } from './adapters/index.ts'
import { Discovery, type DiscoveredAgent, discoveryLayer, machineLayer } from './discovery.ts'
import {
  AgentRegistry,
  AgentUpdater,
  registryLayer,
  updateCommandFor,
  updaterLayer,
} from './installer.ts'

export interface AgentsService {
  readonly list: Effect.Effect<ReadonlyArray<AgentState>>
  readonly checkUpdates: Effect.Effect<ReadonlyArray<AgentState>>
  readonly update: (agent: AgentProvider) => Effect.Effect<AgentUpdate, AgentUpdateRefused>
}

export class Agents extends Context.Service<Agents, AgentsService>()('Agents') {}

/** How long a registry's answer stands before a list reads it again. */
export const LATEST_STANDS_MS = 12 * 60 * 60_000

const stateOf = (
  { path: _path, ...agent }: DiscoveredAgent,
  latest: string | null,
): AgentState => ({ ...agent, latest })

export const agentsLayer = Layer.effect(
  Agents,
  Effect.gen(function* () {
    const discovery = yield* Discovery
    const registry = yield* AgentRegistry
    const updater = yield* AgentUpdater
    const checks = yield* FiberSet.make()
    /** The latest version each agent's registry answered, and when. */
    const known = new Map<AgentProvider, { readonly latest: string | null; readonly at: number }>()
    /** The agents a registry read runs for now. */
    const checking = new Set<AgentProvider>()

    const check = (agent: DiscoveredAgent) =>
      registry
        .latest(ADAPTERS[agent.id], agent.installer)
        .pipe(
          Effect.tap((latest) =>
            Effect.map(Clock.currentTimeMillis, (at) => known.set(agent.id, { latest, at })),
          ),
        )

    /** Reads the registry in the background when its last answer is stale, unless one runs. */
    const refresh = (agent: DiscoveredAgent) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const last = known.get(agent.id)
        if (checking.has(agent.id) || (last !== undefined && now - last.at < LATEST_STANDS_MS)) {
          return
        }
        checking.add(agent.id)
        yield* FiberSet.run(
          checks,
          check(agent).pipe(Effect.ensuring(Effect.sync(() => checking.delete(agent.id)))),
        )
      })

    const update = Effect.fn('Agents.update')(function* (agent: AgentProvider) {
      const adapter = ADAPTERS[agent]
      const found = (yield* discovery.list).find((one) => one.id === agent)
      if (found?.path == null) {
        return yield* new AgentUpdateRefused({
          agent,
          reason: `${adapter.label} is not installed, so there is nothing to update.`,
        })
      }
      const words = updateCommandFor(adapter, found.installer)
      if (words === null) {
        return yield* new AgentUpdateRefused({
          agent,
          reason: `Hemera cannot tell which tool installed ${adapter.label} (${found.path}), and only updates an agent with the tool that installed it.`,
        })
      }
      const output = yield* updater.run(words)
      const version = yield* discovery.probe(found.path)
      return { output, version }
    })

    return Agents.of({
      list: Effect.flatMap(discovery.list, (agents) =>
        Effect.forEach(agents, (agent) =>
          agent.installed
            ? Effect.as(refresh(agent), stateOf(agent, known.get(agent.id)?.latest ?? null))
            : Effect.succeed(stateOf(agent, null)),
        ),
      ),
      // The registries are asked at once: the answer waits on the slowest, not on their sum.
      checkUpdates: Effect.flatMap(discovery.list, (agents) =>
        Effect.forEach(
          agents,
          (agent) =>
            agent.installed
              ? Effect.map(check(agent), (latest) => stateOf(agent, latest))
              : Effect.succeed(stateOf(agent, null)),
          { concurrency: 'unbounded' },
        ),
      ),
      update,
    })
  }),
)

/** The agents of this machine: its `PATH`, its registries, its installers. */
export const machineAgentsLayer = (): Layer.Layer<Agents> =>
  agentsLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        discoveryLayer.pipe(Layer.provide(machineLayer())),
        registryLayer(),
        updaterLayer(),
      ),
    ),
  )
