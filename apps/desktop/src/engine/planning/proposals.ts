/**
 * Answers proposed from the ticket's comments (#97, open question 54).
 *
 * - The Planner, in Planning only, proposes with `answer_propose` an answer to a question open or
 *   waiting on someone, from a comment of the mission's ticket Hemera knows. It is kept on the
 *   question, listed in Since you left and in Home's Questions group; it is not a need.
 * - The user accepts it (the proposed text, or their own): it becomes their answer, delivered and
 *   integrated as any answer (#86, CT-26). Or dismisses it: the Planner is told, as information.
 * - A proposal on a question answered or retired meanwhile expires (`proposals-store.ts`).
 * - Nothing is ever written back to the ticket.
 */

import { PlanningRefused } from '@hemera/ipc'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { storeDeliveryIn } from '../sessions/deliveries.ts'
import { type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { proposedAnswers } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { deliverInputs } from './calls.ts'
import { proposalEvent } from './proposals-store.ts'
import { answerIn } from './questions.ts'
import { PlannerWake } from './wake.ts'

const now = (): string => new Date().toISOString()

/** A proposal still waiting, or the refusal that says why it is not. */
const waitingProposal = (transaction: EngineTransaction, proposalId: string) =>
  Effect.gen(function* () {
    const [row] = yield* transaction
      .select()
      .from(proposedAnswers)
      .where(eq(proposedAnswers.id, proposalId))
      .pipe(Effect.mapError(refusedWhile('reading a proposed answer')))
    if (row === undefined) {
      return yield* new PlanningRefused({ reason: 'This proposed answer no longer exists.' })
    }
    if (row.state === 'expired') {
      return yield* new PlanningRefused({
        reason: `This proposed answer has expired: ${row.reason ?? 'its question changed'}.`,
      })
    }
    if (row.state !== 'proposed') {
      return yield* new PlanningRefused({ reason: `This proposed answer is ${row.state} already.` })
    }
    return row
  })

/**
 * The user accepts a proposed answer: it becomes their answer (the proposed text, or their own),
 * then is delivered to the Planner as any answer.
 */
export const acceptProposedAnswer = (proposalId: string, text?: string) =>
  Effect.gen(function* () {
    const missionId = yield* mutate('accepting a proposed answer', (transaction) =>
      Effect.gen(function* () {
        const row = yield* waitingProposal(transaction, proposalId)
        yield* transaction
          .update(proposedAnswers)
          .set({ state: 'accepted', decidedAt: now() })
          .where(eq(proposedAnswers.id, row.id))
          .pipe(Effect.mapError(refusedWhile('accepting a proposed answer')))
        const own = text?.trim() ?? ''
        const answer = yield* answerIn(transaction, row.missionId, row.questionId, {
          text: own === '' ? row.text : own,
        })
        return {
          result: row.missionId,
          events: [
            proposalEvent('planning.proposal_accepted', row, 'ui', {
              comment: row.commentId,
              edited: own === '' ? null : 'yes',
            }),
            ...answer.events,
          ],
        }
      }),
    )
    yield* deliverInputs(missionId)
  })

/** What the Planner is told of a proposal the user dismissed. */
const dismissedSaid = (row: typeof proposedAnswers.$inferSelect): string =>
  `The user dismissed the answer you proposed for ${row.questionId} from comment ${row.commentId}: “${row.text}”. ${row.questionId} still waits for the user; go on.`

/** The user dismisses a proposed answer: the Planner is told, as information. */
export const dismissProposedAnswer = (proposalId: string) =>
  Effect.gen(function* () {
    const told = yield* mutate('dismissing a proposed answer', (transaction) =>
      Effect.gen(function* () {
        const row = yield* waitingProposal(transaction, proposalId)
        yield* transaction
          .update(proposedAnswers)
          .set({ state: 'dismissed', decidedAt: now() })
          .where(eq(proposedAnswers.id, row.id))
          .pipe(Effect.mapError(refusedWhile('dismissing a proposed answer')))
        const body = dismissedSaid(row)
        // `proposal-dismissed` is a delivery kind: a refusal of it is a defect.
        const id = yield* storeDeliveryIn(transaction, {
          owner: { kind: 'mission', missionId: row.missionId },
          target: { role: 'planner' },
          kind: 'proposal-dismissed',
          body,
        }).pipe(Effect.catchTag('DeliveryKindRefused', Effect.die))
        return {
          result: { missionId: row.missionId, id, body },
          events: [proposalEvent('planning.proposal_dismissed', row, 'ui')],
        }
      }),
    )
    yield* PlannerWake.use((wake) =>
      wake.deliver(told.missionId, 'proposal-dismissed', told.body, told.id),
    )
  })
