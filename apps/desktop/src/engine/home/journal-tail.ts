/** The last Journal line of each of several missions, in one read. */

import type { JournalTail } from '@hemera/ipc'
import { inArray, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import { memoryJournal } from '../storage/schema.ts'

/** The last Journal line of each of these missions, by mission; a mission without one is absent. */
export const lastLines = (
  ids: ReadonlyArray<string>,
): Effect.Effect<ReadonlyMap<string, { at: string; text: string }>, DatabaseError, Database> =>
  Database.use((database) =>
    ids.length === 0
      ? Effect.succeed(new Map<string, { at: string; text: string }>())
      : database
          .select({
            missionId: memoryJournal.missionId,
            at: memoryJournal.at,
            text: memoryJournal.text,
          })
          .from(memoryJournal)
          .where(
            inArray(
              memoryJournal.sequence,
              database
                .select({ sequence: sql<number>`max(${memoryJournal.sequence})` })
                .from(memoryJournal)
                .where(inArray(memoryJournal.missionId, [...ids]))
                .groupBy(memoryJournal.missionId),
            ),
          )
          .pipe(
            Effect.mapError(refusedWhile('reading the Journal')),
            Effect.map(
              (rows) => new Map(rows.map((row) => [row.missionId, { at: row.at, text: row.text }])),
            ),
          ),
  )

/** Every mission named, with its last line, or `null` when it has none. */
export const journalTail = (
  missionIds: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<JournalTail>, DatabaseError, Database> =>
  Effect.map(lastLines(missionIds), (last) =>
    missionIds.map((missionId) => ({ missionId, line: last.get(missionId) ?? null })),
  )
