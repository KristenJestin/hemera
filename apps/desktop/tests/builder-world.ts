/**
 * The world of the Builder (#141): Acme's real repositories in temporary folders, a mission whose
 * frozen Spec has four tasks, checked and launched into Building, and the engine with the fake
 * agent of #32 as every agent (the cold read first, then the Builder, who answers every prompt and
 * does nothing else). The test drives the Builder's tools through its grant.
 *
 * The plan: T1 changes `api/invoices.ts` (R1.S1); T2 creates `api/export.ts` (R1.S2); T3 changes
 * `api/README.md` once T1 and T2 are done (R1.S3); T4 changes `api/invoices.ts` too (R1.S1), so
 * T1 and T4 cannot run together.
 */

import { SPEC_SECTIONS } from '@hemera/core/domain'
import type { BuildingTaskView, BuildingView } from '@hemera/ipc'
import { Effect, type Layer } from 'effect'

import type { FakeScript } from '../src/engine/agents/fake.ts'
import { checkMission } from '../src/engine/building/check.ts'
import { launchMission } from '../src/engine/building/launch.ts'
import type { BuildingEnd, TaskVerdict } from '../src/engine/building/builder.ts'
import { buildingOf } from '../src/engine/building/builder.ts'
import { freezeMission } from '../src/engine/planning/freeze.ts'
import { readSpec } from '../src/engine/planning/store.ts'
import { sessionsIn } from '../src/engine/sessions/store.ts'
import {
  QUIET,
  READING,
  acmeAt,
  call,
  checked,
  grantOf,
  inStage,
  plannedIn,
  readCold,
} from './building-world.ts'
import { HELPER, sessionsEngine, until } from './sessions-world.ts'

/** The cold read first, then every other agent quiet: the test drives the Builder itself. */
export const builderAgents = (index: number): FakeScript => (index === 0 ? READING : QUIET)

/** The engine over `data`, with the Builder of this version and a test helper role. */
export const builderEngine = (
  data: string,
  work: string,
  building: {
    readonly verdict?: Layer.Layer<TaskVerdict>
    readonly end?: Layer.Layer<BuildingEnd>
  } = {},
) =>
  sessionsEngine(data, builderAgents, {
    roles: [HELPER],
    tools: { home: work },
    building,
  })

const scenario = (when: string) => ({ when, then: `${when}: it works` })

const byHand = (scenarioId: string) => ({
  scenario: scenarioId,
  proof: {
    mode: 'by_hand',
    actions: [`Do ${scenarioId}`],
    starting_data: 'None.',
    expected: `${scenarioId} works.`,
    seen_today: false,
  },
  base_version: 0,
})

/** The four tasks of the plan, as `tasks_write` takes them. */
export const PLAN = [
  {
    title: 'Export as CSV',
    result: 'The invoices export as CSV.',
    requirements: ['R1'],
    scenarios: ['R1.S1'],
    targets: [{ repository: 'api', path: 'invoices.ts', intent: 'change' }],
    depends_on: [],
  },
  {
    title: 'Export as Markdown',
    result: 'The invoices export as Markdown.',
    requirements: ['R1'],
    scenarios: ['R1.S2'],
    targets: [{ repository: 'api', path: 'export.ts', intent: 'create' }],
    depends_on: [],
  },
  {
    title: 'Document the exports',
    result: 'The README says how to export.',
    requirements: ['R1'],
    scenarios: ['R1.S3'],
    targets: [{ repository: 'api', path: 'README.md', intent: 'change' }],
    depends_on: ['Export as CSV', 'Export as Markdown'],
  },
  {
    title: 'Name the invoices',
    result: 'Each invoice has a name.',
    requirements: ['R1'],
    scenarios: ['R1.S1'],
    targets: [{ repository: 'api', path: 'invoices.ts', intent: 'change' }],
    depends_on: [],
  },
]

/** A mission of Acme planned with the four tasks, frozen, checked and launched: Building. */
export const launched = (work: string) =>
  Effect.gen(function* () {
    const { project, main } = yield* acmeAt(work)
    const { mission, grantId } = yield* plannedIn(project.id, main)
    for (const section of SPEC_SECTIONS) {
      yield* call(grantId, 'spec_write_section', {
        section,
        content: `The ${section}.`,
        base_version: 0,
      })
    }
    yield* call(grantId, 'requirement_write', {
      domain: 'invoices',
      text: 'Invoices export.',
      delta: 'added',
      scenarios: [scenario('as CSV'), scenario('as Markdown'), scenario('read the README')],
    })
    yield* call(grantId, 'mission_describe', { title: 'Invoices exports', type: 'feature' })
    for (const id of ['R1.S1', 'R1.S2', 'R1.S3']) yield* call(grantId, 'proof_write', byHand(id))
    yield* call(grantId, 'tasks_write', { tasks: PLAN, base_version: 0 })
    yield* call(grantId, 'model_recommend', {
      agent: 'codex',
      model: 'gpt-large',
      reason: 'A small change.',
    })
    yield* call(grantId, 'declare_complete', { why: 'A Builder can build it.' })
    yield* readCold(mission.id, 1)
    yield* freezeMission(mission.id, (yield* readSpec(mission.id)).version)
    yield* checkMission(mission.id)
    const view = yield* checked(mission.id)
    yield* launchMission(mission.id, view.id, 'launch')
    yield* inStage(mission.id, 'building')
    return { project, main, mission }
  })

/**
 * The mission's Builder once its first turn ended, and a grant the test drives it with: minted
 * after the agent's own, which a session's next grant would revoke.
 */
export const builderOf = (missionId: string) =>
  Effect.gen(function* () {
    const idle = Effect.map(
      sessionsIn(['idle'], { kind: 'mission', missionId }),
      (rows) => rows.find((row) => row.role === 'builder') ?? null,
    )
    yield* until(Effect.map(idle, (found) => found !== null))
    const session = yield* idle
    if (session === null) return yield* Effect.die(new Error('no Builder'))
    return { session, grantId: yield* grantOf(session.id) }
  })

/** The mission's Building, once it exists. */
export const buildingNow = (missionId: string) =>
  Effect.gen(function* () {
    yield* until(Effect.map(buildingOf(missionId), (view) => view !== null))
    const view = yield* buildingOf(missionId)
    if (view === null) return yield* Effect.die(new Error('no Building'))
    return view
  })

/** Each task's state, by its id. */
export const statesOf = (view: BuildingView): Readonly<Record<string, string>> =>
  Object.fromEntries(view.tasks.map((task: BuildingTaskView) => [task.id, task.state]))

/** Waits until a task is in a state. */
export const taskIn = (missionId: string, taskId: string, state: string) =>
  until(
    Effect.map(
      buildingOf(missionId),
      (view) => view?.tasks.find((task) => task.id === taskId)?.state === state,
    ),
  )
