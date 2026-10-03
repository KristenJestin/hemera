/**
 * The hint the window is painted from before the engine has answered.
 *
 * The database is the truth about what the user chose, and the engine opens it after Electron is
 * ready: far too late to decide what colour the first frame is. So main keeps a copy of the
 * display preferences in one small file of the data folder, reads it before the window exists,
 * and rewrites it whenever the engine answers or a preference changes. If it is missing or
 * unreadable, the system's theme opens the window and the engine's answer rewrites the file.
 */

import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Preferences } from '@hemera/ipc'
import { Option, Schema } from 'effect'

import type { Log } from './diagnostic.ts'

/** The file the hint lives in, inside the data folder. */
export const SIDECAR_FILE = 'display.json'

const Sidecar = Schema.fromJsonString(Schema.toCodecJson(Preferences))
const readHint = Schema.decodeUnknownOption(Sidecar)
const writeHint = Schema.encodeSync(Sidecar)

/** Tells one write from the next, so two of them never reach for the same temporary file. */
let writes = 0

/** What the last start left, or null when there is nothing to go on. Read synchronously. */
export function readSidecar(dataFolder: string): Preferences | null {
  let written = ''
  try {
    written = readFileSync(join(dataFolder, SIDECAR_FILE), 'utf8')
  } catch {
    return null
  }
  return Option.getOrNull(readHint(written))
}

/**
 * Writes the hint whole, or leaves the previous one: through a temporary file and a rename, which
 * is atomic. A hint that cannot be written is logged and nothing more.
 */
export function writeSidecar(dataFolder: string, preferences: Preferences, log: Log): void {
  const file = join(dataFolder, SIDECAR_FILE)
  writes += 1
  const meanwhile = `${file}.${String(writes)}.writing`
  try {
    writeFileSync(meanwhile, `${writeHint(preferences)}\n`)
    renameSync(meanwhile, file)
  } catch (failed) {
    rmSync(meanwhile, { force: true })
    log(`${SIDECAR_FILE}: the hint of the next start could not be written: ${String(failed)}`)
  }
}
