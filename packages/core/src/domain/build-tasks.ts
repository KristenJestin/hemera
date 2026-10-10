/**
 * The tasks of a Building (#141): the states Hemera owns, the ready set, the dependants a blocked
 * task holds, the claims two running tasks cannot share, and the amendments a decision taken in
 * Building brings to the frozen plan (CT-33). Pure rules: every act on the database, Git or an
 * agent belongs to the engine.
 *
 * Hemera owns every state: the agent only says that a task is finished or blocked. A frozen task
 * is never rewritten; the effective plan is the frozen plan plus its amendments, a removed or
 * replaced task shown skipped.
 */

import { Schema } from 'effect'

import {
  type Coverable,
  TaskAsked,
  type TaskTarget,
  graphProblemSaid,
  taskGraph,
} from './proofs.ts'

/**
 * Where a task stands: waiting on a dependency, available (in the ready set, no claim), in
 * progress (started by `task_start`), checking (finished, Hemera judging), done; beside these,
 * blocked (a need holds it, or a task it depends on is blocked) and skipped (removed by an
 * amendment).
 */
export const TASK_STATES = [
  'waiting',
  'available',
  'in_progress',
  'checking',
  'done',
  'blocked',
  'skipped',
] as const
export const TaskState = Schema.Literals(TASK_STATES)
export type TaskState = typeof TaskState.Type

/** Where a task of the effective plan comes from: the frozen Spec, or an amendment. */
export const TASK_ORIGINS = ['spec', 'amendment'] as const
export const TaskOrigin = Schema.Literals(TASK_ORIGINS)
export type TaskOrigin = typeof TaskOrigin.Type

/** A task of the effective plan as the rules read it. */
export interface BuildTaskNow {
  readonly id: string
  readonly title: string
  readonly result: string
  readonly requirements: ReadonlyArray<string>
  readonly scenarios: ReadonlyArray<string>
  readonly targets: ReadonlyArray<TaskTarget>
  readonly dependsOn: ReadonlyArray<string>
  readonly state: TaskState
  /** The tasks that replace it, for a task an amendment replaced; empty otherwise. */
  readonly replacedBy: ReadonlyArray<string>
}

type Tasks = ReadonlyArray<BuildTaskNow>

const byIdOf = (tasks: Tasks): ReadonlyMap<string, BuildTaskNow> =>
  new Map(tasks.map((task) => [task.id, task]))

/**
 * Whether a task lets its dependants on: done, or skipped; a replaced task only once every task
 * that replaces it does.
 */
const lets = (
  id: string,
  byId: ReadonlyMap<string, BuildTaskNow>,
  seen = new Set<string>(),
): boolean => {
  const task = byId.get(id)
  if (task === undefined || seen.has(id)) return false
  if (task.state === 'done') return true
  if (task.state !== 'skipped') return false
  seen.add(id)
  return task.replacedBy.every((one) => lets(one, byId, seen))
}

const dependenciesMet = (task: BuildTaskNow, byId: ReadonlyMap<string, BuildTaskNow>) =>
  task.dependsOn.every((id) => lets(id, byId))

/** The waiting tasks whose dependencies are all done: they become available, in plan order. */
export const promotable = (tasks: Tasks): ReadonlyArray<string> => {
  const byId = byIdOf(tasks)
  return tasks
    .filter((task) => task.state === 'waiting' && dependenciesMet(task, byId))
    .map((task) => task.id)
}

/** The ready set the Builder chooses from: every available task, in plan order. */
export const readySet = <T extends BuildTaskNow>(tasks: ReadonlyArray<T>): ReadonlyArray<T> =>
  tasks.filter((task) => task.state === 'available')

/** The tasks a task stands for when others depend on it: itself, and what it replaces. */
const standsFor = (id: string, tasks: Tasks): ReadonlyArray<string> => [
  id,
  ...tasks
    .filter((task) => task.replacedBy.includes(id))
    .flatMap((task) => standsFor(task.id, tasks)),
]

/**
 * Every task that depends on `id`, directly or through others, in the order reached: what a need
 * on `id` blocks beside it. A replacement's dependants are those of the task it replaces.
 */
export const dependantsOf = (id: string, tasks: Tasks): ReadonlyArray<string> => {
  const reached: string[] = []
  const queue = [id]
  for (let at = 0; at < queue.length; at += 1) {
    const names = standsFor(queue[at] ?? '', tasks)
    for (const task of tasks) {
      if (task.id === id || reached.includes(task.id)) continue
      if (task.dependsOn.some((one) => names.includes(one))) {
        reached.push(task.id)
        queue.push(task.id)
      }
    }
  }
  return reached
}

/** Every task of the effective plan is done or skipped. */
export const settled = (tasks: Tasks): boolean =>
  tasks.every((task) => task.state === 'done' || task.state === 'skipped')

/** Every task that covers the requirement is done or skipped. */
export const requirementDone = (requirement: string, tasks: Tasks): boolean =>
  settled(tasks.filter((task) => task.requirements.includes(requirement)))

/** Open question 24: done (verified or not) and skipped tasks over the effective plan, in %. */
export const percentDone = (tasks: Tasks): number =>
  tasks.length === 0
    ? 0
    : Math.round(
        (100 * tasks.filter((task) => task.state === 'done' || task.state === 'skipped').length) /
          tasks.length,
      )

/** A file a running task holds. */
export interface HeldClaim {
  readonly taskId: string
  readonly repository: string
  readonly path: string
}

/** The first claim a running task holds on one of these targets, or null when all are free. */
export const claimHolder = (
  targets: ReadonlyArray<TaskTarget>,
  held: ReadonlyArray<HeldClaim>,
): HeldClaim | null =>
  held.find((claim) =>
    targets.some((target) => target.repository === claim.repository && target.path === claim.path),
  ) ?? null

/** A task an amendment brings: an id of its own, and what a frozen task holds. */
export const AmendedTask = Schema.Struct({
  ...TaskAsked.fields,
  depends_on: Schema.Array(
    Schema.String.check(Schema.isNonEmpty()).annotate({
      description: 'A task done before it, by its id: one of the plan (`T1`) or of this amendment.',
    }),
  ),
  id: Schema.String.check(
    Schema.isPattern(/^T[0-9]+[a-z]*$/, { message: 'a task id, as `T21a` or `T30`' }),
  ).annotate({
    description: 'Its id: `T21a`, `T21b` for a replacement, a new number for an addition.',
  }),
})
export type AmendedTask = typeof AmendedTask.Type

const TaskNamed = Schema.String.check(Schema.isNonEmpty()).annotate({
  description: 'A task of the plan, by its id (`T21`).',
})

/** CT-33: replace a task by others, remove it with the reason, or add one. */
export const TaskAmendment = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('replace'),
    task: TaskNamed,
    by: Schema.Array(AmendedTask)
      .check(Schema.isNonEmpty())
      .annotate({ description: 'The tasks that replace it, with their targets and scenarios.' }),
  }),
  Schema.Struct({
    kind: Schema.Literal('remove'),
    task: TaskNamed,
    reason: Schema.String.check(Schema.isNonEmpty()).annotate({
      description: 'Why the task became useless.',
    }),
  }),
  Schema.Struct({ kind: Schema.Literal('add'), task: AmendedTask }),
]).annotate({
  description:
    'A change of the plan, applied only if the user chooses your recommended option: `replace` a task by others, `remove` it with the reason, or `add` one. Every scenario must stay covered.',
})
export type Amendment = typeof TaskAmendment.Type

const newTasksOf = (amendment: Amendment): ReadonlyArray<AmendedTask> => {
  switch (amendment.kind) {
    case 'replace':
      return amendment.by
    case 'remove':
      return []
    case 'add':
      return [amendment.task]
  }
}

/** The task an amendment takes out of the plan, or null for an addition. */
export const amendedTaskOf = (amendment: Amendment): string | null =>
  amendment.kind === 'add' ? null : amendment.task

/**
 * What is wrong with an amendment against the effective plan as it stands, in words; empty when
 * it applies. The targets are checked against Git by the engine.
 */
export const amendmentProblems = (
  tasks: Tasks,
  amendment: Amendment,
  coverable: Coverable,
): ReadonlyArray<string> => {
  const problems: string[] = []
  const out = amendedTaskOf(amendment)
  const live = tasks.filter((task) => task.state !== 'skipped')
  if (out !== null) {
    const found = tasks.find((task) => task.id === out)
    if (found === undefined) problems.push(`${out} is not a task of the plan.`)
    else if (found.state === 'skipped') problems.push(`${out} is already skipped.`)
    else if (found.state === 'done') problems.push(`${out} is done: it stays as it is.`)
    if (problems.length > 0) return problems
  }
  const added = newTasksOf(amendment)
  for (const task of added) {
    if (tasks.some((one) => one.id === task.id)) {
      problems.push(`${task.id} is already a task of the plan: a new task takes an id of its own.`)
    }
  }
  const shaped = (
    task: Pick<BuildTaskNow, 'id' | 'title' | 'requirements' | 'scenarios'>,
    dependsOn: ReadonlyArray<string>,
  ) => ({
    id: task.id,
    title: task.title,
    requirements: task.requirements,
    scenarios: task.scenarios,
    dependsOn,
  })
  const after = [
    // A dependency on the task out stands for its replacements once it goes.
    ...live
      .filter((task) => task.id !== out)
      .map((task) =>
        shaped(
          task,
          task.dependsOn.filter((one) => one !== out),
        ),
      ),
    ...added.map((task) => shaped(task, task.depends_on)),
  ]
  // A dependency on a task already skipped stays valid: its skip lets it on.
  const known = new Set([...after.map((task) => task.id), ...tasks.map((task) => task.id)])
  for (const task of added) {
    const said = (
      kind: 'unknown_task' | 'unknown_requirement' | 'unknown_scenario',
      target: string,
    ) => problems.push(graphProblemSaid({ kind, task: task.id, target }))
    for (const one of task.depends_on) if (!known.has(one)) said('unknown_task', one)
    for (const one of task.requirements) {
      if (!coverable.requirements.has(one)) said('unknown_requirement', one)
    }
    for (const one of task.scenarios)
      if (!coverable.scenarios.has(one)) said('unknown_scenario', one)
  }
  const everything = {
    requirements: new Set(after.flatMap((task) => task.requirements)),
    scenarios: new Set(after.flatMap((task) => task.scenarios)),
  }
  const inPlan = new Set(after.map((task) => task.id))
  problems.push(
    ...taskGraph(
      after.map((task) => ({
        ...task,
        dependsOn: task.dependsOn.filter((one) => inPlan.has(one)),
      })),
      everything,
    )
      .filter((problem) => problem.kind === 'cycle')
      .map(graphProblemSaid),
  )
  if (out !== null) {
    const removed = tasks.find((task) => task.id === out)
    for (const scenario of removed?.scenarios ?? []) {
      if (!after.some((task) => task.scenarios.includes(scenario))) {
        problems.push(
          amendment.kind === 'remove'
            ? `Removing ${out} leaves ${scenario} covered by no task of the plan.`
            : `Replacing ${out} leaves ${scenario} covered by no task of the plan.`,
        )
      }
    }
  }
  return problems
}

const named = (task: AmendedTask): string => `${task.id} (${task.title})`

const listed = (items: ReadonlyArray<string>): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`

/** The amendment in words, as the need and the Journal say it. */
export const amendmentSaid = (amendment: Amendment): string => {
  switch (amendment.kind) {
    case 'replace':
      return `${amendment.task} is replaced by ${listed(amendment.by.map(named))}.`
    case 'remove':
      return `${amendment.task} is removed: ${amendment.reason}`
    case 'add':
      return `${named(amendment.task)} is added.`
  }
}

/** What applying an amendment does to the plan: the tasks skipped, the tasks added. */
export interface AmendedPlan {
  readonly skipped: ReadonlyArray<{
    readonly id: string
    readonly replacedBy: ReadonlyArray<string>
  }>
  readonly added: ReadonlyArray<Omit<BuildTaskNow, 'state' | 'replacedBy'>>
}

/** The amendment applied: the frozen tasks stay as they are, the task out is skipped. */
export const amendedPlan = (amendment: Amendment): AmendedPlan => {
  const added = newTasksOf(amendment).map((task) => ({
    id: task.id,
    title: task.title,
    result: task.result,
    requirements: task.requirements,
    scenarios: task.scenarios,
    targets: task.targets,
    dependsOn: task.depends_on,
  }))
  const out = amendedTaskOf(amendment)
  return {
    skipped:
      out === null
        ? []
        : [
            {
              id: out,
              replacedBy: amendment.kind === 'replace' ? added.map((task) => task.id) : [],
            },
          ],
    added,
  }
}
