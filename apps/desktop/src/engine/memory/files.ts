/**
 * The Memory's folder in the data folder, and its markdown files.
 *
 * Each mission has `missions/<key>/`, named by its key, which never changes (CT-03): `now.md`,
 * `journal.md` and `notes.md`, and `evidence/`. The markdown files are a view for people and for
 * tools that read files, regenerated from the database after each change and once after the
 * start's catch-up; they are never read back, so a file deleted or edited is simply rewritten. A
 * file is written outside any transaction, to a temporary file beside it renamed over it, so a
 * reader never sees half a file.
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { missionKey } from '@hemera/core/domain'
import { UnknownMission } from '@hemera/ipc'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { Database, refusedWhile } from '../storage/database.ts'
import { missions } from '../storage/schema.ts'

/** The folder of the missions' Memory, in the data folder: part of every backup. */
export const MISSIONS_FOLDER = 'missions'

/** The files Hemera writes for a mission. */
export const NOW_FILE = 'now.md'
export const JOURNAL_FILE = 'journal.md'
export const NOTES_FILE = 'notes.md'

export const missionFolder = (dataFolder: string, key: string): string =>
  join(dataFolder, MISSIONS_FOLDER, key)

/** A mission's key, which names its folder. */
export const missionKeyOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ prefix: missions.keyPrefix, number: missions.keyNumber })
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading a mission')))
    if (row === undefined) return yield* new UnknownMission({ id: missionId })
    return missionKey(row.prefix, row.number)
  })

/** Writes a file whole or not at all: a temporary file beside it, renamed over it. */
export function writeWhole(path: string, content: Uint8Array | string): void {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  writeFileSync(temporary, content)
  renameSync(temporary, path)
}

/** The three markdown files of a mission, written in its folder. */
export function writeMarkdown(
  folder: string,
  files: { readonly now: string; readonly journal: string; readonly notes: string },
): void {
  mkdirSync(folder, { recursive: true })
  writeWhole(join(folder, NOW_FILE), files.now)
  writeWhole(join(folder, JOURNAL_FILE), files.journal)
  writeWhole(join(folder, NOTES_FILE), files.notes)
}
