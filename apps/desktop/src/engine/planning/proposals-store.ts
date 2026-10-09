/**
 * The answers the Planner proposes from the ticket's comments (#97), as the data folder keeps them:
 * never a need, never applied. A proposal on a question answered, retired or replaced meanwhile
 * expires, in the transaction that changes the question.
 */

import { MaskedText, type ToolArguments } from '@hemera/core/domain'
import type { ProposedAnswer } from '@hemera/ipc'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'

import type { NewEvent } from '../journal.ts'
import { Secrets } from '../secrets.ts'
import { type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { missionTickets, proposedAnswers, questions, ticketVersions } from '../storage/schema.ts'
import { versionOf } from '../tickets/versions.ts'
import type { Grant } from '../tools/access.ts'
import { answered, failure, refusal } from '../tools/files.ts'
import { mutate } from '../transaction.ts'
import { standingOf } from './store.ts'

const now = (): string => new Date().toISOString()

type ProposalRow = typeof proposedAnswers.$inferSelect

const STATES = ['proposed', 'accepted', 'dismissed', 'expired'] as const

/** A proposal as the window reads it. */
export const proposalOf = (row: ProposalRow): ProposedAnswer => ({
  id: row.id,
  missionId: row.missionId,
  questionId: row.questionId,
  commentId: row.commentId,
  commentAuthor: row.commentAuthor,
  comment: row.commentBody,
  text: row.text,
  state: STATES.find((one) => one === row.state) ?? 'expired',
  proposedAt: row.proposedAt,
  decidedAt: row.decidedAt,
  reason: row.reason,
})

/** One of a proposal's events, about its mission. */
export const proposalEvent = (
  type: string,
  row: Pick<ProposalRow, 'id' | 'missionId' | 'questionId'>,
  by: 'ui' | 'system',
  payload: Readonly<Record<string, string | null>> = {},
): NewEvent => ({
  type,
  entityKind: 'mission',
  entityId: row.missionId,
  source: by,
  author: by === 'ui' ? 'human' : 'hemera',
  payload: { proposal: row.id, question: row.questionId, ...payload },
})

/** The proposals of the missions named, oldest first. */
export const proposalsIn = (transaction: EngineTransaction, missionIds: ReadonlyArray<string>) =>
  missionIds.length === 0
    ? Effect.succeed<ReadonlyArray<ProposedAnswer>>([])
    : Effect.map(
        transaction
          .select()
          .from(proposedAnswers)
          .where(inArray(proposedAnswers.missionId, [...missionIds]))
          .orderBy(asc(proposedAnswers.proposedAt), asc(proposedAnswers.id))
          .pipe(Effect.mapError(refusedWhile('reading the proposed answers'))),
        (rows) => rows.map(proposalOf),
      )

/** The proposals still waiting on a question expire, with the reason; answers their events. */
export const expireProposalsIn = (
  transaction: EngineTransaction,
  missionId: string,
  questionId: string,
  reason: string,
) =>
  Effect.gen(function* () {
    const expired = yield* transaction
      .update(proposedAnswers)
      .set({ state: 'expired', reason: MaskedText.make(reason), decidedAt: now() })
      .where(
        and(
          eq(proposedAnswers.missionId, missionId),
          eq(proposedAnswers.questionId, questionId),
          eq(proposedAnswers.state, 'proposed'),
        ),
      )
      .returning()
      .pipe(Effect.mapError(refusedWhile('expiring the proposed answers')))
    return expired.map((row) =>
      proposalEvent('planning.proposal_expired', row, 'system', { reason }),
    )
  })

/** The comment of the mission's ticket an id names, in the last version Hemera knows; or null. */
const knownComment = (transaction: EngineTransaction, missionId: string, commentId: string) =>
  Effect.gen(function* () {
    const [row] = yield* transaction
      .select({ version: ticketVersions })
      .from(missionTickets)
      .innerJoin(ticketVersions, eq(ticketVersions.id, missionTickets.lastVersionId))
      .where(eq(missionTickets.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission’s ticket')))
    if (row === undefined) return null
    return versionOf(row.version).comments.find((one) => one.id === commentId) ?? null
  })

/** `answer_propose`: an answer proposed from a ticket comment, kept on its question; never applied. */
export const answerProposeTool = (grant: Grant, args: ToolArguments<'answer_propose'>) =>
  Effect.gen(function* () {
    const missionId = grant.missionId
    if (missionId === null) return refusal('refused: this session works for no mission')
    const secrets = yield* Secrets
    const text = secrets.mask(args.text.trim())
    return yield* mutate('proposing an answer', (transaction) =>
      Effect.gen(function* () {
        const no = (sentence: string) => ({ result: refusal(sentence), events: [] })
        const standing = yield* standingOf(transaction, {
          sessionId: grant.sessionId,
          role: grant.role,
          missionId,
        })
        if (standing.refusal !== null) return no(standing.refusal)
        const [question] = yield* transaction
          .select({ id: questions.id, state: questions.state })
          .from(questions)
          .where(and(eq(questions.missionId, missionId), eq(questions.id, args.question.trim())))
          .pipe(Effect.mapError(refusedWhile('reading a question')))
        if (question === undefined) {
          return no(`refused: this mission has no question ${args.question}.`)
        }
        if (question.state !== 'open' && question.state !== 'waiting') {
          return no(
            `refused: ${question.id} is ${question.state}: a proposal is for a question that waits.`,
          )
        }
        const comment = yield* knownComment(transaction, missionId, args.source.trim())
        if (comment === null) {
          return no(
            `refused: ${args.source} is no comment of ${standing.key}’s ticket that Hemera knows: name one from its delivery.`,
          )
        }
        const row = {
          id: crypto.randomUUID(),
          missionId,
          questionId: question.id,
          commentId: comment.id,
          commentAuthor: comment.author,
          commentBody: secrets.mask(comment.body),
          text,
          state: 'proposed',
          sessionId: grant.sessionId,
          proposedAt: now(),
          decidedAt: null,
          reason: null,
        }
        yield* transaction
          .insert(proposedAnswers)
          .values(row)
          .pipe(Effect.mapError(refusedWhile('keeping a proposed answer')))
        const event: NewEvent = {
          type: 'planning.answer_proposed',
          entityKind: 'mission',
          entityId: missionId,
          source: 'system',
          author: 'agent',
          payload: {
            proposal: row.id,
            question: question.id,
            comment: comment.id,
            author: comment.author,
            text,
            sessionId: grant.sessionId,
            role: grant.role,
          },
        }
        return {
          result: answered(
            `Proposed for ${question.id}, from ${comment.id}. The user sees it beside the question and decides: it is not an answer until they accept it.`,
          ),
          events: [event],
        }
      }),
    )
  }).pipe(Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))))
