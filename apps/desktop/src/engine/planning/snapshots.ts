/**
 * What the Freeze keeps of a main checkout's dirty files (#92, CT-23), through the port B2's
 * snapshot store will serve: `FileSnapshots.capture(repository, files)` reads each file, without
 * writing anything, and answers its sha256 and why its content was not kept, if it was not, with
 * the files it could not read; `keepIn` then keeps the contents in the Freeze's own transaction,
 * so a refused Freeze keeps nothing.
 *
 * Until B2 is merged, the stand-in here copies each content into the database, masked, once per
 * sha256. A file of a sensitive place (a `.env`), a binary file, a file larger than
 * `LARGEST_KEPT` and a link keep only their path and hash; a link is never followed, and a deleted
 * file has no content. A folder Git names (a repository inside the checkout, a submodule) keeps
 * only its path.
 */

import { createHash } from 'node:crypto'
import { closeSync, lstatSync, openSync, readFileSync, readSync, readlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { type DirtyStatus, sensitivePlace } from '@hemera/core/domain'
import { Context, Effect, Layer, Predicate, Result } from 'effect'

import type { DirtyFile } from '../git.ts'
import { Secrets } from '../secrets.ts'
import { type DatabaseError, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { snapshotContents } from '../storage/schema.ts'

/** A repository of the main checkout, by its name in the Project and its folder. */
export interface SnapshotRepository {
  readonly name: string
  readonly folder: string
}

/** One dirty file as the snapshot kept it. */
export interface Snapshot {
  readonly path: string
  readonly status: DirtyStatus
  /** The sha256 of its content; null for a deleted file and a folder. */
  readonly sha256: string | null
  /** Why its content was not kept, or null when it was. */
  readonly withheld: string | null
}

/** What a capture read of one repository's dirty files, nothing written yet. */
export interface Captured {
  readonly snapshots: ReadonlyArray<Snapshot>
  /** Each file that could not be read, named with why: the Freeze is refused for it. */
  readonly problems: ReadonlyArray<string>
  /** The contents to keep, by their sha256. */
  readonly contents: ReadonlyMap<string, string>
}

export class FileSnapshots extends Context.Service<
  FileSnapshots,
  {
    readonly capture: (
      repository: SnapshotRepository,
      files: ReadonlyArray<DirtyFile>,
    ) => Effect.Effect<Captured>
    /** Keeps what the captures read, in the transaction given. */
    readonly keepIn: (
      transaction: EngineTransaction,
      captured: ReadonlyArray<Captured>,
    ) => Effect.Effect<void, DatabaseError>
  }
>()('FileSnapshots') {}

/** The largest file whose content is kept: a larger one keeps its path and hash. */
export const LARGEST_KEPT = 1024 * 1024

/** What is kept of one file: its hash, and its content unless it is withheld or deleted. */
interface Kept {
  readonly sha256: string | null
  readonly content: string | null
  readonly withheld: string | null
}

/** The sha256 of a file read in pieces: a large file is never held whole. */
const hashed = (path: string): string => {
  const hash = createHash('sha256')
  const piece = Buffer.alloc(64 * 1024)
  const handle = openSync(path, 'r')
  try {
    for (let read = readSync(handle, piece); read > 0; read = readSync(handle, piece)) {
      hash.update(piece.subarray(0, read))
    }
  } finally {
    closeSync(handle)
  }
  return hash.digest('hex')
}

const sha256Of = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** One file read from the disk; throws what the disk answered when it cannot be read. */
const readOne = (folder: string, file: DirtyFile): Kept => {
  if (file.status === 'deleted') return { sha256: null, content: null, withheld: null }
  const path = join(folder, file.path)
  const stat = lstatSync(path)
  // A link is kept as where it leads, never followed out of the checkout.
  if (stat.isSymbolicLink()) {
    return {
      sha256: sha256Of(Buffer.from(readlinkSync(path))),
      content: null,
      withheld: 'content withheld: a link',
    }
  }
  // Git names a repository inside the checkout by its folder, and a submodule by its path.
  if (stat.isDirectory()) {
    return {
      sha256: null,
      content: null,
      withheld: file.path.endsWith('/')
        ? 'content withheld: a repository'
        : 'content withheld: a submodule',
    }
  }
  if (!stat.isFile())
    return { sha256: null, content: null, withheld: 'content withheld: not a file' }
  if (stat.size > LARGEST_KEPT) {
    return { sha256: hashed(path), content: null, withheld: 'content withheld: larger than 1 MiB' }
  }
  const bytes = readFileSync(path)
  const withheld =
    sensitivePlace(
      file.path,
      { home: homedir(), platform: process.platform },
      { reading: true },
    ) !== null
      ? 'content withheld: a sensitive place'
      : bytes.includes(0)
        ? 'content withheld: a binary file'
        : null
  return {
    sha256: sha256Of(bytes),
    content: withheld === null ? bytes.toString('utf8') : null,
    withheld,
  }
}

/** Why the disk refused a file, in a word: its code, or its message. */
const whyUnread = (cause: Error): string =>
  Predicate.hasProperty(cause, 'code') && Predicate.isString(cause.code)
    ? cause.code
    : cause.message

/** B2's stand-in: the contents in the database, masked, deduplicated by sha256. */
export const databaseSnapshots = Layer.effect(
  FileSnapshots,
  Effect.gen(function* () {
    const secrets = yield* Secrets
    return {
      capture: (repository: SnapshotRepository, files: ReadonlyArray<DirtyFile>) =>
        Effect.gen(function* () {
          const snapshots: Snapshot[] = []
          const problems: string[] = []
          const contents = new Map<string, string>()
          for (const file of files) {
            const read = yield* Effect.result(
              Effect.try({
                try: () => readOne(repository.folder, file),
                catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
              }),
            )
            if (Result.isFailure(read)) {
              problems.push(
                `The dirty file ${repository.name}/${file.path} could not be read (${whyUnread(read.failure)}).`,
              )
              continue
            }
            const kept = read.success
            snapshots.push({
              path: file.path,
              status: file.status,
              sha256: kept.sha256,
              withheld: kept.withheld,
            })
            if (kept.sha256 !== null && kept.content !== null) {
              contents.set(kept.sha256, kept.content)
            }
          }
          const captured: Captured = { snapshots, problems, contents }
          return captured
        }),
      keepIn: (transaction: EngineTransaction, captured: ReadonlyArray<Captured>) =>
        Effect.forEach(
          captured.flatMap((one) => [...one.contents]),
          ([sha256, content]) =>
            transaction
              .insert(snapshotContents)
              .values({ sha256, content: secrets.mask(content) })
              .onConflictDoNothing()
              .pipe(Effect.mapError(refusedWhile('keeping a snapshot'))),
          { discard: true },
        ),
    }
  }),
)
