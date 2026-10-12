/**
 * The Builder (#141): a launched mission's Building, its tasks and its main session.
 *
 * - **The start.** `BuildingStart` (#139's port): the base snapshot of each repository of the
 *   Workspace (#140), then in one transaction the Building, one task per frozen task (waiting, then
 *   those with no dependency available) and `building.started`; then a `builder` session in the
 *   Workspace. A mission that already has an active Building begins nothing but the Builder it
 *   lacks.
 * - **The tools.** `task_start` takes an available task's claims, opens its attempt on its start
 *   snapshot and makes the caller its runner (#40's lease); `task_finished` from the runner takes
 *   the end snapshot and asks `TaskVerdict`; `task_blocked` and `report_need` are requests Hemera
 *   checks before it creates the need, blocking the tasks named and their dependants. Claims guard
 *   every write of the mission's sessions.
 * - **The answers.** A decision's answer is kept as a decision of the Building, its amendment
 *   applied in the same transaction (CT-33), the tasks it held back available again.
 * - **The deliveries.** A ready-set delivery whenever tasks become available, an answer delivery,
 *   an expiry delivery; the end of the tasks once, through `BuildingEnd`.
 * - **The resume.** At every start, each active Building counts the engine's time again, judges
 *   again a task left checking, and has a Builder: the sessions' rebuild (CT-11) gives its fresh
 *   one the resume block. Cancel ends the Building as cancelled; the work stays.
 */

import {
  type Amendment,
  DecisionFields,
  EnvironmentFields,
  MissionOwner,
  type ToolArguments,
  amendmentProblems,
  amendmentSaid,
  readySet,
} from '@hemera/core/domain'
import type { Need } from '@hemera/ipc'
import { and, eq } from 'drizzle-orm'
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Layer,
  Option,
  Predicate,
  Result,
  Schedule,
  Schema,
  Semaphore,
  Stream,
} from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { DomainEvents } from '../domain-events.ts'
import { AutomationGate } from '../gate.ts'
import type { NewEvent } from '../journal.ts'
import {
  DeliveryFailed,
  type NeedHandler,
  createNeedIn,
  expireNeedIn,
  needService,
} from '../needs.ts'
import { basesAt, liveIn, placeOf, planRows, targetProblem } from '../planning/plan.ts'
import { Secrets } from '../secrets.ts'
import type { Git } from '../git.ts'
import type { SessionPost } from '../sessions/post.ts'
import { Sessions } from '../sessions/service.ts'
import { assignWorkIn } from '../sessions/leases.ts'
import { type RoleSession, getSession, sessionsIn } from '../sessions/store.ts'
import {
  Database,
  type DatabaseError,
  type EngineTransaction,
  refusedWhile,
} from '../storage/database.ts'
import {
  buildingActivity,
  buildingAttempts,
  buildingClaims,
  buildingDecisions,
  buildingLaunches,
  buildingTasks,
  buildings,
  missions,
} from '../storage/schema.ts'
import type { Grant } from '../tools/access.ts'
import type { EffectfulAction } from '../tools/actions.ts'
import { type ToolAnswer, answered, failure, refusal } from '../tools/files.ts'
import type { GuardedCall } from '../tools/ports.ts'
import { mutate } from '../transaction.ts'
import type { ProjectServices } from '../repositories.ts'
import { type Preparations, getWorkspace } from '../workspaces.ts'
import { readyLine, readySaid } from './builder-role.ts'
import { type TaskChecks, TaskVerdict } from './checks.ts'
import { BuildDesk } from './desk.ts'
import { type WriteInProgress, writeLocks } from './locks.ts'
import { buildingLoop, fileOf, runningOf } from './loop.ts'
import { BuildingStart } from './launch.ts'
import { Snapshots, type SnapshotFailed } from './snapshots.ts'
import {
  attemptFiles,
  type BuildingBase,
  type BuildingRow,
  NeedCause,
  type TaskNow,
  activeBuildingIn,
  activeBuildings,
  amendments,
  applyAmendmentIn,
  attemptsIn,
  bases,
  blockIn,
  buildingEvent,
  causeSaid,
  claimsIn,
  decisionOfNeedIn,
  decisionsIn,
  holderIn,
  moveIn,
  now,
  openAttemptIn,
  planLine,
  runnerSessionIn,
  settleIn,
  tasksIn,
  unblockIn,
  unknownTasks,
  writeStrings,
  writeTrees,
} from './tasks.ts'

export { BuildingStart } from './launch.ts'
export { TaskVerdict, noCheckVerdict, type TaskJudgement, type VerdictAsked } from './checks.ts'
export { buildingOf } from './tasks.ts'
export { inRepository } from './loop.ts'

/**
 * Where a Building goes once every task of its effective plan is done or skipped, called once:
 * #147 fills it with the end sequence and the move to Review. Until then it writes
 * `building.tasks_done`.
 */
export class BuildingEnd extends Context.Service<
  BuildingEnd,
  { readonly end: (missionId: string) => Effect.Effect<void> }
>()('BuildingEnd') {}

export const tasksDoneEnd = Layer.effect(
  BuildingEnd,
  Effect.gen(function* () {
    const context = yield* Effect.context<Database | DomainEvents | Secrets>()
    return {
      end: (missionId: string) =>
        mutate('saying the tasks are done', () =>
          Effect.succeed({
            result: undefined,
            events: [buildingEvent(missionId, 'building.tasks_done')],
          }),
        ).pipe(Effect.provide(context), Effect.orDie),
    }
  }),
)

/** The service a Builder's requests for a need belong to. */
export const BUILDER_NEEDS = needService('builder')

/** How often the time a Building runs is written down (open question 28). */
const HEARTBEAT = '15 seconds'

type Needs =
  | Database
  | DomainEvents
  | Secrets
  | Sessions
  | Snapshots
  | TaskVerdict
  | TaskChecks
  | Git
  | SessionPost
  | BuildingEnd
  | BuildDesk
  | AutomationGate
  | Preparations
  | ProjectServices

const NO_MISSION = refusal('refused: this session works for no mission')
const NO_BUILDING = refusal('refused: the mission has no Building under way')

/** What a state refuses a start with. */
const notAvailableSaid = (task: TaskNow): string => {
  switch (task.state) {
    case 'waiting':
      return `refused: ${task.id} waits for ${task.dependsOn.join(', ')}: it is not in the ready set yet.`
    case 'in_progress':
      return `refused: ${task.id} is in progress already.`
    case 'checking':
      return `refused: ${task.id} is being checked.`
    case 'done':
      return `refused: ${task.id} is done.`
    case 'blocked':
      return `refused: ${task.id} is blocked: ${task.blockedBy === null ? 'a need' : causeSaid(task.blockedBy)}.`
    case 'skipped':
      return `refused: ${task.id} is skipped: ${task.skippedReason ?? ''}`
    case 'available':
      return ''
  }
}

const listed = (ids: ReadonlyArray<string>): string =>
  ids.length <= 1 ? (ids[0] ?? '') : `${ids.slice(0, -1).join(', ')} and ${ids.at(-1) ?? ''}`

/**
 * Why a need cannot hold these tasks: one done or skipped is over, one being checked waits for its
 * verdict. Null when a need may hold them all.
 */
const unholdable = (tasks: ReadonlyArray<TaskNow>, ids: ReadonlyArray<string>) => {
  const stateOf = (id: string) => tasks.find((task) => task.id === id)?.state
  const over = ids.filter((id) => stateOf(id) === 'done' || stateOf(id) === 'skipped')
  if (over.length > 0) return refusal(`refused: ${listed(over)} is over: a need holds it no more.`)
  const checking = ids.filter((id) => stateOf(id) === 'checking')
  if (checking.length > 0) {
    return refusal(`refused: ${listed(checking)} is being checked: a need holds it no more.`)
  }
  return null
}

/** The tasks an amendment brings into the plan. */
const addedBy = (amendment: Amendment) => {
  switch (amendment.kind) {
    case 'replace':
      return amendment.by
    case 'add':
      return [amendment.task]
    case 'remove':
      return []
  }
}

const readString = Schema.decodeUnknownOption(Schema.String)

/** What the answer to a need says, in words. */
const answerOf = (need: Need): string | null => {
  const answer = need.answer
  if (answer === null) return null
  if (Predicate.isTagged(answer, 'Chosen')) return answer.option
  if (Predicate.isTagged(answer, 'Written')) return answer.text
  return null
}

/**
 * Where a suite holds the Builder between a check and the transaction it guards: after a task's
 * start snapshot, after its end snapshot, after its verdict. Never held otherwise.
 */
export type BuilderHold = (
  at: 'starting' | 'finishing' | 'judging' | 'locked' | 'committing',
) => Effect.Effect<void>

export const builderLayer = (log: Log, hold: BuilderHold = () => Effect.void) => {
  let apply: NeedHandler['deliver'] | null = null
  const handler: NeedHandler = {
    deliver: (need, transaction) =>
      apply === null
        ? Effect.fail(new DeliveryFailed({ reason: 'the Builder is not running yet' }))
        : apply(need, transaction),
    // An environment need holds until the user's Retry says it is fixed.
    recheck: (_need, retried) => Effect.succeed(!retried),
  }
  let takeCut: ((action: EffectfulAction) => Effect.Effect<boolean>) | null = null
  let takeRestart: Effect.Effect<void> | null = null
  const handedOver = Deferred.makeUnsafe<void>()
  /**
   * At an engine's start, before the cut actions are handed over: each write a stop left found
   * done is attributed to its task (#142).
   */
  const restarted = Effect.suspend(() => takeRestart ?? Effect.void)
  /** Once the cut actions are handed over: only then do the Buildings resume and act (#142). */
  const handed = Deferred.succeed(handedOver, undefined)
  /** A command a stop cut in the middle, taken by the Building when its mission builds (#142). */
  const cut = (action: EffectfulAction) =>
    takeCut === null ? Effect.succeed(false) : takeCut(action)
  const layer = Layer.effect(
    BuildingStart,
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs>()
      const layerScope = yield* Effect.scope
      const provided = <A, E, R extends Needs>(effect: Effect.Effect<A, E, R>) =>
        Effect.provide(effect, context)
      const said = (line: string) => Effect.sync(() => log(`building: ${line}`))
      const lock = yield* Semaphore.make(1)
      /** The interval this engine counts for each active Building, by its id. */
      const counting = new Map<string, string>()
      // Attempts, attribution and the verdict loop (#142).
      const loop = buildingLoop({
        needs: BUILDER_NEEDS,
        locks: writeLocks(),
        said,
        hold,
        deliver: (building, target, kind, body) => deliverTo(building, target, kind, body),
      })
      /**
       * The commits left made in the background: a commit may wait for its task's own commands,
       * and never holds back the call that finished the task.
       */
      const commitsLeft = (building: BuildingRow) =>
        loop.commitLeft(building).pipe(
          provided,
          Effect.catchCause((cause) => said(`the commits were not made: ${String(cause)}`)),
          Effect.forkIn(layerScope),
          Effect.asVoid,
        )
      takeCut = (action) =>
        loop.cut(action).pipe(
          provided,
          Effect.catchCause((cause) =>
            Effect.as(said(`a command cut by a stop was not handed over: ${String(cause)}`), false),
          ),
        )

      const missionRowOf = (missionId: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const [row] = yield* database
            .select()
            .from(missions)
            .where(eq(missions.id, missionId))
            .pipe(Effect.mapError(refusedWhile('reading the mission')))
          return row ?? null
        })

      const basesOf = (building: BuildingRow) =>
        Option.getOrElse(bases.read(building.bases), () => [])

      /** The Workspace folder the Builder works in. */
      const folderOf = (building: BuildingRow) =>
        building.workspaceId === null
          ? Effect.succeed(null)
          : getWorkspace(building.workspaceId).pipe(
              Effect.map((workspace) => workspace.folder),
              Effect.catchTag('UnknownWorkspace', () => Effect.succeed(null)),
            )

      /**
       * The mission's Builder: opened when it never had one, its lineage started again when it
       * stopped (#40's resume: its leases and the resume block pass to the fresh one). A stuck one
       * is #40's to replace.
       */
      const ensureBuilder = (building: BuildingRow) =>
        Effect.gen(function* () {
          const owner = { kind: 'mission', missionId: building.missionId } as const
          const live = yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], owner)
          if (live.some((one) => one.role === 'builder')) return
          const last = (yield* sessionsIn(['ended', 'failed', 'replaced'], owner))
            .filter((one) => one.role === 'builder')
            .toSorted((a, b) => b.epoch - a.epoch)[0]
          if (last !== undefined) {
            const resumed = yield* Sessions.use((sessions) => sessions.resume(last.id))
            if (resumed === null)
              yield* said(`the Builder of ${building.missionId} was not resumed`)
            return
          }
          const folder = yield* folderOf(building)
          if (folder === null) return yield* said(`no Workspace for ${building.missionId}`)
          yield* Sessions.use((sessions) => sessions.open({ owner, role: 'builder', folder })).pipe(
            Effect.catchTag('SessionRefused', (refused) =>
              said(`no Builder for ${building.missionId}: ${refused.message}`),
            ),
          )
        })

      /** The interval of this engine's time, opened for a Building. */
      const countIn = (transaction: EngineTransaction, buildingId: string) =>
        Effect.gen(function* () {
          const at = now()
          counting.set(buildingId, at)
          yield* transaction
            .insert(buildingActivity)
            .values({ buildingId, startedAt: at, seenAt: at })
            .onConflictDoNothing()
            .pipe(Effect.mapError(refusedWhile('counting the time')))
        })

      const begin = (missionId: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const active = yield* activeBuildingIn(database, missionId)
          if (active !== null) return yield* ensureBuilder(active)
          const [launch] = yield* database
            .select()
            .from(buildingLaunches)
            .where(
              and(
                eq(buildingLaunches.missionId, missionId),
                eq(buildingLaunches.state, 'launched'),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('reading the launch')))
          if (launch?.workspaceId == null)
            return yield* said(`no launched Workspace for ${missionId}`)
          const workspace = yield* getWorkspace(launch.workspaceId)
          const id = crypto.randomUUID()
          const snapshots = yield* Snapshots
          const taken: BuildingBase[] = []
          for (const repository of workspace.repositories) {
            const tree = yield* snapshots.take(
              { name: repository.path, folder: repository.worktree },
              { kind: 'building', missionId, buildingId: id },
            )
            taken.push({
              repository: repository.path,
              folder: repository.worktree,
              branch: workspace.branch,
              commit: repository.base.commit,
              tree,
            })
          }
          const building = yield* mutate('starting the Building', (transaction) =>
            Effect.gen(function* () {
              const secrets = yield* Secrets
              if ((yield* activeBuildingIn(transaction, missionId)) !== null) {
                return { result: null, events: [] }
              }
              const row: BuildingRow = {
                id,
                missionId,
                label: 'Building',
                round: null,
                workspaceId: workspace.id,
                bases: bases.write(taken),
                phase: 'tasks',
                state: 'active',
                startedAt: now(),
                endedAt: null,
                tasksDoneAt: null,
                endCalledAt: null,
                summary: null,
              }
              yield* transaction
                .insert(buildings)
                .values(row)
                .pipe(Effect.mapError(refusedWhile('starting the Building')))
              const { tasks } = yield* planRows(transaction, missionId)
              for (const [rank, task] of tasks.entries()) {
                yield* transaction
                  .insert(buildingTasks)
                  .values({
                    buildingId: id,
                    id: task.id,
                    rank,
                    origin: 'spec',
                    title: secrets.mask(task.title),
                    result: secrets.mask(task.result),
                    requirements: writeStrings(task.requirements),
                    scenarios: writeStrings(task.scenarios),
                    targets: secrets.mask(JSON.stringify(task.targets)),
                    dependsOn: writeStrings(task.dependsOn),
                    state: 'waiting',
                    replacedBy: '[]',
                    changes: JSON.stringify([{ state: 'waiting', at: row.startedAt }]),
                  })
                  .pipe(Effect.mapError(refusedWhile('copying the tasks')))
              }
              yield* countIn(transaction, id)
              const settledNow = yield* settleIn(transaction, row, true)
              return {
                result: row,
                events: [
                  buildingEvent(missionId, 'building.started', {
                    buildingId: id,
                    label: row.label,
                    tasks: tasks.length,
                  }),
                  ...settledNow.events,
                ],
              }
            }),
          )
          if (building !== null) yield* ensureBuilder(building)
        })

      // ---- The calls of the Builder's tools.

      /** The mission, its active Building and the calling session, or the refusal. */
      const callerOf = (grant: Grant) =>
        Effect.gen(function* () {
          if (grant.missionId === null) return { refused: NO_MISSION } as const
          const database = yield* Database
          const building = yield* activeBuildingIn(database, grant.missionId)
          if (building === null) return { refused: NO_BUILDING } as const
          const session = yield* getSession(grant.sessionId)
          return { building, session, missionId: grant.missionId } as const
        })

      const agentOf = (session: RoleSession) => ({ sessionId: session.id, role: session.role })

      const taskIn = (tasks: ReadonlyArray<TaskNow>, id: string) =>
        tasks.find((task) => task.id === id) ?? null

      /** The snapshot of each repository for an attempt's side, or the failure. */
      const snapshotOf = (
        building: BuildingRow,
        attemptId: string,
        side: 'start' | 'end',
      ): Effect.Effect<
        ReadonlyArray<{ repository: string; tree: string }>,
        SnapshotFailed,
        Snapshots
      > =>
        Effect.forEach(basesOf(building), (base) =>
          Effect.map(
            Snapshots.use((snapshots) =>
              snapshots.take(
                { name: base.repository, folder: base.folder },
                { kind: 'attempt', missionId: building.missionId, attemptId, side },
              ),
            ),
            (tree) => ({ repository: base.repository, tree }),
          ),
        )

      const snapshotRefused = (building: BuildingRow, failed: SnapshotFailed, side: string) =>
        Effect.as(
          Snapshots.use((snapshots) => snapshots.failed(building.missionId, failed)),
          refusal(
            `refused: the ${side} snapshot of ${failed.repository} could not be taken: ${failed.message}`,
          ),
        )

      /**
       * Says a Building's tasks are done to its port, then marks it called: an engine stopped in
       * between calls it again at its next start, so the port is called at least once.
       */
      const ended = (building: BuildingRow) =>
        Effect.gen(function* () {
          yield* BuildingEnd.use((port) => port.end(building.missionId))
          yield* mutate('keeping that the end was called', (transaction) =>
            transaction
              .update(buildings)
              .set({ endCalledAt: now() })
              .where(eq(buildings.id, building.id))
              .pipe(
                Effect.mapError(refusedWhile('keeping that the end was called')),
                Effect.as({ result: undefined, events: [] }),
              ),
          )
          yield* deliver(
            building,
            'done',
            'Every task of the plan is done or skipped. Write the final summary with build_summary.',
          )
        })

      /** Whether the Building is still the mission's active one: a Cancel may have ended it. */
      const stillActive = (transaction: EngineTransaction, building: BuildingRow) =>
        Effect.map(
          activeBuildingIn(transaction, building.missionId),
          (active) => active?.id === building.id,
        )

      /**
       * A finished task judged: done once the verdict says so, then what that lets on; a red one
       * opens its next attempt, or at the third stops it (#142). Answers the verdict and, for a
       * red, what its runner is told.
       */
      const judge = (building: BuildingRow, taskId: string, attemptId: string) =>
        Effect.gen(function* () {
          const judgement = yield* TaskVerdict.use((port) =>
            port.judge({
              missionId: building.missionId,
              buildingId: building.id,
              taskId,
              attemptId,
            }),
          )
          if (judgement === 'pending') return { judgement, said: null }
          if (judgement === 'red') {
            return { judgement, said: yield* loop.redTask(building, taskId, attemptId) }
          }
          yield* hold('judging')
          const done = yield* mutate('judging a task', (transaction) =>
            Effect.gen(function* () {
              if (!(yield* stillActive(transaction, building))) return { result: null, events: [] }
              const task = taskIn(yield* tasksIn(transaction, building.id), taskId)
              if (task?.state !== 'checking') return { result: null, events: [] }
              const verified = judgement === 'verified'
              yield* moveIn(transaction, building.id, task, 'done', { verified })
              const settledNow = yield* settleIn(transaction, building)
              return {
                result: settledNow.done,
                events: [
                  ...(verified ? [loop.greenEvent(building.missionId, taskId)] : []),
                  buildingEvent(building.missionId, 'building.task_done', {
                    task: taskId,
                    verified,
                  }),
                  ...settledNow.events,
                ],
              }
            }),
          )
          if (done === null) return { judgement, said: null }
          yield* commitsLeft(building)
          if (done) yield* ended(building)
          return { judgement, said: null }
        })

      const read = (grant: Grant, args: ToolArguments<'build_read'>) =>
        Effect.gen(function* () {
          const caller = yield* callerOf(grant)
          if ('refused' in caller) return caller.refused
          const database = yield* Database
          const { building } = caller
          const tasks = yield* tasksIn(database, building.id)
          const attempts = yield* attemptsIn(database, building.id)
          if (args.task !== undefined) {
            const task = taskIn(tasks, args.task)
            if (task === null) return refusal(`refused: ${args.task} is not a task of the plan.`)
            const own = attempts.filter((one) => one.taskId === task.id)
            return answered(
              [
                planLine(task),
                task.runner === null ? null : `Runner: ${task.runner}.`,
                ...own.map((one) => {
                  const files = Option.getOrElse(attemptFiles.read(one.files), () => [])
                  return [
                    `Attempt ${String(one.number)}: ${one.endedAt === null ? 'open' : (one.outcome ?? 'ended')}`,
                    one.verdict === null ? '' : `, ${one.verdict.replace('_', ' ')}`,
                    one.summary === null ? '' : ` — ${one.summary}`,
                    files.length === 0
                      ? ''
                      : `; wrote ${files.map((file) => `${file.repository}/${file.path}`).join(', ')}`,
                    one.outside === '[]' ? '' : `; changed outside its targets: ${one.outside}`,
                  ].join('')
                }),
              ]
                .filter((line) => line !== null)
                .join('\n'),
            )
          }
          const claims = yield* claimsIn(database, building.id)
          const decisions = yield* decisionsIn(database, building.id)
          return answered(
            [
              `## Ready set\n\n${readySaid(tasks) ?? 'Nothing is available now.'}`,
              `## Tasks\n\n${tasks.map(planLine).join('\n')}`,
              `## Files held\n\n${claims.length === 0 ? 'None.' : claims.map((one) => `- ${one.repository}/${one.path}: ${one.taskId}`).join('\n')}`,
              `## Needs and decisions\n\n${
                decisions.length === 0
                  ? 'None.'
                  : decisions
                      .map(
                        (one) =>
                          `- ${one.question.split('\n')[0] ?? ''} (${one.state}${one.answer === null ? '' : `: ${one.answer}`})`,
                      )
                      .join('\n')
              }`,
            ].join('\n\n'),
          )
        })

      const start = (grant: Grant, args: ToolArguments<'task_start'>) =>
        Effect.gen(function* () {
          const caller = yield* callerOf(grant)
          if ('refused' in caller) return caller.refused
          const { building, session } = caller
          const database = yield* Database
          const task = taskIn(yield* tasksIn(database, building.id), args.task)
          if (task === null) return refusal(`refused: ${args.task} is not a task of the plan.`)
          if (task.state !== 'available') return refusal(notAvailableSaid(task))
          const holder = yield* holderIn(database, building.id, task)
          if (holder !== null) {
            yield* mutate('holding a task back', (transaction) =>
              transaction
                .update(buildingTasks)
                .set({ heldBack: holder.taskId })
                .where(
                  and(eq(buildingTasks.buildingId, building.id), eq(buildingTasks.id, task.id)),
                )
                .pipe(
                  Effect.mapError(refusedWhile('holding a task back')),
                  Effect.as({ result: undefined, events: [] }),
                ),
            )
            return refusal(
              `${task.id} waits: ${holder.repository}/${holder.path} is held by ${holder.taskId} (${holder.title}), which runs now. It is delivered again once ${holder.taskId} releases it.`,
            )
          }
          const attemptId = crypto.randomUUID()
          const starts = yield* Effect.result(snapshotOf(building, attemptId, 'start'))
          if (Result.isFailure(starts))
            return yield* snapshotRefused(building, starts.failure, 'start')
          yield* hold('starting')
          const outcome = yield* mutate('starting a task', (transaction) =>
            Effect.gen(function* () {
              if (!(yield* stillActive(transaction, building)))
                return { result: NO_BUILDING, events: [] }
              const current = taskIn(yield* tasksIn(transaction, building.id), task.id)
              if (current?.state !== 'available') {
                return {
                  result: refusal(current === null ? '' : notAvailableSaid(current)),
                  events: [],
                }
              }
              if ((yield* holderIn(transaction, building.id, current)) !== null) {
                return {
                  result: refusal(`refused: ${task.id}'s files were taken meanwhile: try again.`),
                  events: [],
                }
              }
              const number =
                (yield* attemptsIn(transaction, building.id)).filter(
                  (one) => one.taskId === task.id,
                ).length + 1
              yield* transaction
                .insert(buildingAttempts)
                .values({
                  id: attemptId,
                  buildingId: building.id,
                  taskId: task.id,
                  number,
                  runner: session.lineage,
                  epoch: session.epoch,
                  starts: writeTrees(starts.success),
                  startedAt: now(),
                  outside: '[]',
                })
                .pipe(Effect.mapError(refusedWhile('opening the attempt')))
              for (const target of task.targets) {
                yield* transaction
                  .insert(buildingClaims)
                  .values({
                    buildingId: building.id,
                    taskId: task.id,
                    repository: target.repository,
                    path: target.path,
                    runner: session.lineage,
                  })
                  .onConflictDoNothing()
                  .pipe(Effect.mapError(refusedWhile('taking the claims')))
              }
              const lease = yield* assignWorkIn(
                transaction,
                `building:${building.id}:${task.id}`,
                session,
              )
              yield* moveIn(transaction, building.id, current, 'in_progress', {
                runner: session.lineage,
                epoch: lease.result.lease.epoch,
                heldBack: null,
              })
              return {
                result: answered(
                  `${task.id} started: attempt ${String(number)}.${task.targets.length === 0 ? '' : ` Its files are yours until it is finished: ${task.targets.map((one) => `${one.intent} ${one.repository}/${one.path}`).join(', ')}.`}`,
                ),
                events: [
                  ...lease.events,
                  buildingEvent(
                    building.missionId,
                    'building.task_started',
                    { task: task.id, title: task.title, runner: session.lineage },
                    agentOf(session),
                  ),
                ],
              }
            }),
          )
          return outcome
        })

      const notRunnerSaid = (id: string, verb: string) =>
        refusal(`refused: ${id} is run by another session: only its runner says it ${verb}.`)

      /**
       * The task named, in progress and run by the caller now, with the lease as it was read, or
       * the refusal. The transaction that acts reads the lease again: it must not have moved.
       */
      const runnerTask = (
        reader: Database['Service'] | EngineTransaction,
        building: BuildingRow,
        grant: Grant,
        id: string,
        verb: string,
      ) =>
        Effect.gen(function* () {
          const task = taskIn(yield* tasksIn(reader, building.id), id)
          if (task === null) return refusal(`refused: ${id} is not a task of the plan.`)
          if (task.state !== 'in_progress') {
            return refusal(`refused: ${id} is not in progress: only a running task ${verb}.`)
          }
          const lease = yield* runnerSessionIn(reader, building.id, id)
          if (lease === null || lease.sessionId !== grant.sessionId) return notRunnerSaid(id, verb)
          return { task, lease }
        })

      /** Whether the lease read before is still the task's, at the same epoch. */
      const stillRunner = (
        transaction: EngineTransaction,
        building: BuildingRow,
        id: string,
        lease: { readonly sessionId: string; readonly epoch: number },
      ) =>
        Effect.map(
          runnerSessionIn(transaction, building.id, id),
          (held) =>
            held !== null && held.sessionId === lease.sessionId && held.epoch === lease.epoch,
        )

      const finished = (grant: Grant, args: ToolArguments<'task_finished'>) =>
        Effect.gen(function* () {
          const caller = yield* callerOf(grant)
          if ('refused' in caller) return caller.refused
          const { building, session } = caller
          const database = yield* Database
          const ran = yield* runnerTask(database, building, grant, args.task, 'is finished')
          if (!('task' in ran)) return ran
          const { task, lease } = ran
          const attempt = yield* openAttemptIn(database, building.id, task.id)
          const attemptId = attempt?.id ?? crypto.randomUUID()
          const ends = yield* Effect.result(snapshotOf(building, attemptId, 'end'))
          if (Result.isFailure(ends)) return yield* snapshotRefused(building, ends.failure, 'end')
          // The attempt's diff is what was written under its name, never its whole interval.
          const found = yield* Effect.result(
            attempt === null
              ? Effect.succeed({ files: [], nobody: [] })
              : loop.attemptFilesOf(building, task, attempt, ends.success),
          )
          if (Result.isFailure(found)) {
            if (!Predicate.isTagged(found.failure, 'SnapshotFailed')) {
              return yield* Effect.fail(found.failure)
            }
            return yield* snapshotRefused(building, found.failure, 'end')
          }
          const files = found.success
          const secrets = yield* Secrets
          yield* hold('finishing')
          const written = yield* mutate('finishing a task', (transaction) =>
            Effect.gen(function* () {
              if (!(yield* stillActive(transaction, building)))
                return { result: NO_BUILDING, events: [] }
              const current = taskIn(yield* tasksIn(transaction, building.id), task.id)
              if (current?.state !== 'in_progress') {
                return {
                  result: refusal(`refused: ${task.id} is no longer in progress.`),
                  events: [],
                }
              }
              // A call held past its check while the runner changed writes nothing.
              if (!(yield* stillRunner(transaction, building, task.id, lease))) {
                return { result: notRunnerSaid(task.id, 'is finished'), events: [] }
              }
              yield* transaction
                .update(buildingAttempts)
                .set({
                  ends: writeTrees(ends.success),
                  endedAt: now(),
                  outcome: 'finished',
                  summary: secrets.mask(args.summary),
                })
                .where(eq(buildingAttempts.id, attemptId))
                .pipe(Effect.mapError(refusedWhile('ending the attempt')))
              yield* loop.keepFilesIn(transaction, building, attemptId, files)
              yield* transaction
                .delete(buildingClaims)
                .where(
                  and(
                    eq(buildingClaims.buildingId, building.id),
                    eq(buildingClaims.taskId, task.id),
                  ),
                )
                .pipe(Effect.mapError(refusedWhile('releasing the claims')))
              yield* moveIn(transaction, building.id, current, 'checking')
              const settledNow = yield* settleIn(transaction, building)
              return {
                result: null,
                events: [
                  buildingEvent(
                    building.missionId,
                    'building.task_finished',
                    { task: task.id, summary: secrets.mask(args.summary) },
                    agentOf(session),
                  ),
                  ...settledNow.events,
                ],
              }
            }),
          )
          if (written !== null) return written
          const { judgement, said: red } = yield* judge(building, task.id, attemptId)
          if (red !== null) return answered(red)
          return answered(
            judgement === 'pending'
              ? `${task.id} is being checked: Hemera tells you the verdict.`
              : `${task.id} is done, ${judgement === 'verified' ? 'verified' : 'not verified: no check ran'}.`,
          )
        })

      /** Why an amendment does not apply, the targets checked at the Building's bases. */
      const amendmentRefusals = (building: BuildingRow, amendment: Amendment) =>
        Effect.gen(function* () {
          const database = yield* Database
          const tasks = yield* tasksIn(database, building.id)
          const coverable = yield* database.transaction((transaction) =>
            liveIn(transaction, building.missionId),
          )
          const problems = [
            ...amendmentProblems(tasks, amendment, {
              requirements: new Set(coverable.requirements),
              scenarios: new Set(coverable.scenarios),
            }),
          ]
          const added = addedBy(amendment)
          if (added.length > 0) {
            const place = yield* placeOf(building.missionId)
            const at = new Map(basesOf(building).map((one) => [one.repository, one.commit]))
            const { bases: found } = yield* basesAt(
              place,
              new Set(added.flatMap((task) => task.targets.map((one) => one.repository))),
              false,
              at,
            )
            for (const task of added) {
              for (const target of task.targets) {
                const problem = yield* targetProblem(place, found, task.id, target)
                if (problem !== null) problems.push(problem)
              }
            }
          }
          return problems
        })

      /** A need created for a request, its decision row, and the tasks it holds blocked. */
      const requested = (
        building: BuildingRow,
        session: RoleSession,
        asked: {
          readonly kind: string
          readonly tasks: ReadonlyArray<string>
          readonly fields: typeof DecisionFields.Type | typeof EnvironmentFields.Type
          readonly amendment: Amendment | null
          /** What the request's own check says again in the transaction: a refusal, or null. */
          readonly still: (
            transaction: EngineTransaction,
          ) => Effect.Effect<ToolAnswer | null, DatabaseError>
        },
      ) =>
        Effect.gen(function* () {
          const mission = yield* missionRowOf(building.missionId)
          if (mission === null) return NO_BUILDING
          const secrets = yield* Secrets
          const write = yield* createNeedIn(
            BUILDER_NEEDS,
            MissionOwner.make({
              projectId: mission.projectId,
              missionId: building.missionId,
              taskId: asked.tasks.length === 1 ? (asked.tasks[0] ?? null) : null,
            }),
            asked.fields,
          )
          return yield* mutate('asking the user', (transaction) =>
            Effect.gen(function* () {
              const moved = yield* asked.still(transaction)
              if (moved !== null) return { result: moved, events: [] }
              const need = yield* write(transaction)
              const decision = Predicate.isTagged(asked.fields, 'Decision') ? asked.fields : null
              yield* transaction
                .insert(buildingDecisions)
                .values({
                  id: crypto.randomUUID(),
                  buildingId: building.id,
                  needId: need.id,
                  kind: asked.kind,
                  tasks: writeStrings(asked.tasks),
                  question: secrets.mask(
                    decision?.question ??
                      (Predicate.isTagged(asked.fields, 'Environment') ? asked.fields.missing : ''),
                  ),
                  options: secrets.mask(writeStrings(decision?.options ?? [])),
                  recommended:
                    decision?.recommended == null
                      ? null
                      : secrets.mask(decision.recommended.option),
                  amendment:
                    asked.amendment === null
                      ? null
                      : secrets.mask(amendments.write(asked.amendment)),
                  state: 'pending',
                  requestedBy: session.id,
                  requestedAt: now(),
                })
                .pipe(Effect.mapError(refusedWhile('keeping the decision')))
              const blocked = yield* blockIn(
                transaction,
                building,
                asked.tasks,
                NeedCause.make({ needId: need.id }),
                need.id,
              )
              return {
                result: null,
                events: [
                  ...need.events,
                  buildingEvent(
                    building.missionId,
                    'building.need_requested',
                    { kind: asked.kind, tasks: [...asked.tasks], need: need.id },
                    agentOf(session),
                  ),
                  ...blocked,
                ],
              }
            }),
          )
        })

      /** What the Builder is told once a request became a need. */
      const askedSaid = (building: BuildingRow, held: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const database = yield* Database
          const tasks = yield* tasksIn(database, building.id)
          const ready = readySet(tasks).map((one) => one.id)
          return [
            held.length === 0
              ? 'The user is asked; it holds no task.'
              : `${listed(held)} ${held.length === 1 ? 'is' : 'are'} blocked: the user is asked.`,
            ready.length === 0 ? null : `Go on with ${listed(ready)}.`,
          ]
            .filter((part) => part !== null)
            .join(' ')
        })

      const blocked = (grant: Grant, args: ToolArguments<'task_blocked'>) =>
        Effect.gen(function* () {
          const caller = yield* callerOf(grant)
          if ('refused' in caller) return caller.refused
          const { building, session } = caller
          const database = yield* Database
          const ran = yield* runnerTask(database, building, grant, args.task, 'is blocked')
          if (!('task' in ran)) return ran
          const { task, lease } = ran
          if (!args.options.includes(args.recommended)) {
            return refusal('refused: the option you recommend is not one of your options.')
          }
          const amendment = args.amendment ?? null
          if (amendment !== null) {
            const problems = yield* amendmentRefusals(building, amendment)
            if (problems.length > 0) {
              return refusal(`refused: the amendment does not apply: ${problems.join(' ')}`)
            }
          }
          const question = [
            `${task.id} · ${task.title}: ${args.reason}`,
            amendment === null
              ? null
              : `Choosing "${args.recommended}" changes the plan: ${amendmentSaid(amendment)}`,
          ]
            .filter((part) => part !== null)
            .join('\n\n')
          const refused = yield* requested(building, session, {
            kind: args.kind,
            tasks: [task.id],
            still: (transaction) =>
              Effect.map(stillRunner(transaction, building, task.id, lease), (runs) =>
                runs ? null : notRunnerSaid(task.id, 'is blocked'),
              ),
            fields: DecisionFields.make({
              question,
              options: args.options,
              recommended: { option: args.recommended, reason: args.recommended_reason },
            }),
            amendment,
          })
          if (refused !== null) return refused
          return answered(yield* askedSaid(building, [task.id]))
        })

      const need = (grant: Grant, args: ToolArguments<'report_need'>) =>
        Effect.gen(function* () {
          const caller = yield* callerOf(grant)
          if ('refused' in caller) return caller.refused
          const { building, session } = caller
          const database = yield* Database
          const tasks = yield* tasksIn(database, building.id)
          const unknown = unknownTasks(tasks, args.tasks)
          if (unknown.length > 0) {
            return refusal(`refused: ${listed(unknown)} is no task of the plan.`)
          }
          const unheld = unholdable(tasks, args.tasks)
          if (unheld !== null) return unheld
          let fields: typeof DecisionFields.Type | typeof EnvironmentFields.Type
          if (args.kind === 'environment') {
            fields = EnvironmentFields.make({
              missing: args.text,
              action: args.action ?? 'Fix what it says, then Retry: the tasks it holds go on.',
              settingsSection: null,
            })
          } else {
            if (args.options === undefined) return refusal('refused: a decision needs its options.')
            if (args.recommended !== undefined && !args.options.includes(args.recommended)) {
              return refusal('refused: the option you recommend is not one of your options.')
            }
            fields = DecisionFields.make({
              question: args.text,
              options: args.options,
              recommended:
                args.recommended === undefined
                  ? null
                  : { option: args.recommended, reason: 'Recommended by the Builder.' },
            })
          }
          const refused = yield* requested(building, session, {
            kind: args.kind,
            tasks: args.tasks,
            fields,
            amendment: null,
            still: (transaction) =>
              Effect.map(tasksIn(transaction, building.id), (current) =>
                unholdable(current, args.tasks),
              ),
          })
          if (refused !== null) return refused
          return answered(yield* askedSaid(building, args.tasks))
        })

      const summary = (grant: Grant, args: ToolArguments<'build_summary'>) =>
        Effect.gen(function* () {
          const caller = yield* callerOf(grant)
          if ('refused' in caller) return caller.refused
          const secrets = yield* Secrets
          yield* mutate('keeping the summary', (transaction) =>
            transaction
              .update(buildings)
              .set({ summary: secrets.mask(args.text) })
              .where(eq(buildings.id, caller.building.id))
              .pipe(
                Effect.mapError(refusedWhile('keeping the summary')),
                Effect.as({ result: undefined, events: [] }),
              ),
          )
          return answered('The summary is kept.')
        })

      /**
       * A write of a mission's session: refused when another running task holds the file, naming
       * it; recorded in the writer's open attempts when it is outside their targets; held while
       * another task's command holds the write lock there, then let on with what it waited for.
       */
      const claim = (call: GuardedCall) =>
        Effect.gen(function* () {
          const missionId = call.session.missionId
          if (missionId === null || call.path === null) return null
          const database = yield* Database
          const building = yield* activeBuildingIn(database, missionId)
          if (building === null) return null
          const file = fileOf(building, call.path.resolved)
          if (file === null) return null
          const writer = yield* getSession(call.session.sessionId)
          const named = `${file.repository}/${file.path}`
          const held = (yield* claimsIn(database, building.id)).find(
            (one) => one.repository === file.repository && one.path === file.path,
          )
          const tasks = yield* tasksIn(database, building.id)
          if (held !== undefined && held.runner !== writer.lineage) {
            const title = taskIn(tasks, held.taskId)?.title ?? ''
            return `refused: ${named} is held by ${held.taskId} (${title}), which runs now: leave it, or wait for ${held.taskId}.`
          }
          const running = runningOf(tasks, writer.lineage)
          const targeted = running.some((task) =>
            task.targets.some(
              (one) => one.repository === file.repository && one.path === file.path,
            ),
          )
          const waited = () => loop.waitForLock(building, writer.id, writer.lineage, tasks, file)
          if (running.length === 0 || targeted) return yield* waited()
          yield* mutate('recording a write outside the targets', (transaction) =>
            Effect.gen(function* () {
              for (const task of running) {
                const attempt = yield* openAttemptIn(transaction, building.id, task.id)
                if (attempt === null) continue
                const outside = [...new Set([...JSON.parse(attempt.outside), named])]
                yield* transaction
                  .update(buildingAttempts)
                  .set({ outside: writeStrings(outside) })
                  .where(eq(buildingAttempts.id, attempt.id))
                  .pipe(Effect.mapError(refusedWhile('recording a write outside the targets')))
              }
              return { result: undefined, events: [] }
            }),
          )
          return yield* waited()
        }).pipe(
          provided,
          // A claim that cannot be checked refuses the write rather than let it through.
          Effect.catchCause((cause) =>
            Effect.as(
              said(`a claim was not checked: ${String(cause)}`),
              'refused: the files held by the running tasks could not be checked: try again.',
            ),
          ),
        )

      const answering =
        <A extends ToolArguments<'build_read'> | object>(
          work: (grant: Grant, args: A) => Effect.Effect<ToolAnswer, unknown, Needs>,
        ) =>
        (grant: Grant, args: A) =>
          work(grant, args).pipe(
            provided,
            Effect.catchCause((cause) =>
              Effect.succeed(
                failure(`the call failed: ${Cause.pretty(cause).split('\n')[0] ?? ''}`),
              ),
            ),
          )

      yield* BuildDesk.use((desk) =>
        desk.serve({
          read: answering(read),
          start: answering(start),
          finished: answering(finished),
          blocked: answering(blocked),
          need: answering(need),
          propose: answering(loop.propose),
          summary: answering(summary),
          claim,
          attribution: {
            written: (file) => (transaction) => loop.attribution.written(file)(transaction),
            command: (asked) =>
              loop.attribution.command(asked).pipe(
                provided,
                Effect.catchCause((cause) =>
                  Effect.as(said(`a command was not watched: ${String(cause)}`), null),
                ),
              ),
            // Whatever ends the write, interrupted or dead included, ends its hold.
            holding: (file, write) =>
              Effect.suspend(() => {
                const sink: WriteInProgress[] = []
                return loop.beginHold(file, sink).pipe(
                  provided,
                  Effect.flatMap((waited) => Effect.map(write, (result) => ({ result, waited }))),
                  Effect.ensuring(
                    Effect.suspend(() =>
                      Effect.forEach(sink.splice(0), loop.endHold, { discard: true }),
                    ),
                  ),
                )
              }),
          },
          judgeScope: (missionId, scope, subject) =>
            loop.judgeScope(missionId, scope, subject).pipe(provided, Effect.orDie),
        }),
      )

      // ---- What the Builder is told.

      /** A delivery to a lineage of the mission, or to its Builder, kept until it is taken. */
      function deliverTo(
        building: BuildingRow,
        target: { readonly lineage: string } | { readonly role: string },
        kind: string,
        body: string,
      ) {
        return Sessions.use((sessions) =>
          sessions.deliver({
            owner: { kind: 'mission', missionId: building.missionId },
            target,
            kind,
            body,
          }),
        ).pipe(
          Effect.asVoid,
          Effect.catchTag('DeliveryKindRefused', (refused) => said(refused.message)),
          provided,
        )
      }

      /** A delivery to the mission's Builder, kept until a Builder takes it. */
      function deliver(building: BuildingRow, kind: string, body: string) {
        return Sessions.use((sessions) =>
          sessions.deliver({
            owner: { kind: 'mission', missionId: building.missionId },
            target: { role: 'builder' },
            kind,
            body,
          }),
        ).pipe(
          Effect.asVoid,
          Effect.catchTag('DeliveryKindRefused', (refused) => said(refused.message)),
        )
      }

      const readyDelivery = (building: BuildingRow, current: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const database = yield* Database
          const tasks = yield* tasksIn(database, building.id)
          const ready = readySet(tasks)
          if (ready.length === 0) return
          yield* deliver(
            building,
            'ready',
            [
              `Available now: ${listed(current)}.`,
              '',
              'The ready set:',
              ...ready.map(readyLine),
            ].join('\n'),
          )
        })

      /** A need of the Builder's answered: its decision kept, the amendment applied if chosen. */
      apply = (answeredNeed, transaction) =>
        Effect.gen(function* () {
          const found = yield* decisionOfNeedIn(transaction, answeredNeed.id)
          if (found === null || found.building.state !== 'active') return []
          const { decision, building } = found
          const secrets = yield* Secrets
          const answer = answerOf(answeredNeed)
          const events: NewEvent[] = []
          const amendment =
            decision.amendment === null
              ? null
              : Option.getOrNull(amendments.read(decision.amendment))
          const chosen = amendment !== null && answer !== null && answer === decision.recommended
          if (chosen) {
            // The plan may have moved since the request: the amendment is checked again.
            const coverable = yield* liveIn(transaction, building.missionId)
            const problems = amendmentProblems(
              yield* tasksIn(transaction, building.id),
              amendment,
              {
                requirements: new Set(coverable.requirements),
                scenarios: new Set(coverable.scenarios),
              },
            )
            if (problems.length > 0) {
              const reason = `the plan moved since it was asked: ${problems.join(' ')}`
              events.push(...(yield* expireNeedIn(transaction, answeredNeed.id, reason)))
              yield* transaction
                .update(buildingDecisions)
                .set({ state: 'expired', answeredAt: now() })
                .where(eq(buildingDecisions.id, decision.id))
                .pipe(Effect.mapError(refusedWhile('expiring the decision')))
              yield* unblockIn(transaction, building, answeredNeed.id)
              return [...events, ...(yield* settleIn(transaction, building)).events]
            }
            events.push(...(yield* applyAmendmentIn(transaction, building, decision.id, amendment)))
          }
          yield* transaction
            .update(buildingDecisions)
            .set({
              state: 'answered',
              answer: answer === null ? null : secrets.mask(answer),
              applied: chosen,
              answeredAt: now(),
            })
            .where(eq(buildingDecisions.id, decision.id))
            .pipe(Effect.mapError(refusedWhile('keeping the answer')))
          // After three reds, the answer is the next attempt's direction: the count restarts.
          if (decision.kind === 'error')
            yield* loop.answeredErrorIn(transaction, building, decision)
          yield* unblockIn(transaction, building, answeredNeed.id)
          const settledNow = yield* settleIn(transaction, building)
          return [
            buildingEvent(building.missionId, 'building.decision', {
              kind: decision.kind,
              runner: decision.proposer,
              question: decision.question,
              answer: secrets.mask(answer ?? ''),
              amendment:
                chosen && amendment !== null ? secrets.mask(amendmentSaid(amendment)) : null,
              tasks: JSON.parse(decision.tasks),
            }),
            ...events,
            ...settledNow.events,
          ]
        }).pipe(Effect.provide(context))

      /** A need of the Builder's that no longer holds, or that the user's Retry withdrew. */
      const needEnded = (needId: string, how: 'expired' | 'withdrawn', reason: string | null) =>
        Effect.gen(function* () {
          const outcome = yield* mutate('releasing what a need held', (transaction) =>
            Effect.gen(function* () {
              const found = yield* decisionOfNeedIn(transaction, needId)
              if (found === null || found.building.state !== 'active') {
                return { result: null, events: [] }
              }
              // An answer whose amendment no longer applied expired it and released its tasks
              // already: only the Builder is left to tell.
              if (found.decision.state === how) return { result: found, events: [] }
              if (found.decision.state !== 'pending') return { result: null, events: [] }
              yield* transaction
                .update(buildingDecisions)
                .set({ state: how, answeredAt: now() })
                .where(eq(buildingDecisions.id, found.decision.id))
                .pipe(Effect.mapError(refusedWhile('ending the decision')))
              yield* unblockIn(transaction, found.building, needId)
              const settledNow = yield* settleIn(transaction, found.building)
              return { result: found, events: settledNow.events }
            }),
          )
          if (outcome === null) return
          const tasks = JSON.parse(outcome.decision.tasks).join(', ')
          yield* deliver(
            outcome.building,
            how === 'expired' ? 'expiry' : 'answer',
            how === 'expired'
              ? `Your request no longer holds and expired: ${outcome.decision.question.split('\n')[0] ?? ''}${reason === null ? '' : `\nWhy: ${reason}`}${tasks === '' ? '' : `\nThe tasks it held (${tasks}) are back.`}`
              : `The user says it is fixed: ${outcome.decision.question}${tasks === '' ? '' : `\nThe tasks it held (${tasks}) are back.`}`,
          )
        })

      /** A mission cancelled: its Building ends as cancelled; the work stays. */
      const cancelled = (missionId: string) =>
        mutate('cancelling the Building', (transaction) =>
          Effect.gen(function* () {
            const building = yield* activeBuildingIn(transaction, missionId)
            if (building === null) return { result: undefined, events: [] }
            yield* transaction
              .update(buildings)
              .set({ state: 'cancelled', endedAt: now() })
              .where(eq(buildings.id, building.id))
              .pipe(Effect.mapError(refusedWhile('cancelling the Building')))
            yield* transaction
              .delete(buildingClaims)
              .where(eq(buildingClaims.buildingId, building.id))
              .pipe(Effect.mapError(refusedWhile('releasing the claims')))
            for (const task of yield* tasksIn(transaction, building.id)) {
              if (task.state !== 'in_progress') continue
              const attempt = yield* openAttemptIn(transaction, building.id, task.id)
              if (attempt === null) continue
              yield* transaction
                .update(buildingAttempts)
                .set({ endedAt: now(), outcome: 'cancelled' })
                .where(eq(buildingAttempts.id, attempt.id))
                .pipe(Effect.mapError(refusedWhile('ending the attempt')))
            }
            counting.delete(building.id)
            return { result: undefined, events: [] }
          }),
        )

      const answerDelivery = (missionId: string, payload: NewEvent['payload']) =>
        Effect.gen(function* () {
          const database = yield* Database
          const building = yield* activeBuildingIn(database, missionId)
          if (building === null || payload === undefined) return
          const runner = Option.getOrNull(readString(payload['runner']))
          if (payload['kind'] === 'error') {
            const tasks = Array.isArray(payload['tasks']) ? payload['tasks'].map(String) : []
            yield* deliverTo(
              building,
              runner === null ? { role: 'builder' } : { lineage: runner },
              'answer',
              [
                `The user answered your three reds${tasks.length === 0 ? '' : ` on ${listed(tasks)}`}: ${String(payload['answer'] ?? '')}`,
                tasks.length === 0
                  ? 'Take it as the direction of your next attempt.'
                  : `Take it as the direction of the next attempt: start ${listed(tasks)} again with task_start.`,
              ].join('\n'),
            )
            return
          }
          const amendment = Option.getOrNull(readString(payload['amendment']))
          yield* deliver(
            building,
            'answer',
            [
              `The user answered: ${String(payload['answer'] ?? '')}`,
              `Your request: ${String(payload['question'] ?? '')}`,
              amendment === null ? null : `The plan changed: ${amendment}`,
            ]
              .filter((part) => part !== null)
              .join('\n'),
          )
        })

      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      const follow = events.pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const payload = event.payload ?? {}
            if (event.type === 'building.task_available' && payload['initial'] !== true) {
              const database = yield* Database
              const building = yield* activeBuildingIn(database, event.entityId)
              const tasks = payload['tasks']
              if (building !== null && Array.isArray(tasks)) {
                yield* readyDelivery(building, tasks.map(String))
              }
            }
            if (event.type === 'building.decision') yield* answerDelivery(event.entityId, payload)
            if (
              (event.type === 'need.expired' || event.type === 'need.withdrawn') &&
              payload['service'] === BUILDER_NEEDS
            ) {
              yield* needEnded(
                event.entityId,
                event.type === 'need.expired' ? 'expired' : 'withdrawn',
                Option.getOrNull(readString(payload['reason'])),
              )
            }
            if (event.type === 'mission.cancelled') yield* cancelled(event.entityId)
          }).pipe(
            provided,
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : said(`an event was not followed: ${String(cause)}`),
            ),
          ),
        ),
      )

      // At every start: each active Building counts this engine's time, judges again a task left
      // checking, says it resumed, and has its Builder.
      const resume = Effect.gen(function* () {
        for (const building of yield* activeBuildings) {
          // What a stop cut in the middle, before anything acts again (CT-09).
          yield* loop
            .restarted(building)
            .pipe(
              Effect.catchCause((cause) =>
                said(`the actions a stop left were not handed over: ${String(cause)}`),
              ),
            )
          const checking = yield* mutate('resuming the Building', (transaction) =>
            Effect.gen(function* () {
              yield* countIn(transaction, building.id)
              const tasks = yield* tasksIn(transaction, building.id)
              return {
                result: tasks.filter((task) => task.state === 'checking').map((task) => task.id),
                events: [buildingEvent(building.missionId, 'building.resumed')],
              }
            }),
          )
          for (const taskId of checking) {
            const attempts = yield* attemptsIn(yield* Database, building.id)
            const last = attempts.findLast((one) => one.taskId === taskId)
            yield* judge(building, taskId, last?.id ?? '')
          }
          if (building.tasksDoneAt !== null && building.endCalledAt === null) yield* ended(building)
          // A stop between a task's done and its commit: the commit is made now.
          yield* commitsLeft(building)
          yield* ensureBuilder(building)
        }
      })

      const heartbeat = Effect.gen(function* () {
        const database = yield* Database
        for (const [buildingId, startedAt] of counting) {
          yield* database
            .update(buildingActivity)
            .set({ seenAt: now() })
            .where(
              and(
                eq(buildingActivity.buildingId, buildingId),
                eq(buildingActivity.startedAt, startedAt),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('counting the time')))
        }
      }).pipe(
        Effect.catchCause((cause) => said(`the time spent was not written: ${String(cause)}`)),
        Effect.repeat(Schedule.spaced(HEARTBEAT)),
      )

      yield* AutomationGate.use((gate) => gate.pass).pipe(
        Effect.andThen(
          Effect.all(
            [
              follow,
              heartbeat,
              resume.pipe(
                Effect.catchCause((cause) =>
                  said(`the Buildings did not resume: ${String(cause)}`),
                ),
              ),
            ],
            { concurrency: 'unbounded', discard: true },
          ),
        ),
        provided,
        Effect.catchCause((cause) => said(`the Builder stopped: ${String(cause)}`)),
        Effect.forkScoped,
      )

      return {
        start: (missionId: string) =>
          Semaphore.withPermits(
            lock,
            1,
          )(begin(missionId)).pipe(
            provided,
            Effect.catchTag('SnapshotFailed', (failed) =>
              Effect.andThen(
                Snapshots.use((snapshots) => snapshots.failed(missionId, failed)).pipe(provided),
                Effect.die(new Error(`the base snapshot could not be taken: ${failed.message}`)),
              ),
            ),
            Effect.orDie,
          ),
      }
    }),
  )
  return { layer, handler, cut, restarted, handed }
}
