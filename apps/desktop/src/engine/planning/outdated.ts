/**
 * The outdated mark an engine service sets (#92): information only, never a move of the stage, and
 * never a block of Launch. Its own module, below the Freeze and the ticket sync (#97), which both
 * set it.
 */

import {
  OutdatedMark,
  type OutdatedReason,
  STAGES,
  isLive,
  markIdentity,
  outdatedReasonSaid,
} from '@hemera/core/domain'
import { and, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'

import type { NewEvent } from '../journal.ts'
import { MarkRefused, markIn } from '../missions.ts'
import { expireNeedIn } from '../needs.ts'
import { type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { missionMarks, needs } from '../storage/schema.ts'
import { missionRow } from './store.ts'

const stageOf = (stage: string) => STAGES.find((one) => one === stage) ?? 'cancelled'

/** What moved since the Freeze, as an engine service tells it. */
export interface Outdated {
  readonly reason: OutdatedReason
  /** Where the difference can be read. */
  readonly reference: string
  /** What moved, as the user is shown it. */
  readonly difference: string
  /** The pending needs of the mission that no longer hold: they expire. */
  readonly expiring: ReadonlyArray<string>
}

/**
 * `markOutdated` in the transaction given, its text masked with `mask`: answers its events. A ticket
 * change (#97) marks the mission in the same transaction that keeps the version it read.
 */
export const markOutdatedIn = (
  transaction: EngineTransaction,
  missionId: string,
  outdated: Outdated,
  mask: (text: string) => string,
) =>
  Effect.gen(function* () {
    const difference = mask(outdated.difference.trim())
    const reference = mask(outdated.reference.trim())
    const mission = yield* missionRow(transaction, missionId)
    if (!isLive(stageOf(mission.stage))) {
      return yield* new MarkRefused({ reason: 'the mission has ended' })
    }
    const mark = OutdatedMark.make({ reason: outdated.reason, reference, difference })
    const marked = yield* markIn(transaction, missionId, mark)
    // Already marked on that reference: the mark says what moved last.
    if (marked.length === 0) {
      yield* transaction
        .update(missionMarks)
        .set({ mark: JSON.stringify(mark) })
        .where(
          and(eq(missionMarks.missionId, missionId), eq(missionMarks.identity, markIdentity(mark))),
        )
        .pipe(Effect.mapError(refusedWhile('marking the mission outdated')))
    }
    const owned =
      outdated.expiring.length === 0
        ? []
        : yield* transaction
            .select({ id: needs.id })
            .from(needs)
            .where(
              and(
                eq(needs.missionId, missionId),
                inArray(needs.id, [...outdated.expiring]),
                eq(needs.state, 'pending'),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('reading the needs')))
    const expired: NewEvent[] = []
    for (const need of owned) {
      expired.push(
        ...(yield* expireNeedIn(
          transaction,
          need.id,
          `it no longer holds: ${outdatedReasonSaid(outdated.reason)}`,
        )),
      )
    }
    const told: NewEvent = {
      type: 'mission.outdated',
      entityKind: 'mission',
      entityId: missionId,
      source: 'system',
      author: 'hemera',
      payload: { reason: outdated.reason, reference, difference },
    }
    return [...marked, told, ...expired]
  })
