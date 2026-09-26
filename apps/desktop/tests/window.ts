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
import { buildChecksLayer, projectChecksLayer } from '#engine/build/checks.ts'
import { AgentNotices } from '#engine/agents/notices.ts'
import { clockLayer, poolLayer } from '#engine/agents/pool.ts'
import { runtimeLayer } from '#engine/agents/runtime.ts'
import { Agents } from '#engine/agents/service.ts'
import { BuildNotices, buildsLayer } from '#engine/build/build.ts'
import type { BuildChecks } from '#engine/build/checks.ts'
import { StderrSink, hostProcessesLayer } from '#engine/agents/supervisor.ts'
import { proposalsLayer } from '#engine/commands/proposals.ts'
import { type Commands, commandsLayer } from '#engine/commands/service.ts'
import { contextLayer } from '#engine/context/service.ts'
import { type EngineServices, PUSHED, named } from '#engine/index.ts'
import { journalLayer } from '#engine/journal.ts'
import { openProfile } from '#engine/migrate.ts'
import { preferencesLayer } from '#engine/preferences.ts'
import { classifierSettingsLayer } from '#engine/classifier/settings.ts'
import { projectsLayer } from '#engine/projects.ts'
import { answer, decideRequest } from '#engine/request.ts'
import { sessionsLayer } from '#engine/sessions.ts'
import { NoSpecNotices } from '#engine/specs/notices.ts'
import { specsLayer } from '#engine/specs/specs.ts'
import { engineStatusLayer } from '#engine/status.ts'
import { type Database, databaseLayer } from '#engine/storage/database.ts'
import { toolAccessLayer } from '#engine/tools/access.ts'
import { toolCatalogueLayer } from '#engine/tools/catalogue.ts'
import { toolPermissionsLayer } from '#engine/tools/permissions.ts'
import { toolServerLayer } from '#engine/tools/server.ts'
import { gitLayer } from '#engine/git.ts'
import { hostLinks, preparationLayer } from '#engine/workspaces/preparation.ts'
import { launchesLayer } from '#engine/workspaces/launches.ts'
import { recipeLayer } from '#engine/workspaces/recipe.ts'
import { type Variables, variablesLayer } from '#engine/workspaces/variables.ts'
import { WorkspacesRoot, workspacesLayer } from '#engine/workspaces/workspaces.ts'

import { SHIPPED, VERSION, besideTheAgent, machine } from './application.ts'
import { noChecks } from './build-harness.ts'

/** A window over one engine: the bridge the stores talk through, and the way to close it. */
export interface OpenWindow {
  readonly bridge: Bridge
  /** Everything the engine pushed, in the order it pushed it. */
  readonly pushed: readonly EngineEvent[]
  /** What the engine wrote to its diagnostic, which is where a refused access is told. */
  readonly written: readonly string[]
  /** The build Sessions the engine said changed (`build.changed`), in the order it said it. */
  readonly built: readonly string[]
  /**
   * Runs a program against this window's engine.
   *
   * A service the window has no channel for yet — the launches (D8-13) — is asked here, in the
   * very context the bridge reaches, rather than through a channel nothing declares yet.
   */
  readonly running: <A, E>(program: Effect.Effect<A, E, EngineServices>) => Promise<A>
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
  return openOver(dataFolder, machine, noChecks, agent, ...others)
}

/**
 * The same window, over the Project's checks a build suite scripts (D10-07), or the checks' own
 * layer, run through the very commands the tools run.
 */
export async function openWindowChecked(
  dataFolder: string,
  checks: Layer.Layer<BuildChecks, never, Database | Commands | Variables>,
  agent: FakeAgent,
  ...others: readonly FakeAgent[]
): Promise<OpenWindow> {
  return openOver(dataFolder, machine, checks, agent, ...others)
}

/**
 * The same window over the machine given: a suite about a start that cannot happen hands it one
 * that holds none of the agents' bare means (D6-02).
 */
export async function openWindowOn(
  dataFolder: string,
  over: typeof machine,
  agent: FakeAgent,
  ...others: readonly FakeAgent[]
): Promise<OpenWindow> {
  return openOver(dataFolder, over, noChecks, agent, ...others)
}

async function openOver(
  dataFolder: string,
  over: typeof machine,
  checks: Layer.Layer<BuildChecks, never, Database | Commands | Variables>,
  agent: FakeAgent,
  ...others: readonly FakeAgent[]
): Promise<OpenWindow> {
  const pushed: EngineEvent[] = []
  const written: string[] = []
  const built: string[] = []
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
    workspace: (projectId, workspaceId) => push({ event: 'workspace', projectId, workspaceId }),
    launched: (specId, projectId) => push({ event: 'launch.changed', specId, projectId }),
  })
  // Nothing here asks a registry or updates an agent: the Agents section's own suites do.
  const listed = Layer.succeed(Agents, {
    list: () => Effect.succeed([]),
    check: () => Effect.succeed([]),
    update: () => Effect.die('nothing in this window updates an agent'),
  })
  const database = databaseLayer(join(dataFolder, 'hemera.sqlite'))

  // The builds, on the checks the suite scripts, and the window hearing that one changed: one
  // service, the catalogue's and the runtime's, as the engine builds it.
  const builds = buildsLayer.pipe(
    Layer.provide(gitLayer()),
    Layer.provide(checks),
    Layer.provide(
      Layer.succeed(BuildNotices, {
        changed: (sessionId) => {
          built.push(sessionId)
          push({ event: 'build.changed', sessionId })
        },
      }),
    ),
  )
  const tools = toolServerLayer.pipe(
    Layer.provideMerge(toolCatalogueLayer),
    Layer.provideMerge(builds),
    Layer.provideMerge(toolAccessLayer),
    Layer.provideMerge(toolPermissionsLayer),
    Layer.provideMerge(commandsLayer),
    Layer.provideMerge(variablesLayer),
  )
  const runtime = runtimeLayer.pipe(
    Layer.provideMerge(proposalsLayer),
    Layer.provideMerge(tools),
    Layer.provideMerge(contextLayer.pipe(Layer.provide(gitLayer()))),
    Layer.provideMerge(journalLayer),
    Layer.provideMerge(
      Layer.mergeAll(
        projectsLayer,
        sessionsLayer,
        // The Specs answer the page like the rest; nothing here listens for a Spec changing.
        specsLayer.pipe(Layer.provide(NoSpecNotices)),
        preferencesLayer,
        listed,
        engineStatusLayer({ directory: dataFolder, channel: 'dev', version: VERSION }),
      ).pipe(Layer.provideMerge(database)),
    ),
    Layer.provideMerge(discoveryLayer.pipe(Layer.provide(over))),
    Layer.provideMerge(
      besideTheAgent([agent, ...others]).pipe(
        Layer.provide(Layer.mergeAll(hostProcessesLayer, lines)),
      ),
    ),
    Layer.provideMerge(notices),
    Layer.provideMerge(lines),
    Layer.provide(poolLayer.pipe(Layer.provide(clockLayer))),
    Layer.provideMerge(heldWordsLayer),
    Layer.provide(agentDirectoriesLayer(dataFolder)),
  )

  // The launches, which start the builds a ready Workspace was waited for (D8-13).
  const launches = launchesLayer.pipe(Layer.provide(runtime))

  // The Workspaces of the Projects, made under the data folder, over the machine's `git`.
  const workspaces = preparationLayer.pipe(
    Layer.provideMerge(Layer.mergeAll(workspacesLayer, recipeLayer)),
    Layer.provide(Layer.succeed(WorkspacesRoot, join(dataFolder, 'workspaces'))),
    Layer.provide(hostLinks),
    Layer.provide(gitLayer()),
    Layer.provideMerge(launches),
    // The runtime, so the preparation runs its commands and tells what changed as it does.
    Layer.provide(runtime),
  )

  // The Project's checks, over the very catalogue the tools run, and run through it (D10-06): what
  // the settings and the checks' own suites reach. The builds above run the ones a suite scripts.
  const projectCheckServices = buildChecksLayer.pipe(
    Layer.provideMerge(projectChecksLayer),
    Layer.provide(runtime),
  )

  const services = Layer.mergeAll(
    runtime,
    workspaces,
    projectCheckServices,
    classifierSettingsLayer.pipe(Layer.provide(database)),
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

  const running = <A, E>(program: Effect.Effect<A, E, EngineServices>) =>
    // SAFETY: `services` is this harness's whole engine, composed with every tag `EngineServices`
    // names; a tag missing from it is a defect the suite is meant to see, not a silent fallback.
    Effect.runPromise(Effect.provide(program, context) as Effect.Effect<A, E>)

  return {
    bridge,
    pushed,
    written,
    built,
    running,
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
