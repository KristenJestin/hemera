/**
 * A build's rows, and the changes of its tasks written inside a transaction (design D10-02 to
 * D10-08).
 *
 * Hemera owns every state (D10-04): what is here reads a build as its rows stand — the Session,
 * the frozen revision it was started on, its tasks, attempts, evidence and blockers — and writes
 * what follows a change, with the Journal lines of D10-14, in the transaction the caller holds.
 * The rules themselves are the core's (`promotions`, `storyDone`, `tasksSettled`…); nothing here
 * runs Git, a check or an agent, which the service does before or after (AGENTS.md, "Data and
 * migrations").
 */

import {
  ATTEMPT_RESULTS,
  type AttemptResult,
  type AttemptScope,
  BUILD_PHASES,
  type BuildPhase,
  type BuildTask,
  CHECK_VERDICTS,
  type CheckVerdict,
  type CheckWhen,
  type SpecSnapshot,
  type SpecTask,
  TASK_STATES,
  type TaskState,
  compareRanks,
  promotions,
  storyDone,
  tasksSettled,
} from '@hemera/core'
import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { Effect } from 'effect'

import type { EventAuthor, NewEvent } from '../journal.ts'
import { DatabaseError, type EngineDatabase, type EngineTransaction } from '../storage/database.ts'
import {
  buildAttemptFiles,
  buildAttemptTrees,
  buildAttempts,
  buildBlockers,
  buildCheckResults,
  buildLaunches,
  buildTasks,
  contextDeliveries,
  sessions,
  specRevisions,
} from '../storage/schema.ts'
import { failed, readSnapshot } from '../specs/snapshot.ts'

export type SessionRow = typeof sessions.$inferSelect
export type TaskRow = typeof buildTasks.$inferSelect
export type AttemptRow = typeof buildAttempts.$inferSelect
export type TreeRow = typeof buildAttemptTrees.$inferSelect
export type FileRow = typeof buildAttemptFiles.$inferSelect
export type ResultRow = typeof buildCheckResults.$inferSelect
export type BlockerRow = typeof buildBlockers.$inferSelect

/** Why a build is stopped when its revision was replaced before its first task started (D10-04). */
export const OBSOLETE = 'The Spec was reworked before the build started.'

/**
 * A build as its rows stand, read at one moment: the Session, the revision it was started on
 * (D8-13), and everything the build keeps of its work. Lists are in their order — tasks by rank,
 * attempts and results as they came — and `briefed` holds the phases a delivery has already
 * opened for the agent, so a later delivery of the same phase is a line rather than a brief.
 */
export interface BuildRows {
  readonly session: SessionRow
  readonly phase: BuildPhase | null
  readonly specId: string
  readonly revisionId: string
  readonly snapshot: SpecSnapshot
  readonly tasks: readonly TaskRow[]
  readonly attempts: readonly AttemptRow[]
  readonly trees: readonly TreeRow[]
  readonly files: readonly FileRow[]
  readonly results: readonly ResultRow[]
  readonly blockers: readonly BlockerRow[]
  readonly briefed: ReadonlySet<string>
}

/** What `context_deliveries` calls the brief of a build's phase once the agent took it. */
export function briefPath(phase: BuildPhase): string {
  return `build · ${phase}`
}

export function phaseOf(row: Pick<SessionRow, 'buildPhase'>): BuildPhase | null {
  return BUILD_PHASES.find((known) => known === row.buildPhase) ?? null
}

export function stateOf(row: Pick<TaskRow, 'state'>): TaskState {
  // The column is checked against `TASK_STATES`; this is only the narrowing a reader needs.
  return TASK_STATES.find((known) => known === row.state) ?? 'waiting'
}

export function resultOf(row: Pick<AttemptRow, 'result'>): AttemptResult | null {
  return ATTEMPT_RESULTS.find((known) => known === row.result) ?? null
}

export function verdictOf(row: Pick<ResultRow, 'verdict'>): CheckVerdict {
  return CHECK_VERDICTS.find((known) => known === row.verdict) ?? 'red'
}

export function scopeOf(row: Pick<AttemptRow, 'scope'>): AttemptScope {
  if (row.scope === 'story' || row.scope === 'build') return row.scope
  return 'task'
}

/** A build's rows, or null for a Session that is no build. */
export function readBuild(transaction: EngineTransaction, sessionId: string) {
  return Effect.gen(function* () {
    const found = yield* transaction
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .pipe(Effect.mapError(failed('reading the build Session')))
    const session = found[0]
    if (
      session === undefined ||
      session.mission !== 'build' ||
      session.specId === null ||
      session.revisionId === null
    ) {
      return null
    }
    const { specId, revisionId } = session
    const revision = yield* transaction
      .select({ number: specRevisions.number })
      .from(specRevisions)
      .where(eq(specRevisions.id, revisionId))
      .pipe(Effect.mapError(failed('reading the revision of the build')))
    // The frozen revision the build was started on, never the Spec's current one (D8-13).
    const snapshot = yield* readSnapshot(transaction, specId, revision[0]?.number ?? 0).pipe(
      Effect.mapError((cause) =>
        cause instanceof DatabaseError
          ? cause
          : new DatabaseError({ doing: 'reading the revision of the build', cause }),
      ),
    )
    const read = (doing: string) => Effect.mapError(failed(`reading the ${doing} of the build`))
    const tasks = yield* transaction
      .select()
      .from(buildTasks)
      .where(eq(buildTasks.sessionId, sessionId))
      .pipe(read('tasks'))
    const attempts = yield* transaction
      .select()
      .from(buildAttempts)
      .where(eq(buildAttempts.sessionId, sessionId))
      .pipe(read('attempts'))
    const attemptIds = attempts.map((attempt) => attempt.id)
    const trees = yield* transaction
      .select()
      .from(buildAttemptTrees)
      .where(inArray(buildAttemptTrees.attemptId, attemptIds))
      .pipe(read('snapshots'))
    const files = yield* transaction
      .select()
      .from(buildAttemptFiles)
      .where(inArray(buildAttemptFiles.attemptId, attemptIds))
      .pipe(read('changed files'))
    const results = yield* transaction
      .select()
      .from(buildCheckResults)
      .where(inArray(buildCheckResults.attemptId, attemptIds))
      .pipe(read('check results'))
    const blockers = yield* transaction
      .select()
      .from(buildBlockers)
      .where(eq(buildBlockers.sessionId, sessionId))
      .pipe(read('blockers'))
    const briefs = yield* transaction
      .select({ path: contextDeliveries.path })
      .from(contextDeliveries)
      .where(and(eq(contextDeliveries.sessionId, sessionId), eq(contextDeliveries.kind, 'brief')))
      .pipe(read('briefs'))
    const rows: BuildRows = {
      session,
      phase: phaseOf(session),
      specId,
      revisionId,
      snapshot,
      tasks: tasks.toSorted((left, right) => compareRanks(left.rank, right.rank)),
      attempts: attempts.toSorted(
        (left, right) =>
          left.startedAt.localeCompare(right.startedAt) || left.number - right.number,
      ),
      trees,
      files,
      results: results.toSorted((left, right) => left.ranAt.localeCompare(right.ranAt)),
      blockers: blockers.toSorted((left, right) => left.raisedAt.localeCompare(right.raisedAt)),
      briefed: new Set(briefs.map((brief) => brief.path)),
    }
    return rows
  })
}

/** The contractual task a row builds, from the frozen revision. */
export function specTaskOf(rows: BuildRows, task: Pick<TaskRow, 'taskId'>): SpecTask | undefined {
  return rows.snapshot.tasks.find((one) => one.id === task.taskId)
}

/** The tasks as the core's rules read them, with the states given where they changed. */
export function asBuildTasks(
  rows: BuildRows,
  states: ReadonlyMap<string, TaskState> = new Map(),
): BuildTask[] {
  return rows.tasks.map((task) => ({
    taskId: task.taskId,
    executor: specTaskOf(rows, task)?.executor ?? 'agent',
    state: states.get(task.taskId) ?? stateOf(task),
    skipUnblocks: task.skipUnblocks,
  }))
}

/** The attempts of one task, oldest first. */
export function attemptsOf(rows: BuildRows, task: Pick<TaskRow, 'id'>): AttemptRow[] {
  return rows.attempts
    .filter((attempt) => attempt.buildTaskId === task.id)
    .toSorted((left, right) => left.number - right.number)
}

/** The attempts on one subject: a task, a story, or the build itself, oldest first. */
export function attemptsOn(rows: BuildRows, attempt: AttemptRow): AttemptRow[] {
  return rows.attempts
    .filter(
      (other) =>
        other.scope === attempt.scope &&
        other.buildTaskId === attempt.buildTaskId &&
        other.storyId === attempt.storyId,
    )
    .toSorted((left, right) => left.number - right.number)
}

/**
 * Whether a red story or build attempt waits for the user (D10-07): every third red one in a row,
 * as a task's third red attempt comes back to them. Resume runs its checks again.
 */
export function waitsForUser(attempt: AttemptRow): boolean {
  return resultOf(attempt) === 'red' && attempt.number % 3 === 0
}

/**
 * The red story and build attempts still to address (D10-07): the last attempt on each subject,
 * when it ended red and does not wait for the user. A later attempt running on the same subject
 * replaces it.
 */
export function pendingFailures(rows: BuildRows): AttemptRow[] {
  const lasts = new Map<string, AttemptRow>()
  for (const attempt of rows.attempts) {
    if (attempt.scope === 'task') continue
    const key = `${attempt.scope}:${attempt.storyId ?? ''}`
    const known = lasts.get(key)
    if (known === undefined || attempt.number > known.number) lasts.set(key, attempt)
  }
  return [...lasts.values()].filter(
    (attempt) => resultOf(attempt) === 'red' && !waitsForUser(attempt),
  )
}

/** The blocker a task is held by, when one is open. */
export function openBlockerOf(rows: BuildRows, task: Pick<TaskRow, 'id'>): BlockerRow | undefined {
  return rows.blockers.findLast(
    (blocker) => blocker.buildTaskId === task.id && blocker.dismissedAt === null,
  )
}

/**
 * What an attempt's work changed, per repository, as a check is asked to run on it (D10-06): the
 * files of the attempts given, a later attempt's reading of a file winning over an earlier one's.
 */
export function changesOf(rows: BuildRows, attemptIds: readonly string[]) {
  const byRepository = new Map<string, Map<string, { path: string; status: string }>>()
  for (const attemptId of attemptIds) {
    for (const file of rows.files.filter((one) => one.attemptId === attemptId)) {
      const held =
        byRepository.get(file.repository) ?? new Map<string, { path: string; status: string }>()
      held.set(file.path, { path: file.path, status: file.status })
      byRepository.set(file.repository, held)
    }
  }
  return [...byRepository].map(([repository, files]) => ({
    repository,
    files: [...files.values()],
  }))
}

/** The last attempt of each task given that holds its files: what a story or the end is judged on. */
export function lastAttemptsOf(rows: BuildRows, tasks: readonly Pick<TaskRow, 'id'>[]): string[] {
  return tasks.flatMap((task) => {
    const last = attemptsOf(rows, task).findLast((attempt) => attempt.endedAt !== null)
    return last === undefined ? [] : [last.id]
  })
}

/** A Journal line about the build itself: entity `session`, correlated as D10-14 says. */
export function buildEvent(
  rows: BuildRows,
  type: string,
  author: EventAuthor,
  payload: Record<string, string | number | boolean | null> = {},
): NewEvent {
  return {
    type,
    entityKind: 'session',
    entityId: rows.session.id,
    source: author === 'human' ? 'ui' : 'system',
    author,
    projectId: rows.session.projectId,
    sessionId: rows.session.id,
    specId: rows.specId,
    revisionId: rows.revisionId,
    payload,
  }
}

/** A Journal line about one task of the build: entity `task`, its row, its label (D10-14). */
export function taskEvent(
  rows: BuildRows,
  task: Pick<TaskRow, 'id' | 'label'>,
  type: string,
  author: EventAuthor,
  payload: Record<string, string | number | boolean | null> = {},
): NewEvent {
  return {
    ...buildEvent(rows, type, author, { label: task.label, ...payload }),
    entityKind: 'task',
    entityId: task.id,
  }
}

/** One check run the service starts once the transaction that asked for it committed. */
export interface CheckJob {
  readonly attemptId: string
  readonly when: CheckWhen
}

/** A new attempt row, with the snapshot of each repository it starts from (D10-05). */
export function openAttempt(
  transaction: EngineTransaction,
  attempt: {
    readonly sessionId: string
    readonly scope: AttemptScope
    readonly buildTaskId: string | null
    readonly storyId: string | null
    readonly number: number
    readonly at: string
    readonly trees: readonly { readonly repository: string; readonly tree: string }[]
  },
) {
  return Effect.gen(function* () {
    const id = crypto.randomUUID()
    yield* transaction
      .insert(buildAttempts)
      .values({
        id,
        sessionId: attempt.sessionId,
        scope: attempt.scope,
        buildTaskId: attempt.buildTaskId,
        storyId: attempt.storyId,
        number: attempt.number,
        startedAt: attempt.at,
      })
      .pipe(Effect.mapError(failed('writing the attempt')))
    if (attempt.trees.length > 0) {
      yield* transaction
        .insert(buildAttemptTrees)
        .values(
          attempt.trees.map((one) => ({
            attemptId: id,
            repository: one.repository,
            startTree: one.tree,
          })),
        )
        .pipe(Effect.mapError(failed('writing the snapshots of the attempt')))
    }
    return id
  })
}

/** Moves one task to a state, with the time and the columns the move sets. */
export function moveTask(
  transaction: EngineTransaction,
  task: Pick<TaskRow, 'id'>,
  state: TaskState,
  at: string,
  columns: Partial<Pick<TaskRow, 'startedAt' | 'finishedAt' | 'endedAt' | 'handedAt'>> = {},
) {
  return transaction
    .update(buildTasks)
    .set({ state, updatedAt: at, ...columns })
    .where(eq(buildTasks.id, task.id))
    .pipe(Effect.mapError(failed('writing the task')))
}

/** Writes where a build's protocol stands (D10-01). */
export function movePhase(
  transaction: EngineTransaction,
  sessionId: string,
  phase: BuildPhase,
  columns: Partial<Pick<SessionRow, 'buildDetail' | 'approachNote'>> = {},
) {
  return transaction
    .update(sessions)
    .set({ buildPhase: phase, ...columns })
    .where(eq(sessions.id, sessionId))
    .pipe(Effect.mapError(failed('writing the phase of the build')))
}

/**
 * What follows a change of the tasks, read from the rows as they now stand (D10-03, D10-07,
 * D10-08): the waiting tasks whose dependencies are met move on — an agent's `ready`, a human's
 * `yours` —; a story whose every task is done and was never checked gets its first attempt; and a
 * build in `execute` whose tasks are all settled goes to `verify`. The checks are the caller's to
 * start once this committed.
 */
export function follow(transaction: EngineTransaction, sessionId: string, at: string) {
  return Effect.gen(function* () {
    const events: NewEvent[] = []
    const jobs: CheckJob[] = []
    const rows = yield* readBuild(transaction, sessionId)
    if (rows === null || (rows.phase !== 'prepare' && rows.phase !== 'execute')) {
      return { events, jobs }
    }
    const states = new Map<string, TaskState>()
    for (const promotion of promotions(asBuildTasks(rows), rows.snapshot.dependencies)) {
      const task = rows.tasks.find((one) => one.taskId === promotion.taskId)
      if (task === undefined) continue
      // A human task is never acknowledged by Hemera: it is the user's, from the moment it is
      // ready (D10-08).
      yield* moveTask(transaction, task, promotion.state, at, {
        endedAt: promotion.state === 'yours' ? at : null,
      })
      states.set(task.taskId, promotion.state)
      events.push(
        promotion.state === 'yours'
          ? taskEvent(rows, task, 'task.yours', 'hemera', { reason: 'human' })
          : taskEvent(rows, task, 'task.ready', 'hemera'),
      )
    }
    const tasks = asBuildTasks(rows, states)
    for (const story of rows.snapshot.stories) {
      if (!storyDone(story.id, rows.snapshot.taskStories, tasks)) continue
      if (rows.attempts.some((attempt) => attempt.storyId === story.id)) continue
      const attemptId = yield* openAttempt(transaction, {
        sessionId,
        scope: 'story',
        buildTaskId: null,
        storyId: story.id,
        number: 1,
        at,
        trees: [],
      })
      jobs.push({ attemptId, when: 'story' })
    }
    // The end checks wait for the agent's own verification: they run once the turn that handed it
    // the `verify` brief is over, never beside it (D10-07).
    if (rows.phase === 'execute' && tasksSettled(tasks)) {
      yield* movePhase(transaction, sessionId, 'verify')
      events.push(buildEvent(rows, 'build.phase_started', 'hemera', { phase: 'verify' }))
    }
    return { events, jobs }
  })
}

/**
 * What a check of an attempt runs on (D10-06): a task's attempt, its own files; a story's, the last
 * files of the tasks covering it; the build's, the last files of every task.
 */
export function changesFor(rows: BuildRows, attempt: AttemptRow) {
  if (attempt.scope === 'task') return changesOf(rows, [attempt.id])
  const covering =
    attempt.scope === 'story'
      ? new Set(
          rows.snapshot.taskStories
            .filter((link) => link.storyId === attempt.storyId)
            .map((link) => link.taskId),
        )
      : null
  const tasks = rows.tasks.filter((task) => covering === null || covering.has(task.taskId))
  return changesOf(rows, lastAttemptsOf(rows, tasks))
}

/**
 * Why a Spec already has its one build, in words a refusal ends with, or null when it has none:
 * a build that is not stopped — paused, verifying or accepted included — or a launch that
 * waits or starts. Read where the caller reads, so a launch reads it in the transaction that writes
 * it: two requests at once never both find the slot free.
 */
export function slotHolder(reader: EngineDatabase | EngineTransaction, specId: string) {
  return Effect.gen(function* () {
    const builds = yield* reader
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.specId, specId),
          eq(sessions.mission, 'build'),
          isNotNull(sessions.buildPhase),
          ne(sessions.buildPhase, 'stopped'),
        ),
      )
      .orderBy(asc(sessions.createdAt))
      .pipe(Effect.mapError(failed('reading the builds of the Spec')))
    const holding = builds[0]
    if (holding !== undefined) {
      const phase = phaseOf(holding)
      if (holding.buildPausedAt !== null) return 'it is paused'
      if (phase === 'prepare') return 'it is getting ready'
      if (phase === 'execute') return 'it is building'
      if (phase === 'verify') return 'it is in its final checks'
      return 'it was accepted'
    }
    const launches = yield* reader
      .select({ state: buildLaunches.state })
      .from(buildLaunches)
      .where(
        and(
          eq(buildLaunches.specId, specId),
          inArray(buildLaunches.state, ['waiting', 'starting']),
        ),
      )
      .pipe(Effect.mapError(failed('reading the launches of the Spec')))
    const launch = launches[0]
    if (launch === undefined) return null
    return launch.state === 'waiting' ? 'it waits for its Workspace' : 'it is starting'
  })
}

/**
 * What went wrong in taking a try's evidence or running its checks, said where the evidence is:
 * a snapshot not taken, a diff not read, checks that could not run.
 */
export interface Failure {
  /** What failed, as the try lists it beside its checks: `Snapshot of sources/api`. */
  readonly name: string
  /** Where: `''` for the Workspace root, or the repository's path. */
  readonly place: string
  /** Why, in plain words, as the failing step said it. */
  readonly detail: string
}

/** Where a place is, in words: its path, or the Workspace root. */
export function placeWords(place: string): string {
  return place === '' ? 'the Workspace root' : place
}

/**
 * Writes failures on a try as red results beside its checks: an error in the evidence is never
 * masked, and the verdict counts it like a red check (D10-07).
 */
export function recordFailures(
  transaction: EngineTransaction,
  attemptId: string,
  failures: readonly Failure[],
  at: string,
) {
  if (failures.length === 0) return Effect.void
  return transaction
    .insert(buildCheckResults)
    .values(
      failures.map((failure) => ({
        id: crypto.randomUUID(),
        attemptId,
        checkId: null,
        name: failure.name,
        place: failure.place,
        line: '',
        runId: null,
        verdict: 'red',
        exitCode: null,
        value: null,
        detail: failure.detail,
        outputTail: '',
        ranAt: at,
      })),
    )
    .pipe(Effect.mapError(failed('recording what failed')), Effect.asVoid)
}
