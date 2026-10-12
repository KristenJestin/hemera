/**
 * What belongs to an attempt (#142, CT-02), as it is kept: every write attributed to its author
 * (a file tool's, in the transaction of its outcome; a command's, from the snapshots before and
 * after it), the files changed with no known author (the Building's, never a task's), the
 * conflicts a command made on another running task's file, and the checks' results. The diff of
 * an attempt is the union of the files written under its name, never "everything between its start
 * and its end".
 *
 * Everything here reads or writes in a reader or a transaction a caller holds.
 */

import { CHECK_VERDICTS } from '@hemera/core/domain'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'

import { type Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  attemptWrites,
  buildingCheckResults,
  buildingConflicts,
  buildingUnattributed,
} from '../storage/schema.ts'

type Reader = EngineTransaction | Database['Service']

/** A write of a running task (or of the documenter): a file tool's, or a command's with its run. */
export interface AttributedWrite {
  readonly buildingId: string
  readonly attemptId: string
  /** Null for a write of no task: the documenter's (#146). */
  readonly taskId: string | null
  readonly sessionId: string
  readonly repository: string
  readonly path: string
  readonly kind: 'file_tool' | 'command'
  readonly runId: string | null
  readonly actionId: string | null
  readonly fingerprint: string | null
}

/** One write recorded under its author's attempt. */
export const recordWriteIn = (transaction: EngineTransaction, write: AttributedWrite) =>
  transaction
    .insert(attemptWrites)
    .values({ id: crypto.randomUUID(), ...write, at: new Date().toISOString() })
    .pipe(Effect.mapError(refusedWhile('attributing a write')), Effect.asVoid)

/** The files written under an attempt's name, each once, in the order they were first written. */
export const attributedIn = (reader: Reader, attemptId: string) =>
  Effect.map(
    reader
      .select()
      .from(attemptWrites)
      .where(eq(attemptWrites.attemptId, attemptId))
      .orderBy(asc(attemptWrites.at))
      .pipe(Effect.mapError(refusedWhile('reading the writes of an attempt'))),
    (rows) => {
      const seen = new Set<string>()
      return rows.filter((row) => {
        const key = `${row.repository}\u0000${row.path}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    },
  )

/** Every write of a Building, for the files no author wrote. */
export const writesIn = (reader: Reader, buildingId: string) =>
  reader
    .select({
      repository: attemptWrites.repository,
      path: attemptWrites.path,
      taskId: attemptWrites.taskId,
      attemptId: attemptWrites.attemptId,
      actionId: attemptWrites.actionId,
    })
    .from(attemptWrites)
    .where(eq(attemptWrites.buildingId, buildingId))
    .pipe(Effect.mapError(refusedWhile('reading the writes')))

/** A file changed in an attempt's interval that no author wrote: the Building's. */
export const recordUnattributedIn = (
  transaction: EngineTransaction,
  buildingId: string,
  attemptId: string,
  file: { readonly repository: string; readonly path: string },
) =>
  transaction
    .insert(buildingUnattributed)
    .values({ buildingId, attemptId, ...file, seenAt: new Date().toISOString() })
    .onConflictDoNothing()
    .pipe(Effect.mapError(refusedWhile('recording a change without an author')), Effect.asVoid)

export const unattributedIn = (reader: Reader, buildingId: string) =>
  reader
    .select({ repository: buildingUnattributed.repository, path: buildingUnattributed.path })
    .from(buildingUnattributed)
    .where(eq(buildingUnattributed.buildingId, buildingId))
    .orderBy(asc(buildingUnattributed.repository), asc(buildingUnattributed.path))
    .pipe(Effect.mapError(refusedWhile('reading the changes without an author')))

export const conflictsIn = (reader: Reader, buildingId: string) =>
  reader
    .select()
    .from(buildingConflicts)
    .where(eq(buildingConflicts.buildingId, buildingId))
    .orderBy(asc(buildingConflicts.at))
    .pipe(Effect.mapError(refusedWhile('reading the conflicts')))

const verdictOf = (text: string) => CHECK_VERDICTS.find((one) => one === text) ?? 'red'

/** The checks' results of some attempts, in the order they were kept. */
export const checkResultsOf = (reader: Reader, attemptIds: ReadonlyArray<string>) =>
  attemptIds.length === 0
    ? Effect.succeed([])
    : Effect.map(
        reader
          .select()
          .from(buildingCheckResults)
          .where(inArray(buildingCheckResults.attemptId, [...attemptIds]))
          .orderBy(asc(buildingCheckResults.at))
          .pipe(Effect.mapError(refusedWhile('reading the checks'))),
        (rows) => rows.map((row) => ({ ...row, verdict: verdictOf(row.verdict) })),
      )

/** One attempt's results as `TaskChecks` answered them. */
export const checkResultsIn = (reader: Reader, attemptId: string) =>
  Effect.map(checkResultsOf(reader, [attemptId]), (rows) =>
    rows.map((row) => ({
      name: row.name,
      place: row.place,
      verdict: row.verdict,
      detail: row.detail,
      outputTail: row.outputTail,
      runId: row.runId,
    })),
  )

/** Whether a write of the Building already carries this intent's id. */
export const attributedAction = (reader: Reader, actionId: string) =>
  Effect.map(
    reader
      .select({ id: attemptWrites.id })
      .from(attemptWrites)
      .where(and(eq(attemptWrites.actionId, actionId)))
      .pipe(Effect.mapError(refusedWhile('reading the writes'))),
    (rows) => rows.length > 0,
  )
