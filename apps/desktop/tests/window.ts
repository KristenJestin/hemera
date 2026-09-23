/**
 * The window over the whole engine: the renderer's stores, talking to the engine's use cases.
 *
 * `toolApplication` is the engine a scenario of the tools runs on — the runtime, the tool server
 * on a loopback port, the commands on the real supervisor, the fake agent as an MCP client. This
 * puts the page in front of it: `window.hemera` is a bridge whose `invoke` is the engine's own
 * `decideRequest` and `answer`, as the main process relays them, and whose `on` hears what the
 * engine pushes, as the preload hands it over. A suite then drives the stores the application
 * draws from — the agent store, the Sessions store, the tools store — and reads what they hold,
 * which is what the window would draw.
 *
 * Nothing of Electron is here and nothing is mocked: the one stand-in is the agent, which is the
 * fake provider, and the registries the Agents section would ask, which nothing here asks.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Cause, Effect, Exit, Layer, Scope } from 'effect'

import type {
  Bridge,
  ChannelArguments,
  ChannelName,
  ChannelResponse,
  EngineEvent,
} from '@hemera/ipc'

import { agentDirectoriesLayer } from '#engine/agents/bare.ts'
import { discoveryLayer } from '#engine/agents/discovery.ts'
import type { FakeAgent } from '#engine/agents/fake.ts'
import { heldWordsLayer } from '#engine/agents/held.ts'
import { AgentNotices } from '#engine/agents/notices.ts'
import { clockLayer, poolLayer } from '#engine/agents/pool.ts'
import { runtimeLayer } from '#engine/agents/runtime.ts'
import { Agents } from '#engine/agents/service.ts'
import { StderrSink, hostProcessesLayer } from '#engine/agents/supervisor.ts'
import { commandsLayer } from '#engine/commands/service.ts'
import { contextLayer } from '#engine/context/service.ts'
import { PUSHED, named } from '#engine/index.ts'
import { journalLayer } from '#engine/journal.ts'
import { openProfile } from '#engine/migrate.ts'
import { preferencesLayer } from '#engine/preferences.ts'
import { projectsLayer } from '#engine/projects.ts'
import { answer, decideRequest } from '#engine/request.ts'
import { sessionsLayer } from '#engine/sessions.ts'
import { engineStatusLayer } from '#engine/status.ts'
import { databaseLayer } from '#engine/storage/database.ts'
import { toolAccessLayer } from '#engine/tools/access.ts'
import { toolCatalogueLayer } from '#engine/tools/catalogue.ts'
import { toolPermissionsLayer } from '#engine/tools/permissions.ts'
import { toolServerLayer } from '#engine/tools/server.ts'
import { gitLayer } from '#engine/git.ts'
import { variablesLayer } from '#engine/workspaces/variables.ts'

import { SHIPPED, VERSION, besideTheAgent, machine } from './application.ts'

/** A window over one engine: the bridge the stores talk through, and the way to close it. */
export interface OpenWindow {
  readonly bridge: Bridge
  /** Everything the engine pushed, in the order it pushed it. */
  readonly pushed: readonly EngineEvent[]
  /** What the engine wrote to its diagnostic, which is where a refused access is told. */
  readonly written: readonly string[]
  /** Closes the engine: every process it started goes with its scope. */
  readonly close: () => Promise<void>
}

/**
 * Opens the engine on a data folder, over the fake agents given, and a bridge in front of it.
 *
 * The composition is the one `engine/index.ts` builds, with the fake agent behind the supervisor
 * and a machine that has every agent signed in.
 */
export async function openWindow(
  dataFolder: string,
  agent: FakeAgent,
  ...others: readonly FakeAgent[]
): Promise<OpenWindow> {
  const pushed: EngineEvent[] = []
  const written: string[] = []
  const listeners = new Set<(event: EngineEvent) => void>()
  const push = (event: EngineEvent) => {
    pushed.push(event)
    for (const listener of listeners) listener(event)
  }

  const lines = Layer.succeed(StderrSink, {
    write: (line: string) =>
      Effect.sync(() => {
        written.push(line)
      }),
  })
  const notices = Layer.succeed(AgentNotices, {
    wrote: (sessionId, entry) => push({ event: 'entry', sessionId, entry }),
    changed: (sessionId, what) => push({ event: PUSHED[what], sessionId, entry: null }),
    ran: (sessionId, run) => push({ event: 'run', sessionId, run }),
  })
  // Nothing here asks a registry or updates an agent: the Agents section's own suites do.
  const listed = Layer.succeed(Agents, {
    list: () => Effect.succeed([]),
    check: () => Effect.succeed([]),
    update: () => Effect.die('nothing in this window updates an agent'),
  })
  const tools = toolServerLayer.pipe(
    Layer.provideMerge(toolCatalogueLayer),
    Layer.provideMerge(toolAccessLayer),
    Layer.provideMerge(toolPermissionsLayer),
    Layer.provideMerge(commandsLayer),
    Layer.provideMerge(variablesLayer),
  )
  const services = runtimeLayer.pipe(
    Layer.provideMerge(tools),
    Layer.provideMerge(contextLayer.pipe(Layer.provide(gitLayer()))),
    Layer.provideMerge(journalLayer),
    Layer.provideMerge(
      Layer.mergeAll(
        projectsLayer,
        sessionsLayer,
        preferencesLayer,
        listed,
        engineStatusLayer({ directory: dataFolder, channel: 'dev', version: VERSION }),
      ).pipe(Layer.provideMerge(databaseLayer(join(dataFolder, 'hemera.sqlite')))),
    ),
    Layer.provideMerge(discoveryLayer.pipe(Layer.provide(machine))),
    Layer.provide(
      besideTheAgent([agent, ...others]).pipe(
        Layer.provide(Layer.mergeAll(hostProcessesLayer, lines)),
      ),
    ),
    Layer.provide(notices),
    Layer.provide(lines),
    Layer.provide(poolLayer.pipe(Layer.provide(clockLayer))),
    Layer.provideMerge(heldWordsLayer),
    Layer.provide(agentDirectoriesLayer(dataFolder)),
  )

  mkdirSync(dataFolder, { recursive: true })
  const scope = Effect.runSync(Scope.make())
  const context = await Effect.runPromise(Layer.buildWithScope(services, scope))
  await Effect.runPromise(Effect.provide(openProfile(dataFolder, SHIPPED, VERSION), context))

  const bridge: Bridge = {
    invoke: async <K extends ChannelName>(
      channel: K,
      argument: ChannelArguments<K>,
    ): Promise<ChannelResponse<K>> => {
      const decision = decideRequest(channel, argument)
      if (!decision.accepted) throw new Error(decision.reason)
      const exit = await Effect.runPromiseExit(Effect.provide(answer(decision), context))
      // A refusal reaches the page as the sentence the engine answers with, which is what the
      // preload hands over once it has taken the transport's wrapping off.
      if (Exit.isFailure(exit)) throw new Error(named(Cause.squash(exit.cause)))
      // SAFETY: the answer of the use case `channel`, whose response type is `ChannelResponse<K>`
      // for every channel relayed to the engine; the engine's router answers it by that name.
      return exit.value as ChannelResponse<K>
    },
    on: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }

  return {
    bridge,
    pushed,
    written,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}

/** Puts a bridge where the page finds it, as the preload does. */
export function install(bridge: Bridge): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { hemera: bridge },
  })
}
