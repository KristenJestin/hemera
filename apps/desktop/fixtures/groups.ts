/**
 * The fixture groups (#420): one per state worth testing by hand, each built from an empty base,
 * its state reached through the engine's services as a user and scripted agents would reach it.
 * Each says what to look at once the application is open on it.
 */

import { Effect } from 'effect'
import type { Cause } from 'effect'

import type { FakeScript } from '../src/engine/agents/fake.ts'
import { moveMission } from '../src/engine/missions.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { PLANS_THE_EXPORT, QUIET, READS_COLD } from './agents.ts'
import type { FixtureGit } from './git.ts'
import { EXPORT_DRAFT, INVOICES, larkspur } from './larkspur.ts'
import {
  builderAsks,
  builderBuilds,
  launchedExport,
  plannedExport,
  proofReached,
} from './missions.ts'

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

/** `src/invoices.js` once the Builder added `toCents`: R1.S2's proof passes. */
const WITH_CENTS = `${INVOICES}
/** An amount as the invoice prints it read back in cents: "21.00" is 2100. */
export function toCents(printed) {
  return Math.round(Number(printed) * 100)
}
`

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
    name: 'building-red',
    look: "Larkspur's CSV export in Building: R1.S1 has its red proof recorded and waits for its task (T1, available); R1.S2 is green, its task done by the Builder. The Building page, the proofs, the tasks.",
    agents: (index) => [PLANS_THE_EXPORT, READS_COLD][index] ?? QUIET,
    build: (world) =>
      Effect.gen(function* () {
        const { mission } = yield* launchedExport(world)
        yield* builderBuilds(mission.id, 'T2', [
          { repository: 'api', path: 'src/invoices.js', content: WITH_CENTS },
        ])
        yield* proofReached(mission.id, 'R1.S2', 'green')
      }),
  },
  {
    name: 'permission-request',
    look: "Larkspur's CSV export in Building: the Builder started T1 and asks to write src/export.js; the request waits for your approval (Allow once, Allow for this mission, Deny). Needs you, the permission card.",
    agents: (index) => [PLANS_THE_EXPORT, READS_COLD][index] ?? QUIET,
    build: (world) =>
      Effect.gen(function* () {
        const { mission } = yield* launchedExport(world)
        yield* builderAsks(mission.id, 'T1', {
          repository: 'api',
          path: 'src/export.js',
          content: EXPORT_DRAFT,
          creates: true,
        })
      }),
  },
  {
    name: 'cancelled',
    look: "Larkspur's CSV export, planned whole then cancelled by the user: the mission page and the lists as a cancelled mission shows them.",
    agents: (index) => [PLANS_THE_EXPORT, READS_COLD][index] ?? QUIET,
    build: (world) =>
      Effect.gen(function* () {
        const { mission } = yield* plannedExport(world)
        yield* moveMission(mission.id, 'cancel', 'user')
      }),
  },
]
