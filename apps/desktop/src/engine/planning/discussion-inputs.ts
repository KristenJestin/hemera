/**
 * What Discuss (#87) takes from #86's register of the human inputs of Planning (CT-26) and from its
 * questions.
 *
 * A pending proposal is a decision in transit: an input of kind `discuss_decision`, its item the
 * discussion's label (`#12`), `received` the moment the Planner proposes it, a new proposal
 * superseding it. It is never delivered while its discussion is open (`handover.ts` skips it): the
 * Planner would be sent its own proposal. When the user closes the discussion on a decision, that
 * decision supersedes it and travels as `[hemera:decision]` with the other inputs; without one, it
 * is withdrawn. Completeness and Freeze name it until the Planner integrates it.
 */

import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { questions } from '../storage/schema.ts'
import { receiveInput, withdrawInput } from './inputs.ts'

/** A decision of a discussion, as the register receives it. */
export interface DiscussDecision {
  readonly missionId: string
  /** `#12`: the discussion, the input's item. */
  readonly label: string
  /** What the Planner is told of it. */
  readonly said: string
}

const received = (transaction: EngineTransaction, decision: DiscussDecision) =>
  receiveInput(transaction, {
    missionId: decision.missionId,
    kind: 'discuss_decision',
    item: decision.label,
    version: null,
    said: decision.said,
    supersedes: true,
  })

export const discussionInputs = {
  /** The Planner proposed a decision: received, superseding the discussion's pending one. */
  proposed: received,
  /** The user closed the discussion on a decision, accepted or written: that is the input now. */
  decided: received,
  /** The user closed it without a decision: its pending proposal is withdrawn, replaced by nothing. */
  withdrawn: withdrawInput,
  /** A question of the mission (#86) as the Planner reads it, or null when it has none so named. */
  question: (transaction: EngineTransaction, missionId: string, id: string) =>
    transaction
      .select({ text: questions.text })
      .from(questions)
      .where(and(eq(questions.missionId, missionId), eq(questions.id, id)))
      .pipe(
        Effect.mapError(refusedWhile('reading the question')),
        Effect.map(([row]) => row?.text ?? null),
      ),
}
