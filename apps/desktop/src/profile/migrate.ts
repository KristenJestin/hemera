/**
 * What happens to a profile before anything is allowed to read it (design D3-05).
 *
 * Three cases, and only three. The profile carries the same migrations the application does,
 * and it opens. It carries fewer, and it is backed up, migrated, then opened. It carries one
 * the application has never heard of — a profile written by a newer version — and it is
 * refused, untouched, naming the version that wrote it.
 *
 * The migrations the application carries are the folders it ships in `drizzle/`; the ones the
 * profile has are the rows the migrator keeps in `__drizzle_migrations`. Neither list is
 * written by hand and neither is duplicated: the comparison is between those two.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { migrate as applyMigrations } from 'drizzle-orm/effect-sqlite-node/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { Data, Effect } from 'effect'

import { Database, SqliteClient } from './storage/database.ts'
import { PROFILE_ROW, profile } from './storage/schema.ts'

/** Where a profile keeps the copy taken of it before each migration. */
export const BACKUPS_FOLDER = 'backups'

/** A migration, as either side names it: the folder it ships in, and what it hashes to. */
export interface Migration {
  name: string
  hash: string
}

/** Where a profile stands against the application that is opening it. */
export interface Standing {
  /** Applied to the profile, unknown to this application: the profile is ahead. */
  ahead: string[]
  /** Carried by this application, not applied yet: the profile is behind. */
  behind: string[]
}

/** The profile was written by a version that knows migrations this one does not. */
export class ProfileAheadError extends Data.TaggedError('ProfileAheadError')<{
  readonly writtenByVersion: string | null
  readonly migrations: string[]
}> {}

/** A migration was refused by the database, which is therefore as it was before. */
export class MigrationError extends Data.TaggedError('MigrationError')<{
  readonly migrations: string[]
  readonly cause: unknown
}> {}

/** The migrations this application carries, read from the folder it ships them in. */
export function carriedMigrations(migrationsFolder: string): Migration[] {
  return readMigrationFiles({ migrationsFolder }).map((migration) => ({
    name: migration.name,
    hash: migration.hash,
  }))
}

/**
 * Where a profile stands, compared by hash rather than by name.
 *
 * The hash is what the migrator itself writes down, and it says more than a name does: a
 * migration renamed is the same migration, and a migration edited after it was applied is not.
 */
export function standingOf(carried: Migration[], applied: Migration[]): Standing {
  const carries = new Set(carried.map((migration) => migration.hash))
  const has = new Set(applied.map((migration) => migration.hash))
  return {
    ahead: applied.filter((one) => !carries.has(one.hash)).map((one) => one.name),
    behind: carried.filter((one) => !has.has(one.hash)).map((one) => one.name),
  }
}

/** Whether the profile has a table, asked of the database rather than assumed. */
function hasTable(name: string) {
  return Effect.gen(function* () {
    const sql = yield* SqliteClient
    const found = yield* sql<{
      name: string
    }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name}`
    return found.length > 0
  })
}

/** What the profile has already been migrated with, empty on one that never has been. */
export const appliedMigrations = Effect.gen(function* () {
  if (!(yield* hasTable('__drizzle_migrations'))) return []
  const sql = yield* SqliteClient
  const rows = yield* sql<{
    name: string
    hash: string
  }>`SELECT name, hash FROM __drizzle_migrations ORDER BY created_at`
  return rows.map((row) => ({ name: row.name, hash: row.hash }))
})

/**
 * The version that wrote this profile last, read without going through the schema.
 *
 * A profile that is ahead was written against a schema this application does not have, so the
 * one table it is read from is named in raw SQL: the query builder of today would be asking
 * about a shape of tomorrow.
 */
export const writtenByVersion = Effect.gen(function* () {
  if (!(yield* hasTable('profile'))) return null
  const sql = yield* SqliteClient
  const rows = yield* sql<{
    written_by_version: string
  }>`SELECT written_by_version FROM profile WHERE id = ${PROFILE_ROW}`
  return rows[0]?.written_by_version ?? null
})

/**
 * A copy of the profile, taken before the first migration is applied and named after it.
 *
 * The write-ahead log is folded into the file first: a copy taken with the log still ahead of
 * it is a copy of the profile as it was some time ago, which is the one thing a backup must
 * not be.
 */
export function backUp(profileDirectory: string, migration: string) {
  return Effect.gen(function* () {
    const client = yield* SqliteClient
    const folder = join(profileDirectory, BACKUPS_FOLDER)
    yield* Effect.sync(() => mkdirSync(folder, { recursive: true }))
    yield* client`PRAGMA wal_checkpoint(TRUNCATE)`
    yield* client.backup(join(folder, `${migration}.sqlite`))
  })
}

/** Writes down that this version opened the profile, and when. */
export function recordOpening(version: string) {
  return Effect.gen(function* () {
    const database = yield* Database
    const written = { writtenByVersion: version, lastOpenedAt: new Date().toISOString() }
    yield* database
      .insert(profile)
      .values({ id: PROFILE_ROW, ...written })
      .onConflictDoUpdate({ target: profile.id, set: written })
  })
}

/**
 * Brings the profile up to what this application carries, or refuses to open it.
 *
 * A profile that has never been migrated is not backed up: there is nothing of the user's in
 * it yet, and a copy of an empty file is a file nobody will ever want back.
 */
export function openProfile(profileDirectory: string, migrationsFolder: string, version: string) {
  return Effect.gen(function* () {
    const database = yield* Database
    const carried = carriedMigrations(migrationsFolder)
    const applied = yield* appliedMigrations
    const standing = standingOf(carried, applied)

    if (standing.ahead.length > 0) {
      return yield* new ProfileAheadError({
        writtenByVersion: yield* writtenByVersion,
        migrations: standing.ahead,
      })
    }

    if (standing.behind.length > 0) {
      const first = standing.behind[0]
      if (applied.length > 0 && first !== undefined) {
        yield* backUp(profileDirectory, first)
      }
      yield* applyMigrations(database, { migrationsFolder }).pipe(
        Effect.mapError((cause) => new MigrationError({ migrations: standing.behind, cause })),
      )
    }

    yield* recordOpening(version)
    return standing
  })
}
