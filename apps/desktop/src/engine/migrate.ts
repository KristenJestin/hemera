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
import type { NewEvent } from './journal.ts'
import { mutate } from './transaction.ts'
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
  /** The migration a copy was taken before, and null when none was taken. */
  backedUp: string | null
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
    // Filled in by the opening itself, which is the only thing that knows whether a copy was
    // worth taking: comparing two lists says what has to run, not what was saved first.
    backedUp: null,
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
export function backUp(dataDirectory: string, migration: string) {
  return Effect.gen(function* () {
    const client = yield* SqliteClient
    const folder = join(dataDirectory, BACKUPS_FOLDER)
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
export function openProfile(dataDirectory: string, migrationsFolder: string, version: string) {
  return Effect.gen(function* () {
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
        yield* backUp(dataDirectory, first)
        standing.backedUp = first
      }
      yield* migrateWithoutForeignKeys(migrationsFolder).pipe(
        Effect.mapError((cause) => new MigrationError({ migrations: standing.behind, cause })),
      )
    }

    yield* recordOpening(version)
    yield* recordStanding(version, standing)
    return standing
  })
}

/**
 * Applies the migrations with foreign key enforcement off, and checks what they left behind.
 *
 * A migration that changes a check rebuilds its table the only way SQLite allows — create the
 * new one, copy into it, drop the old one, rename — and the table it drops is the parent of rows
 * that are already in the new one: with enforcement on, that `DROP TABLE sessions` cascades, and
 * every message of every Session goes with it. The `PRAGMA foreign_keys=OFF` the generated file
 * carries is ignored, because a migration runs inside a transaction and SQLite refuses that
 * pragma while one is pending; so it is turned off here, outside, and turned back on whether the
 * run succeeded or not.
 *
 * Turning it back on is not enough to trust the result: `foreign_key_check` is what the pragma
 * was protecting, run by hand once. A row left without its parent is a profile that is not
 * opened — the copy taken before the migration is why that is recoverable.
 */
function migrateWithoutForeignKeys(migrationsFolder: string) {
  return Effect.gen(function* () {
    const client = yield* SqliteClient
    const database = yield* Database
    yield* client`PRAGMA foreign_keys = OFF`
    yield* Effect.gen(function* () {
      yield* applyMigrations(database, { migrationsFolder })
      const orphans = yield* client<{ table: string }>`PRAGMA foreign_key_check`
      if (orphans.length > 0) {
        return yield* Effect.fail(
          new Error(
            `${orphans.length} rows are left without their parent in ${orphans[0]?.table ?? 'a table'}`,
          ),
        )
      }
    }).pipe(
      // Built as an Effect rather than a statement, so that turning it back on really runs when
      // the migration fails: the refusal leaves a profile that is not opened, and the next
      // attempt to open it must not be running with the checks off.
      Effect.ensuring(
        Effect.gen(function* () {
          yield* client`PRAGMA foreign_keys = ON`
        }).pipe(Effect.orDie),
      ),
    )
  })
}

/**
 * Writes what opening the profile did, into the Journal the user reads (design D4-05).
 *
 * The one place in the application where an event is written by something that is not a use
 * case, because opening a data folder is not something a user asked for: it is the machine
 * starting, and what it did to their data is theirs to see. The detail — which migrations ran,
 * what the driver said — stays in the diagnostic log, where a reader of the Journal is not.
 *
 * The backup and the migration are two entries and not one. They can happen apart: a profile
 * already up to date is opened without either, and a refused migration leaves a backup with no
 * migration after it — which is exactly the case where somebody needs to see the backup named.
 *
 * A failure to write them is not swallowed. The database has just been opened and migrated, so
 * if it cannot take three rows, something is wrong with the data folder and starting anyway
 * would be starting on a profile nobody can write to.
 */
function recordStanding(version: string, standing: Standing) {
  const migrated = standing.behind.at(-1)
  return Effect.gen(function* () {
    // A profile whose migrations do not carry the Journal has nowhere to write this, and that
    // is not a failure: it is a data folder from before the lot that added the table. Asked of
    // the database rather than assumed from a version number.
    if (!(yield* hasTable('domain_events'))) return
    yield* writeStanding(version, standing, migrated)
  })
}

function writeStanding(version: string, standing: Standing, migrated: string | undefined) {
  const events: NewEvent[] = [opened(version)]
  // Each on its own condition, which is what "they can happen apart" means. A migration used to
  // be journaled only when a backup had been taken beside it, so a first launch — which runs
  // every migration there is and has nothing to back up — said it had opened and nothing more.
  if (standing.backedUp !== null) events.push(backedUp(standing.backedUp))
  if (migrated !== undefined) events.push(migratedTo(migrated))
  return mutate('writing down what opening the profile did', () =>
    Effect.succeed({ result: null, events }),
  )
}

/** The three the profile can write, each named the way the Journal shows it. */
function opened(version: string) {
  return {
    type: 'profile.opened',
    entityKind: 'profile',
    entityId: PROFILE,
    source: 'system',
    author: 'hemera',
    payload: { version },
  } as const
}

function backedUp(migration: string) {
  return {
    type: 'profile.backed_up',
    entityKind: 'profile',
    entityId: PROFILE,
    source: 'system',
    author: 'hemera',
    payload: { before: migration },
  } as const
}

function migratedTo(migration: string) {
  return {
    type: 'profile.migrated',
    entityKind: 'profile',
    entityId: PROFILE,
    source: 'system',
    author: 'hemera',
    payload: { migration },
  } as const
}

/** What the profile's own events are about, since the data folder has no identifier. */
const PROFILE = 'profile'
