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
