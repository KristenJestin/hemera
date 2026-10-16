/**
 * The fixture groups (#420): one per state worth testing by hand, each built from an empty base,
 * its state reached through the engine's services as a user and scripted agents would reach it.
 * Each says what to look at once the application is open on it.
 */

import { Effect, Predicate } from 'effect'
import type { Cause } from 'effect'

import type { FakeScript } from '../src/engine/agents/fake.ts'
import { Chats } from '../src/engine/chat/service.ts'
import { transcriptOf } from '../src/engine/chat/store.ts'
import { moveMission } from '../src/engine/missions.ts'
import { awaitRun, startRun } from '../src/engine/runs.ts'
import { listNeeds } from '../src/engine/needs.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { LEAKS_THE_KEY, PLANS_THE_EXPORT, QUIET, READS_COLD } from './agents.ts'
import type { FixtureGit } from './git.ts'
import { EXPORT_DRAFT, INVOICES, larkspur } from './larkspur.ts'
import {
  builderAsks,
  builderBuilds,
  launchedExport,
  plannedExport,
  fixedOutside,
  proofRan,
  proofReached,
  reached,
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

/** An export that writes its header and forgets the invoices: R1.S1's green fails. */
const HEADER_ONLY = `/** The invoices as CSV. */
export function toCsv() {
  return 'number,total'
}
`

/** The questions Hemera asks the user, as the Needs show them. */
const decisionQuestions = Effect.map(listNeeds, (groups) =>
  groups
    .flatMap((group) => group.needs)
    .flatMap((need) => (Predicate.isTagged(need.fields, 'Decision') ? [need.fields.question] : [])),
)

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
    name: 'building-not-proven',
    look: 'Larkspur\'s CSV export in Building: every task done, but R1.S1\'s green failed and the Builder ended its turn without a fix. Hemera asks whether to try again or end without it: the "not proven" question in Needs you.',
    agents: (index) => [PLANS_THE_EXPORT, READS_COLD][index] ?? QUIET,
    build: (world) =>
      Effect.gen(function* () {
        const { mission } = yield* launchedExport(world)
        yield* builderBuilds(mission.id, 'T2', [
          { repository: 'api', path: 'src/invoices.js', content: WITH_CENTS },
        ])
        yield* proofReached(mission.id, 'R1.S2', 'green')
        yield* builderBuilds(mission.id, 'T1', [
          { repository: 'api', path: 'src/export.js', content: HEADER_ONLY, creates: true },
        ])
        yield* reached(
          'the "not proven" question',
          Effect.map(decisionQuestions, (questions) =>
            questions.some((question) => question.includes('is not proven')),
          ),
        )
      }),
  },
  {
    name: 'building-outside-change',
    look: "Larkspur's CSV export in Building: R1.S1's green failed on the Builder's export, then the fix was written in src/export.js outside Hemera, as in an editor. The repository is marked \"Changed outside Hemera\", the change is in the Journal, and the green ran again and passed.",
    agents: (index) => [PLANS_THE_EXPORT, READS_COLD][index] ?? QUIET,
    build: (world) =>
      Effect.gen(function* () {
        const { mission } = yield* launchedExport(world)
        yield* builderBuilds(mission.id, 'T2', [
          { repository: 'api', path: 'src/invoices.js', content: WITH_CENTS },
        ])
        yield* builderBuilds(mission.id, 'T1', [
          { repository: 'api', path: 'src/export.js', content: HEADER_ONLY, creates: true },
        ])
        yield* proofRan(mission.id, 'R1.S1', 2)
        yield* fixedOutside(mission.id, 'api', 'src/export.js', EXPORT_DRAFT)
        yield* proofReached(mission.id, 'R1.S1', 'green')
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
    name: 'masking',
    look: 'Larkspur with one Chat whose agent called the payments API: its fake key (PAYMENTS_API_KEY) in a request header, in a URL, in JSON written in prose and in JSON inside a JSON string. Every place shows the mask, never the key: the Chat and its tool outputs.',
    agents: (index) => [LEAKS_THE_KEY][index] ?? QUIET,
    build: (world) =>
      Effect.gen(function* () {
        const { project } = yield* larkspur(world.work, world.git)
        const chat = yield* Chats.use((chats) => chats.create(project.id))
        yield* Chats.use((chats) =>
          chats.send(chat.id, 'Check that the payments API answers with our key.', []),
        )
        // The user runs the dry run of the payments client: the project's variables reach it.
        const run = yield* startRun({
          projectId: project.id,
          workspaceId: null,
          commandId: null,
          line: 'node scripts/dry-run-payments.mjs',
          folder: 'api',
          startedBy: 'user',
          sessionId: null,
        })
        yield* awaitRun(run.id)
        yield* reached(
          'the Chat answered',
          Effect.map(transcriptOf(chat.id, null), (page) =>
            JSON.stringify(page.entries).includes('the key works'),
          ),
        )
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
