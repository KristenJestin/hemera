/**
 * What a run leaves behind, in the data folder and not on a console: the diagnostic sink.
 *
 * An application started from a desktop icon has no console to print to, so what it says about
 * itself has to be somewhere it can be read afterwards: one file per data folder, opened in
 * append and written a short dated line at a time. Main, the engine and the agents' processes
 * write to it, which is why every line says which one it came from.
 *
 * This file is the only way into the diagnostic class: every line is masked before it is
 * written, by the engine's registry of known secrets where there is one, by the shapes of
 * credentials otherwise (main holds no secret value: they stay in the engine's memory). A test
 * fails if another file writes to the diagnostic file. Past 8 MB the log becomes a generation of
 * its own, which the diagnostic rotation removes once it is old.
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { Cause, Effect, Exit, Option, Stream } from 'effect'

/** Where a line goes. */
export type Log = (line: string) => void

/** The file a data folder keeps its diagnostic in. */
export const DIAGNOSTIC_FILE = 'diagnostic.log'

/**
 * How large the log grows before it becomes a generation of its own, named after the moment and
 * the process that turned it over. The generations are the diagnostic class's to rotate.
 */
export const DIAGNOSTIC_TURNOVER_BYTES = 8 * 1024 * 1024

/** The log and its earlier generations, by name. */
export const DIAGNOSTIC_GENERATION = /^diagnostic(?:\.\d{8}T\d{6}Z-\d+)?\.log$/

/** How many lines are written between two looks at the log's size. */
const LOOK_EVERY = 100

/** Turns the log over when it has grown past its size; another process may have done it first. */
function turnOver(directory: string, file: string): void {
  try {
    if (statSync(file).size < DIAGNOSTIC_TURNOVER_BYTES) return
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
    renameSync(file, join(directory, `diagnostic.${stamp}-${String(process.pid)}.log`))
  } catch {
    // Not there yet, or already turned over by the other process that writes it.
  }
}

/** Which program a line came from. */
export type DiagnosticSource = 'main' | 'engine'

/**
 * The log of one data folder, opened in append, every line masked by `mask` before it is written.
 * The folder is created if it is not there yet: the first run on a data folder is the one with the
 * most to say and the least to write it into.
 */
export function openDiagnosticLog(
  directory: string,
  source: DiagnosticSource,
  mask: (line: string) => string,
): Log {
  mkdirSync(directory, { recursive: true })
  const file = join(directory, DIAGNOSTIC_FILE)
  turnOver(directory, file)
  let written = 0
  return (line) => {
    appendFileSync(file, `${new Date().toISOString()} [${source}] ${mask(line)}\n`)
    written += 1
    if (written % LOOK_EVERY === 0) turnOver(directory, file)
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
