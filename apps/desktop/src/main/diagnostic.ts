/**
 * What a start leaves behind, in the profile and not on a console (design D3-09).
 *
 * An application started from a desktop icon has no console to print to, so what it says about
 * itself has to be somewhere it can be read afterwards: one file per profile, opened in append
 * and written a short dated line at a time. Two programs write to it — the main process and
 * the process that holds the database — which is why every line says which one it came from.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Where a refusal is written. A refused message is a fact, not a silence. */
export type Log = (line: string) => void

/** The file a profile keeps its diagnostic in. */
export const DIAGNOSTIC_FILE = 'diagnostic.log'

/** Which of the two programs a line came from. */
export type DiagnosticSource = 'main' | 'profile'

/**
 * The log of one profile, opened in append.
 *
 * The folder is created if it is not there yet: the first start of a profile is the one that
 * has the most to say and the least to write it into.
 */
export function openDiagnosticLog(directory: string, source: DiagnosticSource): Log {
  mkdirSync(directory, { recursive: true })
  const file = join(directory, DIAGNOSTIC_FILE)
  return (line) => {
    appendFileSync(file, `${new Date().toISOString()} [${source}] ${line}\n`)
  }
}

/**
 * Where a line goes before a profile is known.
 *
 * Which is the one moment a console is the best there is: until the profile is resolved there
 * is no folder to write into, and what happens before that is a crash Electron prints itself.
 */
let write: Log = (line) => {
  console.error(line)
}

/** Makes the log of the profile that was opened the one the application writes to. */
export function writeDiagnosticTo(log: Log): void {
  write = log
}

/** The line every step of a start and every refusal goes through. */
export const diagnostic: Log = (line) => {
  write(line)
}

/**
 * What a failure is called in a log line: the type it was raised as, and what it carries.
 *
 * `String(failure)` is not that. An Effect error is a class with a tag and a few fields, and
 * `Error.prototype.toString` answers a name and a message it does not have — a refusal would
 * reach the log as the name of the use case it came from and nothing else, indistinguishable
 * from a silence and from a process that is gone. Its own `toJSON` carries the tag and the
 * fields, which is exactly what a line has to say.
 */
export function reported<E>(failed: E): string {
  return JSON.stringify(failed) ?? String(failed)
}
