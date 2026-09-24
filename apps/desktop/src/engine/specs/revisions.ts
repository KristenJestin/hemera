/**
 * Rework: reopening a `ready` Spec into a complete new draft, in one transaction (design D7-05).
 *
 * Revision n+1 is a copy of revision n under new identifiers and the same order: its sections
 * (with their versions, so the phase summaries keep meaning), stories, criteria, the contract task
 * set and its tasks, dependencies and story links, and every question, the answered ones still
 * answered (Decided 13). Its phases start `stale` with the summaries they had (Decided 4).
 * Revision n is never written again.
 *
 * A copied open question is a new question: the one asked in the chat named the old revision's,
 * so each is asked again in the writer Session's thread, under its new identifier, and it is that
 * block the answer is given in (D7-01). An answered one is not asked again.
 */

import type { SpecPhase, SpecSnapshot } from '@hemera/core'
import { eq } from 'drizzle-orm'
import { Data, Effect } from 'effect'

import type { NewEvent } from '../journal.ts'
import type { EngineTransaction } from '../storage/database.ts'
import {
  acceptanceCriteria,
  specQuestions,
  specRevisions,
  specSections,
  specTasks,
  specs,
  taskDependencies,
  taskSets,
  taskStories,
  userStories,
} from '../storage/schema.ts'
import { insertPhases } from './protocol.ts'
import { failed, now, specEvent } from './snapshot.ts'
import { type Written, appendEntry, askedIn } from './thread.ts'

/** A Rework refused: not a `ready` Spec, or a stale expected revision (D7-05). */
export class ReopenRefusedError extends Data.TaggedError('ReopenRefusedError')<{
  readonly reason: string
}> {
  override get message(): string {
    return this.reason
  }
}

/** What a Rework is asked with (D7-05); the reason is the human's to give or not. */
export interface ReopenRequest {
  specId: string
  expectedRevisionId: string
  reason?: string | undefined
  /** The Session whose panel the Rework came from (D7-13). */
  sessionId: string
}

function refusal(snapshot: SpecSnapshot, request: ReopenRequest): string | null {
  const { spec } = snapshot
  if (spec.currentRevisionId !== request.expectedRevisionId) {
    return `A stale reopening is refused: ${spec.key} is no longer on the revision it was asked on.`
  }
  if (spec.status !== 'ready')
    return `${spec.key} is ${spec.status}: only a ready Spec is reworked.`
  return null
}

/** New identifiers for a list of rows, old to new. */
function renamed(rows: readonly { id: string }[]): Map<string, string> {
  return new Map(rows.map((row) => [row.id, crypto.randomUUID()]))
}

/** Copies the sections, stories and criteria of a revision into another. */
function copyContent(transaction: EngineTransaction, from: SpecSnapshot, revisionId: string) {
  return Effect.gen(function* () {
    if (from.sections.length > 0) {
      yield* transaction
        .insert(specSections)
        .values(
          from.sections.map((section) => ({
            ...section,
            id: crypto.randomUUID(),
            revisionId,
            updatedAt: new Date(section.updatedAt).toISOString(),
          })),
        )
        .pipe(Effect.mapError(failed('copying the sections')))
    }
    const storyIds = renamed(from.stories)
    if (from.stories.length > 0) {
      yield* transaction
        .insert(userStories)
        .values(
          from.stories.map((story) => ({ ...story, id: storyIds.get(story.id)!, revisionId })),
        )
        .pipe(Effect.mapError(failed('copying the stories')))
    }
    if (from.criteria.length > 0) {
      yield* transaction
        .insert(acceptanceCriteria)
        .values(
          from.criteria.map((criterion) => ({
            ...criterion,
            id: crypto.randomUUID(),
            storyId: storyIds.get(criterion.storyId)!,
          })),
        )
        .pipe(Effect.mapError(failed('copying the criteria')))
    }
    return storyIds
  })
}

/** Copies the contract task set, its tasks, dependencies and story links. */
function copyTasks(
  transaction: EngineTransaction,
  from: SpecSnapshot,
  revisionId: string,
  storyIds: ReadonlyMap<string, string>,
) {
  return Effect.gen(function* () {
    const taskSetId = crypto.randomUUID()
    yield* transaction
      .insert(taskSets)
      .values({ id: taskSetId, revisionId, kind: 'contract' })
      .pipe(Effect.mapError(failed('copying the task set')))
    const taskIds = renamed(from.tasks)
    if (from.tasks.length > 0) {
      yield* transaction
        .insert(specTasks)
        .values(from.tasks.map((task) => ({ ...task, id: taskIds.get(task.id)!, taskSetId })))
        .pipe(Effect.mapError(failed('copying the tasks')))
    }
    if (from.dependencies.length > 0) {
      yield* transaction
        .insert(taskDependencies)
        .values(
          from.dependencies.map((dependency) => ({
            taskId: taskIds.get(dependency.taskId)!,
            dependsOnId: taskIds.get(dependency.dependsOnId)!,
          })),
        )
        .pipe(Effect.mapError(failed('copying the dependencies')))
    }
    if (from.taskStories.length > 0) {
      yield* transaction
        .insert(taskStories)
        .values(
          from.taskStories.map((link) => ({
            taskId: taskIds.get(link.taskId)!,
            storyId: storyIds.get(link.storyId)!,
          })),
        )
        .pipe(Effect.mapError(failed('copying the story links')))
    }
  })
}

/**
 * Copies every question with its answer and the date it was raised, so they keep their order
 * (Decided 13). Answers each old identifier with the new one.
 */
function copyQuestions(transaction: EngineTransaction, from: string, revisionId: string) {
  return Effect.gen(function* () {
    const questions = yield* transaction
      .select()
      .from(specQuestions)
      .where(eq(specQuestions.revisionId, from))
      .pipe(Effect.mapError(failed('reading the questions')))
    const ids = renamed(questions)
    if (questions.length === 0) return ids
    yield* transaction
      .insert(specQuestions)
      .values(
        questions.map((question) => ({
          id: ids.get(question.id)!,
          revisionId,
          body: question.body,
          blocking: question.blocking,
          phase: question.phase,
          raisedBy: question.raisedBy,
          options: question.options,
          answerOptionId: question.answerOptionId,
          answerText: question.answerText,
          resolvedAt: question.resolvedAt,
          createdAt: question.createdAt,
        })),
      )
      .pipe(Effect.mapError(failed('copying the questions')))
    return ids
  })
}

/**
 * Asks again, in the writer Session's thread, every copied open question that had been asked in
 * a chat: the same question under its new identifier, which is the one an answer names.
 */
function askAgain(
  transaction: EngineTransaction,
  from: SpecSnapshot,
  questionIds: ReadonlyMap<string, string>,
) {
  return Effect.gen(function* () {
    const events: NewEvent[] = []
    const wrote: Written[] = []
    const writer = from.spec.writerSessionId
    if (writer === null) return { events, wrote }
    for (const question of from.questions) {
      const id = questionIds.get(question.id)
      if (id === undefined || question.resolvedAt !== null) continue
      if ((yield* askedIn(transaction, question.id)) === null) continue
      const asked = yield* appendEntry(transaction, writer, {
        role: 'hemera',
        kind: 'spec_question',
        body: question.body,
        payload: JSON.stringify({
          id,
          body: question.body,
          blocking: question.blocking,
          phase: question.phase,
          options: question.options,
          answer: null,
        }),
        correlationId: id,
      })
      events.push(asked.event)
      wrote.push({ sessionId: writer, entry: asked.entry })
    }
    return { events, wrote }
  })
}

/** The phases of the copy: `stale` with their summaries and basis, `unavailable` as it was. */
function stalePhases(from: SpecSnapshot, revisionId: string): SpecPhase[] {
  return from.phases.map((phase) => ({
    ...phase,
    id: crypto.randomUUID(),
    revisionId,
    state: phase.state === 'unavailable' ? 'unavailable' : 'stale',
  }))
}

/**
 * Reopens a `ready` Spec (D7-05): checks the expected revision and the status, creates revision
 * n+1 as a complete copy, switches `current_revision_id` and puts the Spec back in `draft`.
 */
export function reopen(
  transaction: EngineTransaction,
  snapshot: SpecSnapshot,
  request: ReopenRequest,
) {
  return Effect.gen(function* () {
    const refused = refusal(snapshot, request)
    if (refused !== null) return yield* Effect.fail(new ReopenRefusedError({ reason: refused }))
    const { spec, revision } = snapshot
    // A blank reason is no reason.
    const reason = request.reason?.trim() || null
    const revisionId = crypto.randomUUID()
    const at = now()
    yield* transaction
      .insert(specRevisions)
      .values({
        id: revisionId,
        specId: spec.id,
        number: revision.number + 1,
        title: revision.title,
        type: revision.type,
        changeReason: reason,
        createdBy: 'human',
        createdAt: at,
      })
      .pipe(Effect.mapError(failed('opening the revision')))
    const storyIds = yield* copyContent(transaction, snapshot, revisionId)
    yield* copyTasks(transaction, snapshot, revisionId, storyIds)
    const questionIds = yield* copyQuestions(transaction, revision.id, revisionId)
    yield* insertPhases(transaction, stalePhases(snapshot, revisionId))
    yield* transaction
      .update(specs)
      .set({ status: 'draft', currentRevisionId: revisionId, updatedAt: at })
      .where(eq(specs.id, spec.id))
      .pipe(Effect.mapError(failed('reopening the Spec')))
    const asked = yield* askAgain(transaction, snapshot, questionIds)
    return {
      events: [
        specEvent(spec, revisionId, 'spec.reopened', {
          author: 'human',
          sessionId: request.sessionId,
          payload: {
            reason,
            number: revision.number + 1,
            previousRevisionId: revision.id,
          },
        }),
        ...asked.events,
      ],
      wrote: asked.wrote,
    }
  })
}
