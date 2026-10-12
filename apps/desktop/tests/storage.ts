/**
 * A data folder for one test: made under the temporary directory, opened with the engine's own
 * layers, and removed afterwards. No test opens the Profile of this machine.
 */

import type { ChildProcess } from 'node:child_process'
import { once } from 'node:events'
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

/** What removes a folder and its content, throwing what the system answers. */
export type Remover = (folder: string) => void

export const removeTree: Remover = (folder) => rmSync(folder, { recursive: true, force: true })

/** Windows answers these while a file is held for a moment (a child just ended, a scan). */
const TRANSIENT = ['EPERM', 'EBUSY', 'ENOTEMPTY']
const ATTEMPTS = 10
const RETRY_MILLIS = 100

const sleep = (millis: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, millis)
}

/**
 * Removes a folder, trying again while the system holds it for a moment, each wait longer than
 * the last. Held for good, the last answer is thrown with the folder's path.
 */
export function removeWithRetries(
  folder: string,
  remove: Remover = removeTree,
  wait: (millis: number) => void = sleep,
): void {
  for (let attempt = 1; ; attempt += 1) {
    try {
      remove(folder)
      return
    } catch (failure) {
      const transient =
        failure instanceof Error &&
        TRANSIENT.some((code) => 'code' in failure && failure.code === code)
      if (!transient || attempt === ATTEMPTS) {
        const said = failure instanceof Error ? failure.message : 'it failed'
        throw new Error(`could not remove ${folder} (${String(attempt)} attempts): ${said}`, {
          cause: failure,
        })
      }
      wait(RETRY_MILLIS * attempt)
    }
  }
}

/** Removes every folder made, the ones that can be even when one cannot; then throws for those. */
export function removeFoldersWith(remove: Remover, wait: (millis: number) => void): void {
  const failures: Error[] = []
  for (const folder of made.splice(0)) {
    try {
      removeWithRetries(folder, remove, wait)
    } catch (failure) {
      if (failure instanceof Error) failures.push(failure)
    }
  }
  const [first] = failures
  if (first !== undefined) throw first
}

export function removeFolders(): void {
  removeFoldersWith(removeTree, sleep)
}

/**
 * Ends a child a test started and answers once it is gone. Windows will not remove a folder a
 * process still stands in, and a kill only asks: the folders are removed after this, not after
 * the kill.
 */
export async function endChild(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  const gone = once(child, 'exit')
  child.kill('SIGKILL')
  await gone
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
