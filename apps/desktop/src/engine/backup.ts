/**
 * The backup of a Profile, and the registry of the folders a backup carries.
 *
 * A backup is one folder, `hemera-backup-<date>/`: a consistent copy of the database, a copy of
 * each registered folder of the data folder, and a `manifest.json` written last, which is what
 * makes it a backup. The registry names folders relative to the data folder (`missions/`,
 * `snapshots/`…); the ticket that creates such a folder registers it where the engine is
 * composed, without touching this file. What is not registered is never carried: Workspace
 * sources and the main checkouts of Projects are not part of a backup.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, normalize } from 'node:path'

import { Context, Effect, Layer, Schema } from 'effect'

import {
  BACKUPS_FOLDER,
  DATABASE_FILE,
  appliedMigrations,
  copyDatabase,
  profileRow,
} from './migrate.ts'
import { ProfileHome } from './profile-home.ts'
import type { Database, DatabaseError, SqliteClient } from './storage/database.ts'

/** The file that makes a folder a backup of Hemera, written last. */
export const MANIFEST_FILE = 'manifest.json'

/** What a backup says about itself. */
export const Manifest = Schema.Struct({
  profileId: Schema.String,
  /** The version of Hemera that wrote it. */
  hemeraVersion: Schema.String,
  /** The last migration applied to the database it carries. */
  lastMigration: Schema.NullOr(Schema.String),
  takenAt: Schema.String,
  /** The registered folders it carries, relative to the data folder. */
  folders: Schema.Array(Schema.String),
})
export type Manifest = typeof Manifest.Type

export const ManifestJson = Schema.fromJsonString(Schema.toCodecJson(Manifest))

/** A backup could not be written. */
export class BackupFailed extends Schema.TaggedError<BackupFailed>()('BackupFailed', {
  folder: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `The backup could not be written to ${this.folder}: ${this.reason}`
  }
}

/** A folder the registry cannot hold: it must be a plain path inside the data folder. */
const isPlainFolder = (folder: string): boolean =>
  folder !== '' && !isAbsolute(folder) && !normalize(folder).startsWith('..')

/** The folders of the data folder a backup carries. */
export class BackupFolders extends Context.Service<BackupFolders, ReadonlyArray<string>>()(
  'BackupFolders',
) {}

export const backupFoldersLayer = (folders: ReadonlyArray<string>) => {
  const refused = folders.filter((folder) => !isPlainFolder(folder))
  if (refused.length > 0) {
    throw new Error(`a backup folder must be relative to the data folder: ${refused.join(', ')}`)
  }
  return Layer.succeed(BackupFolders, folders)
}

/** A date as a file name takes it on every system: no colon, no fraction. */
export const stampOf = (date: Date): string =>
  date
    .toISOString()
    .replace(/\.\d+Z$/, 'Z')
    .replaceAll(':', '-')

/** A folder named `name` in `parent` that does not exist yet, suffixed when one does. */
const freshFolder = (parent: string, name: string): string => {
  let candidate = join(parent, name)
  for (let rank = 2; existsSync(candidate); rank += 1) candidate = join(parent, `${name}-${rank}`)
  return candidate
}

const failedIn =
  (folder: string) =>
  <E>(cause: E) =>
    new BackupFailed({
      folder,
      reason: cause instanceof Error ? cause.message : String(cause),
    })

/**
 * Writes a backup of the Profile into `parent`, as a folder named `name` and the date, and
 * answers the folder it wrote.
 */
export const writeBackup = (
  parent: string,
  name: string,
): Effect.Effect<
  string,
  BackupFailed | DatabaseError,
  Database | SqliteClient | BackupFolders | ProfileHome
> =>
  Effect.gen(function* () {
    const home = yield* ProfileHome
    const registered = yield* BackupFolders
    const takenAt = new Date()
    const folder = yield* Effect.try({
      try: () => {
        mkdirSync(parent, { recursive: true })
        const fresh = freshFolder(parent, `${name}-${stampOf(takenAt)}`)
        mkdirSync(fresh)
        return fresh
      },
      catch: failedIn(parent),
    })
    yield* copyDatabase(join(folder, DATABASE_FILE))
    const carried = registered.filter((one) => existsSync(join(home.dataFolder, one)))
    const manifest: Manifest = {
      profileId: (yield* profileRow)?.id ?? '',
      hemeraVersion: home.version,
      lastMigration: (yield* appliedMigrations).at(-1)?.name ?? null,
      takenAt: takenAt.toISOString(),
      folders: carried,
    }
    yield* Effect.try({
      try: () => {
        for (const one of carried) {
          cpSync(join(home.dataFolder, one), join(folder, one), { recursive: true })
        }
        writeFileSync(join(folder, MANIFEST_FILE), `${Schema.encodeSync(ManifestJson)(manifest)}\n`)
      },
      catch: failedIn(folder),
    })
    return folder
  })

/** The automatic backups of the data folder: how many, and the most recent. */
export const automaticBackups = (dataFolder: string) => {
  const folder = join(dataFolder, BACKUPS_FOLDER)
  if (!existsSync(folder)) return { count: 0, latest: null }
  const taken = readdirSync(folder)
    .map((name) => ({ name, at: statSync(join(folder, name)).mtimeMs }))
    .toSorted((left, right) => left.at - right.at)
  return { count: taken.length, latest: taken.at(-1)?.name ?? null }
}
