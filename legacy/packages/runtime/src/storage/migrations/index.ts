/**
 * Migrations of the profile, imported as text rather than read from a folder.
 *
 * Drizzle's own reader walks a directory on disk, which no compiled binary has: each SQL file
 * is generated into a TypeScript module and imported statically, so a packaged application
 * carries its migrations with it. Each one is identified by its name and by the fingerprint of
 * the text that was applied.
 */

import { createHash } from 'node:crypto'

import { sql as lot1 } from './0001-lot-1.sql.ts'

export interface Migration {
  /** Order and identity; never renamed once applied anywhere. */
  name: string
  sql: string
}

/** Marker the SQL is split on, one statement per transaction step. */
export const STATEMENT_BREAKPOINT = '--> statement-breakpoint'

/** Every migration, in the order they apply. */
export const MIGRATIONS: readonly Migration[] = [{ name: '0001-lot-1', sql: lot1 }]

/** Fingerprint of the text a migration was applied from. */
export function checksumOf(migration: Migration): string {
  return createHash('sha256').update(migration.sql).digest('hex')
}

/** The statements a migration runs, in order. */
export function statementsOf(migration: Migration): string[] {
  return migration.sql
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}
