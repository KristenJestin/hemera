/**
 * The fixture groups (#420): one per state worth testing by hand, each built from an empty base,
 * its state reached through the engine's services as a user and scripted agents would reach it.
 * Each says what to look at once the application is open on it.
 */

import { Effect, Predicate } from 'effect'
import type { Cause } from 'effect'

import { Chats } from '../src/engine/chat/service.ts'
import { transcriptOf } from '../src/engine/chat/store.ts'
import { buildingOf } from '../src/engine/building/builder.ts'
import { getMission, moveMission } from '../src/engine/missions.ts'
import { awaitRun, listRuns, startRun } from '../src/engine/runs.ts'
import { listWorkspaces } from '../src/engine/workspaces.ts'
import { listNeeds } from '../src/engine/needs.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import {
  DOCUMENTS,
  EXPORT_TEST_PATH,
  LEAKS_THE_KEY,
  PLANS_THE_EXPORT,
  READS_COLD,
  REVIEWS_THE_CODE,
  REVIEWS_THE_SPEC,
  SLOW_GREEN_SECONDS,
  heldBuilder,
  plansTheExport,
  type RoleScripts,
} from './agents.ts'
import type { FixtureGit } from './git.ts'
import { EXPORT_DRAFT, INVOICES, larkspur } from './larkspur.ts'
import {
  builderAsks,
  builderBuilds,
  launchedExport,
  fixedOutside,
  plannedExport,
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
   * Why it cannot be built yet, for a group whose state needs what the engine does not do yet: it
   * is listed with it, and the command refuses it.
   */
  readonly notYet?: string
  /** The script each role's agents play; every agent quiet unless said. */
  readonly scripts?: RoleScripts
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

/** The agents of a planned mission: its Planner, then its cold read. */
const PLANNED: RoleScripts = { planner: PLANS_THE_EXPORT, 'cold-read': READS_COLD }

/** The Builder of building-outside-change, held while the fix is written outside Hemera. */
const OUTSIDE_BUILDER = heldBuilder()

/** The agents of a mission built to its end: the documenter and both reviewers too. */
const REVIEWED: RoleScripts = {
  ...PLANNED,
  documenter: DOCUMENTS,
  'spec-reviewer': REVIEWS_THE_SPEC,
  'code-reviewer': REVIEWS_THE_CODE,
}

/** `src/export.js` once RV1 is built: the invoice number quoted. */
const QUOTED_EXPORT = `import { formatAmount, total } from './invoices.js'

/** The invoices as CSV, one line each: its number, quoted, and its total. */
export function toCsv(invoices) {
  const rows = invoices.map((invoice) => \`"\${invoice.number}",\${formatAmount(total(invoice.lines))}\`)
  return ['number,total', ...rows].join('\\n')
}
`

/** `src/invoices.js` once RV2 is built: what is not an amount is refused. */
const CHECKED_CENTS = `${INVOICES}
/** An amount as the invoice prints it read back in cents: "21.00" is 2100. */
export function toCents(printed) {
  const amount = Number(printed)
  if (Number.isNaN(amount)) throw new Error(\`not an amount: \${printed}\`)
  return Math.round(amount * 100)
}
`

/** The export built, every task done and R1.S1 green: the end of the Building starts. */
const builtExport = (world: FixtureWorld) =>
  Effect.gen(function* () {
    const launched = yield* launchedExport(world)
    const missionId = launched.mission.id
    yield* builderBuilds(missionId, 'T2', [
      { repository: 'api', path: 'src/invoices.js', content: WITH_CENTS },
    ])
    yield* builderBuilds(missionId, 'T1', [
      { repository: 'api', path: 'src/export.js', content: EXPORT_DRAFT, creates: true },
    ])
    // R1.S2 is to run again after T1's write in api: the end's refresh runs it.
    yield* proofReached(missionId, 'R1.S1', 'green')
    return launched
  })

/** The code reviewer's findings, RV1 and RV2, handed to the Builder, who builds both. */
const reviewedExport = (world: FixtureWorld) =>
  Effect.gen(function* () {
    const built = yield* builtExport(world)
    const missionId = built.mission.id
    yield* reached(
      'the special tasks RV1 and RV2',
      Effect.map(buildingOf(missionId), (view) =>
        ['RV1', 'RV2'].every((id) => view?.tasks.some((task) => task.id === id) === true),
      ),
    )
    yield* builderBuilds(missionId, 'RV1', [
      { repository: 'api', path: 'src/export.js', content: QUOTED_EXPORT },
    ])
    yield* builderBuilds(missionId, 'RV2', [
      { repository: 'api', path: 'src/invoices.js', content: CHECKED_CENTS },
    ])
    yield* reached(
      'Review',
      Effect.map(getMission(missionId), (mission) => mission.stage === 'review'),
    )
    return built
  })

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
    scripts: PLANNED,
    build: (world) => Effect.asVoid(plannedExport(world)),
  },
  {
    name: 'building-red',
    look: "Larkspur's CSV export in Building: R1.S1 has its red proof recorded and waits for its task (T1, available); R1.S2 is green, its task done by the Builder. The Building page, the proofs, the tasks.",
    scripts: PLANNED,
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
    scripts: PLANNED,
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
    scripts: { ...PLANNED, builder: OUTSIDE_BUILDER.script },
    build: (world) =>
      Effect.gen(function* () {
        const { mission } = yield* launchedExport(world)
        // The Builder's turn stays open until the fix outside Hemera is taken in, so it is not
        // judged quiet on the failed green first and asked "not proven": the order is the same
        // on every build.
        yield* builderBuilds(mission.id, 'T2', [
          { repository: 'api', path: 'src/invoices.js', content: WITH_CENTS },
        ])
        yield* builderBuilds(
          mission.id,
          'T1',
          [{ repository: 'api', path: 'src/export.js', content: HEADER_ONLY, creates: true }],
          OUTSIDE_BUILDER.hold,
        )
        yield* proofRan(mission.id, 'R1.S1', 2)
        yield* fixedOutside(mission.id, 'api', 'src/export.js', EXPORT_DRAFT)
        yield* proofReached(mission.id, 'R1.S1', 'green')
        yield* OUTSIDE_BUILDER.release
      }),
  },
  {
    name: 'permission-request',
    look: "Larkspur's CSV export in Building: the Builder started T1 and asks to write src/export.js; the request waits for your approval (Allow once, Allow for this mission, Deny). Needs you, the permission card.",
    scripts: PLANNED,
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
    scripts: { chat: LEAKS_THE_KEY },
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
    name: 'review-findings',
    look: "Larkspur's CSV export in Review: every task done and both proofs green; the automatic review's code reviewer found two things, which became the special tasks RV1 (quote the invoice number) and RV2 (refuse what is not an amount), both built by the Builder. The Review page, its diff and the findings.",
    scripts: REVIEWED,
    build: (world) => Effect.asVoid(reviewedExport(world)),
  },
  {
    name: 'exit-during-run',
    look: `Larkspur's CSV export in Building, its export written: R1.S1's green was running when the engine closed, and runs again as Hemera opens; it lasts ${String(SLOW_GREEN_SECONDS)} seconds. Close Hemera while it runs, then open the fixture again (without --rebuild): the exit, and the run started again at the restart.`,
    scripts: { ...PLANNED, planner: plansTheExport(true) },
    build: (world) =>
      Effect.gen(function* () {
        const { mission, project } = yield* launchedExport(world)
        yield* builderBuilds(mission.id, 'T1', [
          { repository: 'api', path: 'src/export.js', content: EXPORT_DRAFT, creates: true },
        ])
        // The engine closes with the green going, as when the user quits Hemera.
        yield* reached(
          "R1.S1's green running",
          Effect.gen(function* () {
            const [workspace] = yield* listWorkspaces(project.id)
            if (workspace === undefined) return false
            const runs = yield* listRuns(project.id, workspace.id)
            return runs.some(
              (run) => run.line.includes(EXPORT_TEST_PATH) && run.state === 'running',
            )
          }),
        )
      }),
  },
  {
    name: 'ended',
    look: "Larkspur's CSV export Done: the mission page and the lists as a finished mission shows them.",
    notYet:
      'Done is reached by Hemera at the end of the delivery (Shipping, the move "complete"), and no service of the engine makes that move yet. Built once the delivery is.',
    build: () => Effect.void,
  },
  {
    name: 'cancelled',
    look: "Larkspur's CSV export, planned whole then cancelled by the user: the mission page and the lists as a cancelled mission shows them.",
    scripts: PLANNED,
    build: (world) =>
      Effect.gen(function* () {
        const { mission } = yield* plannedExport(world)
        yield* moveMission(mission.id, 'cancel', 'user')
      }),
  },
]
