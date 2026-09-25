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

import { join } from 'node:path'

import {
  ATTEMPTS_BEFORE_YOURS,
  type AttemptResult,
  type AttemptScope,
  type BuildPhase,
  type CheckVerdict,
  type CheckWhen,
  SPEC_PAGE_CHARACTERS,
  type SpecSnapshot,
  type TaskExecutor,
  type TaskState,
  type ToolName,
  attemptResult,
  dependantsOf,
  renderSpecMarkdown,
  stateAfterAttempt,
  taskLabels,
} from '@hemera/core'
import { and, asc, eq, inArray, isNotNull, ne, or } from 'drizzle-orm'
import { Context, Data, Deferred, Effect, FiberSet, Layer, Result, Scope } from 'effect'

import { StderrSink } from '../agents/supervisor.ts'
import { Git } from '../git.ts'
import type { NewEvent } from '../journal.ts'
import { Database, type DatabaseError, type EngineTransaction } from '../storage/database.ts'
import {
  buildAttemptFiles,
  buildAttemptTrees,
  buildAttempts,
  buildBlockers,
  buildCheckResults,
  buildTasks,
  sessionEntries,
  sessions,
  specs,
} from '../storage/schema.ts'
import { failed, now, reading, specRow } from '../specs/snapshot.ts'
import type { ParsedCall } from '../tools/arguments.ts'
import { mutate } from '../transaction.ts'
import { describedWorkspace } from '../workspaces/described.ts'
import { type BuildDelivery, briefTask, deliveryFor, handing, missed, taken } from './brief.ts'
import { BuildChecks, type CheckOutcome } from './checks.ts'
import { changedFiles, snapshotTree } from './snapshots.ts'
import {
  type AttemptRow,
  type BuildRows,
  type CheckJob,
  type Failure,
  OBSOLETE,
  type TaskRow,
  attemptsOf,
  attemptsOn,
  buildEvent,
  changesFor,
  follow,
  moveTask,
  movePhase,
  openAttempt,
  phaseOf,
  placeWords,
  readBuild,
  recordFailures,
  resultOf,
  slotHolder,
  scopeOf,
  specTaskOf,
  stateOf,
  taskEvent,
  verdictOf,
  waitsForUser,
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

/** One contractual task of the build, its definition beside where it stands (D10-04). */
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
  /** Whether the user's skip let its dependants go on (D10-03). */
  readonly skipUnblocks: boolean
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
  /** The number of the revision the build was started on, which "Spec" opens read only. */
  readonly revision: number
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

/** What the user asked of a build is refused, with the sentence the window shows. */
export class BuildRefusedError extends Data.TaggedError('BuildRefusedError')<{
  readonly reason: string
}> {
  override get message(): string {
    return this.reason
  }
}

/** A build, a task or a blocker was asked for by an identifier nothing answers to. */
export class UnknownBuildError extends Data.TaggedError('UnknownBuildError')<{
  readonly id: string
}> {
  override get message(): string {
    return `No build has anything named "${this.id}".`
  }
}

/** Everything a user's action on a build can be answered with. */
export type BuildRefusal = DatabaseError | BuildRefusedError | UnknownBuildError

/** A call to one of the three build tools, as `parseCall` read it. */
export type BuildCall = Extract<
  ParsedCall,
  { tool: 'build_read' | 'task_finished' | 'task_blocked' }
>

/** What a build tool answers: the catalogue's `Answer`, which it writes down like any other. */
export interface BuildAnswer {
  readonly ok: boolean
  readonly refused?: boolean
  readonly summary: string
  readonly text: string
  readonly paths: readonly string[]
}

/** What a paused build answers every new call with (D10-09). */
export const PAUSED = 'the build is paused: nothing new starts until the user resumes it'

/** Why the user stopped a build, as its view says. */
const STOPPED = 'Stopped by the user.'

const BUILD_TOOLS: readonly ToolName[] = ['build_read', 'task_finished', 'task_blocked']

/** Which of the Project's checks judge an attempt, by what it is about (D10-06). */
const WHEN: Readonly<Record<AttemptScope, CheckWhen>> = {
  task: 'task',
  story: 'story',
  build: 'end',
}

/** The phases a build works through; the other two close it. */
const ACTIVE: readonly BuildPhase[] = ['prepare', 'execute', 'verify']

/** The rows of a build the user acts on, or the refusal of a build that is closed. */
function stillOpen(rows: BuildRows) {
  if (working(rows)) return Effect.succeed(rows)
  return Effect.fail(
    new BuildRefusedError({
      reason: rows.phase === 'accepted' ? 'This build was accepted.' : 'This build is stopped.',
    }),
  )
}

/** Whether a build is still at work: neither accepted nor stopped. */
function working(rows: BuildRows): boolean {
  return rows.phase !== null && ACTIVE.includes(rows.phase)
}

export interface BuildsService {
  /**
   * Begins a build on the Session a launch just wrote (D10-01, D10-02): `prepare`, one task row per
   * contractual task of the revision — labelled `T1…Tn` by rank, `waiting` then the first ones
   * `ready` or `yours` — and their Journal lines.
   */
  readonly begin: (sessionId: string, snapshot: SpecSnapshot) => Effect.Effect<void, DatabaseError>
  /**
   * Why a Spec already has its one build, in words a refusal ends with, or null when it has
   * none: a build that is not stopped — paused, verifying or accepted included — or a launch that
   * waits or starts. A build whose revision the Spec left before its first task started is obsolete
   * and holds nothing: it is stopped on the way (D10-04).
   */
  readonly holder: (specId: string) => Effect.Effect<string | null, DatabaseError>
  /** Hands the build's agent what waits for it, at its next safe point; nothing when paused. */
  readonly wake: (sessionId: string) => Effect.Effect<void>
  /** The runtime, once it is built: how the build reaches its agent. */
  readonly drivenBy: (agent: BuildAgent) => void
  /**
   * Whether the Session's checks are running: its agent is not idle then, and the pool keeps it
   * (D10-07) — the checks are Hemera's, and what an agent let go of takes with it is its own.
   */
  readonly checking: (sessionId: string) => boolean
  /**
   * What waits for a build Session's agent at a safe point, or null (D10-02, D10-03, D10-09).
   * `holdsNone` says the agent's own session holds no brief: it is handed the resume brief.
   */
  readonly waiting: (
    sessionId: string,
    holdsNone: boolean,
  ) => Effect.Effect<BuildDelivery | null, DatabaseError>
  /** The delivery goes out: what it hands is marked, before the agent reads it (D10-04). */
  readonly handing: (delivery: BuildDelivery) => Effect.Effect<void, DatabaseError>
  /** The agent took it. */
  readonly taken: (delivery: BuildDelivery) => Effect.Effect<void, DatabaseError>
  /** The agent did not take it: it waits for the next safe point. */
  readonly missed: (delivery: BuildDelivery) => Effect.Effect<void, DatabaseError>
  /**
   * The turn a delivery was handed in ended (D10-02, D10-07): the answer to `prepare` is the
   * approach note, the end checks run once the `verify` brief was handed, and the checks whose
   * failures it carried run again.
   */
  readonly turnEnded: (
    delivery: BuildDelivery,
    turnId: string,
  ) => Effect.Effect<void, DatabaseError>
  /**
   * One Hemera tool call of a Session, before it runs (D10-04, D10-09): a paused build refuses it,
   * a closed one refuses its build tools, and the first call after a delivery handed tasks starts
   * them — or finds the build obsolete, and refuses. Any other Session's call runs as it is. While
   * it runs it is counted, so a Pause stops the turn only once it ended.
   */
  readonly admitted: <A>(
    sessionId: string,
    tool: ToolName,
    run: Effect.Effect<A>,
    refuse: (reason: string) => Effect.Effect<A>,
  ) => Effect.Effect<A>
  /** `build_read`, `task_finished`, `task_blocked` (D10-04, D10-13). */
  readonly tool: (sessionId: string, call: BuildCall) => Effect.Effect<BuildAnswer>
  readonly view: (sessionId: string) => Effect.Effect<BuildView, BuildRefusal>
  /** D10-09: nothing new starts; the running Hemera call ends, then the turn stops. */
  readonly pause: (sessionId: string) => Effect.Effect<BuildView, BuildRefusal>
  /** D10-09: the agent is handed the resume brief at once. */
  readonly resume: (sessionId: string) => Effect.Effect<BuildView, BuildRefusal>
  /** D10-11: only when `verify` is green and nothing waits for the user. */
  readonly accept: (sessionId: string) => Effect.Effect<BuildView, BuildRefusal>
  /** The build is closed and stays readable. */
  readonly stop: (sessionId: string) => Effect.Effect<BuildView, BuildRefusal>
  /** A task waiting for the user, done by them (D10-08). */
  readonly taskDone: (buildTaskId: string) => Effect.Effect<BuildView, BuildRefusal>
  /**
   * A task waiting for the user, skipped with its reason; its dependants let go on, or skipped with
   * it (D10-03).
   */
  readonly taskSkip: (
    buildTaskId: string,
    reason: string,
    unblocks: boolean,
  ) => Effect.Effect<BuildView, BuildRefusal>
  /** A blocker dismissed: its task is ready again, its dependants wait again (D10-08). */
  readonly dismissBlocker: (blockerId: string) => Effect.Effect<BuildView, BuildRefusal>
  /**
   * At the engine's start (D10-09): the checks a stopped engine left running run again, and every
   * build that is not paused has its agent started and handed the resume brief.
   */
  readonly recover: () => Effect.Effect<void, DatabaseError>
}

export class Builds extends Context.Service<Builds, BuildsService>()('Builds') {}

/** A repository as the Project declares it (`./sources/api`, `.`), as the build names it. */
function repositoryOf(declared: string): string {
  return declared === '.' ? '' : declared.replace(/^\.\//, '')
}

/** One page of a text, ending on a whole line when it does not reach the end. */
function pageOf(text: string, offset: number) {
  const start = Math.min(offset, text.length)
  const cut = Math.min(start + SPEC_PAGE_CHARACTERS, text.length)
  const line = text.lastIndexOf('\n', cut - 1)
  const end = cut < text.length && line >= start ? line + 1 : cut
  const truncated = end < text.length
  return {
    page: text.slice(start, end),
    range: { offset: start, end, size: text.length, truncated, next: truncated ? end : null },
  }
}

function completed(summary: string, text: string): BuildAnswer {
  return { ok: true, summary, text, paths: [] }
}

/** A rule of the build said no: refused with its sentence, and nothing was changed. */
function refusedAnswer(reason: string): BuildAnswer {
  return {
    ok: false,
    refused: true,
    summary: reason,
    text: `${reason}; nothing was changed.`,
    paths: [],
  }
}

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
    revision: rows.snapshot.revision.number,
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
        skipUnblocks: task.skipUnblocks,
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
    // In the revision's rank order, which the snapshot keeps: the window keys them `S1`, `S2`.
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

/**
 * Where a try of a task stands, in the agent's words: its result once judged; before that, being
 * checked once the agent finished it, stopped while a blocker holds the task, running otherwise.
 */
function tryWord(state: TaskState, attempt: { ended: boolean; result: AttemptResult | null }) {
  if (attempt.result !== null) return attempt.result
  if (attempt.ended) return 'finished, being checked by Hemera'
  return state === 'blocked' ? 'stopped by the blocker' : 'running'
}

/** Where a build stands, for its agent: each task, its state and its attempts (D10-13). */
function standing(rows: BuildRows): string {
  const lines = rows.tasks.map((task) => {
    const attempts = attemptsOf(rows, task).map(
      (attempt) =>
        `attempt ${attempt.number} ${tryWord(stateOf(task), { ended: attempt.endedAt !== null, result: resultOf(attempt) })}`,
    )
    const spec = specTaskOf(rows, task)
    return `- ${task.label} · ${spec?.title ?? ''}: ${stateOf(task)}${attempts.length === 0 ? '' : `; ${attempts.join(', ')}`}`
  })
  const note = rows.session.approachNote
  return [
    `# Where the build stands\n\nPhase: ${rows.phase ?? 'prepare'}${rows.session.buildPausedAt === null ? '' : ' (paused)'}`,
    ...(note === null ? [] : [`Approach note:\n${note}`]),
    lines.join('\n'),
  ].join('\n\n')
}

/** One task for its agent: its definition, and each attempt with its files and checks. */
function oneTask(rows: BuildRows, task: TaskRow): string {
  const told = briefTask(rows, task)
  const head = [
    `# ${told.label} · ${told.title}`,
    `State: ${told.state} · Type: ${told.type} · Carried out by: ${told.executor}`,
    ...(told.dependsOn.length === 0 ? [] : [`Depends on: ${told.dependsOn.join(', ')}`]),
    ...(told.covers.length === 0 ? [] : [`Covers: ${told.covers.join(', ')}`]),
    `Result: ${told.result}`,
    `Criteria: ${told.criteria}`,
    ...(told.reason === null ? [] : [`Reason: ${told.reason}`]),
  ]
  const tries = told.attempts.map((attempt) =>
    [
      `## Attempt ${attempt.number}: ${tryWord(told.state, attempt)}`,
      attempt.files.length === 0
        ? 'Files changed: none recorded'
        : `Files changed:\n${attempt.files
            .map(
              (file) =>
                `- ${file.repository === '' ? '' : `${file.repository}/`}${file.path} (${file.status}${file.added === null ? ', binary' : ` +${file.added} -${file.removed ?? 0}`})`,
            )
            .join('\n')}`,
      ...attempt.checks.map(
        (check) =>
          `Check ${check.name} in ${check.place === '' ? 'the Workspace root' : check.place}: ${check.verdict}${check.detail === null ? '' : ` (${check.detail})`}\n${check.outputTail}`,
      ),
    ].join('\n'),
  )
  return [head.join('\n'), ...tries].join('\n\n')
}

export const buildsLayer = Layer.effect(
  Builds,
  Effect.gen(function* () {
    const database = yield* Database
    const git = yield* Git
    const checks = yield* BuildChecks
    const notices = yield* BuildNotices
    const diagnostic = yield* StderrSink
    /** The engine's own scope: the checks run in the background end when the engine does. */
    const scope = yield* Effect.scope

    const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provideService(Database, database))

    /** The runtime, once it handed itself over. */
    let agent: BuildAgent | null = null
    /** The builds whose agent is due the resume brief: after a Resume or a restart (D10-09). */
    const resumeDue = new Set<string>()
    /**
     * The builds paused in this run, as the Pause wrote it: read with the call count in one step,
     * so a call is either counted before the Pause or refused by it — never neither (D10-09).
     */
    const pausedNow = new Set<string>()
    /** The Hemera calls running, per Session, and who waits for them to be over. */
    const running = new Map<string, number>()
    const over = new Map<string, Deferred.Deferred<void>>()

    /** How many check jobs of each Session are running. */
    const checkingNow = new Map<string, number>()
    /** And the fibers running them, which a Stop or an Accept interrupts: its runs stop with them. */
    const jobFibers = new Map<string, FiberSet.FiberSet<void, never>>()

    const jobsOf = (sessionId: string) =>
      Effect.gen(function* () {
        const held = jobFibers.get(sessionId)
        if (held !== undefined) return held
        const made = yield* FiberSet.make<void, never>().pipe(Scope.provide(scope))
        jobFibers.set(sessionId, made)
        return made
      })

    /** Stops the checks a build was running: it closed, and nothing judges it any more. */
    const stopChecks = (sessionId: string) =>
      Effect.suspend(() => {
        const held = jobFibers.get(sessionId)
        return held === undefined ? Effect.void : FiberSet.clear(held)
      })

    const told = (sessionId: string) => Effect.sync(() => notices.changed(sessionId))

    /** What a background step of the build says when it fails: nobody else is there to hear it. */
    const logged = <E extends { readonly message: string }>(what: string) =>
      Effect.catch((cause: E) => diagnostic.write(`builds: ${what}: ${cause.message}`))

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

    const stopTurn = (sessionId: string) =>
      agent === null ? Effect.void : agent.stopTurn(sessionId)

    /** The repositories of the build's Workspace, where it is on disk. */
    const repositoriesOf = (rows: BuildRows) =>
      describedWorkspace(database, rows.session.projectId, rows.session.workspaceId).pipe(
        Effect.map((workspace) =>
          workspace.repositories.map((declared) => ({
            repository: repositoryOf(declared),
            path: join(workspace.path, repositoryOf(declared)),
          })),
        ),
      )

    /**
     * A snapshot of each repository of the Workspace as it stands now (D10-05), taken before the
     * transaction that names it. One that cannot be taken is a failure the caller writes on the
     * try, red: the evidence is short of one repository, and says so.
     */
    const snapshotsOf = (rows: BuildRows) =>
      Effect.gen(function* () {
        const repositories = yield* repositoriesOf(rows)
        const trees: { repository: string; tree: string }[] = []
        const failures: Failure[] = []
        for (const { repository, path } of repositories) {
          const tree = yield* Effect.result(
            snapshotTree(path).pipe(Effect.provideService(Git, git)),
          )
          if (Result.isSuccess(tree)) trees.push({ repository, tree: tree.success })
          else {
            failures.push({
              name: `Snapshot of ${placeWords(repository)}`,
              place: repository,
              detail: `the snapshot could not be taken: ${tree.failure.message}`,
            })
          }
        }
        return { trees, failures }
      })

    /** Runs the checks of one attempt, then writes their verdict (D10-07). */
    const runJob = (sessionId: string, job: CheckJob): Effect.Effect<void> =>
      Effect.gen(function* () {
        const rows = yield* read(sessionId)
        const attempt = rows?.attempts.find((one) => one.id === job.attemptId)
        // A build stopped or accepted meanwhile is judged no more.
        if (rows === null || attempt === undefined || !working(rows)) return
        yield* checks
          .run({
            sessionId,
            projectId: rows.session.projectId,
            workspaceId: rows.session.workspaceId,
            when: job.when,
            attemptId: attempt.id,
            scope: scopeOf(attempt),
            label: rows.tasks.find((task) => task.id === attempt.buildTaskId)?.label ?? null,
            changes: changesFor(rows, attempt),
          })
          .pipe(
            Effect.flatMap((outcomes) => verdict(sessionId, attempt, outcomes)),
            // Checks that could not run are red, said on the try, and the try is judged all the
            // same: its task never stays checking for ever.
            Effect.catch((cause) =>
              withDatabase(
                mutate('recording checks that could not run', (transaction) =>
                  recordFailures(
                    transaction,
                    attempt.id,
                    [
                      {
                        name: 'Checks',
                        place: '',
                        detail: `the checks could not run: ${cause.message}`,
                      },
                    ],
                    now(),
                  ).pipe(Effect.as({ result: undefined, events: [] })),
                ),
              ).pipe(Effect.andThen(verdict(sessionId, attempt, []))),
            ),
          )
      }).pipe(logged(`checking an attempt of ${sessionId}`))

    /** Starts the check runs a committed change asked for, each in the background. */
    const runJobs = (sessionId: string, jobs: readonly CheckJob[]) =>
      Effect.forEach(
        jobs,
        (job) =>
          Effect.gen(function* () {
            checkingNow.set(sessionId, (checkingNow.get(sessionId) ?? 0) + 1)
            yield* FiberSet.run(
              yield* jobsOf(sessionId),
              runJob(sessionId, job).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    const left = (checkingNow.get(sessionId) ?? 1) - 1
                    if (left > 0) checkingNow.set(sessionId, left)
                    else checkingNow.delete(sessionId)
                  }),
                ),
              ),
            )
          }),
        { discard: true },
      )

    /**
     * What an attempt's checks said (D10-07). A task's: all green, or none, is done; red goes back
     * in progress as a new attempt, whose failures the agent is told at its next safe point; the
     * third red comes back to the user. A story's or the build's: the attempt is recorded, and a
     * red one is told to the agent, no task changing state (D10-07).
     */
    const verdict = (sessionId: string, judged: AttemptRow, outcomes: readonly CheckOutcome[]) =>
      Effect.gen(function* () {
        const before = yield* read(sessionId)
        if (before === null || !working(before)) return
        // What the checks answered, and what else is written on the try: a failure of its
        // evidence is red like a check (D10-07).
        const answered = new Set(outcomes.map((outcome) => outcome.id))
        const result = attemptResult([
          ...outcomes.map((outcome) => outcome.verdict),
          ...before.results
            .filter((one) => one.attemptId === judged.id && !answered.has(one.id))
            .map(verdictOf),
        ])
        // The three tries are three red ones (D10-07): the task's red tries, this one included.
        const reds =
          before.attempts.filter(
            (attempt) =>
              attempt.buildTaskId === judged.buildTaskId &&
              attempt.id !== judged.id &&
              resultOf(attempt) === 'red',
          ).length + (result === 'red' ? 1 : 0)
        const next = stateAfterAttempt(result, reds)
        const snapped =
          judged.scope === 'task' && next === 'in_progress'
            ? yield* snapshotsOf(before)
            : { trees: [], failures: [] }
        const at = now()
        const jobs = yield* withDatabase(
          mutate('judging an attempt', (transaction) =>
            Effect.gen(function* () {
              const current = yield* readBuild(transaction, sessionId)
              // Read in the very transaction: a Stop or an Accept that came first leaves the build
              // as it closed it, no try judged, none opened.
              if (current === null || !working(current)) return { result: [], events: [] }
              // A task's try ended when the agent finished it; a story's or the build's ends here.
              yield* transaction
                .update(buildAttempts)
                .set(judged.scope === 'task' ? { result } : { result, endedAt: at })
                .where(eq(buildAttempts.id, judged.id))
                .pipe(Effect.mapError(failed('writing the verdict')))
              const rows = yield* readBuild(transaction, sessionId)
              const task = rows?.tasks.find((one) => one.id === judged.buildTaskId)
              if (rows === null || task === undefined || stateOf(task) !== 'checking') {
                return { result: [], events: [] }
              }
              const events: NewEvent[] = [
                taskEvent(rows, task, 'task.checked', 'hemera', {
                  attempt: judged.number,
                  result,
                }),
              ]
              if (next === 'in_progress') {
                yield* moveTask(transaction, task, 'in_progress', at)
                const retry = yield* openAttempt(transaction, {
                  sessionId,
                  scope: 'task',
                  buildTaskId: task.id,
                  storyId: null,
                  number: judged.number + 1,
                  at,
                  trees: snapped.trees,
                })
                yield* recordFailures(transaction, retry, snapped.failures, at)
                return { result: [], events }
              }
              if (next === 'yours') {
                yield* moveTask(transaction, task, 'yours', at, { endedAt: at })
                events.push(
                  taskEvent(rows, task, 'task.yours', 'hemera', {
                    reason: `${ATTEMPTS_BEFORE_YOURS} red attempts`,
                  }),
                )
                return { result: [], events }
              }
              yield* moveTask(transaction, task, 'done', at, { endedAt: at })
              events.push(taskEvent(rows, task, 'task.done', 'hemera', { result }))
              const followed = yield* follow(transaction, sessionId, at)
              return { result: followed.jobs, events: [...events, ...followed.events] }
            }),
          ),
        )
        yield* runJobs(sessionId, jobs)
        yield* told(sessionId)
        yield* wake(sessionId)
      })

    /** The first Hemera call after a delivery handed tasks starts them (D10-04, D10-10). */
    const start = (sessionId: string) =>
      Effect.gen(function* () {
        const before = yield* read(sessionId)
        const handed = (task: TaskRow) => stateOf(task) === 'ready' && task.handedAt !== null
        if (before === null || !before.tasks.some(handed)) return null
        const snapped = yield* snapshotsOf(before)
        const at = now()
        const refusal = yield* withDatabase(
          mutate('starting the tasks handed', (transaction) =>
            Effect.gen(function* () {
              const rows = yield* readBuild(transaction, sessionId)
              const starting = rows?.tasks.filter(handed) ?? []
              if (rows === null || starting.length === 0) return { result: null, events: [] }
              // The Spec is read in this very transaction: a Rework and the first task started are
              // serialised by it, and never both accepted on a stale state (D10-10).
              const spec = yield* specRow(transaction, rows.specId)
              const current =
                spec.currentRevisionId === rows.revisionId &&
                (spec.status === 'ready' || spec.status === 'in_progress')
              if (!current) {
                yield* movePhase(transaction, sessionId, 'stopped', { buildDetail: OBSOLETE })
                return {
                  result: OBSOLETE,
                  events: [buildEvent(rows, 'build.stopped', 'hemera', { reason: OBSOLETE })],
                }
              }
              const events: NewEvent[] = []
              if (spec.status === 'ready') {
                yield* transaction
                  .update(specs)
                  .set({ status: 'in_progress', updatedAt: at })
                  .where(eq(specs.id, spec.id))
                  .pipe(Effect.mapError(failed('moving the Spec in progress')))
                events.push({
                  ...buildEvent(rows, 'spec.in_progress', 'hemera'),
                  entityKind: 'spec',
                  entityId: spec.id,
                })
              }
              for (const task of starting) {
                const tries = attemptsOf(rows, task)
                // A try a blocker interrupted goes on where it stood, its snapshots kept.
                const interrupted = tries.findLast((attempt) => attempt.endedAt === null)
                const number = interrupted?.number ?? tries.length + 1
                if (interrupted === undefined) {
                  const opened = yield* openAttempt(transaction, {
                    sessionId,
                    scope: 'task',
                    buildTaskId: task.id,
                    storyId: null,
                    number,
                    at,
                    trees: snapped.trees,
                  })
                  yield* recordFailures(transaction, opened, snapped.failures, at)
                }
                yield* moveTask(transaction, task, 'in_progress', at, {
                  startedAt: task.startedAt ?? at,
                })
                events.push(taskEvent(rows, task, 'task.started', 'hemera', { attempt: number }))
              }
              return { result: null, events }
            }),
          ),
        )
        if (refusal !== null) yield* stopTurn(sessionId)
        yield* told(sessionId)
        return refusal
      })

    /** A Hemera call of this Session is over; whoever waits for the last one is told. */
    const leave = (sessionId: string) =>
      Effect.gen(function* () {
        const left = (running.get(sessionId) ?? 1) - 1
        if (left > 0) {
          running.set(sessionId, left)
          return
        }
        running.delete(sessionId)
        const waiting = over.get(sessionId)
        over.delete(sessionId)
        if (waiting !== undefined) yield* Deferred.succeed(waiting, undefined)
      })

    /** Waits for the Hemera calls of this Session running now to be over. */
    const idle = (sessionId: string) =>
      Effect.gen(function* () {
        if ((running.get(sessionId) ?? 0) === 0) return
        const waiting = over.get(sessionId) ?? Deferred.makeUnsafe<void>()
        over.set(sessionId, waiting)
        yield* Deferred.await(waiting)
      })

    const admitted = <A>(
      sessionId: string,
      tool: ToolName,
      run: Effect.Effect<A>,
      refuse: (reason: string) => Effect.Effect<A>,
    ): Effect.Effect<A> =>
      Effect.gen(function* () {
        // A Session that cannot be read is no Session to run a call for: refused, never taken
        // for one that is no build.
        const found = yield* database
          .select()
          .from(sessions)
          .where(eq(sessions.id, sessionId))
          .pipe(Effect.result)
        if (Result.isFailure(found)) {
          return yield* refuse(`the build could not be read: ${found.failure.message}`)
        }
        const row = found.success[0] ?? null
        if (row === null || row.mission !== 'build') return yield* run
        const phase = phaseOf(row)
        if (BUILD_TOOLS.includes(tool) && (phase === 'accepted' || phase === 'stopped')) {
          return yield* refuse(
            phase === 'accepted'
              ? 'the build was accepted: its tasks are settled'
              : `the build is stopped${row.buildDetail === null ? '' : `: ${row.buildDetail}`}`,
          )
        }
        // Read and counted in one step, with nothing yielded in between: a Pause either sees this
        // call running and waits for it, or this call sees the Pause and is refused (D10-09).
        if (row.buildPausedAt !== null || pausedNow.has(sessionId)) return yield* refuse(PAUSED)
        running.set(sessionId, (running.get(sessionId) ?? 0) + 1)
        return yield* Effect.gen(function* () {
          const refusal = yield* start(sessionId).pipe(
            Effect.catch((cause) =>
              diagnostic
                .write(`builds: starting the tasks of ${sessionId}: ${cause.message}`)
                .pipe(Effect.as(null)),
            ),
          )
          if (refusal !== null) return yield* refuse(refusal)
          return yield* run
        }).pipe(Effect.ensuring(leave(sessionId)))
      })

    /** Reads a task by the label the agent named, or answers why it cannot act on it. */
    const labelled = (rows: BuildRows, label: string) => {
      const named = label.trim().toUpperCase()
      const task = rows.tasks.find((one) => one.label === named)
      if (task === undefined) {
        const last = rows.tasks.at(-1)?.label
        return {
          task: null,
          refusal: `there is no task ${label} in this build${last === undefined ? '' : `: its tasks are T1 to ${last}`}`,
        }
      }
      return { task, refusal: null }
    }

    /** Why the agent cannot signal about a task, or null when it can. */
    const signalRefusal = (task: TaskRow) => {
      const state = stateOf(task)
      if (state === 'done') return `${task.label} is already done`
      if (state === 'checking') return `${task.label} is already being checked by Hemera`
      if (state === 'yours') return `${task.label} is the user's now: leave it to them`
      if (state === 'skipped') return `${task.label} was skipped by the user`
      if (state === 'blocked') return `${task.label} is blocked until the user decides`
      if (task.handedAt === null) {
        return `${task.label} was not handed to you: work only on the tasks Hemera hands you`
      }
      return null
    }

    const buildRead = (sessionId: string, call: Extract<BuildCall, { tool: 'build_read' }>) =>
      Effect.gen(function* () {
        const rows = yield* read(sessionId)
        if (rows === null) return refusedAnswer('this Session runs no build')
        const labels = taskLabels(rows.snapshot.tasks)
        let text: string
        let what: string
        if (call.arguments.task === undefined) {
          text = `${renderSpecMarkdown(rows.snapshot, labels)}\n\n${standing(rows)}`
          what = `the build of ${rows.snapshot.spec.key}`
        } else {
          const { task, refusal } = labelled(rows, call.arguments.task)
          if (task === null) return refusedAnswer(refusal)
          text = oneTask(rows, task)
          what = task.label
        }
        const { page, range } = pageOf(text, call.arguments.offset ?? 0)
        const more = range.truncated
          ? `(that is characters ${range.offset}-${range.end} of ${range.size}; the next page starts at offset ${range.end})`
          : `(that is characters ${range.offset}-${range.end} of ${range.size}, the end)`
        return completed(
          `read ${what} (characters ${range.offset}-${range.end} of ${range.size})`,
          [page, more, JSON.stringify(range)].join('\n'),
        )
      })

    /**
     * `task_finished` (D10-04, D10-05, D10-07): the end snapshots and the files the attempt
     * changed are recorded, the task goes `checking`, and the answer comes at once; its `task`
     * checks run in the background and decide.
     */
    const finish = (sessionId: string, call: Extract<BuildCall, { tool: 'task_finished' }>) =>
      Effect.gen(function* () {
        const rows = yield* read(sessionId)
        if (rows === null) return refusedAnswer('this Session runs no build')
        const { task, refusal } = labelled(rows, call.arguments.task)
        if (task === null) return refusedAnswer(refusal)
        const refused = signalRefusal(task)
        if (refused !== null) return refusedAnswer(refused)
        const attempt = attemptsOf(rows, task).findLast((one) => one.endedAt === null)
        if (attempt === undefined) return refusedAnswer(`${task.label} has not started`)
        const starts = rows.trees.filter((tree) => tree.attemptId === attempt.id)
        const { trees: ends, failures } = yield* snapshotsOf(rows)
        const files: {
          repository: string
          path: string
          status: string
          added: number | null
          removed: number | null
        }[] = []
        const repositories = yield* repositoriesOf(rows)
        for (const begun of starts) {
          const end = ends.find((one) => one.repository === begun.repository)
          // An end the snapshots did not take is already a failure of its own.
          if (end === undefined) continue
          const place = repositories.find((one) => one.repository === begun.repository)
          const changed =
            place === undefined
              ? Result.fail(`${placeWords(begun.repository)} is no longer in the Workspace`)
              : yield* Effect.result(
                  changedFiles(place.path, begun.startTree, end.tree).pipe(
                    Effect.provideService(Git, git),
                    Effect.mapError((cause) => cause.message),
                  ),
                )
          if (Result.isFailure(changed)) {
            failures.push({
              name: `Files changed in ${placeWords(begun.repository)}`,
              place: begun.repository,
              detail: `the files changed could not be read: ${changed.failure}`,
            })
            continue
          }
          for (const file of changed.success) {
            files.push({
              repository: begun.repository,
              path: file.path,
              status: file.status,
              added: file.added,
              removed: file.removed,
            })
          }
        }
        const at = now()
        const accepted = yield* withDatabase(
          mutate('recording a task finished', (transaction) =>
            Effect.gen(function* () {
              const fresh = yield* readBuild(transaction, sessionId)
              const current = fresh?.tasks.find((one) => one.id === task.id)
              if (fresh === null || current === undefined || stateOf(current) !== 'in_progress') {
                return { result: false, events: [] }
              }
              for (const end of ends) {
                yield* transaction
                  .update(buildAttemptTrees)
                  .set({ endTree: end.tree })
                  .where(
                    and(
                      eq(buildAttemptTrees.attemptId, attempt.id),
                      eq(buildAttemptTrees.repository, end.repository),
                    ),
                  )
                  .pipe(Effect.mapError(failed('recording the end snapshots')))
              }
              // Copied now, so the evidence outlives the trees Git may prune (D10-05).
              if (files.length > 0) {
                yield* transaction
                  .insert(buildAttemptFiles)
                  .values(files.map((file) => ({ attemptId: attempt.id, ...file })))
                  .pipe(Effect.mapError(failed('recording the files changed')))
              }
              yield* recordFailures(transaction, attempt.id, failures, at)
              // The try is over when the agent says so; the verdict gives it its result (D10-07).
              yield* transaction
                .update(buildAttempts)
                .set({ endedAt: at })
                .where(eq(buildAttempts.id, attempt.id))
                .pipe(Effect.mapError(failed('ending the try')))
              yield* moveTask(transaction, task, 'checking', at, { finishedAt: at })
              const summary = call.arguments.summary?.slice(0, 400) ?? null
              return {
                result: true,
                events: [
                  taskEvent(fresh, task, 'task.finished', 'agent', {
                    attempt: attempt.number,
                    summary,
                    files: files.length,
                  }),
                ],
              }
            }),
          ),
        )
        if (!accepted) return refusedAnswer(`${task.label} is no longer in progress`)
        yield* runJobs(sessionId, [{ attemptId: attempt.id, when: 'task' }])
        yield* told(sessionId)
        return completed(
          `${task.label} finished: Hemera is checking it`,
          `${task.label} is being checked by Hemera; carry on`,
        )
      })

    /**
     * `task_blocked` (D10-08): a blocker with the agent's reason; the task and the tasks waiting on
     * it are suspended, and the others go on.
     */
    const block = (sessionId: string, call: Extract<BuildCall, { tool: 'task_blocked' }>) =>
      Effect.gen(function* () {
        const rows = yield* read(sessionId)
        if (rows === null) return refusedAnswer('this Session runs no build')
        const { task, refusal } = labelled(rows, call.arguments.task)
        if (task === null) return refusedAnswer(refusal)
        const refused = signalRefusal(task)
        if (refused !== null) return refusedAnswer(refused)
        const at = now()
        const held = yield* withDatabase(
          mutate('recording a blocker', (transaction) =>
            Effect.gen(function* () {
              const fresh = yield* readBuild(transaction, sessionId)
              const subject = fresh?.tasks.find((one) => one.id === task.id)
              if (fresh === null || subject === undefined || signalRefusal(subject) !== null) {
                return { result: null, events: [] }
              }
              const blockerId = crypto.randomUUID()
              yield* transaction
                .insert(buildBlockers)
                .values({
                  id: blockerId,
                  sessionId,
                  buildTaskId: task.id,
                  reason: call.arguments.reason,
                  raisedAt: at,
                })
                .pipe(Effect.mapError(failed('writing the blocker')))
              // The try running on it is interrupted, not ended: a dismissed blocker hands the task
              // back to it, and costs no try (D10-08).
              yield* moveTask(transaction, task, 'blocked', at)
              const events = [
                taskEvent(fresh, task, 'task.blocked', 'agent', { reason: call.arguments.reason }),
              ]
              const waiting = dependantsOf(task.taskId, fresh.snapshot.dependencies).flatMap(
                (taskId) =>
                  fresh.tasks.filter((one) => one.taskId === taskId && stateOf(one) === 'waiting'),
              )
              for (const dependant of waiting) {
                yield* moveTask(transaction, dependant, 'blocked', at)
                events.push(
                  taskEvent(fresh, dependant, 'task.blocked', 'hemera', { because: task.label }),
                )
              }
              return { result: waiting.map((one) => one.label), events }
            }),
          ),
        )
        if (held === null) return refusedAnswer(`${task.label} can no longer be blocked`)
        yield* told(sessionId)
        const along = held.length === 0 ? '' : `, and ${held.join(', ')} with it`
        return completed(
          `${task.label} is blocked${along}: the user decides`,
          `${task.label} is blocked${along}: the user decides. Carry on with the other tasks.`,
        )
      })

    /** The use case of one build tool. */
    const used = (sessionId: string, call: BuildCall) => {
      switch (call.tool) {
        case 'build_read':
          return buildRead(sessionId, call)
        case 'task_finished':
          return finish(sessionId, call)
        case 'task_blocked':
          return block(sessionId, call)
      }
    }

    const tool = (sessionId: string, call: BuildCall): Effect.Effect<BuildAnswer> =>
      used(sessionId, call).pipe(
        Effect.catch((cause) =>
          Effect.succeed({
            ok: false,
            summary: 'the build could not be read',
            text: cause.message,
            paths: [],
          } satisfies BuildAnswer),
        ),
      )

    /** The rows of a build a user acts on, refused when it is closed. */
    const open = (sessionId: string) =>
      must(sessionId).pipe(Effect.flatMap((rows) => stillOpen(rows)))

    const view = (sessionId: string) => must(sessionId).pipe(Effect.map(viewOf))

    /** A change the user made, written with its line, then what follows it started. */
    const acted = (
      sessionId: string,
      doing: string,
      body: (
        transaction: EngineTransaction,
        rows: BuildRows,
        at: string,
      ) => Effect.Effect<
        { events: NewEvent[]; follows: boolean; jobs?: readonly CheckJob[] },
        BuildRefusal
      >,
    ) =>
      Effect.gen(function* () {
        const at = now()
        const jobs = yield* withDatabase(
          mutate(doing, (transaction) =>
            Effect.gen(function* () {
              const fresh = yield* readBuild(transaction, sessionId)
              if (fresh === null)
                return yield* Effect.fail(new UnknownBuildError({ id: sessionId }))
              // Read again where the change is written: a build closed since the user asked is
              // refused, never closed or moved twice.
              const rows = yield* stillOpen(fresh)
              const done = yield* body(transaction, rows, at)
              const asked = done.jobs ?? []
              if (!done.follows) return { result: asked, events: done.events }
              const followed = yield* follow(transaction, sessionId, at)
              return {
                result: [...asked, ...followed.jobs],
                events: [...done.events, ...followed.events],
              }
            }),
          ),
        )
        yield* runJobs(sessionId, jobs)
        yield* told(sessionId)
        yield* wake(sessionId)
        return yield* view(sessionId)
      })

    /** The build task a user's action names, and the Session it belongs to. */
    const taskNamed = (buildTaskId: string) =>
      withDatabase(
        reading('reading the task', (transaction) =>
          transaction
            .select({ sessionId: buildTasks.sessionId })
            .from(buildTasks)
            .where(eq(buildTasks.id, buildTaskId))
            .pipe(Effect.mapError(failed('reading the task'))),
        ),
      ).pipe(
        Effect.flatMap((found) =>
          found[0] === undefined
            ? Effect.fail(new UnknownBuildError({ id: buildTaskId }))
            : Effect.succeed(found[0].sessionId),
        ),
      )

    /** A task of the rows, which must be waiting for the user. */
    const yoursIn = (rows: BuildRows, buildTaskId: string) => {
      const task = rows.tasks.find((one) => one.id === buildTaskId)
      if (task === undefined) return Effect.fail(new UnknownBuildError({ id: buildTaskId }))
      if (stateOf(task) !== 'yours') {
        return Effect.fail(
          new BuildRefusedError({ reason: `${task.label} is not waiting for you.` }),
        )
      }
      return Effect.succeed(task)
    }

    /**
     * New attempts at the story and end checks that wait for the user: Resume tries again (D10-07).
     */
    const retried = (transaction: EngineTransaction, rows: BuildRows, at: string) =>
      Effect.gen(function* () {
        const jobs: CheckJob[] = []
        const lasts = new Map<string, AttemptRow>()
        for (const attempt of rows.attempts.filter((one) => one.scope !== 'task')) {
          const key = `${attempt.scope}:${attempt.storyId ?? ''}`
          const known = lasts.get(key)
          if (known === undefined || attempt.number > known.number) lasts.set(key, attempt)
        }
        for (const attempt of lasts.values()) {
          if (!waitsForUser(attempt)) continue
          jobs.push(yield* again(transaction, attempt, at))
        }
        return jobs
      })

    /** A new attempt on the same subject as one that was red, and its checks to run. */
    const again = (transaction: EngineTransaction, attempt: AttemptRow, at: string) =>
      Effect.gen(function* () {
        const attemptId = yield* openAttempt(transaction, {
          sessionId: attempt.sessionId,
          scope: scopeOf(attempt),
          buildTaskId: null,
          storyId: attempt.storyId,
          number: attempt.number + 1,
          at,
          trees: [],
        })
        const job: CheckJob = { attemptId, when: WHEN[scopeOf(attempt)] }
        return job
      })

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
          const spec = yield* database
            .select({ currentRevisionId: specs.currentRevisionId })
            .from(specs)
            .where(eq(specs.id, specId))
            .pipe(Effect.mapError(failed('reading the Spec')))
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
          for (const build of builds) {
            const phase = phaseOf(build)
            const obsolete =
              phase !== null &&
              ACTIVE.includes(phase) &&
              build.revisionId !== (spec[0]?.currentRevisionId ?? build.revisionId)
            if (!obsolete) continue
            // A build whose revision the Spec left can never begin (D10-04): stopped, it frees the
            // slot, and it stays readable.
            yield* withDatabase(
              mutate('stopping an obsolete build', (transaction) =>
                Effect.gen(function* () {
                  const rows = yield* readBuild(transaction, build.id)
                  yield* movePhase(transaction, build.id, 'stopped', { buildDetail: OBSOLETE })
                  return {
                    result: undefined,
                    events:
                      rows === null
                        ? []
                        : [buildEvent(rows, 'build.stopped', 'hemera', { reason: OBSOLETE })],
                  }
                }),
              ),
            )
            yield* stopTurn(build.id)
            yield* told(build.id)
          }
          return yield* slotHolder(database, specId)
        }),

      wake,

      drivenBy: (driven) => {
        agent = driven
      },

      checking: (sessionId) => checkingNow.has(sessionId),

      waiting: (sessionId, holdsNone) =>
        read(sessionId).pipe(
          Effect.map((rows) =>
            rows === null ? null : deliveryFor(rows, holdsNone || resumeDue.has(sessionId)),
          ),
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
        ).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (delivery.kind === 'resume' || delivery.kind === 'prepare') {
                resumeDue.delete(delivery.sessionId)
              }
            }),
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
            // The approach note is the agent's answer to the `prepare` brief (D10-02): what it said
            // in that turn. An empty answer leaves the build in `prepare`, and Resume asks again.
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
              const jobs = yield* withDatabase(
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
              yield* runJobs(sessionId, jobs)
              yield* told(sessionId)
              yield* wake(sessionId)
            }
          }
          if (delivery.phase === 'verify') {
            // The turn that handed the `verify` brief is over: the end checks run now, once
            // (D10-07), and Accept waits for them.
            const at = now()
            const started = yield* withDatabase(
              mutate('running the end checks', (transaction) =>
                Effect.gen(function* () {
                  const rows = yield* readBuild(transaction, sessionId)
                  if (rows === null || rows.phase !== 'verify') return { result: [], events: [] }
                  if (rows.attempts.some((attempt) => attempt.scope === 'build')) {
                    return { result: [], events: [] }
                  }
                  const attemptId = yield* openAttempt(transaction, {
                    sessionId,
                    scope: 'build',
                    buildTaskId: null,
                    storyId: null,
                    number: 1,
                    at,
                    trees: [],
                  })
                  const job: CheckJob = { attemptId, when: 'end' }
                  return { result: [job], events: [] }
                }),
              ),
            )
            yield* runJobs(sessionId, started)
            yield* told(sessionId)
          }
          if (delivery.retold.length === 0) return
          // The turn that carried a story's or the end checks' failures is over: they run again
          // (D10-07), each as a new attempt, unless a later one already runs.
          const at = now()
          const jobs = yield* withDatabase(
            mutate('checking the failures again', (transaction) =>
              Effect.gen(function* () {
                const rows = yield* readBuild(transaction, sessionId)
                if (rows === null || rows.phase === null || !ACTIVE.includes(rows.phase)) {
                  return { result: [], events: [] }
                }
                if (rows.session.buildPausedAt !== null) return { result: [], events: [] }
                const asked: CheckJob[] = []
                for (const attemptId of delivery.retold) {
                  const attempt = rows.attempts.find((one) => one.id === attemptId)
                  if (attempt === undefined || resultOf(attempt) !== 'red') continue
                  if (attemptsOn(rows, attempt).at(-1)?.id !== attempt.id) continue
                  asked.push(yield* again(transaction, attempt, at))
                }
                return { result: asked, events: [] }
              }),
            ),
          )
          yield* runJobs(sessionId, jobs)
          yield* told(sessionId)
        }),

      admitted,
      tool,
      view,

      pause: (sessionId) =>
        Effect.gen(function* () {
          const rows = yield* open(sessionId)
          if (rows.session.buildPausedAt === null) {
            pausedNow.add(sessionId)
            const at = now()
            yield* withDatabase(
              mutate('pausing the build', (transaction) =>
                transaction
                  .update(sessions)
                  .set({ buildPausedAt: at })
                  .where(eq(sessions.id, sessionId))
                  .pipe(
                    Effect.mapError(failed('pausing the build')),
                    Effect.as({
                      result: undefined,
                      events: [buildEvent(rows, 'build.paused', 'human')],
                    }),
                  ),
              ),
            )
            // The call running now ends as it would have; then the turn stops, unless the build
            // was resumed meanwhile — the turn going then is the resumed one (D10-09).
            yield* Effect.forkIn(scope)(
              idle(sessionId).pipe(
                Effect.andThen(
                  Effect.suspend(() =>
                    pausedNow.has(sessionId) ? stopTurn(sessionId) : Effect.void,
                  ),
                ),
              ),
            )
            yield* told(sessionId)
          }
          return yield* view(sessionId)
        }),

      resume: (sessionId) =>
        Effect.gen(function* () {
          yield* open(sessionId)
          pausedNow.delete(sessionId)
          resumeDue.add(sessionId)
          return yield* acted(sessionId, 'resuming the build', (transaction, rows, at) =>
            Effect.gen(function* () {
              yield* transaction
                .update(sessions)
                .set({ buildPausedAt: null })
                .where(eq(sessions.id, sessionId))
                .pipe(Effect.mapError(failed('resuming the build')))
              return {
                events: [buildEvent(rows, 'build.resumed', 'human')],
                follows: false,
                jobs: yield* retried(transaction, rows, at),
              }
            }),
          )
        }),

      accept: (sessionId) =>
        Effect.gen(function* () {
          yield* open(sessionId)
          return yield* acted(sessionId, 'accepting the build', (transaction, rows) =>
            Effect.gen(function* () {
              const refusal = acceptRefusal(rows)
              if (refusal !== null) {
                return yield* Effect.fail(new BuildRefusedError({ reason: refusal }))
              }
              // The Spec stays in progress, and nothing touches the branch or the files: delivery
              // is a later lot's (D10-11).
              yield* movePhase(transaction, sessionId, 'accepted')
              return { events: [buildEvent(rows, 'build.accepted', 'human')], follows: false }
            }),
          ).pipe(Effect.tap(() => stopChecks(sessionId)))
        }),

      stop: (sessionId) =>
        Effect.gen(function* () {
          yield* open(sessionId)
          const stopped = yield* acted(sessionId, 'stopping the build', (transaction, rows) =>
            movePhase(transaction, sessionId, 'stopped', { buildDetail: STOPPED }).pipe(
              Effect.as({
                events: [buildEvent(rows, 'build.stopped', 'human', { reason: STOPPED })],
                follows: false,
              }),
            ),
          )
          yield* stopChecks(sessionId)
          yield* stopTurn(sessionId)
          return stopped
        }),

      taskDone: (buildTaskId) =>
        Effect.gen(function* () {
          const sessionId = yield* taskNamed(buildTaskId)
          yield* open(sessionId)
          return yield* acted(sessionId, 'marking a task done', (transaction, rows, at) =>
            Effect.gen(function* () {
              const task = yield* yoursIn(rows, buildTaskId)
              yield* moveTask(transaction, task, 'done', at, { endedAt: at })
              return { events: [taskEvent(rows, task, 'task.done', 'human')], follows: true }
            }),
          )
        }),

      taskSkip: (buildTaskId, reason, unblocks) =>
        Effect.gen(function* () {
          const why = reason.trim()
          if (why === '') {
            return yield* Effect.fail(
              new BuildRefusedError({ reason: 'Say why the task is skipped.' }),
            )
          }
          const sessionId = yield* taskNamed(buildTaskId)
          yield* open(sessionId)
          return yield* acted(sessionId, 'skipping a task', (transaction, rows, at) =>
            Effect.gen(function* () {
              const task = yield* yoursIn(rows, buildTaskId)
              const skip = (one: TaskRow, because: string, lets: boolean) =>
                transaction
                  .update(buildTasks)
                  .set({
                    state: 'skipped',
                    skipReason: because,
                    skipUnblocks: lets,
                    endedAt: at,
                    updatedAt: at,
                  })
                  .where(eq(buildTasks.id, one.id))
                  .pipe(Effect.mapError(failed('skipping the task')))
              yield* skip(task, why, unblocks)
              const events: NewEvent[] = [
                taskEvent(rows, task, 'task.skipped', 'human', { reason: why, unblocks }),
              ]
              if (!unblocks) {
                // The user did not let its dependants go on: nothing is left for them to wait on,
                // so they are skipped with it, each saying which of its dependencies was, and the
                // build can still reach `verify` (D10-03).
                const { dependencies } = rows.snapshot
                const skipped = new Map([[task.taskId, task.label]])
                for (const taskId of dependantsOf(task.taskId, dependencies)) {
                  const dependant = rows.tasks.find((one) => one.taskId === taskId)
                  if (dependant === undefined) continue
                  const state = stateOf(dependant)
                  if (state === 'done' || state === 'skipped') continue
                  const cause = dependencies.find(
                    (dependency) =>
                      dependency.taskId === taskId && skipped.has(dependency.dependsOnId),
                  )
                  const label = skipped.get(cause?.dependsOnId ?? '') ?? task.label
                  const because = `${label}, which it depends on, was skipped`
                  yield* skip(dependant, because, false)
                  skipped.set(taskId, dependant.label)
                  events.push(
                    taskEvent(rows, dependant, 'task.skipped', 'hemera', {
                      reason: because,
                      unblocks: false,
                    }),
                  )
                }
              }
              return { events, follows: true }
            }),
          )
        }),

      dismissBlocker: (blockerId) =>
        Effect.gen(function* () {
          const found = yield* database
            .select({ sessionId: buildBlockers.sessionId })
            .from(buildBlockers)
            .where(eq(buildBlockers.id, blockerId))
            .pipe(Effect.mapError(failed('reading the blocker')))
          const sessionId = found[0]?.sessionId
          if (sessionId === undefined) {
            return yield* Effect.fail(new UnknownBuildError({ id: blockerId }))
          }
          yield* open(sessionId)
          return yield* acted(sessionId, 'dismissing a blocker', (transaction, rows, at) =>
            Effect.gen(function* () {
              const blocker = rows.blockers.find((one) => one.id === blockerId)
              const task = rows.tasks.find((one) => one.id === blocker?.buildTaskId)
              if (blocker === undefined || task === undefined || blocker.dismissedAt !== null) {
                return yield* Effect.fail(
                  new BuildRefusedError({ reason: 'This blocker was already dismissed.' }),
                )
              }
              yield* transaction
                .update(buildBlockers)
                .set({ dismissedAt: at })
                .where(eq(buildBlockers.id, blockerId))
                .pipe(Effect.mapError(failed('dismissing the blocker')))
              // The task is ready again and handed again, with the dismissal (D10-08).
              yield* moveTask(transaction, task, 'ready', at, { handedAt: null })
              const events: NewEvent[] = [taskEvent(rows, task, 'task.ready', 'human')]
              const { dependencies } = rows.snapshot
              const stillHeld = new Set(
                rows.blockers
                  .filter((one) => one.id !== blockerId && one.dismissedAt === null)
                  .flatMap((one) => {
                    const held = rows.tasks.find((other) => other.id === one.buildTaskId)
                    return held === undefined
                      ? []
                      : [held.taskId].concat(dependantsOf(held.taskId, dependencies))
                  }),
              )
              for (const taskId of dependantsOf(task.taskId, dependencies)) {
                const dependant = rows.tasks.find((one) => one.taskId === taskId)
                if (dependant === undefined || stateOf(dependant) !== 'blocked') continue
                if (stillHeld.has(taskId)) continue
                yield* moveTask(transaction, dependant, 'waiting', at)
              }
              return { events, follows: true }
            }),
          )
        }),

      recover: () =>
        Effect.gen(function* () {
          const active = yield* database
            .select({ id: sessions.id, pausedAt: sessions.buildPausedAt })
            .from(sessions)
            .where(and(eq(sessions.mission, 'build'), inArray(sessions.buildPhase, [...ACTIVE])))
            .pipe(Effect.mapError(failed('reading the builds a stopped engine left')))
          for (const build of active) {
            const rows = yield* read(build.id)
            if (rows === null) continue
            // The checks a stopped engine left running never said anything: what they wrote is
            // dropped, and they run again (D10-09).
            const left = rows.attempts.filter((attempt) => {
              if (attempt.result !== null) return false
              // A story's or the build's try runs its checks until it ends; a task's is being
              // checked once it ended, while its task is.
              if (attempt.scope !== 'task') return attempt.endedAt === null
              const task = rows.tasks.find((one) => one.id === attempt.buildTaskId)
              return attempt.endedAt !== null && task !== undefined && stateOf(task) === 'checking'
            })
            if (left.length > 0) {
              yield* withDatabase(
                mutate('dropping the checks a stopped engine left', (transaction) =>
                  transaction
                    .delete(buildCheckResults)
                    // A failure Hemera wrote on the try is kept: it is evidence, not a check.
                    .where(
                      and(
                        inArray(
                          buildCheckResults.attemptId,
                          left.map((attempt) => attempt.id),
                        ),
                        or(
                          isNotNull(buildCheckResults.checkId),
                          isNotNull(buildCheckResults.runId),
                        ),
                      ),
                    )
                    .pipe(
                      Effect.mapError(failed('dropping the checks a stopped engine left')),
                      Effect.as({ result: undefined, events: [] }),
                    ),
                ),
              )
            }
            yield* runJobs(
              build.id,
              left.map((attempt) => ({ attemptId: attempt.id, when: WHEN[scopeOf(attempt)] })),
            )
            if (build.pausedAt !== null) continue
            resumeDue.add(build.id)
            yield* wake(build.id)
          }
        }),
    }
    return service
  }),
)

/** What the engine does once at its start, after the launches came back (D10-09). */
export const recoveredBuilds = Effect.gen(function* () {
  yield* (yield* Builds).recover()
})
