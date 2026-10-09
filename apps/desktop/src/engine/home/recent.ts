/** The missions opened last, which Home lists as Recent. Not read yet: the list is empty. */

import type { Mission } from '@hemera/ipc'
import { Effect } from 'effect'

import type { Database, DatabaseError } from '../storage/database.ts'

/** At most eight missions, the last opened first. */
export const recentMissions: Effect.Effect<
  ReadonlyArray<Mission>,
  DatabaseError,
  Database
> = Effect.succeed([])

/** The user opened a mission: it becomes the first of Recent. */
export const missionOpened = (_missionId: string): Effect.Effect<void, DatabaseError, Database> =>
  Effect.void
