/**
 * The world of a Review round (#468, R2), for the suites beside `review-rounds.test.ts` (#485):
 * the engine as it starts, with the fake agent of #32 as every agent: the cold read reads, every
 * Builder and the Planner of a round answer each prompt (the test drives their tools through their
 * grants), and every other agent (the documenter, the reviewers) holds its turn until the test lets
 * it go. Acme's `api` and `web` in temporary folders, a mission launched into Building, moved into
 * Review the way the end of a Building leaves it, or through the real end of its first Building.
 */

import { SESSION_STATES } from '@hemera/core/domain'
import { FeedbackUser, type FeedbackView } from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Layer, type Schema } from 'effect'

import type { FakeScript } from '../src/engine/agents/fake.ts'
import { buildingOf } from '../src/engine/building/builder.ts'
import { TaskChecks } from '../src/engine/building/checks.ts'
import { getMission, moveIn } from '../src/engine/missions.ts'
import { Review, type FeedbackAsked } from '../src/engine/review/feedback.ts'
import { Rounds } from '../src/engine/review/rounds.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { sessionsIn } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  buildingLaunches,
  buildings,
  sessionDeliveries,
  workspaces,
} from '../src/engine/storage/schema.ts'
import { mutate } from '../src/engine/transaction.ts'
import { READING, grantOf, says } from './building-world.ts'
import { builderOf, launched } from './builder-world.ts'
import { HELPER, held, sessionsEngine, text, until } from './sessions-world.ts'
import { ALLOW, callTool, verdictsSaying } from './tools-world.ts'

/** How long a step may take on a slow runner: never a measure of speed. */
export const LONG = 30_000

/** Each test runs a whole engine, Git and agents: far above its time alone. */
export const SLOW = { timeout: 180_000 }

const USER = FeedbackUser.make({})

/** Whether an agent's first prompt is one the test drives through its grant: it answers at once. */
const DRIVEN = ['## Builder · ', '## Planner · ']

/** How the end of a round names the sources left to answer to its Builder. */
const ANSWERS_ASKED = 'The round does not end while a source has no answer'

/**
 * The engine over `data`: the cold read reads (unless `resumed`), the Builders and the round's
 * Planner answer every prompt, every other agent holds its turn until the test lets it go. A
 * Builder told to answer its sources holds that turn while the test answers them through its grant.
 */
export const rounding = (
  data: string,
  work: string,
  options: { readonly resumed?: boolean } = {},
) => {
  const answering = held()
  const holds = new Map<number, ReturnType<typeof held>>()
  const holdOf = (index: number) => {
    const found = holds.get(index) ?? held()
    holds.set(index, found)
    return found
  }
  const driven = (index: number) => {
    const first = text(engine.world.agents[index]?.answers.prompts[0] ?? [])
    return DRIVEN.some((heading) => first.includes(heading))
  }
  const asked = (index: number) =>
    text(engine.world.agents[index]?.answers.prompts.at(-1) ?? []).includes(ANSWERS_ASKED)
  const script = (index: number): FakeScript =>
    index === 0 && options.resumed !== true
      ? READING
      : {
          steps: [says('Working.')],
          between: () =>
            !driven(index)
              ? holdOf(index).promise
              : asked(index)
                ? answering.promise
                : Promise.resolve(),
        }
  const engine = sessionsEngine(data, script, {
    roles: [HELPER],
    tools: { home: work, verdicts: verdictsSaying(() => ALLOW).layer },
    building: {
      outside: { compareEveryMillis: 3_600_000, baseEveryMillis: 3_600_000 },
      checks: Layer.succeed(TaskChecks, { run: () => Effect.succeed([]) }),
    },
  })
  return {
    world: {
      agents: engine.world.agents,
      release: (index: number) => holdOf(index).release(),
    },
    run: <A, E>(program: Parameters<typeof engine.run<A, E>>[0]) =>
      engine.run(program).finally(() => {
        answering.release()
        for (const one of holds.values()) one.release()
      }),
  }
}

/** What a suite reads of the agents of `rounding`, and how it lets one go. */
export interface Held {
  readonly agents: ReadonlyArray<{
    answers: { prompts: ReadonlyArray<ReadonlyArray<{ type: string; text?: string }>> }
  }>
  readonly release: (index: number) => void
}

/**
 * The mission's Building ended as the exit of its end leaves it (B9): its sessions stopped, the
 * Building over, the mission moved to Review by Hemera.
 */
const intoReview = (missionId: string) =>
  Effect.gen(function* () {
    yield* Sessions.use((sessions) =>
      sessions.stopTree({ kind: 'mission', missionId }, 'the Building ended'),
    )
    const mission = yield* getMission(missionId)
    yield* mutate('ending the Building', (transaction) =>
      Effect.gen(function* () {
        yield* transaction
          .update(buildings)
          .set({ state: 'ended', phase: 'ended', endedAt: new Date().toISOString() })
          .where(and(eq(buildings.missionId, missionId), eq(buildings.state, 'active')))
        const event = yield* moveIn(
          transaction,
          { id: missionId, stage: mission.stage, round: mission.round },
          'endBuilding',
          'hemera',
        )
        return { result: undefined, events: [event] }
      }),
    )
  })

/** A mission launched over Acme's `api`, its first Building ended, its first Builder's lineage. */
export const reviewed = (work: string) =>
  Effect.gen(function* () {
    const { mission, project } = yield* launched(work)
    const lineage = (yield* builderOf(mission.id)).session.lineage
    yield* intoReview(mission.id)
    return { missionId: mission.id, projectId: project.id, key: mission.key, lineage }
  })

export const remark = (body: string): FeedbackAsked => ({
  kind: 'remark',
  body,
  anchor: null,
  images: [],
})

export const written = (missionId: string, asked: FeedbackAsked) =>
  Review.use((review) => review.feedbackAdd(missionId, asked, USER))

export const withdrawn = (feedbackId: string) =>
  Review.use((review) => review.feedbackWithdraw(feedbackId, USER))

export const fix = (missionId: string) => Rounds.use((rounds) => rounds.fix(missionId))

/**
 * The round's Planner once its first turn ended, and a grant the test drives it with; never the
 * session `before` (one a restart replaces).
 */
export const roundPlannerOf = (missionId: string, before = '') =>
  Effect.gen(function* () {
    const idle = Effect.map(
      sessionsIn(['idle'], { kind: 'mission', missionId }),
      (rows) => rows.find((row) => row.role === 'round-planner' && row.id !== before) ?? null,
    )
    yield* until(
      Effect.map(idle, (found) => found !== null),
      LONG,
    )
    const session = yield* idle
    if (session === null) return yield* Effect.die(new Error('no Planner in round mode'))
    return { session, grantId: yield* grantOf(session.id) }
  })

/** A tool's answer, its text and whether it went through. */
export const using = (grantId: string, tool: string, args: Schema.JsonObject) =>
  Effect.map(callTool(grantId, tool, args), (answer) => ({ ok: answer.ok, text: answer.text }))

/** A tool that must go through: its text. */
export const used = (grantId: string, tool: string, args: Schema.JsonObject) =>
  Effect.gen(function* () {
    const answer = yield* callTool(grantId, tool, args)
    if (!answer.ok) return yield* Effect.die(new Error(`${tool}: ${answer.text}`))
    return answer.text
  })

/** A scenario verified by hand. */
const byHand = (when: string, then: string): Schema.JsonObject => ({
  when,
  then,
  proof: {
    mode: 'by_hand',
    actions: [`${when}.`],
    starting_data: 'Two invoices.',
    expected: `${then}.`,
    seen_today: false,
  },
})

/** The header point R1.1 of round 1, its scenario by hand, from `sources`. */
export const headerPoint = (grantId: string, sources: ReadonlyArray<string>) =>
  used(grantId, 'round_point_write', {
    round: 1,
    text: 'The CSV export starts with a header row naming each column.',
    kind: 'corrective',
    scenarios: [byHand('the user exports the invoices', 'the first line names the columns')],
    decisions: [],
    sources: [...sources],
  })

/** The round's one task, building R1.1 by changing `invoices.ts`. */
export const headerTask = (grantId: string) =>
  used(grantId, 'round_tasks_write', {
    round: 1,
    tasks: [
      {
        title: 'Write the header',
        result: 'The CSV starts with its header row.',
        points: ['R1.1'],
        scenarios: ['R1.1.S1'],
        targets: [{ repository: 'api', path: 'invoices.ts', intent: 'change' }],
        depends_on: [],
      },
    ],
  })

/** The header point, built by one task changing `invoices.ts`, and the round ready. */
export const headerRound = (grantId: string, sources: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    yield* headerPoint(grantId, sources)
    yield* headerTask(grantId)
    return yield* used(grantId, 'round_ready', {
      why: 'The remarks are one point, built by one task.',
    })
  })

/** The round's Builder builds its one task, writing the header into `invoices.ts`. */
export const builtHeader = (grantId: string) =>
  Effect.gen(function* () {
    const started = yield* using(grantId, 'task_start', { task: 'R1.T1' })
    if (!started.ok || started.text.startsWith('refused')) {
      return yield* Effect.die(new Error(started.text))
    }
    yield* used(grantId, 'fs_read', { repository: 'api', path: 'invoices.ts' })
    yield* used(grantId, 'fs_write', {
      repository: 'api',
      path: 'invoices.ts',
      content: "export const header = 'number,date,amount'\nexport const invoices = []\n",
    })
    yield* used(grantId, 'task_finished', { task: 'R1.T1', summary: 'The header row is written.' })
  })

/**
 * The round's Builder: idle, not of `before`'s lineage, never the session `replaced` (one a restart
 * replaces), and a grant to drive it.
 */
export const roundBuilderOf = (missionId: string, before: string, replaced = '') =>
  Effect.gen(function* () {
    const idle = Effect.map(
      sessionsIn(['idle'], { kind: 'mission', missionId }),
      (rows) =>
        rows.find(
          (row) => row.role === 'builder' && row.lineage !== before && row.id !== replaced,
        ) ?? null,
    )
    yield* until(
      Effect.map(idle, (found) => found !== null),
      LONG,
    )
    const session = yield* idle
    if (session === null) return yield* Effect.die(new Error('no Builder for the round'))
    return { session, grantId: yield* grantOf(session.id) }
  })

/** The mission's latest Building, once it is the one of a round. */
export const roundBuilding = (missionId: string, round: number) =>
  Effect.gen(function* () {
    yield* until(
      Effect.map(buildingOf(missionId), (view) => view?.round?.number === round),
      LONG,
    )
    const view = yield* buildingOf(missionId)
    if (view === null) return yield* Effect.die(new Error('no Building'))
    return view
  })

/** Waits until a scenario's proof of the latest Building is in a state. */
export const proofIn = (missionId: string, scenario: string, state: string) =>
  until(
    Effect.map(buildingOf(missionId), (view) =>
      (view?.requirements ?? [])
        .flatMap((one) => one.scenarios)
        .some((one) => one.scenario === scenario && one.state === state),
    ),
    LONG,
  )

const HEADINGS = {
  documenter: '## Documenter · ',
  'spec-reviewer': '## Spec reviewer · ',
  'code-reviewer': '## Code reviewer · ',
}

/** The `count`-th agent of a role in the mission once it read its brief, and a grant to drive it. */
const agentOf = (world: Held, missionId: string, role: keyof typeof HEADINGS, count = 1) =>
  Effect.gen(function* () {
    const heading = HEADINGS[role]
    const indexes = () =>
      world.agents.flatMap((agent, index) =>
        text(agent.answers.prompts[0] ?? []).includes(heading) ? [index] : [],
      )
    yield* until(
      Effect.sync(() => indexes().length >= count),
      LONG,
    )
    const index = indexes()[count - 1] ?? -1
    const opened = Effect.map(sessionsIn(SESSION_STATES, { kind: 'mission', missionId }), (rows) =>
      rows
        .filter((row) => row.role === role)
        .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)),
    )
    yield* until(
      Effect.map(opened, (rows) => rows.length >= count),
      LONG,
    )
    const session = (yield* opened).at(-1)
    if (session === undefined) return yield* Effect.die(new Error(`no ${role}`))
    return { session, index, grantId: yield* grantOf(session.id) }
  })

/** Waits until the mission is in a stage. */
export const inStage = (missionId: string, stage: string) =>
  until(
    Effect.map(getMission(missionId), (mission) => mission.stage === stage),
    LONG,
  )

/** The `count`-th documenter and both reviewers report nothing to change, and the mission is back. */
export const throughEnd = (world: Held, missionId: string, count = 1) =>
  Effect.gen(function* () {
    const documenter = yield* agentOf(world, missionId, 'documenter', count)
    yield* used(documenter.grantId, 'docs_report', {
      changed: [],
      no_change_reason: 'The header row changes no behaviour the README describes to its readers.',
    })
    world.release(documenter.index)
    for (const role of ['spec-reviewer', 'code-reviewer'] as const) {
      const reviewer = yield* agentOf(world, missionId, role, count)
      yield* used(reviewer.grantId, 'review_report', { findings: [] })
      world.release(reviewer.index)
    }
    yield* inStage(missionId, 'review')
  })

/** The feedback of the mission, by id, as Review reads it now. */
export const feedbackNow = (missionId: string) =>
  Effect.map(
    Review.use((review) => review.state(missionId)),
    (state) => new Map<string, FeedbackView>(state.feedback.map((one) => [one.id, one])),
  )

/** The rounds of the mission, as `[number, state]`. */
export const roundsOf = (missionId: string) =>
  Effect.map(
    Review.use((review) => review.state(missionId)),
    (state) => state.rounds.map((one) => [one.number, one.state] as const),
  )

/** The mission's sessions still running. */
export const liveOf = (missionId: string) =>
  sessionsIn(['starting', 'working', 'idle', 'stuck'], { kind: 'mission', missionId })

/** The Workspace folder of the mission's launch. */
export const workspaceOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ folder: workspaces.folder })
      .from(buildingLaunches)
      .innerJoin(workspaces, eq(workspaces.id, buildingLaunches.workspaceId))
      .where(eq(buildingLaunches.missionId, missionId))
    return row?.folder ?? ''
  })

/** What was delivered to a role of the mission, as `kind: body`. */
export const deliveredTo = (missionId: string, role: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return (yield* database
      .select()
      .from(sessionDeliveries)
      .where(eq(sessionDeliveries.ownerId, missionId))
      .orderBy(asc(sessionDeliveries.createdAt)))
      .filter((row) => row.targetRole === role)
      .map((row) => `${row.kind}: ${row.body}`)
  })
