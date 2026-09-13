/**
 * Opening the profile database.
 *
 * Foreign keys, write-ahead logging and a bounded busy timeout are turned on before anything
 * else. Migrations are applied one transaction each, together with the row that records them,
 * before any service opens: a failure leaves no half-applied schema and no writable start.
 */

import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { MIGRATIONS, checksumOf, statementsOf } from './migrations/index.ts'
import type { Migration } from './migrations/index.ts'

/** File the profile keeps its database in. */
export const DATABASE_FILE = 'hemera.db'

/** How long a write waits for another connection before giving up. */
export const BUSY_TIMEOUT_MS = 5_000

export class MigrationFailedError extends Error {
  constructor(
    readonly migration: string,
    cause: unknown,
  ) {
    super(`migration ${migration} failed: ${cause instanceof Error ? cause.message : cause}`)
    this.name = 'MigrationFailedError'
  }
}

export class MigrationChecksumError extends Error {
  constructor(
    readonly migration: string,
    readonly applied: string,
    readonly current: string,
  ) {
    super(`migration ${migration} was applied from ${applied} but the package carries ${current}`)
    this.name = 'MigrationChecksumError'
  }
}

export class SchemaAheadError extends Error {
  constructor(readonly unknownMigrations: string[]) {
    super(
      `the profile carries migrations this package does not know: ${unknownMigrations.join(', ')}`,
    )
    this.name = 'SchemaAheadError'
  }
}

export interface AppliedMigration {
  name: string
  checksum: string
  appliedAt: number
}

function readApplied(database: Database): AppliedMigration[] {
  database.run(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )`,
  )
  return database
    .query('SELECT name, checksum, applied_at AS appliedAt FROM schema_migrations ORDER BY name')
    .all() as AppliedMigration[]
}

/** Applies one migration and its tracking row in a single transaction. */
function applyMigration(database: Database, migration: Migration, now: number): void {
  const apply = database.transaction(() => {
    for (const statement of statementsOf(migration)) database.run(statement)
    database.run('INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?, ?, ?)', [
      migration.name,
      checksumOf(migration),
      now,
    ])
  })
  try {
    apply()
  } catch (cause) {
    throw new MigrationFailedError(migration.name, cause)
  }
}

export interface MigrationReport {
  applied: string[]
  alreadyApplied: string[]
}

/**
 * Brings the profile up to the schema this package carries.
 *
 * A migration already applied is never replayed; a fingerprint that no longer matches is
 * reported rather than ignored; a profile carrying an unknown migration is refused, which is
 * what an older package meets on a profile a newer one has migrated.
 */
export function migrate(
  database: Database,
  now: number,
  migrations: readonly Migration[] = MIGRATIONS,
): MigrationReport {
  const applied = readApplied(database)
  const known = new Set(migrations.map((migration) => migration.name))
  const unknown = applied.filter((entry) => !known.has(entry.name)).map((entry) => entry.name)
  if (unknown.length > 0) throw new SchemaAheadError(unknown)

  const byName = new Map(applied.map((entry) => [entry.name, entry]))
  const report: MigrationReport = { applied: [], alreadyApplied: [] }

  for (const migration of migrations) {
    const previous = byName.get(migration.name)
    if (previous !== undefined) {
      const current = checksumOf(migration)
      if (previous.checksum !== current) {
        throw new MigrationChecksumError(migration.name, previous.checksum, current)
      }
      report.alreadyApplied.push(migration.name)
      continue
    }
    applyMigration(database, migration, now)
    report.applied.push(migration.name)
  }
  return report
}

export interface OpenProfileOptions {
  /** Directory the profile lives in; created when absent. */
  directory: string
  now: number
  migrations?: readonly Migration[]
}

export interface OpenProfile {
  database: Database
  path: string
  migrations: MigrationReport
}

/** Opens the profile database, turns its pragmas on and brings the schema up to date. */
export function openProfile({ directory, now, migrations }: OpenProfileOptions): OpenProfile {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, DATABASE_FILE)
  const database = new Database(path, { create: true })

  database.run('PRAGMA foreign_keys = ON')
  database.run('PRAGMA journal_mode = WAL')
  database.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)

  try {
    return { database, path, migrations: migrate(database, now, migrations) }
  } catch (cause) {
    // A failed migration leaves no writable connection behind.
    database.close()
    throw cause
  }
}
