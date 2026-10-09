/**
 * "Since you left" on Home: the events worth telling since the user last looked, grouped by
 * mission, and the cursor that moves when they look. Not read yet: Home shows nothing here.
 */

import type { SincePage } from '@hemera/ipc'
import { Effect, Stream } from 'effect'

import type { Database, DatabaseError } from '../storage/database.ts'

const NOTHING: SincePage = { groups: [], before: null }

/** One page of what happened, the newest first; `before` is the cursor of an older page. */
export const sinceYouLeft = (
  _before: number | null,
): Effect.Effect<SincePage, DatabaseError, Database> => Effect.succeed(NOTHING)

/** The first page, then again after each event worth telling. */
export const sinceYouLeftChanges: Stream.Stream<SincePage, DatabaseError, Database> =
  Stream.succeed(NOTHING)

/** The user looked: the cursor moves to the latest event. */
export const lookedAtHome: Effect.Effect<void, DatabaseError, Database> = Effect.void
