/**
 * The `delivery` role (S1): one fresh session per Agent step of a mission's delivery, in one
 * repository's worktree of the mission's Workspace, after the user shipped it. It reads the Memory,
 * writes in its place through the gate, starts no sub-agent, and ends with `delivery_step_report`.
 * Its instructions are the ticket's, as written; S3 adds the bump paragraph.
 *
 * Apart from the delivery's steps, so the role registry imports nothing that imports the sessions
 * back.
 */

import { DeliveryAction, missionKey } from '@hemera/core/domain'
import { and, desc, eq } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'

import type { BriefedSession, RoleEntry, SessionOwner } from '../sessions/roles.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import {
  buildingLaunches,
  deliveryPushes,
  deliverySteps,
  missionShips,
  missions,
  workspaceRepositories,
  workspaces,
} from '../storage/schema.ts'

/** The role's instructions, as the ticket writes them. */
export const DELIVERY_TEMPLATE = `# Role: Delivery

## Mission
You run one step of a mission's delivery, after the user shipped it. The code was reviewed
and frozen at Ship. Your step does the one thing its task says, in one repository, and nothing
else.

## Inputs (your brief)
The step's task, written by the Project; the repository, its worktree, its branch and its pull
request; the frozen Spec (spec_read); Now, Notes and the end of the Journal.

## Your place
The worktree of your repository in the mission's Workspace. Nothing outside it.

## Rules
- The tree is frozen. Change no file unless your task says so. Hemera compares the repository
  with the frozen tree when you finish: any change goes back to the user, who decides
  whether it is kept. If your task cannot be done without changing files it did not name, stop
  and say so in your report.
- You cannot push, merge, tag, publish a package or write to a forge. Hemera does the network
  writes of the delivery. Do not commit; do not create or switch branches.
- Do not invent a result. If you could not check something, say "not verified".
- End with delivery_step_report: \`done\` with what you did, or \`failed\` with what blocked you and
  what you tried. A step that ends without a report counts as failed.`

const readAction = Schema.decodeUnknownOption(Schema.fromJsonString(DeliveryAction))
const PullRequestUrl = Schema.Struct({ url: Schema.String })
const readUrl = Schema.decodeUnknownOption(Schema.fromJsonString(PullRequestUrl))

/** The Agent step a session's lineage runs, or null. */
export const stepOfLineage = (lineage: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(deliverySteps)
      .where(eq(deliverySteps.lineage, lineage))
      .pipe(Effect.mapError(refusedWhile('reading a delivery step')))
    return row ?? null
  })

/** The brief: the mission, the step and its task, the repository, its pull request, the freeze. */
export const deliveryBrief = (owner: SessionOwner, session: BriefedSession) =>
  Effect.gen(function* () {
    if (owner.kind !== 'mission') return []
    const step = yield* stepOfLineage(session.lineage)
    if (step === null) return []
    const database = yield* Database
    const read = refusedWhile('reading a delivery step’s brief')
    const [mission] = yield* database
      .select({ prefix: missions.keyPrefix, number: missions.keyNumber, title: missions.title })
      .from(missions)
      .where(eq(missions.id, step.missionId))
      .pipe(Effect.mapError(read))
    if (mission === undefined) return []
    const [place] = yield* database
      .select({
        path: workspaceRepositories.path,
        worktree: workspaceRepositories.worktree,
        branch: workspaces.branch,
      })
      .from(buildingLaunches)
      .innerJoin(workspaces, eq(workspaces.id, buildingLaunches.workspaceId))
      .innerJoin(
        workspaceRepositories,
        eq(workspaceRepositories.workspaceId, buildingLaunches.workspaceId),
      )
      .where(
        and(
          eq(buildingLaunches.missionId, step.missionId),
          eq(workspaceRepositories.repositoryId, step.repositoryId),
        ),
      )
      .orderBy(desc(buildingLaunches.startedAt))
      .limit(1)
      .pipe(Effect.mapError(read))
    const [push] = yield* database
      .select({ repository: deliveryPushes.repository, pullRequest: deliveryPushes.pullRequest })
      .from(deliveryPushes)
      .where(
        and(
          eq(deliveryPushes.missionId, step.missionId),
          eq(deliveryPushes.repositoryId, step.repositoryId),
        ),
      )
      .pipe(Effect.mapError(read))
    const [ship] = yield* database
      .select({ shippedAt: missionShips.shippedAt })
      .from(missionShips)
      .where(eq(missionShips.missionId, step.missionId))
      .pipe(Effect.mapError(read))
    const task = Option.match(readAction(step.action), {
      onNone: () => '',
      onSome: (action) => (action.kind === 'agent' ? action.task : ''),
    })
    const url = Option.match(readUrl(push?.pullRequest ?? ''), {
      onNone: () => null,
      onSome: (one) => one.url,
    })
    const name = place?.path ?? push?.repository ?? step.repositoryId
    return [
      {
        label: `Delivery · ${missionKey(mission.prefix, mission.number)} · ${mission.title}`,
        text: [
          `Step: ${step.stepId} · ${task}`,
          `Repository: ${name} · worktree ${place?.worktree ?? 'not on the disk'} · branch ${place?.branch ?? 'none'}`,
          ...(url === null ? [] : [`Pull request: ${url}`]),
          `The tree was frozen at Ship (${ship?.shippedAt ?? 'unknown'}).`,
          'Spec: frozen; spec_read for the full text.',
        ].join('\n'),
      },
    ]
  })

export const DELIVERY_ROLE: RoleEntry = {
  id: 'delivery',
  displayName: 'the Delivery agent',
  ownerKind: 'mission',
  placeKind: 'workspace',
  writes: true,
  readsMemory: true,
  projectLayer: true,
  mainOf: null,
  template: DELIVERY_TEMPLATE,
  brief: deliveryBrief,
  countsInCap: true,
  ledByUser: false,
  modelOf: 'builder',
}
