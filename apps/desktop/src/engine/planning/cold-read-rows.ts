/**
 * A cold read's row as the role reads it (#91): the pass a session's lineage works for, and the
 * Spec it reads, kept at its launch. Apart from the store, so the role registry imports nothing
 * that imports the sessions back.
 */

import { eq } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'

import { Database, refusedWhile } from '../storage/database.ts'
import { coldReads } from '../storage/schema.ts'

export type ColdReadRow = typeof coldReads.$inferSelect

/** The Spec as a pass reads it, kept at its launch: the whole text and each part. */
export const ColdReadSnapshot = Schema.Struct({
  key: Schema.String,
  whole: Schema.String,
  parts: Schema.Record(Schema.String, Schema.String),
  repositories: Schema.Array(Schema.String),
})
export type ColdReadSnapshot = typeof ColdReadSnapshot.Type

const SnapshotJson = Schema.fromJsonString(ColdReadSnapshot)
const readSnapshot = Schema.decodeUnknownOption(SnapshotJson)
export const writeSnapshot = Schema.encodeSync(SnapshotJson)

export const snapshotOf = (row: ColdReadRow): ColdReadSnapshot | null =>
  Option.getOrNull(readSnapshot(row.snapshot))

/** The pass a session's lineage works for, or null. */
export const coldReadOfLineage = (lineage: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(coldReads)
      .where(eq(coldReads.lineage, lineage))
      .pipe(Effect.mapError(refusedWhile('reading a cold read')))
    return row ?? null
  })
