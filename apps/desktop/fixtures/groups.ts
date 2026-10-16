/**
 * The fixture groups (#420): one per state worth testing by hand, each built from an empty base,
 * its state reached through the engine's services as a user and scripted agents would reach it.
 * Each says what to look at once the application is open on it.
 */

import { Effect } from 'effect'
import type { Cause } from 'effect'

import type { FakeScript } from '../src/engine/agents/fake.ts'
import { createMission, moveMission } from '../src/engine/missions.ts'
import { listColdReads } from '../src/engine/planning/cold-read-store.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { PLANS_THE_EXPORT, QUIET, READS_COLD } from './agents.ts'
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
const plannedExport = (world: FixtureWorld) =>
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

/** What a group builds in: its folder for repositories, and a Git that commits the same way twice. */
export interface FixtureWorld {
  readonly work: string
  readonly git: FixtureGit
}

export interface FixtureGroup {
  readonly name: string
  /** What to test once the application is open on it. */
  readonly look: string
  /**
   * The script of each agent the engine starts, by its place in the start order; every agent
   * quiet unless said.
   */
  readonly agents?: (index: number) => FakeScript
  /** Its state, through the engine's services, on a Profile opened from nothing. */
  readonly build: (world: FixtureWorld) => Effect.Effect<void, Cause.YieldableError, EngineServices>
}

export const FIXTURE_GROUPS: ReadonlyArray<FixtureGroup> = [
  {
    name: 'empty',
    look: 'The first launch: no project, the setup and the home as a new user sees them.',
    // The Profile opened once, its migrations applied: nothing else.
    build: () => Effect.void,
  },
  {
    name: 'project-ready',
    look: 'Larkspur, one project with two repositories (api, web), three variables and a fake secret (PAYMENTS_API_KEY, masked), nothing launched: the project page and its settings.',
    build: ({ work, git }) => Effect.asVoid(larkspur(work, git)),
  },
  {
    name: 'planning',
    look: 'Larkspur\'s mission "Export the invoices as CSV" in Planning: its Spec written whole by the Planner and declared complete, read cold with nothing found, ready to freeze. Read the plan and judge it.',
    // The Planner starts on its own as the mission is created, then the cold read.
    agents: (index) => [PLANS_THE_EXPORT, READS_COLD][index] ?? QUIET,
    build: (world) => Effect.asVoid(plannedExport(world)),
  },
  {
    name: 'cancelled',
    look:
      'Larkspur\'s CSV export, planned whole then cancelled by the user: the mission page and the lists as a cancelled mission shows them.',
    agents: (index) => [PLANS_THE_EXPORT, READS_COLD][index] ?? QUIET,
    build: (world) =>
      Effect.gen(function* () {
        const { mission } = yield* plannedExport(world)
        yield* moveMission(mission.id, 'cancel', 'user')
      }),
  },
]
