/**
 * A data folder for one test: made under the temporary directory, opened with the engine's own
 * layers, and removed afterwards. No test opens the Profile of this machine.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect, Fiber, Layer } from 'effect'
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

/** The programs running on the tests' folders, until each ends. */
const running = new Set<Fiber.Fiber<unknown, unknown>>()

/**
 * Runs a program as `Effect.runPromise` does, and keeps it until it ends: one its test left
 * running (timed out, or never awaited) still holds its database and its children in the folders,
 * so `removeFolders` interrupts it, its scope closed, before removing them.
 */
export function runOnFolders<A, E>(program: Effect.Effect<A, E>): Promise<A> {
  const fiber = Effect.runFork(program)
  running.add(fiber)
  fiber.addObserver(() => running.delete(fiber))
  return Effect.runPromise(Fiber.join(fiber))
}

/** Ends what still runs on the folders, then removes them. */
export async function removeFolders(): Promise<void> {
  await Effect.runPromise(Fiber.interruptAll([...running]))
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

/**
 * Answers once a child a test started writes its first line, and fails, naming what it wrote on
 * its errors, when it has not within `bound` ms or ends first. A wait on a child without a bound
 * hangs its test when the child is slow to start: PowerShell took seconds to on a loaded runner.
 */
export function readyWithin(child: ChildProcess, bound: number): Promise<void> {
  let errors = ''
  const onErrors = (chunk: Buffer): void => {
    errors += chunk.toString()
  }
  child.stderr?.on('data', onErrors)
  return new Promise<void>((resolve, reject) => {
    const settle = (failure?: Error): void => {
      clearTimeout(timer)
      child.stdout?.off('data', onReady)
      child.off('exit', onExit)
      child.stderr?.off('data', onErrors)
      if (failure === undefined) resolve()
      else reject(failure)
    }
    const onReady = (): void => settle()
    const onExit = (code: number | null): void =>
      settle(new Error(`the child ended (${code}) before it was ready: ${errors}`))
    const timer = setTimeout(
      () => settle(new Error(`the child was not ready after ${bound} ms: ${errors}`)),
      bound,
    )
    child.stdout?.once('data', onReady)
    child.once('exit', onExit)
  })
}

/** How long a child a test starts has to say it is ready. */
export const READY_WITHIN = 20_000

/**
 * Starts a process that holds a file open until `endChild` ends it, and answers once it does, or
 * fails within `READY_WITHIN`. On Windows it shares nothing, as an editor or an antivirus may:
 * PowerShell, since Node opens every file shared (it took 6 s to start on a loaded runner). Its
 * input is closed: PowerShell may wait on an input pipe left open. Elsewhere an open file never
 * stops a rename.
 */
export async function holdFile(file: string): Promise<ChildProcess> {
  const holder =
    process.platform === 'win32'
      ? spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `$f = [System.IO.File]::Open('${file}', 'Open', 'Read', 'None'); 'held'; Start-Sleep -Seconds 60`,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        )
      : spawn(
          process.execPath,
          [
            '-e',
            "require('node:fs').openSync(process.argv[1], 'r'); console.log('held'); setInterval(() => {}, 1000)",
            file,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        )
  try {
    await readyWithin(holder, READY_WITHIN)
  } catch (failure) {
    await endChild(holder)
    throw failure
  }
  return holder
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
  return runOnFolders(Effect.scoped(Effect.provide(program, storageOf(dataFolder))))
}

/** The same, for a program expected to fail: its error is the answer. */
export function refusalOn<A, E>(
  dataFolder: string,
  program: Effect.Effect<A, E, Storage | Scope.Scope>,
): Promise<E | DatabaseError> {
  mkdirSync(dataFolder, { recursive: true })
  return runOnFolders(Effect.scoped(Effect.flip(Effect.provide(program, storageOf(dataFolder)))))
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
