/**
 * The door every start of work goes through for a mission (#378): a session written, a run
 * recorded. A mission cancelled in the database starts nothing, read in the transaction that
 * would start it, so no work under way at the cancel undoes it.
 */

import { eq } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import { type EngineTransaction, refusedWhile } from './storage/database.ts'
import { missions } from './storage/schema.ts'

export class MissionCancelled extends Schema.TaggedError<MissionCancelled>()('MissionCancelled', {
  missionId: Schema.String,
}) {
  override get message(): string {
    return 'the mission was cancelled'
  }
}

/** Whether the user cancelled the mission, read in the transaction given. */
export const cancelledIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.map(
    transaction
      .select({ stage: missions.stage })
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission'))),
    ([row]) => row?.stage === 'cancelled',
  )

/** Refuses, in the transaction given, to start work for a mission the user cancelled. */
export const refusedIfCancelled = (transaction: EngineTransaction, missionId: string) =>
  Effect.gen(function* () {
    if (yield* cancelledIn(transaction, missionId)) {
      return yield* new MissionCancelled({ missionId })
    }
  })
