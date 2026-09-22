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
import { AgentNotices, runtimeLayer } from './agents/runtime.ts'
import type { AgentRuntime, Notice } from './agents/runtime.ts'
import { type Agents, agentsLayer } from './agents/service.ts'
import { discoveryLayer, machineEnvironmentLayer } from './agents/discovery.ts'
import type { Discovery } from './agents/discovery.ts'
import { StderrSink, hostProcessesLayer, processSupervisorLayer } from './agents/supervisor.ts'
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

/**
 * The window, as the runtime's notices.
 *
 * Every entry an agent writes and every change to a Session is pushed to the page as it happens,
 * on the one channel the preload listens on: the thread is drawn from what arrives rather than
 * from asking again (D5-12). The four names a change can travel under are the page's, and the
 * reasons the runtime changes something map onto them here, in the one place that knows the wire.
 */
function noticesTo(port: MessagePortMain, log: (line: string) => void): Layer.Layer<AgentNotices> {
  const PUSHED: Record<Notice, EngineEventName> = {
    permission_requested: 'permission',
    turn_ended: 'turn',
    agent_died: 'agent',
    session_fallback: 'agent',
  }

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
  | Database
  | SqliteClient

function servicesOf(
  start: EngineStart,
  port: MessagePortMain,
  log: (line: string) => void,
): Layer.Layer<EngineServices> {
  const channel = channelSchema.parse(start.channel)
  // The rows of a Session and its thread stand on one file, and the runtime is built on the very
  // same ones: `provideMerge` hands them up rather than hiding them.
  const rows = Layer.mergeAll(projectsLayer, sessionsLayer)
  // The machine the agents are looked for on, the processes they are started as, where their
  // `stderr` goes, and the window that hears about all of it: everything the runtime needs that
  // is not a row.
  const agents = Layer.mergeAll(
    machineEnvironmentLayer,
    hostProcessesLayer,
    Layer.succeed(StderrSink, { write: (line: string) => Effect.sync(() => log(line)) }),
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

  return Layer.mergeAll(
    preferencesLayer,
    engineStatusLayer({ directory: start.directory, channel, version: start.version }),
    journalLayer,
    rows,
    listed,
    runtimeLayer.pipe(
      // Discovery is handed up rather than hidden: the settings page asks this process what the
      // machine has, and that question is answered without starting anything.
      Layer.provideMerge(discoveryLayer),
      Layer.provide(rows),
      Layer.provide(processSupervisorLayer),
      Layer.provide(agents),
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
