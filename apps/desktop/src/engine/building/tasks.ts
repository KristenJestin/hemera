/**
 * The tasks of a Building as they are kept (#141): the Building's row, its effective plan (the
 * frozen tasks copied at its start, and the tasks amendments brought), each task's state and the
 * dates of every change, its attempts with their snapshots, the files running tasks hold, and the
 * decisions taken during Building. Everything here reads or writes inside a transaction a caller
 * holds and answers the events it records; nothing here leaves the database.
 *
 * Hemera owns every state: a move is one of the functions here, never an agent's word.
 */

import {
  type Amendment,
  type BuildTaskNow,
  TaskAmendment,
  TaskOrigin,
  TaskState,
  TaskTarget,
  amendedPlan,
  amendmentSaid,
  claimHolder,
  dependantsOf,
  percentDone,
  promotable,
  requirementDone,
  settled,
  taskText,
} from '@hemera/core/domain'
import {
  type BuildingAttemptView,
  type BuildingDecisionView,
  BuildingTree,
  type BuildingTaskView,
  type BuildingView,
  UnknownBuildingTask,
} from '@hemera/ipc'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { Effect, Option, Predicate, Schema, Stream } from 'effect'

import { DomainEvents } from '../domain-events.ts'
import type { NewEvent } from '../journal.ts'
import { missionRow } from '../planning/store.ts'
import { Secrets } from '../secrets.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  buildingActivity,
  buildingAttempts,
  buildingClaims,
  buildingDecisions,
  buildingTasks,
  buildings,
  runnerLeases,
} from '../storage/schema.ts'

type Reader = EngineTransaction | Database['Service']
export type BuildingRow = typeof buildings.$inferSelect
type TaskRow = typeof buildingTasks.$inferSelect
type AttemptRow = typeof buildingAttempts.$inferSelect
export type DecisionRow = typeof buildingDecisions.$inferSelect

export const now = (): string => new Date().toISOString()

/** What holds a blocked task: a need, or a task it depends on that is blocked. */
export const NeedCause = Schema.TaggedStruct('Need', { needId: Schema.String })
export const TaskCause = Schema.TaggedStruct('Task', { taskId: Schema.String })
export const BlockCause = Schema.Union([NeedCause, TaskCause])
export type BlockCause = typeof BlockCause.Type

/** A repository of the Workspace and its base snapshot, taken at the Building's start. */
export const BuildingBase = Schema.Struct({
  repository: Schema.String,
  folder: Schema.String,
  branch: Schema.NullOr(Schema.String),
  commit: Schema.String,
  tree: Schema.String,
})
export type BuildingBase = typeof BuildingBase.Type

const Change = Schema.Struct({ state: TaskState, at: Schema.String })
type Change = typeof Change.Type

const json = <A, E>(schema: Schema.Codec<A, E>) => {
  const codec = Schema.fromJsonString(schema)
  return {
    read: Schema.decodeUnknownOption(codec),
    write: (value: A): string => Schema.encodeSync(codec)(value),
  }
}

const strings = json(Schema.Array(Schema.String))
const targets = json(Schema.Array(TaskTarget))
const changes = json(Schema.Array(Change))
const cause = json(BlockCause)
const trees = json(Schema.Array(BuildingTree))
export const bases = json(Schema.Array(BuildingBase))
export const amendments = json(TaskAmendment)

const stringsOf = (text: string): ReadonlyArray<string> =>
  Option.getOrElse(strings.read(text), () => [])
export const writeStrings = strings.write
export const writeTrees = trees.write

/** A task of the effective plan with what Hemera keeps of it beside the rules' fields. */
export interface TaskNow extends BuildTaskNow {
  readonly rank: number
  readonly origin: TaskOrigin
  readonly decisionId: string | null
  readonly verified: boolean | null
  readonly runner: string | null
  readonly blockedBy: BlockCause | null
  readonly skippedReason: string | null
  readonly heldBack: string | null
  readonly changes: ReadonlyArray<Change>
}

const taskNowOf = (row: TaskRow): TaskNow => ({
  id: row.id,
  title: row.title,
  result: row.result,
  requirements: stringsOf(row.requirements),
  scenarios: stringsOf(row.scenarios),
  targets: Option.getOrElse(targets.read(row.targets), () => []),
  dependsOn: stringsOf(row.dependsOn),
  state: TaskState.literals.find((one) => one === row.state) ?? 'waiting',
  replacedBy: stringsOf(row.replacedBy),
  rank: row.rank,
  origin: TaskOrigin.literals.find((one) => one === row.origin) ?? 'spec',
  decisionId: row.decisionId,
  verified: row.verified,
  runner: row.runner,
  blockedBy: row.blockedBy === null ? null : Option.getOrNull(cause.read(row.blockedBy)),
  skippedReason: row.skippedReason,
  heldBack: row.heldBack,
  changes: Option.getOrElse(changes.read(row.changes), () => []),
})

/** The mission's Building that is not over, or null. */
export const activeBuildingIn = (reader: Reader, missionId: string) =>
  reader
    .select()
    .from(buildings)
    .where(and(eq(buildings.missionId, missionId), eq(buildings.state, 'active')))
    .pipe(
      Effect.mapError(refusedWhile('reading the Building')),
      Effect.map(([row]) => row ?? null),
    )

/** The mission's latest Building, over or not, or null before its first. */
export const latestBuildingIn = (reader: Reader, missionId: string) =>
  reader
    .select()
    .from(buildings)
    .where(eq(buildings.missionId, missionId))
    .orderBy(desc(buildings.startedAt))
    .limit(1)
    .pipe(
      Effect.mapError(refusedWhile('reading the Building')),
      Effect.map(([row]) => row ?? null),
    )

/** Every Building not over, at the start of an engine. */
export const activeBuildings = Effect.gen(function* () {
  const database = yield* Database
  return yield* database
    .select()
    .from(buildings)
    .where(eq(buildings.state, 'active'))
    .pipe(Effect.mapError(refusedWhile('reading the Buildings')))
})

/** The effective plan, in its order. */
export const tasksIn = (reader: Reader, buildingId: string) =>
  reader
    .select()
    .from(buildingTasks)
    .where(eq(buildingTasks.buildingId, buildingId))
    .orderBy(asc(buildingTasks.rank))
    .pipe(
      Effect.mapError(refusedWhile('reading the tasks')),
      Effect.map((rows) => rows.map(taskNowOf)),
    )

/** The files the running tasks hold. */
export const claimsIn = (reader: Reader, buildingId: string) =>
  reader
    .select()
    .from(buildingClaims)
    .where(eq(buildingClaims.buildingId, buildingId))
    .pipe(Effect.mapError(refusedWhile('reading the claims')))

export const attemptsIn = (reader: Reader, buildingId: string) =>
  reader
    .select()
    .from(buildingAttempts)
    .where(eq(buildingAttempts.buildingId, buildingId))
    .orderBy(asc(buildingAttempts.startedAt), asc(buildingAttempts.number))
    .pipe(Effect.mapError(refusedWhile('reading the attempts')))

export const decisionsIn = (reader: Reader, buildingId: string) =>
  reader
    .select()
    .from(buildingDecisions)
    .where(eq(buildingDecisions.buildingId, buildingId))
    .orderBy(asc(buildingDecisions.requestedAt))
    .pipe(Effect.mapError(refusedWhile('reading the decisions')))

/** The work item a task's runner lease names (#40). */
export const workItemOf = (buildingId: string, taskId: string): string =>
  `building:${buildingId}:${taskId}`

/** The session holding a task's lease now, or null. */
export const runnerSessionIn = (reader: Reader, buildingId: string, taskId: string) =>
  reader
    .select({ sessionId: runnerLeases.sessionId, epoch: runnerLeases.epoch })
    .from(runnerLeases)
    .where(eq(runnerLeases.workItem, workItemOf(buildingId, taskId)))
    .pipe(
      Effect.mapError(refusedWhile('reading a lease')),
      Effect.map(([row]) => row ?? null),
    )

/** A Building's event, in the mission's Journal. */
export const buildingEvent = (
  missionId: string,
  type: string,
  payload: NewEvent['payload'] = {},
  agent: { readonly sessionId: string; readonly role: string } | null = null,
): NewEvent => ({
  type,
  entityKind: 'mission',
  entityId: missionId,
  source: 'system',
  author: agent === null ? 'hemera' : 'agent',
  payload: agent === null ? payload : { ...payload, ...agent },
})

/** A task moved to a state, its change dated, with whatever else it holds now. */
export const moveIn = (
  transaction: EngineTransaction,
  buildingId: string,
  task: TaskNow,
  state: TaskNow['state'],
  set: Partial<
    Pick<
      typeof buildingTasks.$inferInsert,
      'verified' | 'runner' | 'epoch' | 'blockedBy' | 'skippedReason' | 'replacedBy' | 'heldBack'
    >
  > = {},
) =>
  transaction
    .update(buildingTasks)
    .set({ ...set, state, changes: changes.write([...task.changes, { state, at: now() }]) })
    .where(and(eq(buildingTasks.buildingId, buildingId), eq(buildingTasks.id, task.id)))
    .pipe(Effect.mapError(refusedWhile('moving a task')), Effect.asVoid)

/** The cause of a block, as the page and the brief say it. */
export const causeSaid = (blocked: BlockCause): string =>
  Predicate.isTagged(blocked, 'Task') ? `${blocked.taskId} is blocked` : 'a need waits for the user'

/**
 * After any move: the tasks held by a blocked task they no longer depend on wait again, the
 * waiting tasks whose dependencies are done become available, the tasks a released claim held
 * back are delivered again, and once every task is done or skipped the Building's tasks are done,
 * once. Answers the events, and whether the tasks are done now.
 */
export const settleIn = (transaction: EngineTransaction, building: BuildingRow, initial = false) =>
  Effect.gen(function* () {
    let tasks = yield* tasksIn(transaction, building.id)
    const events: NewEvent[] = []
    // A task held only because a dependency was blocked waits again once none is.
    let freed = true
    while (freed) {
      freed = false
      for (const task of tasks) {
        if (task.state !== 'blocked' || !Predicate.isTagged(task.blockedBy, 'Task')) continue
        const stillBlocked = tasks.find(
          (one) => one.state === 'blocked' && dependantsOf(one.id, tasks).includes(task.id),
        )
        if (stillBlocked !== undefined) {
          if (stillBlocked.id !== task.blockedBy.taskId) {
            yield* moveIn(transaction, building.id, task, 'blocked', {
              blockedBy: cause.write(TaskCause.make({ taskId: stillBlocked.id })),
            })
          }
          continue
        }
        yield* moveIn(transaction, building.id, task, 'waiting', { blockedBy: null })
        freed = true
      }
      if (freed) tasks = yield* tasksIn(transaction, building.id)
    }
    const available = promotable(tasks)
    for (const id of available) {
      const task = tasks.find((one) => one.id === id)
      if (task !== undefined) yield* moveIn(transaction, building.id, task, 'available')
    }
    const running = new Set(tasks.filter((one) => one.state === 'in_progress').map((one) => one.id))
    const again: string[] = []
    for (const task of tasks) {
      if (task.heldBack === null || running.has(task.heldBack)) continue
      yield* transaction
        .update(buildingTasks)
        .set({ heldBack: null })
        .where(and(eq(buildingTasks.buildingId, building.id), eq(buildingTasks.id, task.id)))
        .pipe(Effect.mapError(refusedWhile('releasing a task held back')))
      if (task.state === 'available') again.push(task.id)
    }
    const delivered = [...available, ...again]
    if (delivered.length > 0) {
      // The first ready set travels in the Builder's brief: `initial` says no delivery follows.
      events.push(
        buildingEvent(building.missionId, 'building.task_available', {
          tasks: delivered,
          initial,
        }),
      )
    }
    const after = yield* tasksIn(transaction, building.id)
    const done = building.tasksDoneAt === null && settled(after)
    if (done) {
      yield* transaction
        .update(buildings)
        .set({ tasksDoneAt: now() })
        .where(eq(buildings.id, building.id))
        .pipe(Effect.mapError(refusedWhile('saying the tasks are done')))
    }
    return { events, done }
  })

/**
 * A task and its dependants blocked: the task by `blocked`, each dependant not done or skipped
 * by the task. Answers the events.
 */
export const blockIn = (
  transaction: EngineTransaction,
  building: BuildingRow,
  taskIds: ReadonlyArray<string>,
  blocked: BlockCause,
  needId: string,
) =>
  Effect.gen(function* () {
    const tasks = yield* tasksIn(transaction, building.id)
    const events: NewEvent[] = []
    const moved = new Set<string>()
    for (const id of taskIds) {
      const task = tasks.find((one) => one.id === id)
      if (task === undefined || moved.has(id)) continue
      yield* leaveRunningIn(transaction, building.id, task, 'blocked')
      yield* moveIn(transaction, building.id, task, 'blocked', { blockedBy: cause.write(blocked) })
      moved.add(id)
      events.push(
        buildingEvent(building.missionId, 'building.task_blocked', { task: id, need: needId }),
      )
      for (const dependant of dependantsOf(id, tasks)) {
        const held = tasks.find((one) => one.id === dependant)
        if (held === undefined || moved.has(dependant)) continue
        if (held.state === 'done' || held.state === 'skipped' || held.state === 'blocked') continue
        yield* leaveRunningIn(transaction, building.id, held, 'blocked')
        yield* moveIn(transaction, building.id, held, 'blocked', {
          blockedBy: cause.write(TaskCause.make({ taskId: id })),
        })
        moved.add(dependant)
        events.push(
          buildingEvent(building.missionId, 'building.task_blocked', {
            task: dependant,
            need: needId,
          }),
        )
      }
    }
    return events
  })

/** The tasks a need holds go back: each waits again, then the settle makes them available. */
export const unblockIn = (transaction: EngineTransaction, building: BuildingRow, needId: string) =>
  Effect.gen(function* () {
    for (const task of yield* tasksIn(transaction, building.id)) {
      if (task.state !== 'blocked' || !Predicate.isTagged(task.blockedBy, 'Need')) continue
      if (task.blockedBy.needId !== needId) continue
      yield* moveIn(transaction, building.id, task, 'waiting', { blockedBy: null })
    }
  })

/** A running task leaves `in_progress`: its claims are released and its open attempt ends. */
export const leaveRunningIn = (
  transaction: EngineTransaction,
  buildingId: string,
  task: TaskNow,
  outcome: string,
) =>
  Effect.gen(function* () {
    if (task.state !== 'in_progress') return
    yield* transaction
      .delete(buildingClaims)
      .where(and(eq(buildingClaims.buildingId, buildingId), eq(buildingClaims.taskId, task.id)))
      .pipe(Effect.mapError(refusedWhile('releasing the claims')))
    yield* transaction
      .update(buildingAttempts)
      .set({ endedAt: now(), outcome })
      .where(
        and(
          eq(buildingAttempts.buildingId, buildingId),
          eq(buildingAttempts.taskId, task.id),
          isNull(buildingAttempts.endedAt),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('ending the attempt')))
  })

/** The attempt of a task still open, or null. */
export const openAttemptIn = (reader: Reader, buildingId: string, taskId: string) =>
  Effect.map(
    attemptsIn(reader, buildingId),
    (rows) => rows.findLast((row) => row.taskId === taskId && row.endedAt === null) ?? null,
  )

/** The holder of a task's targets among the other running tasks, with the holder's title. */
export const holderIn = (reader: Reader, buildingId: string, task: TaskNow) =>
  Effect.gen(function* () {
    const held = (yield* claimsIn(reader, buildingId)).filter((one) => one.taskId !== task.id)
    const found = claimHolder(task.targets, held)
    if (found === null) return null
    const tasks = yield* tasksIn(reader, buildingId)
    return { ...found, title: tasks.find((one) => one.id === found.taskId)?.title ?? '' }
  })

/** The amendment of a decision applied: the task out skipped, the new tasks added waiting. */
export const applyAmendmentIn = (
  transaction: EngineTransaction,
  building: BuildingRow,
  decisionId: string,
  amendment: Amendment,
) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const tasks = yield* tasksIn(transaction, building.id)
    const plan = amendedPlan(amendment)
    const events: NewEvent[] = []
    let rank = Math.max(0, ...tasks.map((task) => task.rank)) + 1
    for (const task of plan.added) {
      yield* transaction
        .insert(buildingTasks)
        .values({
          buildingId: building.id,
          id: task.id,
          rank,
          origin: 'amendment',
          decisionId,
          title: secrets.mask(task.title),
          result: secrets.mask(task.result),
          requirements: strings.write(task.requirements),
          scenarios: strings.write(task.scenarios),
          targets: secrets.mask(targets.write(task.targets)),
          dependsOn: strings.write(task.dependsOn),
          state: 'waiting',
          replacedBy: '[]',
          changes: changes.write([{ state: 'waiting', at: now() }]),
        })
        .pipe(Effect.mapError(refusedWhile('adding a task')))
      rank += 1
    }
    for (const out of plan.skipped) {
      const task = tasks.find((one) => one.id === out.id)
      if (task === undefined) continue
      yield* leaveRunningIn(transaction, building.id, task, 'skipped')
      const reason =
        amendment.kind === 'remove' ? amendment.reason : `replaced by ${out.replacedBy.join(', ')}`
      yield* moveIn(transaction, building.id, task, 'skipped', {
        blockedBy: null,
        replacedBy: strings.write(out.replacedBy),
        skippedReason: secrets.mask(reason),
      })
      events.push(
        buildingEvent(building.missionId, 'building.task_skipped', {
          task: out.id,
          reason: secrets.mask(reason),
        }),
      )
    }
    return events
  })

const attemptViewOf = (row: AttemptRow): BuildingAttemptView => ({
  number: row.number,
  runner: row.runner,
  startedAt: row.startedAt,
  endedAt: row.endedAt,
  outcome: row.outcome,
  summary: row.summary,
  starts: Option.getOrElse(trees.read(row.starts), () => []),
  ends: row.ends === null ? null : Option.getOrElse(trees.read(row.ends), () => []),
  outside: stringsOf(row.outside),
})

const decisionViewOf = (row: DecisionRow): BuildingDecisionView => ({
  id: row.id,
  needId: row.needId,
  kind: row.kind,
  tasks: stringsOf(row.tasks),
  question: row.question,
  options: stringsOf(row.options),
  recommended: row.recommended,
  amendment:
    row.amendment === null
      ? null
      : Option.match(amendments.read(row.amendment), {
          onNone: () => null,
          onSome: amendmentSaid,
        }),
  state: row.state,
  answer: row.answer,
  applied: row.applied,
  requestedAt: row.requestedAt,
  answeredAt: row.answeredAt,
})

const taskViewOf = (task: TaskNow, attempts: ReadonlyArray<AttemptRow>): BuildingTaskView => ({
  id: task.id,
  title: task.title,
  result: task.result,
  origin: task.origin,
  requirements: task.requirements,
  scenarios: task.scenarios,
  targets: task.targets,
  dependsOn: task.dependsOn,
  state: task.state,
  verified: task.verified,
  runner: task.runner,
  blockedBy: task.blockedBy === null ? null : causeSaid(task.blockedBy),
  skippedReason: task.skippedReason,
  replacedBy: task.replacedBy,
  decisionId: task.decisionId,
  attempts: attempts.filter((one) => one.taskId === task.id).map(attemptViewOf),
  changes: task.changes,
})

/** Open question 28: the time the engine ran since the start, from its intervals, in seconds. */
const elapsedIn = (reader: Reader, buildingId: string) =>
  Effect.map(
    reader
      .select()
      .from(buildingActivity)
      .where(eq(buildingActivity.buildingId, buildingId))
      .pipe(Effect.mapError(refusedWhile('reading the time spent'))),
    (rows) =>
      Math.round(
        rows.reduce(
          (sum, row) => sum + Math.max(0, Date.parse(row.seenAt) - Date.parse(row.startedAt)),
          0,
        ) / 1000,
      ),
  )

const STATES = ['active', 'ended', 'cancelled'] as const

/** A Building as its page reads it. */
export const viewIn = (reader: Reader, building: BuildingRow) =>
  Effect.gen(function* () {
    const tasks = yield* tasksIn(reader, building.id)
    const attempts = yield* attemptsIn(reader, building.id)
    const requirements = [...new Set(tasks.flatMap((task) => task.requirements))]
    const view: BuildingView = {
      missionId: building.missionId,
      buildingId: building.id,
      label: building.label,
      round: null,
      state: STATES.find((one) => one === building.state) ?? 'active',
      phase: building.phase,
      percent: percentDone(tasks),
      special: { done: 0, total: 0 },
      elapsedSeconds: yield* elapsedIn(reader, building.id),
      startedAt: building.startedAt,
      endedAt: building.endedAt,
      repositories: Option.getOrElse(bases.read(building.bases), () => []).map((base) => ({
        name: base.repository,
        folder: base.folder,
        branch: base.branch,
        baseCommit: base.commit,
      })),
      requirements: requirements.map((id) => ({
        id,
        done: requirementDone(id, tasks),
        tasks: tasks.filter((task) => task.requirements.includes(id)).map((task) => task.id),
      })),
      tasks: tasks.map((task) => taskViewOf(task, attempts)),
      decisions: (yield* decisionsIn(reader, building.id)).map(decisionViewOf),
      summary: building.summary,
    }
    return view
  })

/** The mission's latest Building as its page reads it, or null before its first. */
export const buildingOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        yield* missionRow(transaction, missionId)
        const building = yield* latestBuildingIn(transaction, missionId)
        return building === null ? null : yield* viewIn(transaction, building)
      }),
    )
  })

/** One task of the mission's latest Building, with its attempts. */
export const buildingTaskOf = (missionId: string, taskId: string) =>
  Effect.gen(function* () {
    const view = yield* buildingOf(missionId)
    const task = view?.tasks.find((one) => one.id === taskId)
    if (task === undefined) return yield* new UnknownBuildingTask({ id: taskId })
    return task
  })

/** The mission's latest Building now, then again at each change of the mission. */
export const buildingTaskChanges = (missionId: string) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      return Stream.concat(
        Stream.fromEffect(buildingOf(missionId)),
        events.pipe(
          Stream.filter((event) => event.entityKind === 'mission' && event.entityId === missionId),
          Stream.mapEffect(() => buildingOf(missionId)),
        ),
      )
    }),
  )

const stateSaid = (task: TaskNow): string => {
  switch (task.state) {
    case 'done':
      return task.verified === true ? 'done, verified' : 'done, not verified'
    case 'blocked':
      return `blocked: ${task.blockedBy === null ? 'a need' : causeSaid(task.blockedBy)}`
    case 'skipped':
      return `skipped: ${task.skippedReason ?? ''}`
    case 'in_progress':
      return 'in progress'
    default:
      return task.state
  }
}

/** One task of the effective plan on its line, with its state. */
export const planLine = (task: TaskNow): string => `${taskText(task)} [${stateSaid(task)}]`

/**
 * What `spec_read` adds in Building: the decisions taken since the Freeze, then the effective
 * plan with its amendments, each linked to its decision. Null before the mission's first Building.
 */
export const buildingPartOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        const building = yield* latestBuildingIn(transaction, missionId)
        if (building === null) return null
        const tasks = yield* tasksIn(transaction, building.id)
        const decisions = (yield* decisionsIn(transaction, building.id)).map(decisionViewOf)
        const decided = decisions.map((one, at) =>
          [
            `- D${String(at + 1)} (${one.tasks.join(', ') || 'no task'}, ${one.state}): ${one.question}`,
            one.answer === null ? null : `  Answer: ${one.answer}`,
            one.amendment === null
              ? null
              : `  Amendment${one.applied ? ' applied' : ' proposed'}: ${one.amendment}`,
          ]
            .filter((line) => line !== null)
            .join('\n'),
        )
        const decisionOf = (id: string | null) => {
          const at = decisions.findIndex((one) => one.id === id)
          return at === -1 ? '' : ` (decision D${String(at + 1)})`
        }
        return [
          '## Decisions taken during Building',
          '',
          decided.length === 0 ? '_None yet._' : decided.join('\n'),
          '',
          '## Effective plan',
          '',
          tasks
            .map((task) =>
              task.origin === 'amendment'
                ? `${planLine(task)}${decisionOf(task.decisionId)}`
                : planLine(task),
            )
            .join('\n'),
        ].join('\n')
      }),
    )
  })

/** The tasks named that are not in the plan. */
export const unknownTasks = (tasks: ReadonlyArray<TaskNow>, named: ReadonlyArray<string>) =>
  named.filter((id) => !tasks.some((task) => task.id === id))

/** Whether some decision of the Building is held by this need. */
export const decisionOfNeedIn = (transaction: EngineTransaction, needId: string) =>
  transaction
    .select({ decision: buildingDecisions, building: buildings })
    .from(buildingDecisions)
    .innerJoin(buildings, eq(buildings.id, buildingDecisions.buildingId))
    .where(eq(buildingDecisions.needId, needId))
    .pipe(
      Effect.mapError(refusedWhile('reading a decision')),
      Effect.map(([row]) => row ?? null),
    )

/** The Buildings of these missions not over. */
export const activeOfMissions = (reader: Reader, missionIds: ReadonlyArray<string>) =>
  reader
    .select()
    .from(buildings)
    .where(and(inArray(buildings.missionId, [...missionIds]), eq(buildings.state, 'active')))
    .pipe(Effect.mapError(refusedWhile('reading the Buildings')))
