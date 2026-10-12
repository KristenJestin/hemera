/**
 * Attempts, attribution and the verdict loop (#142), the Builder's parts that act on them.
 *
 * - **Attribution (CT-02).** A file tool write is attributed, in the transaction of its outcome, to
 *   the task its session runs (the one whose targets hold the file, else its first). A writing
 *   command takes its repository's write lock (its globs' paths when it declares some), and the
 *   snapshots before and after it say what it changed: its task's, a conflict on any file another
 *   running task holds. A finished attempt's files are the union of what was written under its
 *   name; a file that changed in its interval with no author is the Building's.
 * - **The loop.** A red verdict opens a new attempt for whoever made the red one (its parent when
 *   that runner has ended) and hands it the check, the place and the end of the output. The third
 *   red on a task, or on a requirement's or the end's checks, becomes an error need; its runner is
 *   asked to fill what is proposed with `need_propose`.
 * - **A restart (CT-09).** A file write found done is attributed; a command cut in the middle is
 *   indeterminate: its runner is told to check the real state, or, on an exclusive resource, the
 *   user is asked whether it ran. Nothing is run again.
 * - **Commits.** With the mission's copy saying one commit per task, a done task's own files are
 *   committed with the user's identity, as an action with its intent and outcome.
 */

import { realpathSync } from 'node:fs'
import { posix } from 'node:path'

import {
  type AttemptResult,
  type AttemptScope,
  DecisionFields,
  ErrorFields,
  MissionOwner,
  REDS_BEFORE_A_NEED,
  type ToolArguments,
  missionKey,
  outputTail,
  placeWords,
} from '@hemera/core/domain'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { Deferred, Effect, Exit, Option, Predicate, Result, Schema, Semaphore } from 'effect'

import { getCommand } from '../catalogue.ts'
import { getProject } from '../projects.ts'
import type { DomainEvents } from '../domain-events.ts'
import type { NewEvent } from '../journal.ts'
import { type NeedService, createNeedIn, getNeed, reviseNeedIn } from '../needs.ts'
import { Git } from '../git.ts'
import { resourcesOf } from '../resources/declarations.ts'
import { Secrets } from '../secrets.ts'
import { SessionPost } from '../sessions/post.ts'
import { assignWorkIn } from '../sessions/leases.ts'
import { type RoleSession, getSession, sessionsIn, sessionsOfLineage } from '../sessions/store.ts'
import {
  Database,
  type DatabaseError,
  type EngineTransaction,
  refusedWhile,
} from '../storage/database.ts'
import {
  agentSessions,
  buildingAttempts,
  buildingClaims,
  buildingConflicts,
  buildingDecisions,
  effectfulActions,
  missions,
} from '../storage/schema.ts'
import { type EffectfulAction, actionDone, actionFailed, beginAction } from '../tools/actions.ts'
import type { Grant } from '../tools/access.ts'
import { answered, refusal } from '../tools/files.ts'
import type { CommandAsked, CommandWatch, WritingFile, WrittenFile } from '../tools/ports.ts'
import { mutate } from '../transaction.ts'
import {
  attributedIn,
  checkResultsIn,
  recordUnattributedIn,
  recordWriteIn,
  writesIn,
} from './attempts.ts'
import { TaskChecks, checkAttempt } from './checks.ts'
import { type WriteInProgress, type WriteLock, type WriteLocks, waitingSaid } from './locks.ts'
import { type ChangedFile, Snapshots } from './snapshots.ts'
import {
  type AttemptFile,
  type BuildingBase,
  type BuildingRow,
  NeedCause,
  type TaskNow,
  activeBuildingIn,
  attemptFiles,
  attemptsIn,
  bases,
  blockIn,
  buildingEvent,
  claimsIn,
  decisionOfNeedIn,
  moveIn,
  now,
  openAttemptIn,
  runnerSessionIn,
  settleIn,
  tasksIn,
  workItemOf,
  writeStrings,
  writeTrees,
} from './tasks.ts'
import { commitRuleOf, validationSettingsOf } from './validation.ts'

type Reader = EngineTransaction | Database['Service']

/** How long a wait for a write lock lasts before the Journal says so. */
const LONG_WAIT_MS = 60_000

const LIVE = ['starting', 'working', 'idle', 'stuck'] as const

/** What the loop is handed by the Builder that runs it. */
export interface LoopParts {
  readonly needs: NeedService
  readonly locks: WriteLocks
  readonly said: (line: string) => Effect.Effect<void>
  readonly hold: (at: 'starting' | 'finishing' | 'judging' | 'locked') => Effect.Effect<void>
  /** A delivery to a lineage of the mission, or to its Builder. */
  readonly deliver: (
    building: BuildingRow,
    target: { readonly lineage: string } | { readonly role: string },
    kind: string,
    body: string,
  ) => Effect.Effect<void, DatabaseError>
}

const basesOf = (building: BuildingRow): ReadonlyArray<BuildingBase> =>
  Option.getOrElse(bases.read(building.bases), () => [])

const placeOfBase = (base: BuildingBase) => ({ name: base.repository, folder: base.folder })

/** A folder as the file tools resolve paths: its real path, or as written when it is gone. */
const realFolder = (folder: string): string => {
  try {
    return realpathSync.native(folder)
  } catch {
    return folder
  }
}

/**
 * A path of a repository of the Workspace, or null when it is in none. Both sides are real paths;
 * on Windows the case of their letters does not tell two paths apart.
 */
export const inRepository = (
  repositories: ReadonlyArray<{ readonly repository: string; readonly folder: string }>,
  resolved: string,
  platform: NodeJS.Platform = process.platform,
): { readonly repository: string; readonly path: string } | null => {
  const separator = platform === 'win32' ? '\\' : '/'
  const folded = (path: string) => (platform === 'win32' ? path.toLowerCase() : path)
  const at = folded(resolved)
  const found = repositories
    .toSorted((a, b) => b.folder.length - a.folder.length)
    .find((one) => at.startsWith(`${folded(one.folder)}${separator}`))
  return found === undefined
    ? null
    : {
        repository: found.repository,
        path: resolved
          .slice(found.folder.length + 1)
          .split(separator)
          .join('/'),
      }
}

/** A resolved path in a repository of the Building, or null. */
export const fileOf = (building: BuildingRow, resolved: string) =>
  inRepository(
    basesOf(building).map((base) => ({
      repository: base.repository,
      folder: realFolder(base.folder),
    })),
    resolved,
  )

/** The tasks a lineage runs now, in the plan's order. */
export const runningOf = (tasks: ReadonlyArray<TaskNow>, lineage: string) =>
  tasks.filter((task) => task.state === 'in_progress' && task.runner === lineage)

/** The task a write belongs to: the one whose targets hold the file, else the first. */
const taskOfFile = (
  running: ReadonlyArray<TaskNow>,
  file: { readonly repository: string; readonly path: string },
) =>
  running.find((task) =>
    task.targets.some((one) => one.repository === file.repository && one.path === file.path),
  ) ??
  running[0] ??
  null

const lineageIn = (reader: Reader, sessionId: string) =>
  Effect.map(
    reader
      .select({ lineage: agentSessions.lineage })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .pipe(Effect.mapError(refusedWhile('reading a session'))),
    ([row]) => row?.lineage ?? null,
  )

const listed = (ids: ReadonlyArray<string>): string =>
  ids.length <= 1 ? (ids[0] ?? '') : `${ids.slice(0, -1).join(', ')} and ${ids.at(-1) ?? ''}`

const ActionDetails = Schema.Struct({
  path: Schema.optionalKey(Schema.String),
  after: Schema.optionalKey(Schema.String),
  sessionId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  command: Schema.optionalKey(Schema.NullOr(Schema.String)),
  line: Schema.optionalKey(Schema.String),
  claim: Schema.optionalKey(Schema.String),
  // A command's snapshots before it, kept for a restart (#142); `before` is a file write's.
  trees: Schema.optionalKey(
    Schema.Array(Schema.Struct({ repository: Schema.String, tree: Schema.String })),
  ),
  globs: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
})
const readDetails = Schema.decodeUnknownOption(Schema.fromJsonString(ActionDetails))
const readParsed = Schema.decodeUnknownOption(ActionDetails)

export const buildingLoop = (parts: LoopParts) => {
  const { locks, said, hold, deliver } = parts

  /** The session a lineage acts through now: its live one, or its parent's when it has ended. */
  const runnerNow = (
    lineage: string,
  ): Effect.Effect<
    { readonly lineage: string; readonly session: RoleSession | null },
    unknown,
    Database
  > =>
    Effect.gen(function* () {
      const sessions = yield* sessionsOfLineage(lineage)
      const live = sessions.findLast((one) => LIVE.some((state) => state === one.state))
      if (live !== undefined) return { lineage, session: live }
      const last = sessions.at(-1)
      // An ended runner hands its task to its parent; a failed or replaced one is resumed.
      if (last?.state === 'ended' && last.parent !== null) return yield* runnerNow(last.parent)
      return { lineage, session: null }
    })

  /** The mission's Builder's lineage, or null when it has none live. */
  const builderLineage = (missionId: string) =>
    Effect.map(
      sessionsIn([...LIVE], { kind: 'mission', missionId }),
      (live) => live.find((one) => one.role === 'builder')?.lineage ?? null,
    )

  const waitingFor = (building: BuildingRow, sessionId: string, started: number, lock: WriteLock) =>
    Effect.gen(function* () {
      if (Date.now() - started < LONG_WAIT_MS) return
      yield* mutate('saying a write waited', () =>
        Effect.succeed({
          result: undefined,
          events: [
            buildingEvent(building.missionId, 'building.write_waiting', {
              command: lock.command,
              task: lock.taskId,
              repository: lock.repository,
              seconds: Math.round((Date.now() - started) / 1000),
              sessionId,
            }),
          ],
        }),
      )
    })

  /** A wait for a write lock, counted as a running command for the stuck rule. */
  const counted = <A, E, R>(sessionId: string, wait: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const post = yield* SessionPost
      yield* post.lockWait(sessionId, true)
      return yield* wait.pipe(Effect.ensuring(post.lockWait(sessionId, false)))
    })

  // ---- Attribution.

  /** A file tool write attributed to its task, in the transaction of its outcome. */
  const written = (file: WrittenFile) => (transaction: EngineTransaction) =>
    Effect.gen(function* () {
      const building = yield* activeBuildingIn(transaction, file.missionId)
      if (building === null) return
      const located = fileOf(building, file.path)
      if (located === null) return
      const lineage = yield* lineageIn(transaction, file.sessionId)
      if (lineage === null) return
      const task = taskOfFile(runningOf(yield* tasksIn(transaction, building.id), lineage), located)
      if (task === null) return
      const attempt = yield* openAttemptIn(transaction, building.id, task.id)
      if (attempt === null) return
      yield* recordWriteIn(transaction, {
        buildingId: building.id,
        attemptId: attempt.id,
        taskId: task.id,
        sessionId: file.sessionId,
        repository: located.repository,
        path: located.path,
        kind: 'file_tool',
        runId: null,
        actionId: file.actionId,
        fingerprint: file.fingerprint,
      })
    })

  /**
   * A file tool write where another task's command holds the write lock waits until it ends; the
   * session is told what it waited for. Null when nothing held it.
   */
  const waitForLock = (
    building: BuildingRow,
    sessionId: string,
    lineage: string,
    tasks: ReadonlyArray<TaskNow>,
    file: { readonly repository: string; readonly path: string },
  ) =>
    Effect.gen(function* () {
      const mine = runningOf(tasks, lineage).map((task) => task.id)
      if (locks.heldFile(building.id, mine, file) === null) return null
      const started = Date.now()
      const lock = yield* counted(sessionId, locks.waitForFile(building.id, mine, file))
      if (lock === null) return null
      yield* waitingFor(building, sessionId, started, lock)
      return { note: waitingSaid(lock) }
    })

  /** The repositories of the Building a command writes in: its own, else every one. */
  const repositoriesOf = (building: BuildingRow, asked: CommandAsked) =>
    Effect.gen(function* () {
      const all = basesOf(building)
      let named: string | null = asked.folder
      if (asked.command !== null && asked.command.repositoryId !== null) {
        const project = yield* getProject(asked.command.projectId)
        named =
          project.repositories.find((one) => one.id === asked.command?.repositoryId)?.path ?? null
      }
      const found =
        named === null
          ? undefined
          : all
              .toSorted((a, b) => b.repository.length - a.repository.length)
              .find(
                (one) =>
                  one.repository !== '' &&
                  (named === one.repository || named?.startsWith(`${one.repository}/`) === true),
              )
      return found === undefined ? all : [found]
    })

  /**
   * A writing command of a mission's session, watched: nothing is held until its launch, which
   * takes its lock and the snapshots before it; its finish attributes and lets the lock go.
   */
  const command = (asked: CommandAsked) =>
    Effect.gen(function* () {
      // A command that writes nothing takes no lock and gets no snapshot pair; nor does a
      // service, which runs until it is stopped and would hold its repository all that time.
      if (asked.command?.readOnly === true || asked.command?.type === 'serve') return null
      const database = yield* Database
      const building = yield* activeBuildingIn(database, asked.missionId)
      if (building === null) return null
      const session = yield* getSession(asked.sessionId)
      const task = runningOf(yield* tasksIn(database, building.id), session.lineage)[0] ?? null
      const repositories = yield* repositoriesOf(building, asked)
      const prefix = asked.command?.folder == null ? '' : `${asked.command.folder}/`
      const globs =
        asked.command === null || asked.command.writeGlobs.length === 0
          ? null
          : asked.command.writeGlobs.map((glob) => posix.normalize(`${prefix}${glob}`))
      const name = asked.command?.name ?? asked.line
      const watchId = crypto.randomUUID()
      const context = yield* Effect.context<
        Database | DomainEvents | Secrets | Snapshots | SessionPost
      >()
      // One at a time: the launch's snapshots and the finish never cross.
      const turn = yield* Semaphore.make(1)
      const done = yield* Deferred.make<void>()
      const taken: WriteLock[] = []
      let waited: WriteLock | null = null
      let before: ReadonlyArray<{ readonly base: BuildingBase; readonly tree: string }> | null =
        null
      let closed = false
      const letGo = Effect.suspend(() => locks.release(taken.splice(0)))
      const launch = Effect.gen(function* () {
        if (closed) return
        const started = Date.now()
        waited = yield* counted(
          session.id,
          locks.take(
            building.id,
            task?.id ?? null,
            name,
            repositories.map((one) => one.repository),
            globs,
            taken,
          ),
        )
        if (waited !== null) {
          yield* waitingFor(building, session.id, started, waited).pipe(
            Effect.catch((refused) => said(`a long wait was not said: ${refused.message}`)),
          )
        }
        yield* hold('locked')
        yield* Semaphore.withPermits(
          turn,
          1,
        )(
          Effect.gen(function* () {
            if (closed) return yield* letGo
            const snapshots = yield* Snapshots
            const trees = yield* Effect.result(
              Effect.forEach(repositories, (base) =>
                Effect.map(
                  snapshots.take(placeOfBase(base), {
                    kind: 'run',
                    missionId: building.missionId,
                    runId: watchId,
                    side: 'before',
                  }),
                  (tree) => ({ base, tree }),
                ),
              ),
            )
            if (Result.isFailure(trees)) {
              yield* snapshots.failed(building.missionId, trees.failure)
              closed = true
              return yield* letGo
            }
            before = trees.success
          }),
        )
      }).pipe(
        // Interrupted or dead before it was watching: nothing of the lock stays.
        Effect.onExit((exit) =>
          Exit.isSuccess(exit)
            ? Effect.void
            : Effect.suspend(() => {
                closed = true
                return letGo
              }),
        ),
        Effect.provide(context),
      )
      const finish = (runId: string | null) =>
        Semaphore.withPermits(
          turn,
          1,
        )(
          Effect.gen(function* () {
            if (closed) return
            closed = true
            if (runId !== null && before !== null) {
              yield* afterCommand(building, task, session, name, globs, watchId, runId, before)
            }
          }),
        ).pipe(
          Effect.catchCause((cause) =>
            said(`a command's changes were not attributed: ${String(cause)}`),
          ),
          Effect.ensuring(letGo),
          Effect.ensuring(Deferred.succeed(done, undefined)),
          Effect.provide(context),
        )
      const watch: CommandWatch = {
        note: () => (waited === null ? null : waitingSaid(waited)),
        taskId: task?.id ?? null,
        launch,
        recorded: () =>
          before === null
            ? {}
            : {
                trees: before.map((one) => ({ repository: one.base.repository, tree: one.tree })),
                globs: globs === null ? null : [...globs],
              },
        finish,
        settled: Deferred.await(done),
      }
      return watch
    })

  /**
   * The hold of a file tool write of a mission's session, begun once no other task's command
   * holds its file and put into `sink`: no command starts there until `endHold`. Answers what it
   * waited for, or null.
   */
  const beginHold = (file: WritingFile, sink: WriteInProgress[]) =>
    Effect.gen(function* () {
      const database = yield* Database
      const building = yield* activeBuildingIn(database, file.missionId)
      const located = building === null ? null : fileOf(building, file.path)
      const lineage = yield* lineageIn(database, file.sessionId)
      if (building === null || located === null || lineage === null) return null
      const mine = runningOf(yield* tasksIn(database, building.id), lineage).map((one) => one.id)
      const started = Date.now()
      const waited = yield* counted(
        file.sessionId,
        locks.beginWrite(building.id, mine, located, sink),
      )
      if (waited === null) return null
      yield* waitingFor(building, file.sessionId, started, waited)
      return waitingSaid(waited)
    }).pipe(
      Effect.catch((refused) =>
        Effect.as(said(`a write was not held against the commands: ${refused.message}`), null),
      ),
    )

  /** What a command changed, attributed to its task; a held file of another task is a conflict. */
  const afterCommand = (
    building: BuildingRow,
    task: TaskNow | null,
    session: RoleSession,
    name: string,
    globs: ReadonlyArray<string> | null,
    watchId: string,
    runId: string,
    before: ReadonlyArray<{ readonly base: BuildingBase; readonly tree: string }>,
  ) =>
    Effect.gen(function* () {
      const snapshots = yield* Snapshots
      const changes: Array<{
        readonly repository: string
        readonly files: ReadonlyArray<ChangedFile>
      }> = []
      for (const { base, tree } of before) {
        const place = placeOfBase(base)
        const after = yield* snapshots.take(place, {
          kind: 'run',
          missionId: building.missionId,
          runId: watchId,
          side: 'after',
        })
        const changed = (yield* snapshots.changed(building.missionId, place, tree, after)).filter(
          (file) => globs === null || globs.some((glob) => posix.matchesGlob(file.path, glob)),
        )
        if (changed.length > 0)
          yield* snapshots.capture(building.missionId, place, tree, after, changed)
        changes.push({ repository: base.repository, files: changed })
      }
      const secrets = yield* Secrets
      const conflicts = yield* mutate('attributing a command', (transaction) =>
        Effect.gen(function* () {
          const attempt =
            task === null ? null : yield* openAttemptIn(transaction, building.id, task.id)
          const claims = yield* claimsIn(transaction, building.id)
          const found: Array<{
            readonly repository: string
            readonly path: string
            readonly heldBy: string
            readonly runner: string
          }> = []
          const events: NewEvent[] = []
          for (const { repository, files } of changes) {
            for (const file of files) {
              if (task === null || attempt === null) {
                yield* recordUnattributedIn(transaction, building.id, '', {
                  repository,
                  path: file.path,
                })
                continue
              }
              yield* recordWriteIn(transaction, {
                buildingId: building.id,
                attemptId: attempt.id,
                taskId: task.id,
                sessionId: session.id,
                repository,
                path: file.path,
                kind: 'command',
                runId,
                actionId: null,
                fingerprint: null,
              })
              const held = claims.find(
                (one) =>
                  one.repository === repository && one.path === file.path && one.taskId !== task.id,
              )
              if (held === undefined) continue
              // The change is kept and attributed to the command: a conflict on both tasks.
              yield* transaction
                .insert(buildingConflicts)
                .values({
                  id: crypto.randomUUID(),
                  buildingId: building.id,
                  repository,
                  path: file.path,
                  runId,
                  command: secrets.mask(name),
                  byTask: task.id,
                  heldBy: held.taskId,
                  at: now(),
                })
                .pipe(Effect.mapError(refusedWhile('recording a conflict')))
              found.push({ repository, path: file.path, heldBy: held.taskId, runner: held.runner })
              events.push(
                buildingEvent(building.missionId, 'building.write_conflict', {
                  file: `${repository}/${file.path}`,
                  command: secrets.mask(name),
                  byTask: task.id,
                  heldBy: held.taskId,
                }),
              )
            }
          }
          return { result: found, events }
        }),
      )
      for (const conflict of conflicts) {
        yield* deliver(
          building,
          { lineage: conflict.runner },
          'conflict',
          `${conflict.repository}/${conflict.path} was rewritten by \`${name}\` of ${task?.id ?? 'a session'}: read it again before writing.`,
        )
      }
    })

  /**
   * What a finished attempt holds, from its start and end snapshots: the files written under its
   * name, captured, and those no author wrote. A file another task's running command holds is not
   * judged yet: that command attributes it when it ends.
   */
  const attemptFilesOf = (
    building: BuildingRow,
    task: TaskNow,
    attempt: { readonly id: string; readonly starts: string },
    ends: ReadonlyArray<{ readonly repository: string; readonly tree: string }>,
  ) =>
    Effect.gen(function* () {
      const database = yield* Database
      const snapshots = yield* Snapshots
      const own = yield* attributedIn(database, attempt.id)
      const all = yield* writesIn(database, building.id)
      const starts = Option.getOrElse(
        Schema.decodeUnknownOption(
          Schema.fromJsonString(
            Schema.Array(Schema.Struct({ repository: Schema.String, tree: Schema.String })),
          ),
        )(attempt.starts),
        () => [],
      )
      const files: AttemptFile[] = []
      const nobody: Array<{ readonly repository: string; readonly path: string }> = []
      for (const base of basesOf(building)) {
        const from = starts.find((one) => one.repository === base.repository)?.tree ?? null
        const to = ends.find((one) => one.repository === base.repository)?.tree
        if (to === undefined) continue
        const place = placeOfBase(base)
        const changed = yield* snapshots.changed(building.missionId, place, from, to)
        const wrote = (
          file: ChangedFile,
          rows: ReadonlyArray<{ readonly repository: string; readonly path: string }>,
        ) =>
          rows.some(
            (row) =>
              row.repository === base.repository &&
              (row.path === file.path || row.path === file.oldPath),
          )
        const mine = changed.filter((file) => wrote(file, own))
        if (mine.length > 0) yield* snapshots.capture(building.missionId, place, from, to, mine)
        for (const file of mine) {
          files.push({
            repository: base.repository,
            path: file.path,
            status: file.status,
            added: file.added,
            removed: file.removed,
            outside: !task.targets.some(
              (one) => one.repository === base.repository && one.path === file.path,
            ),
          })
        }
        for (const file of changed) {
          if (wrote(file, all)) continue
          const at = { repository: base.repository, path: file.path }
          if (locks.pending(building.id, [task.id], at)) continue
          nobody.push(at)
        }
      }
      return { files, nobody }
    })

  /** What a finishing transaction writes of an attempt's files. */
  const keepFilesIn = (
    transaction: EngineTransaction,
    building: BuildingRow,
    attemptId: string,
    found: {
      readonly files: ReadonlyArray<AttemptFile>
      readonly nobody: ReadonlyArray<{ readonly repository: string; readonly path: string }>
    },
  ) =>
    Effect.gen(function* () {
      yield* transaction
        .update(buildingAttempts)
        .set({ files: attemptFiles.write(found.files) })
        .where(eq(buildingAttempts.id, attemptId))
        .pipe(Effect.mapError(refusedWhile('keeping the files of an attempt')))
      for (const file of found.nobody) {
        yield* recordUnattributedIn(transaction, building.id, attemptId, file)
      }
    })

  // ---- The verdict loop.

  /** A red check's results as its runner is handed them. */
  const redSaid = (
    subject: string,
    results: ReadonlyArray<{
      readonly name: string
      readonly place: string
      readonly verdict: string
      readonly detail: string
      readonly outputTail: string
    }>,
    next: string,
  ) =>
    Effect.gen(function* () {
      const secrets = yield* Secrets
      const reds = results.filter((one) => one.verdict === 'red')
      return [
        `${subject} is red.`,
        ...reds.map((one) => {
          const { tail, cut } = outputTail(one.outputTail)
          return [
            `- ${one.name} failed in ${placeWords(one.place)}: ${one.detail}`,
            cut === null ? null : `  (${cut})`,
            '```',
            secrets.mask(tail),
            '```',
          ]
            .filter((line) => line !== null)
            .join('\n')
        }),
        next,
      ].join('\n')
    })

  const failedSaid = (
    results: ReadonlyArray<{
      readonly name: string
      readonly place: string
      readonly verdict: string
    }>,
  ) =>
    listed(
      results
        .filter((one) => one.verdict === 'red')
        .map((one) => `${one.name} failed in ${placeWords(one.place)}`),
    )

  /** A Hemera need of the Builder's service, its decision kept, the tasks it holds blocked. */
  const hemeraNeedIn = (
    transaction: EngineTransaction,
    building: BuildingRow,
    write: Effect.Success<ReturnType<typeof createNeedIn>>,
    asked: {
      readonly kind: string
      readonly tasks: ReadonlyArray<string>
      readonly question: string
      readonly options: ReadonlyArray<string>
      readonly proposer: string | null
    },
  ) =>
    Effect.gen(function* () {
      const secrets = yield* Secrets
      const need = yield* write(transaction)
      yield* transaction
        .insert(buildingDecisions)
        .values({
          id: crypto.randomUUID(),
          buildingId: building.id,
          needId: need.id,
          kind: asked.kind,
          tasks: writeStrings(asked.tasks),
          question: secrets.mask(asked.question),
          options: secrets.mask(writeStrings(asked.options)),
          recommended: null,
          amendment: null,
          state: 'pending',
          requestedBy: 'hemera',
          requestedAt: now(),
          proposer: asked.proposer,
        })
        .pipe(Effect.mapError(refusedWhile('keeping the decision')))
      const blocked = yield* blockIn(
        transaction,
        building,
        asked.tasks,
        NeedCause.make({ needId: need.id }),
        need.id,
      )
      return { needId: need.id, events: [...need.events, ...blocked] }
    })

  const ownerOf = (building: BuildingRow, taskId: string | null) =>
    Effect.gen(function* () {
      const database = yield* Database
      const [mission] = yield* database
        .select({
          projectId: missions.projectId,
          prefix: missions.keyPrefix,
          number: missions.keyNumber,
        })
        .from(missions)
        .where(eq(missions.id, building.missionId))
        .pipe(Effect.mapError(refusedWhile('reading the mission')))
      return {
        owner: MissionOwner.make({
          projectId: mission?.projectId ?? '',
          missionId: building.missionId,
          taskId,
        }),
        key: mission === undefined ? '' : missionKey(mission.prefix, mission.number),
        projectId: mission?.projectId ?? '',
      }
    })

  /** The three failures an error need carries: each attempt's red checks, files and runner. */
  const failuresOf = (
    attempts: ReadonlyArray<{
      readonly id: string
      readonly number: number
      readonly runner: string
    }>,
  ) =>
    Effect.gen(function* () {
      const database = yield* Database
      const secrets = yield* Secrets
      const failures: Array<{ what: string; output: string }> = []
      for (const attempt of attempts) {
        const reds = (yield* checkResultsIn(database, attempt.id)).filter(
          (one) => one.verdict === 'red',
        )
        const files = (yield* attributedIn(database, attempt.id)).map(
          (one) => `${one.repository}/${one.path}`,
        )
        failures.push({
          what: [
            listed(reds.map((one) => `${one.name} in ${placeWords(one.place)}`)) || 'a red check',
            `attempt ${String(attempt.number)} by ${attempt.runner}`,
            files.length === 0 ? null : `files: ${files.join(', ')}`,
          ]
            .filter((part) => part !== null)
            .join(' · '),
          output: secrets.mask(outputTail(reds[0]?.outputTail ?? '').tail),
        })
      }
      return failures
    })

  /**
   * A red attempt of a task: a new attempt for its runner with the red handed over, or at the third
   * red an error need that stops the task. Answers what the runner is told.
   */
  const redTask = (building: BuildingRow, taskId: string, attemptId: string) =>
    Effect.gen(function* () {
      const database = yield* Database
      const attempts = (yield* attemptsIn(database, building.id)).filter(
        (one) => one.taskId === taskId,
      )
      const attempt = attempts.find((one) => one.id === attemptId)
      if (attempt === undefined) return `${taskId} is red.`
      const results = yield* checkResultsIn(database, attemptId)
      const reds = attempts.filter((one) => one.verdict === 'red' && one.counted)
      const runner = yield* runnerNow(attempt.runner)
      const task = (yield* tasksIn(database, building.id)).find((one) => one.id === taskId)
      if (task === undefined) return `${taskId} is red.`
      const first = results.find((one) => one.verdict === 'red')
      if (reds.length >= REDS_BEFORE_A_NEED) {
        const failures = yield* failuresOf(reds.slice(-REDS_BEFORE_A_NEED))
        const { owner } = yield* ownerOf(building, taskId)
        const question = `${task.id} · ${task.title}: three red attempts`
        const write = yield* createNeedIn(
          parts.needs,
          owner,
          ErrorFields.make({ failed: question, attempts: failures, proposals: [] }),
        )
        yield* hold('judging')
        const needId = yield* mutate('stopping a task after three reds', (transaction) =>
          Effect.gen(function* () {
            const current = (yield* tasksIn(transaction, building.id)).find(
              (one) => one.id === taskId,
            )
            if (current?.state !== 'checking') return { result: null, events: [] }
            const made = yield* hemeraNeedIn(transaction, building, write, {
              kind: 'error',
              tasks: [taskId],
              question,
              options: [],
              proposer: runner.lineage,
            })
            const settledNow = yield* settleIn(transaction, building)
            return {
              result: made.needId,
              events: [
                buildingEvent(building.missionId, 'building.attempt_red', {
                  task: taskId,
                  check: first?.name ?? null,
                  place: first?.place ?? null,
                }),
                buildingEvent(building.missionId, 'building.three_reds', {
                  task: taskId,
                  need: made.needId,
                }),
                ...made.events,
                ...settledNow.events,
              ],
            }
          }),
        )
        if (needId !== null) {
          yield* deliver(
            building,
            { lineage: runner.lineage },
            'propose',
            `${task.id} · ${task.title} is red for the third time: Hemera stopped it and asks the user. Fill what you propose with need_propose (need ${needId}): your options, the one you recommend and why. Never try a fourth time the same way: three reds mean an assumption is wrong.`,
          )
        }
        return `${taskId} is red for the third time (${failedSaid(results)}): Hemera stopped it and asks the user. You will be asked what you propose.`
      }
      const next = crypto.randomUUID()
      const starts = yield* Effect.result(
        Effect.forEach(basesOf(building), (base) =>
          Effect.map(
            Snapshots.use((snapshots) =>
              snapshots.take(placeOfBase(base), {
                kind: 'attempt',
                missionId: building.missionId,
                attemptId: next,
                side: 'start',
              }),
            ),
            (tree) => ({ repository: base.repository, tree }),
          ),
        ),
      )
      if (Result.isFailure(starts)) {
        yield* Snapshots.use((snapshots) => snapshots.failed(building.missionId, starts.failure))
        return `${taskId} is red, and its next attempt could not open: Hemera judges it again at its next start.`
      }
      yield* hold('judging')
      const number = attempts.length + 1
      const opened = yield* mutate('opening an attempt after a red', (transaction) =>
        Effect.gen(function* () {
          const current = (yield* tasksIn(transaction, building.id)).find(
            (one) => one.id === taskId,
          )
          if (current?.state !== 'checking') return { result: false, events: [] }
          yield* transaction
            .insert(buildingAttempts)
            .values({
              id: next,
              buildingId: building.id,
              taskId,
              number,
              runner: runner.lineage,
              epoch: runner.session?.epoch ?? attempt.epoch,
              starts: writeTrees(starts.success),
              startedAt: now(),
              outside: '[]',
            })
            .pipe(Effect.mapError(refusedWhile('opening the attempt')))
          for (const target of current.targets) {
            yield* transaction
              .insert(buildingClaims)
              .values({
                buildingId: building.id,
                taskId,
                repository: target.repository,
                path: target.path,
                runner: runner.lineage,
              })
              .onConflictDoNothing()
              .pipe(Effect.mapError(refusedWhile('taking the claims')))
          }
          const events: NewEvent[] = []
          // The runner's lease moves to whoever takes the red: the parent of an ended runner.
          const held = yield* runnerSessionIn(transaction, building.id, taskId)
          if (runner.session !== null && held?.sessionId !== runner.session.id) {
            const lease = yield* assignWorkIn(
              transaction,
              workItemOf(building.id, taskId),
              runner.session,
            )
            events.push(...lease.events)
          }
          yield* moveIn(transaction, building.id, current, 'in_progress', {
            runner: runner.lineage,
          })
          return {
            result: true,
            events: [
              ...events,
              buildingEvent(building.missionId, 'building.attempt_red', {
                task: taskId,
                check: first?.name ?? null,
                place: first?.place ?? null,
              }),
              buildingEvent(building.missionId, 'building.attempt_opened', {
                task: taskId,
                attempt: number,
                runner: runner.lineage,
              }),
            ],
          }
        }),
      )
      if (!opened) return `${taskId} is red.`
      const nextStep = `Attempt ${String(number)} is open: fix it in ${taskId}, then task_finished again.`
      yield* deliver(
        building,
        { lineage: runner.lineage },
        'red',
        yield* redSaid(`${taskId} · ${task.title}`, results, nextStep),
      )
      return `${taskId} is red: ${failedSaid(results)}. ${nextStep} The end of the output was delivered to you.`
    })

  /** A green attempt of a task: its event, the done itself being the Builder's. */
  const greenEvent = (missionId: string, taskId: string) =>
    buildingEvent(missionId, 'building.attempt_green', { task: taskId })

  /**
   * The checks of a requirement or of the end (#143, #147): judged on the open attempt of that
   * scope if one is, a red opening the next one for the Builder, the third an error need. No task
   * changes state.
   */
  const judgeScope = (
    missionId: string,
    scope: Exclude<AttemptScope, 'task'>,
    subject: string | null,
  ) =>
    Effect.gen(function* () {
      const database = yield* Database
      const building = yield* activeBuildingIn(database, missionId)
      if (building === null) return 'not_verified' satisfies AttemptResult
      const all = (yield* attemptsIn(database, building.id)).filter(
        (one) => one.taskId === null && one.scope === scope && one.subject === subject,
      )
      const open = all.findLast((one) => one.endedAt === null) ?? null
      const tasks = yield* tasksIn(database, building.id)
      const covering = tasks.filter(
        (task) => scope === 'end' || (subject !== null && task.requirements.includes(subject)),
      )
      let verdict: AttemptResult
      let results: ReadonlyArray<{
        readonly name: string
        readonly place: string
        readonly verdict: string
        readonly detail: string
        readonly outputTail: string
      }>
      if (open !== null) {
        const judged = yield* checkAttempt({
          missionId,
          buildingId: building.id,
          scope,
          subject,
          attemptId: open.id,
        })
        verdict = judged.verdict
        results = judged.results
        yield* mutate('ending a scope attempt', (transaction) =>
          transaction
            .update(buildingAttempts)
            .set({ endedAt: now(), outcome: verdict })
            .where(eq(buildingAttempts.id, open.id))
            .pipe(
              Effect.mapError(refusedWhile('ending the attempt')),
              Effect.as({ result: undefined, events: [] }),
            ),
        )
      } else {
        const files: Array<{ repository: string; path: string }> = []
        for (const attempt of (yield* attemptsIn(database, building.id)).filter((one) =>
          covering.some((task) => task.id === one.taskId),
        )) {
          files.push(
            ...(yield* attributedIn(database, attempt.id)).map((one) => ({
              repository: one.repository,
              path: one.path,
            })),
          )
        }
        const ran = yield* TaskChecks.use((checks) =>
          checks.run({ missionId, buildingId: building.id, scope, subject, attemptId: '', files }),
        )
        results = ran
        verdict = ran.some((one) => one.verdict === 'red')
          ? 'red'
          : ran.some((one) => one.verdict === 'green')
            ? 'green'
            : 'not_verified'
      }
      if (verdict !== 'red') return verdict
      const label = scope === 'end' ? 'The end of the Building' : `${subject ?? ''}'s checks`
      // The red that opened the first attempt counts, then each attempt judged red.
      const judgedRed = all.filter(
        (one) => one.counted && (one.verdict === 'red' || one.id === open?.id),
      )
      const reds = judgedRed.length + 1
      const builder = yield* builderLineage(missionId)
      const target = builder === null ? { role: 'builder' } : { lineage: builder }
      const first = results.find((one) => one.verdict === 'red')
      if (reds >= REDS_BEFORE_A_NEED) {
        const failures = yield* failuresOf(judgedRed.slice(-REDS_BEFORE_A_NEED))
        const { owner } = yield* ownerOf(building, null)
        const question = `${label}: three red attempts`
        const write = yield* createNeedIn(
          parts.needs,
          owner,
          ErrorFields.make({ failed: question, attempts: failures, proposals: [] }),
        )
        const needId = yield* mutate('stopping a scope after three reds', (transaction) =>
          Effect.gen(function* () {
            const made = yield* hemeraNeedIn(transaction, building, write, {
              kind: 'error',
              tasks: [],
              question,
              options: [],
              proposer: builder,
            })
            return {
              result: made.needId,
              events: [
                buildingEvent(missionId, 'building.attempt_red', {
                  scope,
                  subject,
                  check: first?.name ?? null,
                  place: first?.place ?? null,
                }),
                buildingEvent(missionId, 'building.three_reds', {
                  scope,
                  subject,
                  need: made.needId,
                }),
                ...made.events,
              ],
            }
          }),
        )
        yield* deliver(
          building,
          target,
          'propose',
          `${label} are red for the third time: Hemera asks the user. Fill what you propose with need_propose (need ${needId}): your options, the one you recommend and why.`,
        )
        return verdict
      }
      const next = crypto.randomUUID()
      const starts = yield* Effect.forEach(basesOf(building), (base) =>
        Effect.map(
          Snapshots.use((snapshots) =>
            snapshots.take(placeOfBase(base), {
              kind: 'attempt',
              missionId,
              attemptId: next,
              side: 'start',
            }),
          ),
          (tree) => ({ repository: base.repository, tree }),
        ),
      )
      const number = all.length + 1
      yield* mutate('opening a scope attempt', (transaction) =>
        Effect.gen(function* () {
          yield* transaction
            .insert(buildingAttempts)
            .values({
              id: next,
              buildingId: building.id,
              taskId: null,
              scope,
              subject,
              number,
              runner: builder ?? 'builder',
              epoch: 0,
              starts: writeTrees(starts),
              startedAt: now(),
              outside: '[]',
            })
            .pipe(Effect.mapError(refusedWhile('opening the attempt')))
          return {
            result: undefined,
            events: [
              buildingEvent(missionId, 'building.attempt_red', {
                scope,
                subject,
                check: first?.name ?? null,
                place: first?.place ?? null,
              }),
              buildingEvent(missionId, 'building.attempt_opened', {
                scope,
                subject,
                attempt: number,
              }),
            ],
          }
        }),
      )
      yield* deliver(
        building,
        target,
        'red',
        yield* redSaid(
          label,
          results,
          `Attempt ${String(number)} on ${scope === 'end' ? 'the end' : (subject ?? '')} is yours: fix it without changing any task's state.`,
        ),
      )
      return verdict
    })

  // ---- need_propose.

  const propose = (grant: Grant, args: ToolArguments<'need_propose'>) =>
    Effect.gen(function* () {
      const notAsked = refusal('refused: this need is not an error need you were asked to fill.')
      const session = yield* getSession(grant.sessionId)
      const found = yield* (yield* Database).transaction((transaction) =>
        decisionOfNeedIn(transaction, args.need),
      )
      if (found === null || found.decision.kind !== 'error' || found.decision.state !== 'pending')
        return notAsked
      if (found.decision.proposer !== session.lineage) return notAsked
      const labels = args.options.map((one) => one.label)
      const at = labels.indexOf(args.recommended)
      if (at === -1) return refusal('refused: the option you recommend is not one of your options.')
      const need = yield* getNeed(args.need)
      if (!Predicate.isTagged(need.fields, 'Error')) return notAsked
      const proposals = args.options.map((one) => `${one.label}: ${one.detail}`)
      const fields = ErrorFields.make({
        failed: need.fields.failed,
        attempts: need.fields.attempts,
        proposals,
        recommended: { option: proposals[at] ?? '', reason: args.reason },
      })
      const secrets = yield* Secrets
      yield* mutate('proposing on an error need', (transaction) =>
        Effect.gen(function* () {
          yield* transaction
            .update(buildingDecisions)
            .set({
              options: secrets.mask(writeStrings(proposals)),
              recommended: secrets.mask(proposals[at] ?? ''),
            })
            .where(eq(buildingDecisions.id, found.decision.id))
            .pipe(Effect.mapError(refusedWhile('keeping the proposal')))
          return { result: undefined, events: yield* reviseNeedIn(transaction, args.need, fields) }
        }),
      )
      return answered(
        'Your proposal is on the need: the user chooses one, or gives a direction of their own.',
      )
    })

  /** An answered error need: the reds counted no more on what it held. */
  const answeredErrorIn = (
    transaction: EngineTransaction,
    building: BuildingRow,
    decision: { readonly tasks: string; readonly question: string },
  ) =>
    Effect.gen(function* () {
      const tasks = Option.getOrElse(
        Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))(
          decision.tasks,
        ),
        () => [],
      )
      yield* transaction
        .update(buildingAttempts)
        .set({ counted: false })
        .where(
          tasks.length === 0
            ? and(eq(buildingAttempts.buildingId, building.id), isNull(buildingAttempts.taskId))
            : and(
                eq(buildingAttempts.buildingId, building.id),
                inArray(buildingAttempts.taskId, [...tasks]),
              ),
        )
        .pipe(Effect.mapError(refusedWhile('counting the reds again')))
    })

  // ---- A restart.

  /**
   * At an engine's start, before the Builder resumes: each file write the restart's
   * reconciliation found done is attributed to its task.
   */
  const restarted = (building: BuildingRow) =>
    Effect.gen(function* () {
      const database = yield* Database
      const left = yield* database
        .select()
        .from(effectfulActions)
        .where(
          and(
            eq(effectfulActions.ownerKind, 'mission'),
            eq(effectfulActions.ownerId, building.missionId),
            isNull(effectfulActions.handledAt),
            eq(effectfulActions.kind, 'file.write'),
            eq(effectfulActions.state, 'done'),
          ),
        )
        .pipe(Effect.mapError(refusedWhile('reading the writes a restart found')))
      for (const action of left) {
        // Only what the restart's reconciliation settled: a write done in a call is attributed then.
        if (action.outcome !== 'found so at restart') continue
        const details = Option.getOrNull(readDetails(action.details))
        yield* mutate('attributing a write found at restart', (transaction) =>
          Effect.gen(function* () {
            yield* transaction
              .update(effectfulActions)
              .set({ handledAt: now() })
              .where(eq(effectfulActions.id, action.id))
              .pipe(Effect.mapError(refusedWhile('handing an action over')))
            if (details?.path !== undefined && Predicate.isString(details.sessionId)) {
              yield* written({
                sessionId: details.sessionId,
                missionId: building.missionId,
                path: details.path,
                fingerprint: details.after ?? '',
                actionId: action.id,
              })(transaction)
            }
            return { result: undefined, events: [] }
          }),
        )
      }
    })

  /**
   * A command an engine stop cut in the middle, handed over once by the start (`handleIndeterminate`):
   * the Building's when its mission builds and it is not a reservation's reset. Answers whether
   * the Building took it.
   */
  const cut = (action: EffectfulAction) =>
    Effect.gen(function* () {
      if (action.kind !== 'command.run' || action.owner.kind !== 'mission') return false
      const building = yield* activeBuildingIn(yield* Database, action.owner.missionId)
      const details = Option.getOrNull(readParsed(action.details))
      if (building === null || details === null || details.claim !== undefined) return false
      yield* indeterminate(building, action.id, action.owner.taskId, details)
      return true
    })

  /**
   * What a command cut by a stop changed before it, from the snapshots its intent kept to a
   * snapshot taken now: its task's, in its last attempt.
   */
  const cutChanges = (
    building: BuildingRow,
    actionId: string,
    taskId: string,
    sessionId: string,
    before: ReadonlyArray<{ readonly repository: string; readonly tree: string }>,
    globs: ReadonlyArray<string> | null,
  ) =>
    Effect.gen(function* () {
      const database = yield* Database
      const snapshots = yield* Snapshots
      const attempt = (yield* attemptsIn(database, building.id)).findLast(
        (one) => one.taskId === taskId,
      )
      if (attempt === undefined) return
      const changes: Array<{ readonly repository: string; readonly path: string }> = []
      for (const { repository, tree } of before) {
        const base = basesOf(building).find((one) => one.repository === repository)
        if (base === undefined) continue
        const place = placeOfBase(base)
        const after = yield* snapshots.take(place, {
          kind: 'run',
          missionId: building.missionId,
          runId: actionId,
          side: 'after',
        })
        const changed = (yield* snapshots.changed(building.missionId, place, tree, after)).filter(
          (file) => globs === null || globs.some((glob) => posix.matchesGlob(file.path, glob)),
        )
        if (changed.length > 0)
          yield* snapshots.capture(building.missionId, place, tree, after, changed)
        changes.push(...changed.map((file) => ({ repository, path: file.path })))
      }
      yield* mutate('attributing what a cut command changed', (transaction) =>
        Effect.gen(function* () {
          for (const change of changes) {
            yield* recordWriteIn(transaction, {
              buildingId: building.id,
              attemptId: attempt.id,
              taskId,
              sessionId,
              repository: change.repository,
              path: change.path,
              kind: 'command',
              runId: null,
              actionId,
              fingerprint: null,
            })
          }
          return { result: undefined, events: [] }
        }),
      )
    })

  /** A command an engine stop cut in the middle: never run again; its runner or the user told. */
  const indeterminate = (
    building: BuildingRow,
    actionId: string,
    taskId: string | null,
    details: typeof ActionDetails.Type,
  ) =>
    Effect.gen(function* () {
      const database = yield* Database
      const tasks = yield* tasksIn(database, building.id)
      const lineage = Predicate.isString(details.sessionId)
        ? yield* lineageIn(database, details.sessionId)
        : null
      const task =
        tasks.find((one) => one.id === taskId) ??
        (lineage === null ? undefined : runningOf(tasks, lineage)[0])
      if (task !== undefined && details.trees !== undefined) {
        const by = Predicate.isString(details.sessionId) ? details.sessionId : ''
        yield* cutChanges(
          building,
          actionId,
          task.id,
          by,
          details.trees,
          details.globs ?? null,
        ).pipe(
          Effect.catchCause((cause) =>
            said(`what a cut command changed was not attributed: ${String(cause)}`),
          ),
        )
      }
      const { projectId, owner } = yield* ownerOf(building, task?.id ?? null)
      const cutCommand =
        details.command == null
          ? null
          : yield* getCommand(projectId, details.command).pipe(
              Effect.map(Option.some),
              Effect.catchTag('UnknownCommand', () => Effect.succeed(Option.none())),
              Effect.map(Option.getOrNull),
            )
      const line = details.line ?? cutCommand?.line ?? 'the command'
      const shared = cutCommand === null ? [] : yield* resourcesOf(projectId, cutCommand.id)
      const secrets = yield* Secrets
      const event = buildingEvent(building.missionId, 'building.indeterminate', {
        task: task?.id ?? null,
        command: secrets.mask(line),
        asked: shared.length > 0,
      })
      if (cutCommand !== null && shared.length > 0) {
        const question = `\`${cutCommand.name}\` was cut by a restart. Did it run?`
        const write = yield* createNeedIn(
          parts.needs,
          owner,
          DecisionFields.make({
            question,
            options: ['it ran', 'it did not run'],
            recommended: null,
          }),
        )
        yield* mutate('asking whether a command ran', (transaction) =>
          Effect.gen(function* () {
            const made = yield* hemeraNeedIn(transaction, building, write, {
              kind: 'indeterminate',
              tasks: task === undefined ? [] : [task.id],
              question,
              options: ['it ran', 'it did not run'],
              proposer: null,
            })
            return { result: undefined, events: [event, ...made.events] }
          }),
        )
        return
      }
      yield* mutate('saying a command may have run', () =>
        Effect.succeed({ result: undefined, events: [event] }),
      )
      const runner = task?.runner ?? lineage
      yield* deliver(
        building,
        runner === null ? { role: 'builder' } : { lineage: runner },
        'indeterminate',
        `${task?.id ?? 'A task'}: indeterminate result: \`${line}\` may have run; check the real state before running it again.`,
      )
    })

  // ---- Commits per task.

  /** A done task's own files committed, when the mission's copy asks for one commit per task. */
  const commitTask = (building: BuildingRow, taskId: string) =>
    Effect.gen(function* () {
      const settings = yield* validationSettingsOf(building.missionId)
      const rule = settings === null ? null : commitRuleOf(settings.sections)
      if (rule === null) return
      const database = yield* Database
      const tasks = yield* tasksIn(database, building.id)
      const task = tasks.find((one) => one.id === taskId)
      if (task === undefined) return
      const attempts = yield* attemptsIn(database, building.id)
      const filesOf = (ids: ReadonlyArray<string>) =>
        Effect.map(
          Effect.forEach(
            attempts.filter((one) => one.taskId !== null && ids.includes(one.taskId)),
            (attempt) => attributedIn(database, attempt.id),
          ),
          (rows) => rows.flat().map((one) => `${one.repository}\u0000${one.path}`),
        )
      const running = tasks
        .filter(
          (one) => one.id !== taskId && (one.state === 'in_progress' || one.state === 'checking'),
        )
        .map((one) => one.id)
      // A file another running task also wrote is left for that task's commit.
      const theirs = new Set(yield* filesOf(running))
      const mine = [...new Set(yield* filesOf([taskId]))].filter((one) => !theirs.has(one))
      const { key } = yield* ownerOf(building, taskId)
      const message = rule.template
        .replaceAll('{key}', key)
        .replaceAll('{task}', task.id)
        .replaceAll('{title}', task.title)
      for (const base of basesOf(building)) {
        const paths = mine
          .filter((one) => one.startsWith(`${base.repository}\u0000`))
          .map((one) => one.slice(base.repository.length + 1))
        if (paths.length === 0) continue
        const intent = yield* beginAction(
          'git.commit',
          { kind: 'mission', missionId: building.missionId, taskId },
          { repository: base.repository, paths: [...paths], message },
        )
        const committed = yield* Git.use((git) =>
          git.commitPaths(base.folder, paths, message),
        ).pipe(Effect.result)
        if (Result.isFailure(committed)) {
          yield* actionFailed(intent, committed.failure.message)
          yield* said(
            `${taskId} was not committed in ${base.repository}: ${committed.failure.message}`,
          )
          continue
        }
        yield* mutate('saying a task was committed', () =>
          Effect.succeed({
            result: undefined,
            events: [
              buildingEvent(building.missionId, 'building.commit', {
                task: taskId,
                commit: committed.success,
                repository: base.repository,
              }),
            ],
          }),
        )
        yield* actionDone(intent, `committed ${committed.success}`)
      }
    })

  return {
    attribution: { written, command },
    beginHold,
    endHold: locks.endWrite,
    waitForLock,
    attemptFilesOf,
    keepFilesIn,
    redTask,
    greenEvent,
    judgeScope,
    propose,
    answeredErrorIn,
    restarted,
    cut,
    commitTask,
  }
}

export type Loop = ReturnType<typeof buildingLoop>
