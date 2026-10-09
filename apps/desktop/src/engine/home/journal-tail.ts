/** The last Journal line of each of several missions, in one read. Not read yet: none is found. */

import type { JournalTail } from '@hemera/ipc'
import { Effect } from 'effect'

import type { Database, DatabaseError } from '../storage/database.ts'

/** Every mission named, with its last line, or `null` when it has none. */
export const journalTail = (
  missionIds: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<JournalTail>, DatabaseError, Database> =>
  Effect.succeed(missionIds.map((missionId) => ({ missionId, line: null })))
