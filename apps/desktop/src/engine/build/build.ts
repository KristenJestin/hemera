/**
 * The build: its protocol, its loop, the tools its agent signals with, and what the user does to it
 * (design D10-01 to D10-14).
 *
 * A `build` Session works through a frozen Spec in `prepare`, `execute` and `verify`, then waits
 * for the user's Accept (D10-01). Its phase and every task's state are rows, so a restart resumes
 * exactly; what is kept in memory is only what a restart asks again — which agent is due the resume
 * brief, which build was just paused, which Hemera call is running. Hemera owns the tasks' states
 * (D10-04): the agent says it finished a task, or that a task contradicts the Spec, and the verdict
 * is the Project's checks', run through `BuildChecks` and never through the agent (D10-07).
 *
 * The service sits below the tool catalogue and below the runtime, and depends on neither: the
 * catalogue asks it before a call runs (`admitted`) and routes the three build tools to it
 * (`tool`), the runtime asks it what waits for a build's agent at a safe point (`waiting`) and hands
 * it back what the agent took. Where the build needs the agent — to hand it something now, or to
 * stop its turn — it goes through `BuildAgent`, a port the runtime fills once it is built
 * (`drivenBy`), exactly as the runtime hands its flush to `HeldWords`; until it does, nothing is
 * driven. Every change is written with its Journal line in one transaction (D10-14), and no Git
 * call, check or agent runs inside one.
 */

import {
  type AttemptResult,
  type AttemptScope,
  type BuildPhase,
  type CheckVerdict,
  type SpecSnapshot,
  type TaskExecutor,
  type TaskState,
  taskLabels,
} from '@hemera/core'
import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { Context, Data, Effect, Layer } from 'effect'

import { Database, type DatabaseError } from '../storage/database.ts'
import { buildLaunches, buildTasks, sessionEntries, sessions } from '../storage/schema.ts'
import { failed, now, reading } from '../specs/snapshot.ts'
import { mutate } from '../transaction.ts'
import { type BuildDelivery, deliveryFor, handing, missed, taken } from './brief.ts'
import {
  type AttemptRow,
  type BuildRows,
  attemptsOf,
  buildEvent,
  follow,
  movePhase,
  phaseOf,
  readBuild,
  resultOf,
  scopeOf,
  specTaskOf,
  stateOf,
  verdictOf,
} from './tasks.ts'

export type { BuildDelivery } from './brief.ts'

/** One check's run, as the build view shows it (D10-12). */
export interface CheckResultView {
  readonly id: string
  readonly name: string
  /** Where it ran: `''` for the Workspace root, or the repository's path. */
  readonly place: string
  readonly line: string
  readonly verdict: CheckVerdict
  readonly exitCode: number | null
  readonly value: number | null
  readonly detail: string | null
  readonly outputTail: string
  readonly runId: string | null
  readonly ranAt: string
}

/** One file an attempt changed, in one repository (`''` for the Workspace root). */
export interface ChangedFileView {
  readonly repository: string
  readonly path: string
  readonly status: string
  readonly added: number | null
  readonly removed: number | null
}

/** One attempt — a Try — at a task, a story's checks or the end checks, with its evidence. */
export interface AttemptView {
  readonly id: string
  readonly scope: AttemptScope
  readonly number: number
  readonly startedAt: string
  readonly endedAt: string | null
  /** Null while it runs; `unverified` when no check ran — "Done, not verified". */
  readonly result: AttemptResult | null
  readonly checks: readonly CheckResultView[]
  readonly files: readonly ChangedFileView[]
}

/** One contractual task of the build, its definition beside where it stands (D10-04, L1). */
export interface BuildTaskView {
  /** The `build_tasks` row, which the user's actions name. */
  readonly id: string
  /** The contractual task of the frozen revision. */
  readonly taskId: string
  readonly label: string
  readonly title: string
  readonly result: string
  readonly criteria: string
  readonly type: string
  readonly executor: TaskExecutor
  readonly state: TaskState
  /** The labels of the tasks it depends on. */
  readonly dependsOn: readonly string[]
  readonly storyIds: readonly string[]
  readonly handedAt: string | null
  readonly startedAt: string | null
  readonly finishedAt: string | null
  readonly endedAt: string | null
  readonly updatedAt: string
  readonly skipReason: string | null
  readonly attempts: readonly AttemptView[]
}

/** A task the agent said contradicts the Spec, and whether the user dismissed it (D10-08). */
export interface BlockerView {
  readonly id: string
  /** The build task it holds. */
  readonly taskId: string
  readonly label: string
  readonly reason: string
  readonly raisedAt: string
  readonly dismissedAt: string | null
}

/**
 * A story's progress, derived from its tasks and its checks' attempts (D10-07): `open` until its
 * checks first run, `checking` while they run, then `green` or `red` as the last attempt ended — a
 * story whose checks judged nothing counts as green.
 */
export interface StoryView {
  readonly id: string
  readonly title: string
  /** The labels of the tasks covering it. */
  readonly labels: readonly string[]
  readonly state: 'open' | 'checking' | 'green' | 'red'
  readonly attempts: readonly AttemptView[]
}

/**
 * A build as the window draws it (D10-12): the Spec it builds, its phase, whether it is paused and
 * why it stopped, the agent's approach note, the tasks with their attempts and evidence, the
 * blockers, the stories and the end checks' attempts, and whether Accept is offered (D10-11).
 */
export interface BuildView {
  readonly sessionId: string
  readonly specId: string
  readonly specKey: string
  readonly specTitle: string
  readonly phase: BuildPhase
  readonly pausedAt: string | null
  readonly detail: string | null
  readonly note: string | null
  readonly tasks: readonly BuildTaskView[]
  readonly blockers: readonly BlockerView[]
  readonly stories: readonly StoryView[]
  readonly endAttempts: readonly AttemptView[]
  readonly canAccept: boolean
}

/**
 * What the build asks of its agent, filled by the runtime once it is built (`Builds.drivenBy`):
 * a port rather than the runtime itself, because the runtime is built on this service.
 */
export interface BuildAgent {
  /**
   * Hands what waits for the Session's agent at its next safe point — now when no turn runs, once
   * the running one ends otherwise — starting the agent again when it is not running: a build is
   * driven by Hemera, never by a message of the user's (D10-02).
   */
  readonly wake: (sessionId: string) => Effect.Effect<void>
  /** Stops the turn running in the Session, if one is: a Pause, a Stop, an obsolete build. */
  readonly stopTurn: (sessionId: string) => Effect.Effect<void>
}

/** Who hears that a build changed: the window, which reads its view again (`build.changed`). */
export interface BuildNoticesService {
  readonly changed: (sessionId: string) => void
}

export class BuildNotices extends Context.Service<BuildNotices, BuildNoticesService>()(
  'BuildNotices',
) {}

/** Nobody watching. */
export const NoBuildNotices = Layer.succeed(BuildNotices, { changed: () => undefined })

/** A build, a task or a blocker was asked for by an identifier nothing answers to. */
export class UnknownBuildError extends Data.TaggedError('UnknownBuildError')<{
  readonly id: string
}> {
  override get message(): string {
    return `No build has anything named "${this.id}".`
  }
}

/** Everything a user's action on a build can be answered with. */
export type BuildRefusal = DatabaseError | UnknownBuildError

/** The phases a build works through; the other two close it. */
const ACTIVE: readonly BuildPhase[] = ['prepare', 'execute', 'verify']

export interface BuildsService {
  /**
   * Begins a build on the Session a launch just wrote (D10-01, D10-02): `prepare`, one task row per
   * contractual task of the revision — labelled `T1…Tn` by rank (L1), `waiting` then the first ones
   * `ready` or `yours` — and their Journal lines.
   */
  readonly begin: (sessionId: string, snapshot: SpecSnapshot) => Effect.Effect<void, DatabaseError>
  /**
   * Why a Spec already has its one build (L10), in words a refusal ends with, or null when it has
   * none: a build that is not stopped — paused, verifying or accepted included — or a launch that
   * waits or starts.
   */
  readonly holder: (specId: string) => Effect.Effect<string | null, DatabaseError>
  /** Hands the build's agent what waits for it, at its next safe point; nothing when paused. */
  readonly wake: (sessionId: string) => Effect.Effect<void>
  /** The runtime, once it is built: how the build reaches its agent. */
  readonly drivenBy: (agent: BuildAgent) => void
  /**
   * What waits for a build Session's agent at a safe point, or null (D10-02, D10-03, D10-09).
   * `holdsNone` says the agent's own session holds no brief: it is handed the resume brief.
   */
  readonly waiting: (
    sessionId: string,
    holdsNone: boolean,
  ) => Effect.Effect<BuildDelivery | null, DatabaseError>
  /** The delivery goes out: what it hands is marked, before the agent reads it (L3). */
  readonly handing: (delivery: BuildDelivery) => Effect.Effect<void, DatabaseError>
  /** The agent took it. */
  readonly taken: (delivery: BuildDelivery) => Effect.Effect<void, DatabaseError>
  /** The agent did not take it: it waits for the next safe point. */
  readonly missed: (delivery: BuildDelivery) => Effect.Effect<void, DatabaseError>
  /**
   * The turn a delivery was handed in ended (L2): the answer to `prepare` is the approach note.
   */
  readonly turnEnded: (
    delivery: BuildDelivery,
    turnId: string,
  ) => Effect.Effect<void, DatabaseError>
  readonly view: (sessionId: string) => Effect.Effect<BuildView, BuildRefusal>
}

export class Builds extends Context.Service<Builds, BuildsService>()('Builds') {}

/** Why Accept is not offered, or null when it is (D10-11). */
function acceptRefusal(rows: BuildRows): string | null {
  if (rows.phase !== 'verify') return 'The build has not reached its final checks.'
  if (rows.session.buildPausedAt !== null) return 'The build is paused.'
  const states = rows.tasks.map(stateOf)
  if (states.includes('yours')) return 'A task waits for you.'
  if (states.includes('blocked') || rows.blockers.some((one) => one.dismissedAt === null)) {
    return 'The agent says a task contradicts the Spec: decide it first.'
  }
  const lasts = new Map<string, AttemptRow>()
  for (const attempt of rows.attempts.filter((one) => one.scope !== 'task')) {
    lasts.set(`${attempt.scope}:${attempt.storyId ?? ''}`, attempt)
  }
  const end = lasts.get('build:')
  if (end === undefined || [...lasts.values()].some((attempt) => attempt.endedAt === null)) {
    return 'The final checks are still running.'
  }
  if ([...lasts.values()].some((attempt) => resultOf(attempt) === 'red')) {
    return 'The final checks are not green.'
  }
  return null
}

function checkView(row: BuildRows['results'][number]): CheckResultView {
  return {
    id: row.id,
    name: row.name,
    place: row.place,
    line: row.line,
    verdict: verdictOf(row),
    exitCode: row.exitCode,
    value: row.value,
    detail: row.detail,
    outputTail: row.outputTail,
    runId: row.runId,
    ranAt: row.ranAt,
  }
}

function attemptView(rows: BuildRows, attempt: AttemptRow): AttemptView {
  return {
    id: attempt.id,
    scope: scopeOf(attempt),
    number: attempt.number,
    startedAt: attempt.startedAt,
    endedAt: attempt.endedAt,
    result: resultOf(attempt),
    checks: rows.results.filter((one) => one.attemptId === attempt.id).map(checkView),
    files: rows.files
      .filter((one) => one.attemptId === attempt.id)
      .map((one) => ({
        repository: one.repository,
        path: one.path,
        status: one.status,
        added: one.added,
        removed: one.removed,
      })),
  }
}

function storyState(attempts: readonly AttemptRow[]): StoryView['state'] {
  const last = attempts.at(-1)
  if (last === undefined) return 'open'
  if (last.endedAt === null) return 'checking'
  return resultOf(last) === 'red' ? 'red' : 'green'
}

/** The build as the window reads it (D10-12). */
export function viewOf(rows: BuildRows): BuildView {
  const labelOf = (taskId: string) =>
    rows.tasks.find((task) => task.taskId === taskId)?.label ?? taskId
  const byNumber = (left: AttemptRow, right: AttemptRow) => left.number - right.number
  return {
    sessionId: rows.session.id,
    specId: rows.specId,
    specKey: rows.snapshot.spec.key,
    specTitle: rows.snapshot.revision.title,
    phase: rows.phase ?? 'prepare',
    pausedAt: rows.session.buildPausedAt,
    detail: rows.session.buildDetail,
    note: rows.session.approachNote,
    tasks: rows.tasks.map((task) => {
      const spec = specTaskOf(rows, task)
      return {
        id: task.id,
        taskId: task.taskId,
        label: task.label,
        title: spec?.title ?? task.label,
        result: spec?.result ?? '',
        criteria: spec?.criteria ?? '',
        type: spec?.type ?? '',
        executor: spec?.executor ?? 'agent',
        state: stateOf(task),
        dependsOn: rows.snapshot.dependencies
          .filter((dependency) => dependency.taskId === task.taskId)
          .map((dependency) => labelOf(dependency.dependsOnId)),
        storyIds: rows.snapshot.taskStories
          .filter((link) => link.taskId === task.taskId)
          .map((link) => link.storyId),
        handedAt: task.handedAt,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
        endedAt: task.endedAt,
        updatedAt: task.updatedAt,
        skipReason: task.skipReason,
        attempts: attemptsOf(rows, task).map((attempt) => attemptView(rows, attempt)),
      }
    }),
    blockers: rows.blockers.map((blocker) => ({
      id: blocker.id,
      taskId: blocker.buildTaskId,
      label: rows.tasks.find((task) => task.id === blocker.buildTaskId)?.label ?? '',
      reason: blocker.reason,
      raisedAt: blocker.raisedAt,
      dismissedAt: blocker.dismissedAt,
    })),
    stories: rows.snapshot.stories.map((story) => {
      const attempts = rows.attempts
        .filter((attempt) => attempt.storyId === story.id)
        .toSorted(byNumber)
      return {
        id: story.id,
        title: story.title,
        labels: rows.snapshot.taskStories
          .filter((link) => link.storyId === story.id)
          .map((link) => labelOf(link.taskId)),
        state: storyState(attempts),
        attempts: attempts.map((attempt) => attemptView(rows, attempt)),
      }
    }),
    endAttempts: rows.attempts
      .filter((attempt) => attempt.scope === 'build')
      .toSorted(byNumber)
      .map((attempt) => attemptView(rows, attempt)),
    canAccept: acceptRefusal(rows) === null,
  }
}

export const buildsLayer = Layer.effect(
  Builds,
  Effect.gen(function* () {
    const database = yield* Database
    const notices = yield* BuildNotices

    const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provideService(Database, database))

    /** The runtime, once it handed itself over. */
    let agent: BuildAgent | null = null

    const told = (sessionId: string) => Effect.sync(() => notices.changed(sessionId))

    const read = (sessionId: string) =>
      withDatabase(reading('reading the build', (transaction) => readBuild(transaction, sessionId)))

    const must = (sessionId: string) =>
      read(sessionId).pipe(
        Effect.flatMap((rows) =>
          rows === null
            ? Effect.fail(new UnknownBuildError({ id: sessionId }))
            : Effect.succeed(rows),
        ),
      )

    const sessionRowOf = (sessionId: string) =>
      database
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .pipe(
          Effect.map((found) => found[0] ?? null),
          Effect.orElseSucceed(() => null),
        )

    const wake = (sessionId: string) =>
      Effect.gen(function* () {
        const row = yield* sessionRowOf(sessionId)
        const phase = row === null ? null : phaseOf(row)
        if (row === null || phase === null || !ACTIVE.includes(phase)) return
        if (row.buildPausedAt !== null || agent === null) return
        yield* agent.wake(sessionId)
      })

    const view = (sessionId: string) => must(sessionId).pipe(Effect.map(viewOf))

    const service: BuildsService = {
      begin: (sessionId, snapshot) =>
        withDatabase(
          mutate('beginning the build', (transaction) =>
            Effect.gen(function* () {
              const at = now()
              const labels = taskLabels(snapshot.tasks)
              if (snapshot.tasks.length > 0) {
                yield* transaction
                  .insert(buildTasks)
                  .values(
                    snapshot.tasks.map((task) => ({
                      id: crypto.randomUUID(),
                      sessionId,
                      taskId: task.id,
                      label: labels.get(task.id) ?? '',
                      rank: task.rank,
                      state: 'waiting',
                      updatedAt: at,
                    })),
                  )
                  .pipe(Effect.mapError(failed('writing the tasks of the build')))
              }
              yield* movePhase(transaction, sessionId, 'prepare')
              const rows = yield* readBuild(transaction, sessionId)
              const followed = yield* follow(transaction, sessionId, at)
              return {
                result: undefined,
                events: [
                  ...(rows === null
                    ? []
                    : [buildEvent(rows, 'build.phase_started', 'hemera', { phase: 'prepare' })]),
                  ...followed.events,
                ],
              }
            }),
          ),
        ).pipe(Effect.tap(() => told(sessionId))),

      holder: (specId) =>
        Effect.gen(function* () {
          const builds = yield* database
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
          const holding = builds[0] ?? null
          if (holding !== null) {
            const phase = phaseOf(holding)
            if (holding.buildPausedAt !== null) return 'it is paused'
            if (phase === 'prepare') return 'it is getting ready'
            if (phase === 'execute') return 'it is building'
            if (phase === 'verify') return 'it is in its final checks'
            return 'it was accepted'
          }
          const launches = yield* database
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
        }),

      wake,

      drivenBy: (driven) => {
        agent = driven
      },

      waiting: (sessionId, holdsNone) =>
        read(sessionId).pipe(
          Effect.map((rows) => (rows === null ? null : deliveryFor(rows, holdsNone))),
        ),

      handing: (delivery) =>
        withDatabase(
          mutate('handing the build its delivery', (transaction) =>
            handing(transaction, delivery).pipe(Effect.as({ result: undefined, events: [] })),
          ),
        ).pipe(Effect.tap(() => told(delivery.sessionId))),

      taken: (delivery) =>
        withDatabase(
          mutate('recording the delivery taken', (transaction) =>
            taken(transaction, delivery).pipe(Effect.as({ result: undefined, events: [] })),
          ),
        ),

      missed: (delivery) =>
        withDatabase(
          mutate('taking back a delivery not taken', (transaction) =>
            missed(transaction, delivery).pipe(Effect.as({ result: undefined, events: [] })),
          ),
        ).pipe(Effect.tap(() => told(delivery.sessionId))),

      turnEnded: (delivery, turnId) =>
        Effect.gen(function* () {
          const { sessionId } = delivery
          if (delivery.kind === 'prepare') {
            // The approach note is the agent's answer to the `prepare` brief (L2): what it said in
            // that turn. An empty answer leaves the build in `prepare`, and Resume asks again.
            const said = yield* database
              .select({ body: sessionEntries.body })
              .from(sessionEntries)
              .where(
                and(
                  eq(sessionEntries.sessionId, sessionId),
                  eq(sessionEntries.turnId, turnId),
                  eq(sessionEntries.role, 'agent'),
                  eq(sessionEntries.kind, 'message'),
                ),
              )
              .orderBy(asc(sessionEntries.seq))
              .pipe(Effect.mapError(failed('reading the approach note')))
            const note = said
              .map((entry) => entry.body.trim())
              .filter((body) => body !== '')
              .join('\n\n')
            if (note !== '') {
              const at = now()
              yield* withDatabase(
                mutate('keeping the approach note', (transaction) =>
                  Effect.gen(function* () {
                    const rows = yield* readBuild(transaction, sessionId)
                    if (rows === null || rows.phase !== 'prepare') {
                      return { result: [], events: [] }
                    }
                    yield* movePhase(transaction, sessionId, 'execute', { approachNote: note })
                    const followed = yield* follow(transaction, sessionId, at)
                    return {
                      result: followed.jobs,
                      events: [
                        buildEvent(rows, 'build.phase_started', 'hemera', { phase: 'execute' }),
                        ...followed.events,
                      ],
                    }
                  }),
                ),
              )
              yield* told(sessionId)
              yield* wake(sessionId)
            }
          }
        }),

      view,
    }
    return service
  }),
)
