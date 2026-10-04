/**
 * A data folder for one test: made under the temporary directory, opened with the engine's own
 * layers, and removed afterwards. No test opens the Profile of this machine.
 */

import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect, Layer } from 'effect'
import type { Scope } from 'effect'

import { type DomainEvents, domainEventsLayer } from '../src/engine/domain-events.ts'
import { DATABASE_FILE } from '../src/engine/migrate.ts'
import {
  type Database,
  type DatabaseError,
  type SqliteClient,
  databaseLayer,
} from '../src/engine/storage/database.ts'

/** The migrations this application ships, which is what a real start reads. */
export const SHIPPED = join(import.meta.dirname, '..', 'drizzle')

/** A temporary folder, removed by `removeFolders`. */
const made: string[] = []
export function temporaryFolder(name: string): string {
  const folder = mkdtempSync(join(tmpdir(), `hemera-${name}-`))
  made.push(folder)
  return folder
}
export function removeFolders(): void {
  // On Windows a tree just ended still holds its folders for a moment: the removal is retried.
  for (const folder of made.splice(0)) {
    rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

export type Storage = Database | SqliteClient | DomainEvents

export const storageOf = (dataFolder: string): Layer.Layer<Storage, DatabaseError> =>
  Layer.merge(databaseLayer(join(dataFolder, DATABASE_FILE)), domainEventsLayer)

/**
 * Runs a program on a data folder and closes the database before answering: one call is one
 * opening, so two calls are a restart.
 */
export function on<A, E>(
  dataFolder: string,
  program: Effect.Effect<A, E, Storage | Scope.Scope>,
): Promise<A> {
  mkdirSync(dataFolder, { recursive: true })
  return Effect.runPromise(Effect.scoped(Effect.provide(program, storageOf(dataFolder))))
}

/** The same, for a program expected to fail: its error is the answer. */
export function refusalOn<A, E>(
  dataFolder: string,
  program: Effect.Effect<A, E, Storage | Scope.Scope>,
): Promise<E | DatabaseError> {
  mkdirSync(dataFolder, { recursive: true })
  return Effect.runPromise(
    Effect.scoped(Effect.flip(Effect.provide(program, storageOf(dataFolder)))),
  )
}

let folders = 0

/**
 * The shipped migrations followed by `extra`, each one a later migration with its SQL: what a
 * newer build would carry.
 */
export function migrationsWith(...extra: string[]): string {
  const folder = temporaryFolder(`migrations-${String(folders++)}`)
  for (const shipped of readdirSync(SHIPPED)) {
    cpSync(join(SHIPPED, shipped), join(folder, shipped), { recursive: true })
  }
  extra.forEach((sql, rank) => {
    const directory = join(folder, `2099010100000${String(rank)}_later_${String(rank)}`)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'migration.sql'), sql)
  })
  return folder
}
