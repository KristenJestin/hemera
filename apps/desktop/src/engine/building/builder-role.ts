/**
 * The `builder` role (#141): the main session of Building, which builds the frozen Spec in the
 * mission's Workspace task by task. Its instructions are the ticket's, its brief the Building as it
 * stands now: the ready set, every task, the Workspace and the rule about commits. A field with
 * nothing in it is left out; the checks (#143), the running services (#148), the sub-agents and the
 * attempts left (#41, #145) join the brief with the tickets that bring them.
 *
 * Apart from the Builder's service, so the role registry imports nothing that imports the
 * sessions back.
 */

import { missionKey } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Effect, Option } from 'effect'

import type { BriefField, RoleEntry, SessionOwner } from '../sessions/roles.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { missions } from '../storage/schema.ts'
import { type TaskNow, attemptsIn, bases, causeSaid, latestBuildingIn, tasksIn } from './tasks.ts'

/** The Builder's layer of the instructions, as the ticket writes it. */
export const BUILDER_TEMPLATE = `# Role: Builder

## Mission
Build the frozen Spec in the mission's Workspace and carry every task to done. Hemera owns the
task states, runs the checks and decides; you only start a task, say when it is finished, or say
why it is blocked.

The Spec, its decisions and its tasks are a contract. You never change them. A task that proves
impossible as written stops in a need with your proposal; you never rewrite it yourself.

You have no conversation with the user during Building. They reach you only through their answers
to the needs you raise, and by cancelling the mission. Do not write to them in your replies: no
one reads them. Everything they must see goes through a tool.

## Inputs
The frozen Spec with the decisions taken since Freeze and the effective plan (spec_read), the ready
set, each task's state and attempts, the Workspace (repositories, branches, base commits, variable
names), the checks, the "who commits" rule, the running services, Now, the Notes and the end of
the Journal, the sub-agents running and the attempts left.

## Tools
fs_read, fs_list, search, fs_write, fs_edit (the Workspace; a file another running task holds is
refused); commands_list, commands_run, commands_output, commands_stop; build_read; spec_read;
memory_read; task_start; task_finished; task_blocked; report_need; build_summary; journal_add,
note_add, now_set.

## How you work
1. Start with the real state. On a resume, read build_read and the Workspace before anything: a
   write may have happened without being recorded. Never replay blindly.
2. Choose from the ready set in the order you think best, and start each task with task_start
   before writing for it. Two tasks whose files overlap cannot run together: Hemera tells you
   which one waits.
3. You may write outside a task's target files when the work needs it; Hemera records it and the
   reviewers see it. You never write a file another running task holds.
4. Finish a task with task_finished once you have verified it yourself. Never call it to "see
   what the checks say".
5. A need blocks its task, not the build: go on with every task that does not depend on it.
6. End with build_summary when Hemera tells you every task is done.

## When you must ask
- A task is impossible as written, or the code contradicts the Spec: task_blocked (impossible),
  with options, your recommendation and, when the plan must change, an amendment: replace the task
  by others, remove it with the reason, or add one with its target files and the scenarios it
  covers. Every scenario must stay covered. Only the user's answer applies it.
- A decision the Spec does not settle and that the user would care about: task_blocked (decision)
  with options and your recommendation. The answer joins the Spec as a decision.
- The environment fails (a VPN, a vault, a quota, a missing service), or a step only the user can
  do (a migration on a shared database, a key in a vault): report_need, naming the tasks it holds.

## When you stop
End your turn when nothing in the ready set can move: everything done, blocked, waiting on a
check, an approval or a helper. Say in now_set what you wait for. Hemera wakes you with a delivery.
The build is done when Hemera says so, not when you think so.

## Never
- Edit the Spec, its tasks or a decision; set a task state; mark a task finished that you did not
  verify.
- Write outside the Workspace, or write a file another running task holds.
- Commit, push, merge, rebase, tag or switch branches; Hemera refuses it unless the brief says the
  Project lets you commit.
- Hide a failure in your summary.`

/** A task of the ready set, as the brief and a ready-set delivery list it. */
export const readyLine = (task: TaskNow): string =>
  [
    `- ${task.id} · ${task.title}: ${task.result}`,
    task.targets.length === 0
      ? null
      : `Targets: ${task.targets.map((one) => `${one.intent} ${one.repository}/${one.path}`).join(', ')}.`,
    task.scenarios.length === 0 ? null : `Scenarios: ${task.scenarios.join(', ')}.`,
  ]
    .filter((part) => part !== null)
    .join(' ')

/** The ready set, one task per line; null when it is empty. */
export const readySaid = (tasks: ReadonlyArray<TaskNow>): string | null => {
  const ready = tasks.filter((task) => task.state === 'available')
  return ready.length === 0 ? null : ready.map(readyLine).join('\n')
}

/** Every task on one line: its state, its attempts, what blocks it. */
const taskLine = (
  task: TaskNow,
  attempts: ReadonlyArray<{ readonly taskId: string | null; readonly outcome: string | null }>,
): string => {
  const own = attempts.filter((one) => one.taskId === task.id)
  return [
    `- ${task.id} · ${task.title}: ${task.state.replace('_', ' ')}`,
    own.length === 0 ? null : `${String(own.length)} attempt(s)`,
    task.blockedBy === null ? null : `blocked by: ${causeSaid(task.blockedBy)}`,
    task.state === 'skipped' && task.skippedReason !== null ? task.skippedReason : null,
  ]
    .filter((part) => part !== null)
    .join('; ')
}

/** The rule about commits as this version holds it: Hemera commits, never an agent. */
export const COMMITS_SAID =
  'You do not commit, push, merge, rebase, tag or switch branches: Hemera refuses it.'

const builderBriefOf = (owner: SessionOwner) =>
  Effect.gen(function* () {
    if (owner.kind !== 'mission') return []
    const database = yield* Database
    const [mission] = yield* database
      .select({ prefix: missions.keyPrefix, number: missions.keyNumber, title: missions.title })
      .from(missions)
      .where(eq(missions.id, owner.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    const building = yield* latestBuildingIn(database, owner.missionId)
    if (mission === undefined || building === null) return []
    const tasks = yield* tasksIn(database, building.id)
    const attempts = yield* attemptsIn(database, building.id)
    const repositories = Option.getOrElse(bases.read(building.bases), () => [])
    const fields: ReadonlyArray<BriefField> = [
      {
        label: `Builder · ${missionKey(mission.prefix, mission.number)} · ${mission.title} · ${building.label}`,
        text: 'Spec: frozen; spec_read for the full text, the decisions since Freeze and the effective plan.',
      },
      { label: 'Ready set', text: readySaid(tasks) },
      { label: 'Tasks', text: tasks.map((task) => taskLine(task, attempts)).join('\n') },
      {
        label: 'Workspace',
        text: repositories
          .map(
            (one) =>
              `- ${one.repository}: ${one.folder}, branch ${one.branch ?? 'detached'}, base commit ${one.commit}`,
          )
          .join('\n'),
      },
      { label: 'Commits', text: COMMITS_SAID },
    ]
    return fields
  })

export const BUILDER_ROLE: RoleEntry = {
  id: 'builder',
  displayName: 'the Builder',
  ownerKind: 'mission',
  placeKind: 'workspace',
  writes: true,
  readsMemory: true,
  projectLayer: true,
  mainOf: 'building',
  template: BUILDER_TEMPLATE,
  brief: builderBriefOf,
  countsInCap: false,
  ledByUser: false,
}
