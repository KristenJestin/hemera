/**
 * The restore of a Profile from one of its backups.
 *
 * A restore is staged while Hemera runs and takes effect at the next start, before the database
 * is opened: the engine never pulls its own database from under itself. Staging refuses a folder
 * without a readable manifest, and a backup written by a newer Hemera or carrying a newer
 * migration. Otherwise it backs the current Profile up first (into
 * `backups-1/before-restore-<date>/`), copies the backup's database and its registered folders
 * into `restore-1/`, and writes the record of the restore there last. Main then relaunches.
 *
 * At the next start the staged copy replaces the database and each folder the backup carries,
 * the restore is written down as `profile.restored` once the database is open, and the
 * reconciliation (`reconciliation.ts`) runs with the gate closed. Nothing outside the database
 * and the registered folders is touched: Workspace sources are neither restored nor deleted.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Effect, Option, Schema } from 'effect'

import {
  BackupFailed,
  BackupFolders,
  MANIFEST_FILE,
  type Manifest,
  ManifestJson,
  writeBackup,
} from './backup.ts'
import { BACKUPS_FOLDER, DATABASE_FILE, carriedMigrations } from './migrate.ts'
import { ProfileHome } from './profile-home.ts'
import type { Database, DatabaseError, SqliteClient } from './storage/database.ts'

/** Where a restore waits for the next start, in the data folder. */
export const RESTORE_FOLDER = 'restore-1'

/** A backup that cannot be restored. */
export class RestoreRefusal extends Schema.TaggedError<RestoreRefusal>()('RestoreRefusal', {
  sentence: Schema.String,
}) {
  override get message(): string {
    return this.sentence
  }
}

/**
 * Whether version `a` is newer than version `b`, both semantic versions: numbers first, then a
 * release over any of its pre-releases, then the pre-releases part by part.
 */
export function isNewer(a: string, b: string): boolean {
  const parse = (version: string) => {
    const [core = '', pre] = version.split('+')[0]!.split(/-(.*)/s)
    return { numbers: core.split('.').map(Number), pre: pre === undefined ? [] : pre.split('.') }
  }
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.numbers[index] ?? 0) - (right.numbers[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  if (left.pre.length === 0 || right.pre.length === 0) {
    return left.pre.length === 0 && right.pre.length > 0
  }
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index += 1) {
    const [l, r] = [left.pre[index], right.pre[index]]
    if (l === r) continue
    if (l === undefined) return false
    if (r === undefined) return true
    const [ln, rn] = [Number(l), Number(r)]
    if (Number.isInteger(ln) && Number.isInteger(rn)) return ln > rn
    return l > r
  }
  return false
}

const readManifest = (folder: string): Option.Option<Manifest> => {
  try {
    return Schema.decodeUnknownOption(ManifestJson)(
      readFileSync(join(folder, MANIFEST_FILE), 'utf8'),
    )
  } catch {
    return Option.none()
  }
}

const refused = (sentence: string) => Effect.fail(new RestoreRefusal({ sentence }))

/** Stages the restore of the backup in `folder`, for the next start to apply. */
export const stageRestore = (
  folder: string,
): Effect.Effect<
  void,
  RestoreRefusal | BackupFailed | DatabaseError,
  Database | SqliteClient | BackupFolders | ProfileHome
> =>
  Effect.gen(function* () {
    const home = yield* ProfileHome
    const registered = yield* BackupFolders
    const read = readManifest(folder)
    if (Option.isNone(read)) {
      return yield* refused('This folder is not a backup of Hemera: it has no readable manifest.')
    }
    const manifest = read.value
    if (isNewer(manifest.hemeraVersion, home.version)) {
      return yield* refused(
        `This backup was written by a newer version of Hemera (${manifest.hemeraVersion}) and cannot be restored by this one.`,
      )
    }
    const carried = carriedMigrations(home.migrations).map(({ name }) => name)
    if (manifest.lastMigration !== null && !carried.includes(manifest.lastMigration)) {
      return yield* refused(
        'This backup holds data of a newer version of Hemera and cannot be restored by this one.',
      )
    }
    if (!existsSync(join(folder, DATABASE_FILE))) {
      return yield* refused('This backup has lost its database and cannot be restored.')
    }

    yield* writeBackup(join(home.dataFolder, BACKUPS_FOLDER), 'before-restore')

    const staged = join(home.dataFolder, RESTORE_FOLDER)
    // Only the folders this build registers: a manifest never names a path to write.
    const folders = manifest.folders.filter(
      (one) => registered.includes(one) && existsSync(join(folder, one)),
    )
    yield* Effect.try({
      try: () => {
        rmSync(staged, { recursive: true, force: true })
        mkdirSync(staged, { recursive: true })
        cpSync(join(folder, DATABASE_FILE), join(staged, DATABASE_FILE))
        for (const one of folders) cpSync(join(folder, one), join(staged, one), { recursive: true })
        writeFileSync(
          join(staged, MANIFEST_FILE),
          `${Schema.encodeSync(ManifestJson)({ ...manifest, folders })}\n`,
        )
      },
      catch: (cause) =>
        new BackupFailed({
          folder: staged,
          reason: cause instanceof Error ? cause.message : String(cause),
        }),
    })
  })

/**
 * Applies a staged restore, before the database is opened: the staged database replaces the
 * current one (its write-ahead log with it), and each staged folder the current one. Answers the
 * manifest of what was restored, or none. A staging the previous run left unfinished, without
 * its record, is removed and nothing is applied. The staging itself is removed by
 * `clearStagedRestore`, once the restore is written down: a start that stops in between applies
 * the same files again.
 */
export function applyStagedRestore(dataFolder: string): Manifest | null {
  const staged = join(dataFolder, RESTORE_FOLDER)
  if (!existsSync(staged)) return null
  const manifest = Option.getOrNull(readManifest(staged))
  if (manifest === null) {
    rmSync(staged, { recursive: true, force: true })
    return null
  }
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(join(dataFolder, `${DATABASE_FILE}${suffix}`), { force: true })
  }
  cpSync(join(staged, DATABASE_FILE), join(dataFolder, DATABASE_FILE))
  for (const one of manifest.folders) {
    rmSync(join(dataFolder, one), { recursive: true, force: true })
    cpSync(join(staged, one), join(dataFolder, one), { recursive: true })
  }
  return manifest
}

export function clearStagedRestore(dataFolder: string): void {
  rmSync(join(dataFolder, RESTORE_FOLDER), { recursive: true, force: true })
}
