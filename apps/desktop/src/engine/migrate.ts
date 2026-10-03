/**
 * What happens to a Profile before anything is allowed to read it.
 *
 * Three cases, and only three. The Profile carries the migrations this build carries: it opens.
 * It carries fewer: it is backed up, migrated, then opened. It carries one this build has never
 * heard of, written by a newer version: it is refused, untouched.
 *
 * Hemera 1.0 keeps its own files in the data folder, `hemera-1.sqlite` and `backups-1/`, and
 * reads, moves, renames or migrates nothing else there: what a 0.x build left stays as it was.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { migrate as applyMigrations } from 'drizzle-orm/effect-sqlite-node/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { Effect, Schema } from 'effect'

import type { EventPayload, NewEvent } from './journal.ts'
import { Database, type DatabaseError, SqliteClient, refusedWhile } from './storage/database.ts'
import { PROFILE_ROW, profile } from './storage/schema.ts'
import { mutate } from './transaction.ts'

/** The database of a 1.0 Profile, in the data folder. */
export const DATABASE_FILE = 'hemera-1.sqlite'

/** Where the automatic backups of a 1.0 Profile go, in the data folder. */
export const BACKUPS_FOLDER = 'backups-1'

/** A migration, as both sides name it: the folder it ships in, and what it hashes to. */
export interface Migration {
  readonly name: string
  readonly hash: string
}

/** Where a Profile stands against the build that opens it. */
export interface Standing {
  /** Applied to the Profile, unknown to this build: the Profile is ahead. */
  readonly ahead: ReadonlyArray<string>
  /** Carried by this build, not applied yet: the Profile is behind. */
  readonly behind: ReadonlyArray<string>
}

/** What opening the Profile did. */
export interface Opened extends Standing {
  /** The backup taken before migrating, and null when none was. */
  readonly backedUp: string | null
  /** The last migration the Profile stands at now. */
  readonly lastMigration: string | null
}

/** The Profile was written by a version that knows migrations this one does not. */
export class ProfileAhead extends Schema.TaggedError<ProfileAhead>()('ProfileAhead', {
  writtenByVersion: Schema.NullOr(Schema.String),
  migrations: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return 'This data folder was written by a newer version of Hemera and cannot be opened by this one.'
  }
}

/** A migration was refused: the database is as it was, and the backup taken before is kept. */
export class MigrationFailed extends Schema.TaggedError<MigrationFailed>()('MigrationFailed', {
  migrations: Schema.Array(Schema.String),
  backup: Schema.NullOr(Schema.String),
  reason: Schema.String,
}) {
  override get message(): string {
    const kept = this.backup === null ? '' : ` Its backup is kept in ${this.backup}.`
    return `This data folder could not be brought up to this version of Hemera.${kept}`
  }
}

/** The migrations this build carries, read from the folder it ships them in. */
export function carriedMigrations(migrationsFolder: string): ReadonlyArray<Migration> {
  return readMigrationFiles({ migrationsFolder }).map(({ name, hash }) => ({ name, hash }))
}

/**
 * Where a Profile stands, compared by hash rather than by name: a migration renamed is the same
 * migration, and one edited after it was applied is not.
 */
export function standingOf(
  carried: ReadonlyArray<Migration>,
  applied: ReadonlyArray<Migration>,
): Standing {
  const carries = new Set(carried.map(({ hash }) => hash))
  const has = new Set(applied.map(({ hash }) => hash))
  return {
    ahead: applied.filter(({ hash }) => !carries.has(hash)).map(({ name }) => name),
    behind: carried.filter(({ hash }) => !has.has(hash)).map(({ name }) => name),
  }
}

const hasTable = (name: string) =>
  Effect.gen(function* () {
    const sql = yield* SqliteClient
    const found = yield* sql<{
      name: string
    }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name}`
    return found.length > 0
  })

/** The migrations the Profile has been through, none for one that never was. */
export const appliedMigrations = Effect.gen(function* () {
  if (!(yield* hasTable('__drizzle_migrations'))) return []
  const sql = yield* SqliteClient
  const rows = yield* sql<Migration>`SELECT name, hash FROM __drizzle_migrations ORDER BY id`
  return rows.map(({ name, hash }) => ({ name, hash }))
}).pipe(Effect.mapError(refusedWhile('reading its migrations')))

/** What the `profile` row says, read in raw SQL: a newer Profile's shape is not this build's. */
export const profileRow = Effect.gen(function* () {
  if (!(yield* hasTable('profile'))) return null
  const sql = yield* SqliteClient
  const [row] = yield* sql<{
    id: string
    last_opened_by_version: string
  }>`SELECT id, last_opened_by_version FROM profile WHERE row = ${PROFILE_ROW}`
  return row === undefined ? null : { id: row.id, lastOpenedByVersion: row.last_opened_by_version }
}).pipe(Effect.mapError(refusedWhile('reading the Profile')))

/**
 * A consistent copy of the database into `file`: the write-ahead log is folded into the file
 * first, then SQLite's online backup copies it page by page.
 */
export const copyDatabase = (file: string) =>
  Effect.gen(function* () {
    const client = yield* SqliteClient
    yield* client`PRAGMA wal_checkpoint(TRUNCATE)`
    yield* client.backup(file)
  }).pipe(Effect.mapError(refusedWhile('copying the database')))

/**
 * Applies the migrations with foreign key enforcement off, and checks what they left behind. A
 * migration that rebuilds a table drops the parent of rows already copied, and with enforcement
 * on that drop cascades. SQLite refuses the pragma inside the migrator's transaction, so it is
 * turned off here, outside, and back on whatever happened.
 */
const migrateWithoutForeignKeys = (migrationsFolder: string) =>
  Effect.gen(function* () {
    const client = yield* SqliteClient
    const database = yield* Database
    yield* client`PRAGMA foreign_keys = OFF`
    yield* Effect.gen(function* () {
      yield* applyMigrations(database, { migrationsFolder })
      const orphans = yield* client<{ table: string }>`PRAGMA foreign_key_check`
      if (orphans.length > 0) {
        return yield* Effect.fail(
          new Error(`${orphans.length} rows are left without their parent in ${orphans[0]?.table}`),
        )
      }
    }).pipe(Effect.ensuring(client`PRAGMA foreign_keys = ON`.pipe(Effect.orDie)))
  })

const PROFILE = 'profile'

const profileEvent = (type: string, payload: EventPayload): NewEvent => ({
  type,
  entityKind: PROFILE,
  entityId: PROFILE,
  source: 'system',
  author: 'hemera',
  payload,
})

/** Writes down that this version opened the Profile, creating it on its first opening. */
const recordOpening = (version: string, opened: Opened, existing: { id: string } | null) =>
  mutate('writing down the opening of the Profile', (transaction) =>
    Effect.gen(function* () {
      const now = new Date().toISOString()
      const id = existing?.id ?? crypto.randomUUID()
      const written = { lastOpenedByVersion: version, lastOpenedAt: now }
      yield* transaction
        .insert(profile)
        .values({ row: PROFILE_ROW, id, createdByVersion: version, createdAt: now, ...written })
        .onConflictDoUpdate({ target: profile.row, set: written })
      const events: NewEvent[] = []
      if (existing === null) events.push(profileEvent('profile.created', { id, version }))
      if (opened.backedUp !== null) {
        events.push(profileEvent('profile.backed_up', { backup: opened.backedUp }))
      }
      if (opened.behind.length > 0) {
        events.push(profileEvent('profile.migrated', { migrations: [...opened.behind] }))
      }
      events.push(profileEvent('profile.opened', { version }))
      return { result: id, events }
    }),
  )

/**
 * Brings the Profile up to what this build carries and writes down its opening, or refuses it.
 * A database that was never migrated is not backed up: there is nothing of the user's in it.
 */
export const openProfile = (dataFolder: string, migrationsFolder: string, version: string) =>
  Effect.gen(function* () {
    const carried = carriedMigrations(migrationsFolder)
    const applied = yield* appliedMigrations
    const standing = standingOf(carried, applied)

    if (standing.ahead.length > 0) {
      return yield* new ProfileAhead({
        writtenByVersion: (yield* profileRow)?.lastOpenedByVersion ?? null,
        migrations: [...standing.ahead],
      })
    }

    let backedUp: string | null = null
    const [first] = standing.behind
    if (first !== undefined) {
      if (applied.length > 0) {
        const folder = join(dataFolder, BACKUPS_FOLDER)
        yield* Effect.sync(() => mkdirSync(folder, { recursive: true }))
        backedUp = join(folder, `${first}.sqlite`)
        yield* copyDatabase(backedUp)
      }
      const backup = backedUp
      yield* migrateWithoutForeignKeys(migrationsFolder).pipe(
        Effect.mapError(
          (cause) =>
            new MigrationFailed({
              migrations: [...standing.behind],
              backup,
              reason: cause instanceof Error ? cause.message : String(cause),
            }),
        ),
      )
    }

    const opened: Opened = {
      ...standing,
      backedUp,
      lastMigration: carried.at(-1)?.name ?? null,
    }
    yield* recordOpening(version, opened, yield* profileRow)
    return opened
  })

export type OpenProfileError = ProfileAhead | MigrationFailed | DatabaseError
