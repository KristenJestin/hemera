/**
 * The `helper` and `prototyper` roles (#145): a helper is a child session of a Building, launched
 * by the Builder or by a helper at depth 1; the Prototyper, of a Planning, launched by the Planner
 * (#222). Their instructions are the ticket's (the Prototyper's are its definition's role text),
 * their brief the helper as it is kept: who launched it, its parent's brief, the task it is tied
 * to, the Spec (frozen, or still being planned), whether it writes and where. Both count in the
 * Project's cap of sub-agents; what becomes of their sessions is told to their parent by the
 * helpers' service, in their own words.
 *
 * Apart from the helpers' service, so the role registry imports nothing that imports the sessions
 * back.
 */

import {
  PROTOTYPER,
  ROLE_NAMES,
  helperBriefFields,
  helperLabel,
  missionKey,
} from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import type { BriefField, BriefedSession, RoleEntry, SessionOwner } from '../sessions/roles.ts'
import { sessionsOfLineage } from '../sessions/store.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { missions } from '../storage/schema.ts'
import { helperOfLineage } from './helper-store.ts'
import { latestBuildingIn, tasksIn } from './tasks.ts'

/** The free helper's layer of the instructions, as the ticket writes it. */
export const HELPER_TEMPLATE = `# Role: Helper

## Mission
Do the one piece of work your parent agent wrote below, and hand back its result. Your parent is
an agent, not the user: nobody else reads your answer.

## Inputs
Your parent's brief, the task it is tied to if any (its scenarios and target files), the frozen
Spec, the Notes, whether you may write, your depth (1 or 2).

## Tools
A subset of your parent's: fs_read, fs_list, search; fs_write, fs_edit if you may write (a file
another running task holds is refused); commands_run, commands_output, commands_stop; task_start,
task_finished, task_blocked for your task only; need_propose when Hemera asks you; note_add;
helper_launch and helper_read at depth 1 only; helper_result.

## How you work
- Do exactly what the brief asks, nothing beside it.
- If you are tied to a task, carry it to task_finished yourself. Hemera runs the checks after
  task_finished. A red comes back to you as a delivery: the check, the place it ran in and the end
  of its output. Fix it in the same task, then task_finished again. After the third red, Hemera
  asks the user; answer what you propose with need_propose when asked.
- A write refused because another task holds the file: leave the file, say so in your result.
- The user may change files in the Workspace themselves. Hemera tells you which ones.
- A launch refused by the cap or the budget is an answer: do the work yourself.
- A call held for approval has not happened: go on with what does not depend on it.

## When you stop
helper_result: what changed and where, what you checked and how, what is left. Then end.

## Never
- Address the user, or raise a need yourself: your parent decides.
- Change the Spec, the mission's stage, or another task.
- Commit, push, branch, or write outside your parent's place.
- Launch helpers at depth 2.
- Report something as checked that you did not run.`

/** The brief of a helper's session, from its row. */
const helperBriefOf = (owner: SessionOwner, session: BriefedSession) =>
  Effect.gen(function* () {
    if (owner.kind !== 'mission') return []
    const database = yield* Database
    const row = yield* helperOfLineage(session.lineage)
    const [mission] = yield* database
      .select({ prefix: missions.keyPrefix, number: missions.keyNumber })
      .from(missions)
      .where(eq(missions.id, owner.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (row === null || mission === undefined) return []
    // Its parent is the Planner or the Builder, or a helper at depth 1, named by its id.
    const parent = yield* helperOfLineage(row.parentLineage)
    const planned = (yield* sessionsOfLineage(row.parentLineage)).some(
      (one) => one.role === 'planner',
    )
    const parentRole =
      parent !== null
        ? helperLabel(parent.number)
        : planned
          ? ROLE_NAMES.planner
          : ROLE_NAMES.builder
    const building = yield* latestBuildingIn(database, owner.missionId)
    const task =
      row.taskId === null || building === null
        ? undefined
        : (yield* tasksIn(database, building.id)).find((one) => one.id === row.taskId)
    const definition = row.definition === null ? null : PROTOTYPER
    const fields: ReadonlyArray<BriefField> = helperBriefFields({
      label: helperLabel(row.number),
      parentRole,
      missionKey: missionKey(mission.prefix, mission.number),
      depth: row.depth,
      brief: row.brief,
      task:
        task === undefined
          ? null
          : {
              id: task.id,
              title: task.title,
              result: task.result,
              targets: task.targets.map((one) => `${one.intent} ${one.repository}/${one.path}`),
              scenarios: task.scenarios,
            },
      spec: definition === null || definition.inputs.includes('spec'),
      frozen: !planned,
      writes: row.writes,
      place:
        row.place === 'prototype'
          ? `your own folder, ${row.folder}; ${planned ? 'the main checkout' : 'the Workspace'} is read-only to you (name a repository to read it)`
          : `the Workspace, ${row.folder}`,
    })
    return fields
  })

export const HELPER_ROLE: RoleEntry = {
  id: 'helper',
  displayName: 'a helper',
  ownerKind: 'mission',
  placeKind: 'workspace',
  writes: true,
  readsMemory: true,
  projectLayer: true,
  mainOf: null,
  template: HELPER_TEMPLATE,
  brief: helperBriefOf,
  countsInCap: true,
  ledByUser: false,
  toldToParentByOwner: true,
}

export const PROTOTYPER_ROLE: RoleEntry = {
  id: 'prototyper',
  displayName: 'the Prototyper',
  ownerKind: 'mission',
  placeKind: 'own-worktree',
  writes: true,
  readsMemory: true,
  projectLayer: false,
  mainOf: null,
  template: PROTOTYPER.role,
  brief: helperBriefOf,
  countsInCap: true,
  ledByUser: false,
  toldToParentByOwner: true,
}
