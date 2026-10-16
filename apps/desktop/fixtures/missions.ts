/**
 * The steps the mission groups share, each through the engine's services: Larkspur's CSV export
 * planned by its scripted Planner and read cold, then frozen, checked and launched as the user
 * does, then built task by task by the Builder through its own tools (`task_start`, `fs_write`,
 * `task_finished`), called with its grant as its agent calls them.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PermissionAnswer } from '@hemera/core/domain'
import { Effect } from 'effect'

import { buildingOf } from '../src/engine/building/builder.ts'
import { latestCheckOf } from '../src/engine/building/check.ts'
import { OutsideChanges } from '../src/engine/building/outside.ts'
import { launchMission } from '../src/engine/building/launch.ts'
import { proofsRead } from '../src/engine/building/proofs.ts'
import { createMission, getMission } from '../src/engine/missions.ts'
import { answerNeed, listNeeds } from '../src/engine/needs.ts'
import { listColdReads } from '../src/engine/planning/cold-read-store.ts'
import { freezeMission } from '../src/engine/planning/freeze.ts'
import { readSpec } from '../src/engine/planning/store.ts'
import { checkMission } from '../src/engine/building/check.ts'
import { sessionsIn } from '../src/engine/sessions/store.ts'
import { grantOf } from '../tests/building-world.ts'
import { callTool } from '../tests/tools-world.ts'
import type { FixtureGit } from './git.ts'
import { larkspur } from './larkspur.ts'

/** Waits, on the real clock, until `check` holds; fails naming what never came after `bound` ms. */
export const reached = <E, R>(what: string, check: Effect.Effect<boolean, E, R>, bound = 60_000) =>
  Effect.gen(function* () {
    const deadline = Date.now() + bound
    while (!(yield* check)) {
      if (Date.now() > deadline) {
        return yield* Effect.die(new Error(`the fixture never reached ${what}`))
      }
      yield* Effect.sleep('50 millis')
    }
  })

/** Larkspur's mission of the CSV export, planned by its scripted Planner and read cold. */
export const plannedExport = (world: { readonly work: string; readonly git: FixtureGit }) =>
  Effect.gen(function* () {
    const { project } = yield* larkspur(world.work, world.git)
    const mission = yield* createMission({
      projectId: project.id,
      idea: { sentence: 'Export the invoices of a month as CSV', ticket: null },
    })
    yield* reached(
      'a cold read done',
      Effect.map(listColdReads(mission.id), (passes) => passes.some((one) => one.state === 'done')),
    )
    return { project, mission }
  })

/** Waits until a scenario's proof is in a state. */
export const proofReached = (missionId: string, scenario: string, state: string) =>
  reached(
    `${scenario} ${state}`,
    Effect.map(
      proofsRead(missionId),
      (view) => view?.scenarios.find((one) => one.scenario === scenario)?.state === state,
    ),
  )

/** Waits until a scenario's proof has run so many times. */
export const proofRan = (missionId: string, scenario: string, runs: number) =>
  reached(
    `${String(runs)} runs of ${scenario}`,
    Effect.map(proofsRead(missionId), (view) => {
      const proof = view?.scenarios.find((one) => one.scenario === scenario)
      return proof !== undefined && proof.runs.length >= runs
    }),
  )

/**
 * The user writes a file of the mission's Workspace in their own editor, outside Hemera; then the
 * detector compares the Workspace, as its timer and the window's focus make it do.
 */
export const fixedOutside = (
  missionId: string,
  repository: string,
  path: string,
  content: string,
) =>
  Effect.gen(function* () {
    const view = yield* buildingOf(missionId)
    const folder = view?.repositories.find((one) => one.name === repository)?.folder
    if (folder === undefined)
      return yield* Effect.die(new Error(`no ${repository} in the Workspace`))
    yield* Effect.sync(() => writeFileSync(join(folder, path), content))
    yield* OutsideChanges.use((outside) => outside.compare(missionId, null))
  })

/** The export planned, then frozen, checked and launched by the user: Building, its reds recorded. */
export const launchedExport = (world: { readonly work: string; readonly git: FixtureGit }) =>
  Effect.gen(function* () {
    const planned = yield* plannedExport(world)
    const missionId = planned.mission.id
    yield* freezeMission(missionId, (yield* readSpec(missionId)).version)
    yield* checkMission(missionId)
    yield* reached(
      'a pre-launch check ended',
      Effect.map(latestCheckOf(missionId), (view) => view !== null && view.state !== 'running'),
    )
    const check = yield* latestCheckOf(missionId)
    if (check === null) return yield* Effect.die(new Error('no pre-launch check'))
    yield* launchMission(missionId, check.id, 'launch')
    yield* reached(
      'Building',
      Effect.map(getMission(missionId), (mission) => mission.stage === 'building'),
    )
    yield* proofReached(missionId, 'R1.S1', 'red_recorded')
    yield* proofReached(missionId, 'R1.S2', 'red_recorded')
    return planned
  })

/** What the gate answers a call that waits for the user. */
const WAITING = "Waiting for the user's approval"

/** The permission needs waiting on the user, oldest first. */
export const permissionNeeds = Effect.map(listNeeds, (groups) =>
  groups.flatMap((group) => group.needs).filter((need) => need.choices.length > 0),
)

/** The user answers the oldest permission need: Allow for this mission when it is offered. */
export const userAllows = Effect.gen(function* () {
  const [need] = yield* permissionNeeds
  if (need === undefined) return yield* Effect.die(new Error('no permission need to allow'))
  const choice = need.choices.includes('allow-for-mission') ? 'allow-for-mission' : 'allow-once'
  yield* answerNeed({
    id: need.id,
    answer: PermissionAnswer.make({ choice }),
    key: `fixture-${need.id}`,
  })
})

/**
 * One of Hemera's tools, called with the Builder's grant. A call that waits for the user is
 * allowed by them, then made again once under the grant they gave; a refusal stops the fixture,
 * said.
 */
const builderCalls = (
  grantId: string,
  tool: string,
  args: Parameters<typeof callTool>[2],
  allowed = false,
): Effect.Effect<
  string,
  never,
  Effect.Services<ReturnType<typeof callTool>> | Effect.Services<typeof userAllows>
> =>
  Effect.gen(function* () {
    const answer = yield* callTool(grantId, tool, args).pipe(Effect.orDie)
    if (answer.text.startsWith(WAITING) && !allowed) {
      yield* userAllows.pipe(Effect.orDie)
      return yield* builderCalls(grantId, tool, args, true)
    }
    if (!answer.ok) return yield* Effect.die(new Error(`${tool} was refused: ${answer.text}`))
    return answer.text
  })

/** A write of the Builder's, through `fs_write`. */
export interface BuilderWrite {
  readonly repository: string
  readonly path: string
  readonly content: string
  /** A file it creates, which there is nothing to read of first. */
  readonly creates?: boolean
}

/** What `fs_write` takes of a write. */
const toolWrite = (write: BuilderWrite) => ({
  repository: write.repository,
  path: write.path,
  content: write.content,
})

/** The file a write changes, read first as a Builder does; nothing for a file it creates. */
const readFirst = (grantId: string, write: BuilderWrite) =>
  write.creates === true
    ? Effect.void
    : Effect.asVoid(
        builderCalls(grantId, 'fs_read', { repository: write.repository, path: write.path }),
      )

/** The grant of the mission's Builder, once its first turn ended: minted after its agent's own. */
const builderGrant = (missionId: string) =>
  Effect.gen(function* () {
    const idle = Effect.map(
      sessionsIn(['idle'], { kind: 'mission', missionId }),
      (rows) => rows.find((row) => row.role === 'builder') ?? null,
    )
    yield* reached(
      'the Builder idle',
      Effect.map(idle, (found) => found !== null),
    )
    const session = yield* idle
    if (session === null) return yield* Effect.die(new Error('no Builder'))
    return yield* grantOf(session.id)
  })

/**
 * The mission's Builder builds a task: it starts it, writes each file through `fs_write` after
 * reading it, and says it is finished.
 */
export const builderBuilds = (
  missionId: string,
  task: string,
  writes: ReadonlyArray<BuilderWrite>,
) =>
  Effect.gen(function* () {
    const grantId = yield* builderGrant(missionId)
    yield* builderCalls(grantId, 'task_start', { task })
    for (const write of writes) {
      yield* readFirst(grantId, write)
      yield* builderCalls(grantId, 'fs_write', toolWrite(write))
    }
    yield* builderCalls(grantId, 'task_finished', { task, summary: `${task} built.` })
  })

/**
 * The mission's Builder starts a task and asks to write a file: the call waits for the user's
 * approval, and is left waiting.
 */
export const builderAsks = (missionId: string, task: string, write: BuilderWrite) =>
  Effect.gen(function* () {
    const grantId = yield* builderGrant(missionId)
    yield* builderCalls(grantId, 'task_start', { task })
    yield* readFirst(grantId, write)
    const answer = yield* callTool(grantId, 'fs_write', toolWrite(write)).pipe(Effect.orDie)
    if (!answer.text.startsWith(WAITING)) {
      return yield* Effect.die(new Error(`fs_write did not wait for the user: ${answer.text}`))
    }
  })
