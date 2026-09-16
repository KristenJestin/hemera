/**
 * The process that holds the database, and the one frontier it is run behind (design D3-03).
 *
 * This file is *the* `runPromise` of this program: the services are built once into a scope,
 * the scope closes the database when the process ends, and every message that arrives is run
 * inside that one runtime. Nothing else in this process runs an Effect of its own.
 *
 * It talks to the main process over a `MessagePort` and to nobody else. It has no window, no
 * Electron API beyond the port it was handed, and it is the only program of the four that ever
 * opens the profile's database.
 */

import { join } from 'node:path'

import { channelSchema } from '@hemera/ipc'
import { Effect, Layer, Scope } from 'effect'

import { openDiagnosticLog } from '../main/diagnostic.ts'
import { openProfile } from './migrate.ts'
import { preferencesLayer } from './preferences.ts'
import { type ProfileAnswer, type ProfileRequest, answer, decideRequest } from './request.ts'
import { profileStatusLayer } from './status.ts'
import { databaseLayer } from './storage/database.ts'

/** The file the profile keeps its database in. */
export const DATABASE_FILE = 'hemera.sqlite'

/** What the main process tells this one when it forks it, before any message is sent. */
export interface ProfileStart {
  directory: string
  channel: string
  version: string
  migrations: string
}

/**
 * Everything this process is, built once.
 *
 * The database layer is underneath the two services, so both stand on the same open file, and
 * the whole thing lives in the scope this program is run in: when the process ends, the scope
 * closes and the database is let go of.
 */
function servicesOf(start: ProfileStart) {
  const channel = channelSchema.parse(start.channel)
  return Layer.mergeAll(
    preferencesLayer,
    profileStatusLayer({ directory: start.directory, channel, version: start.version }),
  ).pipe(Layer.provideMerge(databaseLayer(join(start.directory, DATABASE_FILE))))
}

/**
 * What a refusal or a failure is called on the wire: its own type, and what it carries.
 *
 * An Effect error has a tag and a few fields and no message at all, so `${name}: ${message}`
 * would cross the port as `DatabaseError: ` and the reason would be lost between here and the
 * log the main process writes. Its `toJSON` carries the fields; a cause that is an `Error` is
 * named beside them, because an `Error` serialises to nothing.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a failure is whatever was raised; naming it is the last thing done with it
function named(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const carried = JSON.stringify(error) ?? '{}'
  const because = error.cause === undefined ? '' : ` caused by ${String(error.cause)}`
  return `${error.name} ${carried}${because}`
}

if (process.parentPort !== undefined) {
  // The start is handed over on the first message, with the port the conversation happens on.
  process.parentPort.once('message', (handed) => {
    // SAFETY: the one message the main process sends before any other, whose shape it wrote in
    // `profile-client.ts`; `utilityProcess` carries values, not types.
    const start = handed.data as ProfileStart
    const port = handed.ports[0]
    if (port === undefined) return

    const log = openDiagnosticLog(start.directory, 'profile')

    void Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scope = yield* Effect.scope
          const context = yield* Layer.build(servicesOf(start)).pipe(Scope.provide(scope))

          yield* Effect.provide(
            openProfile(start.directory, start.migrations, start.version),
            context,
          )
          log(`opened the database of ${start.directory}`)

          port.on('message', (event) => {
            // SAFETY: what the main process put on the port; `decideRequest` is what reads it.
            const request = event.data as ProfileRequest
            // Every message is answered, including one whose program died rather than failed:
            // a defect `Effect.match` never sees would otherwise be a silence the main process
            // can only call a timeout, five seconds later and with nothing to say about it.
            void Effect.runPromise(Effect.provide(replyTo(request), context))
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

/** One message in, one answer out, on the identifier it came in on. */
function replyTo(request: ProfileRequest) {
  return Effect.gen(function* () {
    const decision = decideRequest(request.name, request.argument)
    if (!decision.accepted) {
      const refused: ProfileAnswer = { id: request.id, ok: false, error: decision.reason }
      return refused
    }
    return yield* answer(decision).pipe(
      Effect.match({
        onSuccess: (value): ProfileAnswer => ({ id: request.id, ok: true, value }),
        onFailure: (failed): ProfileAnswer => ({
          id: request.id,
          ok: false,
          error: `${request.name}: ${named(failed)}`,
        }),
      }),
    )
  })
}
