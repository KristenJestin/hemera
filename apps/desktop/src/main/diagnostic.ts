/**
 * What a run leaves behind, in the data folder and not on a console.
 *
 * An application started from a desktop icon has no console to print to, so what it says about
 * itself has to be somewhere it can be read afterwards: one file per data folder, opened in
 * append and written a short dated line at a time. Main, the engine and the agents' processes
 * write to it, which is why every line says which one it came from.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { Cause, Effect, Exit, Option, Stream } from 'effect'

/** Where a line goes. */
export type Log = (line: string) => void

/** The file a data folder keeps its diagnostic in. */
export const DIAGNOSTIC_FILE = 'diagnostic.log'

/** Which program a line came from. */
export type DiagnosticSource = 'main' | 'engine'

/**
 * The log of one data folder, opened in append. The folder is created if it is not there yet: the
 * first run on a data folder is the one with the most to say and the least to write it into.
 */
export function openDiagnosticLog(directory: string, source: DiagnosticSource): Log {
  mkdirSync(directory, { recursive: true })
  const file = join(directory, DIAGNOSTIC_FILE)
  return (line) => {
    appendFileSync(file, `${new Date().toISOString()} [${source}] ${line}\n`)
  }
}

/** What a line says about a failure: its sentence, never a stack or a JSON dump. */
const said = <E>(failure: E): string =>
  failure instanceof Error && failure.message !== '' ? failure.message : String(failure)

/**
 * A call on a link, with its failure or its interruption written down under the RPC's name. A
 * call that is interrupted is not a failure, but it is the proof that the interruption reached
 * the handler, which is what a window that reloads is owed.
 */
export const observed =
  (rpc: string, log: Log) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.onExit(self, (exit) => Effect.sync(() => logExit(rpc, log, exit)))

/**
 * `observed`, for a stream, whose end is written down too. A stream served over a link sees the
 * caller who stops listening as its own end rather than as an interruption (Effect 4.0.0), so
 * for a stream that never ends by itself, `ended` is the caller leaving.
 */
export const observedStream =
  (rpc: string, log: Log) =>
  <A, E, R>(self: Stream.Stream<A, E, R>): Stream.Stream<A, E, R> =>
    Stream.onExit(self, (exit) =>
      Effect.sync(() => (Exit.isSuccess(exit) ? log(`${rpc}: ended`) : logExit(rpc, log, exit))),
    )

const logExit = <A, E>(rpc: string, log: Log, exit: Exit.Exit<A, E>): void => {
  if (Exit.isSuccess(exit)) return
  if (Cause.hasInterruptsOnly(exit.cause)) return log(`${rpc}: interrupted`)
  const failure = Cause.findErrorOption(exit.cause)
  log(
    `${rpc}: failed: ${Option.isSome(failure) ? said(failure.value) : Cause.pretty(exit.cause).split('\n')[0]}`,
  )
}
