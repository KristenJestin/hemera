/**
 * Backing a profile up before migrating it.
 *
 * A migration on a profile that already holds a user's work is preceded by a consistent copy:
 * the database with its write-ahead log and its shared-memory file, and the files the profile
 * keeps. The copy is taken with every connection closed and the log checkpointed, or it would
 * hold a database whose latest writes live only in a log that was not copied with it.
 *
 * A failed migration leaves the previous profile untouched and its copy in place.
 */

import { Database } from 'bun:sqlite'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { DATABASE_FILE } from './database.ts'

/** Directory of the profile the dated copies are kept under. */
export const BACKUP_DIRECTORY = 'backups'

/** Files a copy of the database has to carry together. */
export const DATABASE_FILES = [DATABASE_FILE, `${DATABASE_FILE}-wal`, `${DATABASE_FILE}-shm`]

export interface BackupResult {
  /** Directory the copy was written to. */
  directory: string
  /** Files actually copied. */
  files: string[]
}

/** Name of a dated copy, stable enough to sort and readable enough to recognise. */
export function backupNameOf(now: number, schemaVersion: string): string {
  const at = new Date(now).toISOString().replaceAll(/[:.]/g, '-')
  return `${at}-${schemaVersion}`
}

/**
 * Checkpoints the write-ahead log so the database file holds everything committed.
 *
 * Without it a copy of the database alone is a copy of yesterday.
 */
export function checkpoint(path: string): void {
  const database = new Database(path)
  try {
    database.run('PRAGMA wal_checkpoint(TRUNCATE)')
  } finally {
    database.close()
  }
}

export interface BackupOptions {
  /** Profile being backed up; every connection to it must already be closed. */
  directory: string
  now: number
  /** Schema the copy is of, so a restore knows what it is looking at. */
  schemaVersion: string
}

/** Takes a consistent, dated copy of a profile. */
export function backupProfile({ directory, now, schemaVersion }: BackupOptions): BackupResult {
  const databasePath = join(directory, DATABASE_FILE)
  if (existsSync(databasePath)) checkpoint(databasePath)

  const destination = join(directory, BACKUP_DIRECTORY, backupNameOf(now, schemaVersion))
  mkdirSync(destination, { recursive: true })

  const files: string[] = []
  for (const name of DATABASE_FILES) {
    const source = join(directory, name)
    if (!existsSync(source)) continue
    copyFileSync(source, join(destination, name))
    files.push(name)
  }

  // Anything else the profile keeps beside its database travels with it.
  for (const entry of readdirSync(directory)) {
    if (DATABASE_FILES.includes(entry) || entry === BACKUP_DIRECTORY) continue
    const source = join(directory, entry)
    if (!statSync(source).isFile()) continue
    copyFileSync(source, join(destination, entry))
    files.push(entry)
  }

  return { directory: destination, files }
}

/** The dated copies a profile holds, oldest first. */
export function backupsOf(directory: string): string[] {
  const root = join(directory, BACKUP_DIRECTORY)
  if (!existsSync(root)) return []
  return readdirSync(root).toSorted()
}
