/**
 * One revision of one Spec, read out of its rows (design D7-01).
 *
 * Every use case of `specs/` reads the revision it acts on through here, inside the transaction
 * it writes in, and answers the snapshot it leaves: the panel draws what was stored, never what
 * it sent. A read with nothing to write runs in a transaction of its own, so the ten tables of a
 * snapshot are read at one moment.
 */

import {
  type PhaseId,
  type SectionName,
  type Spec,
  type SpecActor,
  type SpecPhase,
  type SpecRevision,
  type SpecSnapshot,
  type SpecStatus,
  type SpecType,
  type TaskExecutor,
  PHASE_IDS,
  SECTION_NAMES,
  compareRanks,
} from '@hemera/core'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Data, Effect } from 'effect'
import { z } from 'zod'

import type { EventAuthor, EventPayload, NewEvent } from '../journal.ts'
import { Database, DatabaseError, type EngineTransaction } from '../storage/database.ts'
import {
  acceptanceCriteria,
  specPhases,
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

/** A Spec was asked for by an identifier nothing answers to. */
export class UnknownSpecError extends Data.TaggedError('UnknownSpecError')<{
  readonly id: string
}> {
  override get message(): string {
    return `No Spec has the identifier "${this.id}".`
  }
}

/** A revision number the Spec never had. */
export class UnknownRevisionError extends Data.TaggedError('UnknownRevisionError')<{
  readonly key: string
  readonly number: number
}> {
  override get message(): string {
    return `${this.key} has no revision ${this.number}.`
  }
}

/** The date every row of one mutation shares, so a row and its event agree on when. */
export function now(): string {
  return new Date().toISOString()
}

export const failed = (doing: string) => (cause: unknown) => new DatabaseError({ doing, cause })

/** What a step of a Spec is correlated to beyond the Spec and its revision (design D7-13). */
export interface StepOf {
  author: EventAuthor
  sessionId?: string | null
  phaseId?: PhaseId | null
  payload?: EventPayload
}

/** One Journal line of a Spec: entity `spec`, correlated to its Project and revision (D7-13). */
export function specEvent(spec: Spec, revisionId: string, type: string, step: StepOf): NewEvent {
  return {
    type,
    entityKind: 'spec',
    entityId: spec.id,
    source: 'ui',
    projectId: spec.projectId,
    specId: spec.id,
    revisionId,
    ...step,
  }
}

/** Runs a read in a transaction of its own, so a snapshot is read at one moment. */
export function reading<A, E>(
  doing: string,
  body: (transaction: EngineTransaction) => Effect.Effect<A, E>,
): Effect.Effect<A, E | DatabaseError, Database> {
  return Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .transaction(body)
      .pipe(
        Effect.catchTag('SqlError', (cause) => Effect.fail(new DatabaseError({ doing, cause }))),
      )
  })
}

const assumptionsSchema = z.array(z.string())
const optionsSchema = z.array(
  z.object({ id: z.string(), label: z.string(), recommended: z.boolean().optional() }),
)
const basisSchema = z.partialRecord(z.enum(SECTION_NAMES), z.number())

/** A JSON column read through its parser: this is an I/O boundary like any other. */
function parsedJson<T>(schema: z.ZodType<T>, text: string, fallback: T): T {
  try {
    const read = schema.safeParse(JSON.parse(text))
    return read.success ? read.data : fallback
  } catch {
    return fallback
  }
}

function epoch(iso: string | null): number | null {
  return iso === null ? null : Date.parse(iso)
}

export function specOf(row: typeof specs.$inferSelect): Spec {
  return {
    id: row.id,
    projectId: row.projectId,
    key: row.key,
    slug: row.slug,
    // SAFETY: the column is checked against exactly the statuses the domain declares.
    status: row.status as SpecStatus,
    priority: row.priority,
    workspaceId: row.workspaceId,
    currentRevisionId: row.currentRevisionId,
    writerSessionId: row.writerSessionId,
    contentVersion: row.contentVersion,
    createdAt: Date.parse(row.createdAt),
    updatedAt: Date.parse(row.updatedAt),
  }
}

export function revisionOf(row: typeof specRevisions.$inferSelect): SpecRevision {
  return {
    id: row.id,
    specId: row.specId,
    number: row.number,
    title: row.title,
    // SAFETY: the column is checked against exactly the types the domain declares.
    type: row.type as SpecType,
    changeSummary: row.changeSummary,
    changeReason: row.changeReason,
    // SAFETY: the column is checked against exactly the actors the domain declares.
    createdBy: row.createdBy as SpecActor,
    attestedContentVersion: row.attestedContentVersion,
    createdAt: Date.parse(row.createdAt),
  }
}

export function phaseOf(row: typeof specPhases.$inferSelect): SpecPhase {
  return {
    id: row.id,
    revisionId: row.revisionId,
    // SAFETY: the column is checked against exactly the phases the domain declares.
    phase: row.phase as PhaseId,
    // SAFETY: the column is checked against exactly the states the domain declares.
    state: row.state as SpecPhase['state'],
    summary: row.summary,
    assumptions: parsedJson(assumptionsSchema, row.assumptions, []),
    basis: parsedJson(basisSchema, row.basis, {}),
    protocolVersion: row.protocolVersion,
    declaredAt: epoch(row.declaredAt),
  }
}

/** The Spec row, or the refusal naming the identifier nothing answers to. */
export function specRow(transaction: EngineTransaction, specId: string) {
  return Effect.gen(function* () {
    const found = yield* transaction
      .select()
      .from(specs)
      .where(eq(specs.id, specId))
      .pipe(Effect.mapError(failed('reading the Spec')))
    const row = found[0]
    if (row === undefined) return yield* Effect.fail(new UnknownSpecError({ id: specId }))
    return specOf(row)
  })
}

/** The contract task set of a revision, created with the revision (D7-01). */
export function taskSetOf(transaction: EngineTransaction, revisionId: string) {
  return transaction
    .select()
    .from(taskSets)
    .where(and(eq(taskSets.revisionId, revisionId), eq(taskSets.kind, 'contract')))
    .pipe(
      Effect.mapError(failed('reading the task set')),
      Effect.map((rows) => rows[0]?.id ?? null),
    )
}

/**
 * One revision of a Spec as the domain reads it: the current one, or an older one by number
 * (D7-05, Decided 5). Lists come back in their order: ranks, protocol order, section order.
 */
export function readSnapshot(
  transaction: EngineTransaction,
  specId: string,
  number?: number,
): Effect.Effect<SpecSnapshot, DatabaseError | UnknownSpecError | UnknownRevisionError> {
  return Effect.gen(function* () {
    const spec = yield* specRow(transaction, specId)
    const revisionRows = yield* transaction
      .select()
      .from(specRevisions)
      .where(
        number === undefined
          ? eq(specRevisions.id, spec.currentRevisionId)
          : and(eq(specRevisions.specId, specId), eq(specRevisions.number, number)),
      )
      .pipe(Effect.mapError(failed('reading the revision')))
    const revisionRow = revisionRows[0]
    if (revisionRow === undefined) {
      return yield* Effect.fail(new UnknownRevisionError({ key: spec.key, number: number ?? 0 }))
    }
    const revision = revisionOf(revisionRow)
    const read = (doing: string) => Effect.mapError(failed(`reading the ${doing}`))

    const sections = yield* transaction
      .select()
      .from(specSections)
      .where(eq(specSections.revisionId, revision.id))
      .pipe(read('sections'))
    const stories = yield* transaction
      .select()
      .from(userStories)
      .where(eq(userStories.revisionId, revision.id))
      .pipe(read('stories'))
    const storyIds = stories.map((story) => story.id)
    const criteria = yield* transaction
      .select()
      .from(acceptanceCriteria)
      .where(inArray(acceptanceCriteria.storyId, storyIds))
      .pipe(read('criteria'))
    const taskSetId = yield* taskSetOf(transaction, revision.id)
    const tasks = yield* transaction
      .select()
      .from(specTasks)
      .where(eq(specTasks.taskSetId, taskSetId ?? ''))
      .pipe(read('tasks'))
    const taskIds = tasks.map((task) => task.id)
    const dependencies = yield* transaction
      .select()
      .from(taskDependencies)
      .where(inArray(taskDependencies.taskId, taskIds))
      .pipe(read('dependencies'))
    const links = yield* transaction
      .select()
      .from(taskStories)
      .where(inArray(taskStories.taskId, taskIds))
      .pipe(read('story links'))
    const questions = yield* transaction
      .select()
      .from(specQuestions)
      .where(eq(specQuestions.revisionId, revision.id))
      .orderBy(asc(specQuestions.createdAt))
      .pipe(read('questions'))
    const phases = yield* transaction
      .select()
      .from(specPhases)
      .where(eq(specPhases.revisionId, revision.id))
      .pipe(read('phases'))

    const byRank = (left: { rank: string }, right: { rank: string }) =>
      compareRanks(left.rank, right.rank)
    // A link has no rank of its own: it is read in the order of the rows it joins.
    const ranks = new Map([...tasks, ...stories].map((row) => [row.id, row.rank]))
    const rankOf = (id: string) => ranks.get(id) ?? ''
    const byEnds = (left: [string, string], right: [string, string]) =>
      compareRanks(rankOf(left[0]), rankOf(right[0])) ||
      compareRanks(rankOf(left[1]), rankOf(right[1]))
    const sectionOrder = (name: string) => SECTION_NAMES.findIndex((known) => known === name)
    const phaseOrder = (phase: string) => PHASE_IDS.findIndex((known) => known === phase)

    return {
      spec,
      revision,
      sections: sections
        .toSorted((left, right) => sectionOrder(left.name) - sectionOrder(right.name))
        .map((row) => ({
          id: row.id,
          revisionId: row.revisionId,
          // SAFETY: the column is checked against exactly the section names the domain declares.
          name: row.name as SectionName,
          body: row.body,
          version: row.version,
          // SAFETY: the column is checked against exactly the actors the domain declares.
          author: row.author as SpecActor,
          sessionId: row.sessionId,
          updatedAt: Date.parse(row.updatedAt),
        })),
      stories: stories.toSorted(byRank),
      criteria: criteria.toSorted(byRank),
      tasks: tasks.toSorted(byRank).map((row) => ({
        id: row.id,
        taskSetId: row.taskSetId,
        title: row.title,
        result: row.result,
        type: row.type,
        criteria: row.criteria,
        rank: row.rank,
        // SAFETY: the column is checked against exactly the executors the domain declares.
        executor: row.executor as TaskExecutor,
      })),
      dependencies: dependencies.toSorted((left, right) =>
        byEnds([left.taskId, left.dependsOnId], [right.taskId, right.dependsOnId]),
      ),
      taskStories: links.toSorted((left, right) =>
        byEnds([left.taskId, left.storyId], [right.taskId, right.storyId]),
      ),
      questions: questions.map((row) => ({
        id: row.id,
        revisionId: row.revisionId,
        body: row.body,
        blocking: row.blocking,
        // SAFETY: the column is checked against exactly the phases the domain declares, or null.
        phase: row.phase as PhaseId | null,
        // SAFETY: the column is checked against exactly the actors the domain declares.
        raisedBy: row.raisedBy as SpecActor,
        options: parsedJson(optionsSchema, row.options, []),
        answer:
          row.resolvedAt === null ? null : { optionId: row.answerOptionId, text: row.answerText },
        resolvedAt: epoch(row.resolvedAt),
      })),
      phases: phases
        .map(phaseOf)
        .toSorted((left, right) => phaseOrder(left.phase) - phaseOrder(right.phase)),
    }
  })
}
