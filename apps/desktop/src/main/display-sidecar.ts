/**
 * The hint the window is painted from before anything has been read (design D3-07).
 *
 * The database is the truth about what the user chose, and it is opened by another process
 * after the application is ready — which is far too late to decide what colour the frame is.
 * So the main process keeps a copy of the three values it needs at that moment, in one small
 * file it writes itself and reads back synchronously before the window exists.
 *
 * It is a hint and nothing else. If it is missing, unreadable, or says something the database
 * disagrees with, the database wins and this file is rewritten: at worst the first frame of one
 * start wears the previous theme, once.
 */

import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type DisplayPreferences, displayPreferencesSchema } from '@hemera/ipc'

import { diagnostic } from './diagnostic.ts'

/** The file the hint lives in, inside the profile. */
export const SIDECAR_FILE = 'display.json'

/** Tells one write from the next, so two of them never reach for the same temporary file. */
let writes = 0

/**
 * What the last start left, or null when there is nothing to go on.
 *
 * Read synchronously on purpose: this is the one thing the main process waits for, and it waits
 * for it because the alternative is a window that appears in the wrong colour and corrects
 * itself afterwards.
 */
export function readSidecar(profileDirectory: string): DisplayPreferences | null {
  try {
    const written = readFileSync(join(profileDirectory, SIDECAR_FILE), 'utf8')
    const read = displayPreferencesSchema.safeParse(JSON.parse(written))
    return read.success ? read.data : null
  } catch {
    // Absent, unreadable, or not JSON at all: all three mean the same thing here, which is that
    // this start has nothing to go on and the system's own theme is what it opens in.
    return null
  }
}

/**
 * Writes the hint down, whole, or leaves the previous one alone.
 *
 * Through a temporary file and a rename, because a half-written hint is worse than an old one:
 * a rename is atomic, so what the next start reads is either all of this or all of the last.
 * The temporary file is named per write: two changes a fold apart are two channels answering at
 * once, and one name between them is one of the two renaming a file the other already moved.
 *
 * A hint that could not be written is written down as a fact and nothing more. It is a hint:
 * failing the channel over it would take a read of the profile down with it, and the page would
 * come up on defaults although the database answered.
 */
export function writeSidecar(profileDirectory: string, preferences: DisplayPreferences): void {
  const file = join(profileDirectory, SIDECAR_FILE)
  writes += 1
  const meanwhile = `${file}.${writes.toString()}.writing`
  try {
    writeFileSync(meanwhile, `${JSON.stringify(preferences, null, 2)}\n`)
    renameSync(meanwhile, file)
  } catch (failed) {
    rmSync(meanwhile, { force: true })
    diagnostic(
      `${SIDECAR_FILE}: the hint of the next start could not be written: ${String(failed)}`,
    )
  }
}
