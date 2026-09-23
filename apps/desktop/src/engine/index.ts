/**
 * The process that holds the database, and the one frontier it is run behind (design D3-03).
 *
 * This file is *the* `runPromise` of this program: the services are built once into a scope,
 * the scope closes the database when the process ends, and every message that arrives is run
 * inside that one runtime. Nothing else in this process runs an Effect of its own.
 *
 * It talks to the main process over a `MessagePort` and to nobody else. It has no window, no
 * Electron API beyond the port it was handed, and it is the only program of the four that ever
 * opens the database of the data folder.
 */

import { join } from 'node:path'

import { type EngineEventName, channelSchema } from '@hemera/ipc'
import { Effect, Layer, Scope } from 'effect'
import type { MessagePortMain } from 'electron'

import { openDiagnosticLog } from '../main/diagnostic.ts'
import { registryLayer, updaterLayer } from './agents/installer.ts'
import { agentDirectoriesLayer } from './agents/bare.ts'
import { heldWordsLayer } from './agents/held.ts'
import { AgentNotices } from './agents/notices.ts'
import type { Notice } from './agents/notices.ts'
import { clockLayer, poolLayer } from './agents/pool.ts'
import { runtimeLayer } from './agents/runtime.ts'
import type { AgentRuntime } from './agents/runtime.ts'
import { type Agents, agentsLayer } from './agents/service.ts'
import { discoveryLayer, machineEnvironmentLayer } from './agents/discovery.ts'
import type { Discovery } from './agents/discovery.ts'
import { StderrSink, hostProcessesLayer, processSupervisorLayer } from './agents/supervisor.ts'
import { type Proposals, proposalsLayer } from './commands/proposals.ts'
import { type Commands, commandsLayer } from './commands/service.ts'
import { type Context, contextLayer } from './context/service.ts'
import { toolAccessLayer } from './tools/access.ts'
import { toolCatalogueLayer } from './tools/catalogue.ts'
import { toolPermissionsLayer } from './tools/permissions.ts'
import { toolServerLayer } from './tools/server.ts'
import { openProfile } from './migrate.ts'
import { journalLayer } from './journal.ts'
import type { Journal } from './journal.ts'
import { preferencesLayer } from './preferences.ts'
import type { Preferences } from './preferences.ts'
import { projectsLayer } from './projects.ts'
import type { Projects } from './projects.ts'
import { type EngineAnswer, type EngineRequest, answer, decideRequest } from './request.ts'
import { sessionsLayer } from './sessions.ts'
import type { Sessions } from './sessions.ts'
import { engineStatusLayer } from './status.ts'
import type { EngineStatus } from './status.ts'
import { databaseLayer } from './storage/database.ts'
import type { Database, SqliteClient } from './storage/database.ts'

/** The file the data folder keeps its database in. */
export const DATABASE_FILE = 'hemera.sqlite'

/** What the main process tells this one when it forks it, before any message is sent. */
export interface EngineStart {
  directory: string
  channel: string
  version: string
  migrations: string
}

/** The name each change of a Session travels under, on the one channel the page listens on. */
export const PUSHED: Record<Notice, Exclude<EngineEventName, 'entry' | 'run'>> = {
  permission_requested: 'permission',
  turn_started: 'turn_start',
  turn_ended: 'turn',
  agent_died: 'agent',
  session_fallback: 'agent',
  context_delivered: 'delivery',
}

/**
 * The window, as the runtime's notices.
 *
 * Every entry an agent writes and every change to a Session is pushed to the page as it happens,
 * on the one channel the preload listens on: the thread is drawn from what arrives rather than
 * from asking again (D5-12). The five names a change can travel under are the page's, and the
 * reasons the runtime changes something map onto them here, in the one place that knows the wire.
 */
function noticesTo(port: MessagePortMain, log: (line: string) => void): Layer.Layer<AgentNotices> {
  return Layer.succeed(AgentNotices, {
    wrote: (sessionId, entry) => {
      try {
        port.postMessage({ event: 'entry', sessionId, entry })
      } catch (died) {
        // The window is gone: the entry is written either way, and a page that is not there to
        // hear about it is not a reason to fail the turn that wrote it.
        log(`pushing an entry failed: ${named(died)}`)
      }
    },
    changed: (sessionId, what) => {
      const event = PUSHED[what]
      try {
        port.postMessage({ event, sessionId, entry: null })
      } catch (died) {
        log(`pushing ${event} failed: ${named(died)}`)
      }
    },
    ran: (sessionId, run) => {
      try {
        port.postMessage({ event: 'run', sessionId, run })
      } catch (died) {
        log(`pushing a run failed: ${named(died)}`)
      }
    },
  })
}

/**
 * Everything this process is, built once.
 *
 * The database layer is underneath the two services, so both stand on the same open file, and
 * the whole thing lives in the scope this program is run in: when the process ends, the scope
 * closes and the database is let go of. The agents are built on top of the same file — a Session
 * and its thread are rows — and their notices go out on the port the main process handed over.
 */
/** Everything this process holds once it is built, named so the composition is checked against it. */
type EngineServices =
  | Preferences
  | EngineStatus
  | Projects
  | Journal
  | Sessions
  | AgentRuntime
  | Discovery
  | Agents
  | Commands
  | Proposals
  | Context
  | Database
  | SqliteClient

function servicesOf(
  start: EngineStart,
  port: MessagePortMain,
  log: (line: string) => void,
): Layer.Layer<EngineServices> {
  const channel = channelSchema.parse(start.channel)
  // The engine's diagnostic log, which a child's `stderr` and a write dropped at the quit go to.
  const diagnostic = Layer.succeed(StderrSink, {
    write: (line: string) => Effect.sync(() => log(line)),
  })
  // The rows of a Session and its thread stand on one file, and the runtime is built on the very
  // same ones: `provideMerge` hands them up rather than hiding them.
  const rows = Layer.mergeAll(projectsLayer, sessionsLayer).pipe(Layer.provide(diagnostic))
  // The machine the agents are looked for on, the processes they are started as, where their
  // `stderr` goes, and the window that hears about all of it: everything the runtime needs that
  // is not a row.
  const agents = Layer.mergeAll(
    machineEnvironmentLayer,
    hostProcessesLayer,
    diagnostic,
    noticesTo(port, log),
  )
  // What the Agents section of the settings asks about: the three agents this machine has, and
  // the one thing that changes them, which is asked of a registry and of the tool that installed
  // the command (D5-18). Both of those need to know what the machine is, so they are built over
  // it, and discovery is built a second time rather than shared: it is three `PATH` lookups with
  // no state between them.
  const discovery = discoveryLayer.pipe(Layer.provide(rows), Layer.provide(agents))
  const sources = Layer.mergeAll(registryLayer, updaterLayer).pipe(Layer.provide(agents))
  const listed = agentsLayer.pipe(Layer.provide(discovery), Layer.provide(sources))
  // The processes a command becomes and the processes an agent is are started by the same
  // supervisor, built once: a quit closes one scope and every tree of both goes with it (D5-04).
  const processes = processSupervisorLayer.pipe(Layer.provide(agents))
  // Hemera's own tools, and the one loopback address they are served on (D6-01 to D6-05). The
  // server and the runtime are handed the very same book of tokens — `provideMerge` hands it up
  // rather than minting a second one, and a token of one book means nothing to the other.
  const tools = toolServerLayer.pipe(
    Layer.provideMerge(toolCatalogueLayer),
    Layer.provideMerge(toolAccessLayer),
    Layer.provideMerge(toolPermissionsLayer),
    Layer.provideMerge(commandsLayer),
    Layer.provide(rows),
    Layer.provide(processes),
    Layer.provide(agents),
    // What an agent holds in memory, written before a call or a run is: the runtime hands its
    // flush to this very instance, which is why the same layer is given to both.
    Layer.provide(heldWordsLayer),
  )
  // What a Session is provided with, and the book of which agents are live (D6-07, D5-05).
  const provisions = Layer.mergeAll(contextLayer.pipe(Layer.provide(rows)), poolLayer).pipe(
    Layer.provide(clockLayer),
  )

  return Layer.mergeAll(
    preferencesLayer,
    engineStatusLayer({ directory: start.directory, channel, version: start.version }),
    journalLayer,
    rows,
    listed,
    // What a human decides of the commands the agent proposed: the catalogue is written from
    // there, on the very commands the tools run (D8-11).
    proposalsLayer.pipe(Layer.provide(tools), Layer.provide(rows), Layer.provide(agents)),
    runtimeLayer.pipe(
      // Discovery is handed up rather than hidden: the settings page asks this process what the
      // machine has, and that question is answered without starting anything.
      Layer.provideMerge(discoveryLayer),
      Layer.provide(rows),
      // What each Project's composer was left on: the runtime seeds the Home's choices from it
      // at start and writes them back as they are made (D5-17).
      Layer.provide(preferencesLayer),
      // Handed up rather than hidden: the Commands panel, the Project settings and the Context
      // view ask this process for the very catalogue, runs and provisions the runtime lends.
      Layer.provideMerge(tools),
      // What a Session is provided with, and the book of what is running on the engine's own
      // clock: it is what closes an agent nobody is talking to any more (D5-05).
      Layer.provideMerge(provisions),
      Layer.provide(processes),
      Layer.provide(agents),
      Layer.provide(heldWordsLayer),
      // A directory of Hemera's per agent, inside the data folder, where its bare means is written.
      Layer.provide(agentDirectoriesLayer(start.directory)),
    ),
  ).pipe(Layer.provideMerge(databaseLayer(join(start.directory, DATABASE_FILE))))
}

/**
 * What a refusal or a failure is called on the wire: the sentence it carries.
 *
 * A refusal is something a reader is shown — "the repository location "../elsewhere" is refused:
 * it resolves outside the workspace root" — and every refusal of this process has one: the
 * refusals of the domain are `Error`s written that way, and the tagged errors of the engine each
 * declare a `message` of their own for exactly this crossing. What is never sent is the fields
 * of an error as JSON: `StaleVersionError {"entity":"session","expected":1}` says nothing to
 * whoever pressed the button, and a page cannot show it. A failure with nothing to say is named
 * by its own name and no more; a cause that is an `Error` is named beside it, because an `Error`
 * serialises to nothing.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a failure is whatever was raised; naming it is the last thing done with it
export function named(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause === undefined ? '' : String(error.cause)
  // A cause the sentence already names is not named a second time: the tagged errors of the
  // engine carry the reason inside their own message, and `Error.cause` is the same reason.
  const because = cause === '' || error.message.includes(cause) ? '' : ` caused by ${cause}`
  if (error.message !== '') return `${error.message}${because}`
  return `${error.name}${because}`
}

if (process.parentPort !== undefined) {
  // The start is handed over on the first message, with the port the conversation happens on.
  process.parentPort.once('message', (handed) => {
    // SAFETY: the one message the main process sends before any other, whose shape it wrote in
    // `engine-client.ts`; `utilityProcess` carries values, not types.
    const start = handed.data as EngineStart
    const port = handed.ports[0]
    if (port === undefined) return

    const log = openDiagnosticLog(start.directory, 'engine')

    void Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scope = yield* Effect.scope
          const context = yield* Layer.build(servicesOf(start, port, log)).pipe(
            Scope.provide(scope),
          )

          yield* Effect.provide(
            openProfile(start.directory, start.migrations, start.version),
            context,
          )
          log(`opened the database of ${start.directory}`)

          port.on('message', (event) => {
            // SAFETY: what the main process put on the port; `decideRequest` is what reads it.
            const request = event.data as EngineRequest
            // Every message is answered, including one whose program died rather than failed:
            // a defect `Effect.match` never sees would otherwise be a silence the main process
            // can only call a timeout, five seconds later and with nothing to say about it.
            void Effect.runPromise(Effect.provide(replyTo(request, log), context))
              .then((reply) => {
                port.postMessage(reply)
              })
              // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejected promise carries whatever was thrown, and this is where it stops
              .catch((died: unknown) => {
                const reason = `${request.name}: ${named(died)}`
                log(reason)
                port.postMessage({ id: request.id, ok: false, error: reason })
              })
          })
          port.start()

          // Held open for as long as the port is: the scope must outlive the conversation.
          yield* Effect.never
        }),
      ),
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejected promise carries whatever was thrown, and this is where it stops
    ).catch((refused: unknown) => {
      log(`refused to open the database: ${named(refused)}`)
      process.exit(1)
    })
  })
}

/**
 * One message in, one answer out, on the identifier it came in on.
 *
 * What is answered is the refusal on its own, because it is shown to whoever asked and the
 * name of a channel means nothing to them. What is logged carries that name, because the line
 * is read later by someone who was not there when it was written.
 */
function replyTo(request: EngineRequest, log: (line: string) => void) {
  return Effect.gen(function* () {
    const decision = decideRequest(request.name, request.argument)
    if (!decision.accepted) {
      const refused: EngineAnswer = { id: request.id, ok: false, error: decision.reason }
      return refused
    }
    return yield* answer(decision).pipe(
      Effect.match({
        onSuccess: (value): EngineAnswer => ({ id: request.id, ok: true, value }),
        onFailure: (failed): EngineAnswer => {
          const reason = named(failed)
          log(`${request.name}: ${reason}`)
          return { id: request.id, ok: false, error: reason }
        },
      }),
    )
  })
}
