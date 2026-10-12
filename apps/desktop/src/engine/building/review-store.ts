/**
 * The automatic review as it is kept (#147): a reviewer's pass by its lineage or its Building, the
 * findings of a Building in their order, and the review as Review reads it. Apart from the
 * reviewers' service, so the roles' briefs, the end and the calls read them without importing the
 * sessions.
 */

import {
  REVIEW_FATES,
  REVIEW_SEVERITIES,
  type ReviewFate,
  REVIEWERS,
  REVIEW_PASS_STATES,
  type Reviewer,
  TASK_STATES,
} from '@hemera/core/domain'
import type { AutoReviewView, ReviewFindingView, ReviewPassView } from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Stream } from 'effect'

import { DomainEvents } from '../domain-events.ts'
import { getMission } from '../missions.ts'
import { needService } from '../needs.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  buildingTasks,
  buildings,
  checkpointFiles,
  checkpointRepositories,
  checkpoints,
  reviewChangedAfter,
  reviewFindings,
  reviewPasses,
} from '../storage/schema.ts'

type Reader = EngineTransaction | Database['Service']

/** The service the needs of the automatic review belong to: a finding that contradicts the Spec. */
export const REVIEW_NEEDS = needService('review')

export type ReviewPassRow = typeof reviewPasses.$inferSelect
export type ReviewFindingRow = typeof reviewFindings.$inferSelect

/** A row's reviewer, read back as one. */
export const reviewerOf = (row: { readonly reviewer: string }): Reviewer =>
  REVIEWERS.find((one) => one === row.reviewer) ?? 'code-reviewer'

/** The passes of a Building, the Spec reviewer's first. */
export const reviewPassesIn = (reader: Reader, buildingId: string) =>
  Effect.map(
    reader
      .select()
      .from(reviewPasses)
      .where(eq(reviewPasses.buildingId, buildingId))
      .pipe(Effect.mapError(refusedWhile('reading the review’s passes'))),
    (rows) =>
      rows.toSorted((a, b) => REVIEWERS.indexOf(reviewerOf(a)) - REVIEWERS.indexOf(reviewerOf(b))),
  )

/** The pass a lineage runs, or null. */
export const reviewPassOfLineage = (reader: Reader, lineage: string) =>
  Effect.map(
    reader
      .select()
      .from(reviewPasses)
      .where(eq(reviewPasses.lineage, lineage))
      .pipe(Effect.mapError(refusedWhile('reading the review’s pass'))),
    (rows) => rows[0] ?? null,
  )

/** The findings of a Building, in their order. */
export const reviewFindingsIn = (reader: Reader, buildingId: string) =>
  reader
    .select()
    .from(reviewFindings)
    .where(eq(reviewFindings.buildingId, buildingId))
    .orderBy(asc(reviewFindings.number))
    .pipe(Effect.mapError(refusedWhile('reading the review’s findings')))

/** The files of a checkpoint, repository by repository in the order taken. */
export const checkpointFilesIn = (reader: Reader, checkpointId: string) =>
  Effect.map(
    reader
      .select()
      .from(checkpointFiles)
      .innerJoin(
        checkpointRepositories,
        and(
          eq(checkpointRepositories.checkpointId, checkpointFiles.checkpointId),
          eq(checkpointRepositories.repository, checkpointFiles.repository),
        ),
      )
      .where(eq(checkpointFiles.checkpointId, checkpointId))
      .orderBy(asc(checkpointRepositories.position), asc(checkpointFiles.position))
      .pipe(Effect.mapError(refusedWhile('reading the checkpoint'))),
    (rows) => rows.map((row) => row.checkpoint_files),
  )

const passViewOf = (row: ReviewPassRow, findings: ReadonlyArray<ReviewFindingRow>) => {
  const own = findings.filter((one) => one.passId === row.id)
  const count = (severity: string) => own.filter((one) => one.severity === severity).length
  const view: ReviewPassView = {
    id: row.id,
    reviewer: reviewerOf(row),
    state: REVIEW_PASS_STATES.find((one) => one === row.state) ?? 'failed',
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    failure: row.failure,
    counts: {
      blocking: count('blocking'),
      warning: count('warning'),
      suggestion: count('suggestion'),
    },
  }
  return view
}

const fateOf = (row: ReviewFindingRow): ReviewFate | null =>
  REVIEW_FATES.find((one) => one === row.fate) ?? null

const findingViewOf = (
  row: ReviewFindingRow,
  tasks: ReadonlyArray<typeof buildingTasks.$inferSelect>,
): ReviewFindingView => {
  const task = row.taskId === null ? undefined : tasks.find((one) => one.id === row.taskId)
  return {
    id: row.id,
    number: row.number,
    reviewer: reviewerOf(row),
    severity: REVIEW_SEVERITIES.find((one) => one === row.severity) ?? 'suggestion',
    requirement: row.requirement,
    scenario: row.scenario,
    repository: row.repository,
    path: row.path,
    line: row.line,
    text: row.text,
    contradictsSpec: row.contradictsSpec,
    evidence: row.evidence,
    fate: fateOf(row),
    needId: row.needId,
    answer: row.answer,
    taskId: row.taskId,
    taskState: TASK_STATES.find((one) => one === task?.state) ?? null,
    verified: task?.verified ?? null,
  }
}

/** The automatic review of a Building, as Review reads it. */
export const autoReviewIn = (reader: Reader, building: typeof buildings.$inferSelect) =>
  Effect.gen(function* () {
    const findings = yield* reviewFindingsIn(reader, building.id)
    const tasks = yield* reader
      .select()
      .from(buildingTasks)
      .where(eq(buildingTasks.buildingId, building.id))
      .pipe(Effect.mapError(refusedWhile('reading the tasks')))
    const checkpointId = building.reviewCheckpointId
    const [taken] =
      checkpointId === null
        ? []
        : yield* reader
            .select()
            .from(checkpoints)
            .where(eq(checkpoints.id, checkpointId))
            .pipe(Effect.mapError(refusedWhile('reading the checkpoint')))
    const files = taken === undefined ? [] : yield* checkpointFilesIn(reader, taken.id)
    const changed = yield* reader
      .select()
      .from(reviewChangedAfter)
      .where(eq(reviewChangedAfter.buildingId, building.id))
      .orderBy(asc(reviewChangedAfter.repository), asc(reviewChangedAfter.path))
      .pipe(Effect.mapError(refusedWhile('reading what changed after the review')))
    const view: AutoReviewView = {
      missionId: building.missionId,
      buildingId: building.id,
      phase: building.phase,
      checkpoint:
        taken === undefined
          ? null
          : {
              id: taken.id,
              takenAt: taken.takenAt,
              files: files.map((one) => ({
                repository: one.repository,
                path: one.path,
                status: one.status,
                added: one.added,
                removed: one.removed,
              })),
            },
      passes: (yield* reviewPassesIn(reader, building.id)).map((row) => passViewOf(row, findings)),
      findings: findings.map((row) => findingViewOf(row, tasks)),
      changedAfter: changed.map((one) => ({
        repository: one.repository,
        path: one.path,
        status: one.status,
        added: one.added,
        removed: one.removed,
        by: one.writtenBy,
      })),
    }
    return view
  })

/** The automatic review of the mission's Building, its latest unless one is named; null before. */
export const autoReviewOf = (missionId: string, buildingId: string | null = null) =>
  Effect.gen(function* () {
    const database = yield* Database
    yield* getMission(missionId)
    return yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        const [building] = yield* transaction
          .select()
          .from(buildings)
          .where(
            buildingId === null
              ? eq(buildings.missionId, missionId)
              : and(eq(buildings.missionId, missionId), eq(buildings.id, buildingId)),
          )
          .orderBy(asc(buildings.startedAt))
          .pipe(
            Effect.map((rows) => (buildingId === null ? rows.slice(-1) : rows)),
            Effect.mapError(refusedWhile('reading the Building')),
          )
        return building === undefined ? null : yield* autoReviewIn(transaction, building)
      }),
    )
  })

/** The automatic review of the mission's latest Building now, then again at each change. */
export const autoReviewChanges = (missionId: string) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      return Stream.concat(
        Stream.fromEffect(autoReviewOf(missionId)),
        events.pipe(
          Stream.filter((event) => event.entityKind === 'mission' && event.entityId === missionId),
          Stream.mapEffect(() => autoReviewOf(missionId)),
        ),
      )
    }),
  )
