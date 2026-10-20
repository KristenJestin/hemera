/**
 * What the suites of the end of a Building share (`building-end-*.test.ts`, #147): the engine with
 * its agents held by the test, the fake checks, and the reads of what the end recorded. One file
 * was too long for one worker on a Windows runner (#484), so its suites are cut into four files,
 * and what they share lives here.
 */

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ChosenAnswer, type DocRecipeDraft, SESSION_STATES } from '@hemera/core/domain'
import { asc, eq } from 'drizzle-orm'
import type { LaunchFailed } from '@hemera/ipc'
import type { Duration } from 'effect'
import { Effect, Layer, Predicate, type Schema } from 'effect'
import type { FakeScript } from '../src/engine/agents/fake.ts'
import type { BuilderHold } from '../src/engine/building/builder.ts'
import { type CheckResult, TaskChecks } from '../src/engine/building/checks.ts'
import { helperRowsOf } from '../src/engine/building/helper-store.ts'
import { autoReviewOf } from '../src/engine/building/review-store.ts'
import { type EndHold } from '../src/engine/building/end.ts'
import type { OutsideSettings } from '../src/engine/building/outside.ts'
import type { SnapshotsService } from '../src/engine/building/snapshots.ts'
import { attemptsIn } from '../src/engine/building/tasks.ts'
import { acceptDocRecipes } from '../src/engine/doc-recipes.ts'
import { Memory } from '../src/engine/memory/index.ts'
import { getMission } from '../src/engine/missions.ts'
import { answerNeed } from '../src/engine/needs.ts'
import type { TaskStates } from '../src/engine/permissions/requests.ts'
import { everyTaskHolds } from '../src/engine/permissions/requests.ts'
import { type SessionHold } from '../src/engine/sessions/service.ts'
import { sessionsIn, sessionsOfLineage } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  buildingTasks,
  documenterPasses,
  domainEvents,
  sessionDeliveries,
} from '../src/engine/storage/schema.ts'
import { QUIET, READING, call, eventsOf, grantOf, says } from './building-world.ts'
import { builderOf, buildingNow, launched } from './builder-world.ts'
import { HELPER, held, sessionsEngine, text, until } from './sessions-world.ts'
import { ALLOW, callTool, verdictsSaying } from './tools-world.ts'
import type { Verdicts, WriteAttribution } from '../src/engine/tools/ports.ts'
import { temporaryFolder } from './storage.ts'

export let data: string
export let work: string

/** How long a step of the end may take on a slow runner: never a measure of speed. */
export const LONG = 30_000

/** A whole end runs many steps, each bounded by `LONG`. */
export const SLOW = { timeout: 180_000 }

/** What the checks of a scope say: none unless a test says; null for checks that never end. */
export type ChecksOf = (asked: {
  readonly scope: string
  readonly subject: string | null
}) => ReadonlyArray<CheckResult> | null

export const RED: CheckResult = {
  name: 'unit tests',
  place: 'api',
  verdict: 'red',
  detail: 'exit code 1',
  outputTail: 'FAIL the header row',
  runId: null,
}

export const GREEN: CheckResult = {
  ...RED,
  verdict: 'green',
  detail: 'exit code 0',
  outputTail: '',
}

export interface Agents {
  readonly agents: ReadonlyArray<{
    answers: { prompts: ReadonlyArray<ReadonlyArray<{ type: string; text?: string }>> }
  }>
}

/** The engine's world, and how a test lets a held agent's turn end. */
export interface Ending extends Agents {
  readonly release: (index: number) => void
}

/**
 * The engine over `dataFolder`. With `resumed`, no cold read and no Builder start first: every
 * agent holds its turn (an engine started again on a Building already under way).
 */
export const ending = (
  options: {
    readonly checks?: ChecksOf
    readonly resumed?: boolean
    readonly folder?: string
    /** The Builder's agent, when not every prompt is answered at once. */
    readonly builder?: FakeScript
    /** The snapshots as the engine reaches them, when a test makes one fail. */
    readonly snapshots?: (real: SnapshotsService) => SnapshotsService
    /** Runs as each agent starts: a failure there is an agent that cannot start. */
    readonly starting?: (sessionId: string) => Effect.Effect<void, LaunchFailed>
    /** The verdicts on the calls, when not every call is allowed. */
    readonly verdicts?: Layer.Layer<Verdicts>
    /** Whether a task still holds, as Hemera checks an allowed call again before it acts. */
    readonly taskStates?: Layer.Layer<TaskStates>
    /** Where the writes are attributed, when a test holds one as it executes. */
    readonly attribution?: Layer.Layer<WriteAttribution>
    /** Where the Builder is held, when a test orders it against the end. */
    readonly hold?: BuilderHold
    /** Where the end is held as it takes in a Builder's turn end. */
    readonly endHold?: EndHold
    /** Where a session is held as it starts or fails, or its start failed. */
    readonly sessionHold?: SessionHold
    /** How long a minute of the Project's proof limit lasts (#321). */
    readonly proofMinute?: Duration.Duration
    /** The detector of changes outside Hemera, when a test keeps its timer from driving the end. */
    readonly outside?: Partial<OutsideSettings>
  } = {},
) => {
  const holds = new Map<number, ReturnType<typeof held>>()
  const holdOf = (index: number) => {
    const found = holds.get(index) ?? held()
    holds.set(index, found)
    return found
  }
  const working = (index: number): FakeScript => ({
    steps: [says('Working.')],
    between: () => holdOf(index).promise,
  })
  const first: ReadonlyArray<FakeScript> =
    options.resumed === true ? [] : [READING, options.builder ?? QUIET]
  const checks = options.checks ?? (() => [])
  const verdicts = options.verdicts ?? verdictsSaying(() => ALLOW).layer
  const taskStates = options.taskStates ?? everyTaskHolds
  const engine = sessionsEngine(options.folder ?? data, (index) => first[index] ?? working(index), {
    roles: [HELPER],
    sessions: options.sessionHold === undefined ? {} : { sessionHold: options.sessionHold },
    starting: options.starting ?? (() => Effect.void),
    snapshots: options.snapshots ?? ((real) => real),
    tools:
      options.attribution === undefined
        ? { home: work, verdicts, taskStates }
        : { home: work, verdicts, taskStates, attribution: options.attribution },
    building: {
      hold: options.hold,
      endHold: options.endHold,
      proofMinute: options.proofMinute,
      outside: options.outside ?? {},
      checks: Layer.succeed(TaskChecks, {
        run: (asked) => {
          const said = checks(asked)
          return said === null ? Effect.never : Effect.succeed(said)
        },
      }),
    },
  })
  const world: Ending = {
    agents: engine.world.agents,
    release: (index) => holdOf(index).release(),
  }
  return {
    world,
    run: <A, E>(program: Parameters<typeof engine.run<A, E>>[0]) =>
      engine.run(program).finally(() => {
        for (const one of holds.values()) one.release()
      }),
  }
}

export const README: DocRecipeDraft = {
  repository: 'api',
  path: 'README.md',
  purpose: 'What the api is, and how to export the invoices.',
  applies: 'always',
  words: [],
}

/** A launch whose Project documents its README. */
export const withReadme = (projectId: string) =>
  Effect.asVoid(acceptDocRecipes(projectId, [README]))

/** The Builder runs every task of the plan to its end: T1 writes `invoices.ts`, T2 `export.ts`. */
export const builtAll = (grantId: string, exported = 'export const markdown = true\n') =>
  Effect.gen(function* () {
    for (const task of ['T1', 'T2', 'T4', 'T3']) {
      const started = yield* call(grantId, 'task_start', { task })
      if (started.startsWith('refused')) return yield* Effect.die(new Error(started))
      if (task === 'T1') {
        yield* call(grantId, 'fs_read', { repository: 'api', path: 'invoices.ts' })
        yield* call(grantId, 'fs_write', {
          repository: 'api',
          path: 'invoices.ts',
          content: 'export const invoices = ["csv"]\n',
        })
      }
      if (task === 'T2') {
        yield* call(grantId, 'fs_write', {
          repository: 'api',
          path: 'export.ts',
          content: exported,
        })
      }
      yield* call(grantId, 'task_finished', { task, summary: `${task} built.` })
    }
  })

export const HEADINGS = {
  documenter: '## Documenter · ',
  'spec-reviewer': '## Spec reviewer · ',
  'code-reviewer': '## Code reviewer · ',
}

/**
 * The `count`-th agent of a role in the mission once it read its brief: its session, its brief,
 * its index among the agents, and a grant to drive it.
 */
export const agentOf = (world: Agents, missionId: string, role: keyof typeof HEADINGS, count = 1) =>
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
    return {
      session,
      index,
      brief: text(world.agents[index]?.answers.prompts[0] ?? []),
      grantId: yield* grantOf(session.id),
    }
  })

export const NO_DOC = 'The exports change no behaviour the README describes to its readers.'

/** The `count`-th documenter reports that nothing needed to change, and its turn ends. */
export const documented = (world: Ending, missionId: string, count = 1) =>
  Effect.gen(function* () {
    const documenter = yield* agentOf(world, missionId, 'documenter', count)
    const answer = yield* callTool(documenter.grantId, 'docs_report', {
      changed: [],
      no_change_reason: NO_DOC,
    })
    if (!answer.ok) return yield* Effect.die(new Error(answer.text))
    world.release(documenter.index)
    return documenter
  })

/** A reviewer reports its pass, and its turn ends. */
export const reviewed = (
  world: Ending,
  missionId: string,
  role: 'spec-reviewer' | 'code-reviewer',
  findings: ReadonlyArray<Schema.JsonObject> = [],
) =>
  Effect.gen(function* () {
    const reviewer = yield* agentOf(world, missionId, role)
    const answer = yield* callTool(reviewer.grantId, 'review_report', { findings: [...findings] })
    if (!answer.ok) return yield* Effect.die(new Error(answer.text))
    world.release(reviewer.index)
    return reviewer
  })

/** A finding that goes the Spec's way, on a file of `api`. */
export const warning = (path: string, words: string): Schema.JsonObject => ({
  severity: 'warning',
  repository: 'api',
  path,
  text: words,
  contradicts_spec: false,
  evidence: `Read ${path} at the checkpoint.`,
})

/** The Builder runs a special task to its end, writing `path` of `api` when one is given. */
export const specialDone = (
  grantId: string,
  task: string,
  path: string | null,
  content = 'fixed\n',
) =>
  Effect.gen(function* () {
    const started = yield* call(grantId, 'task_start', { task })
    if (started.startsWith('refused')) return yield* Effect.die(new Error(started))
    if (path !== null) {
      yield* call(grantId, 'fs_read', { repository: 'api', path })
      yield* call(grantId, 'fs_write', { repository: 'api', path, content })
    }
    return yield* call(grantId, 'task_finished', { task, summary: `${task} done.` })
  })

/** The mission's helper of a number, once its session runs, and a grant the test drives it with. */
export const helperNumbered = (missionId: string, number: number) =>
  Effect.gen(function* () {
    const sessionOf = Effect.gen(function* () {
      const row = (yield* helperRowsOf(missionId)).find((one) => one.number === number)
      if (row === undefined) return null
      const live = (yield* sessionsOfLineage(row.lineage)).filter((one) =>
        ['working', 'idle'].includes(one.state),
      )
      const session = live.toSorted((a, b) => b.epoch - a.epoch).at(0)
      return session === undefined ? null : { row, session }
    })
    yield* until(
      Effect.map(sessionOf, (found) => found !== null),
      LONG,
    )
    const found = yield* sessionOf
    if (found === null) return yield* Effect.die(new Error(`no helper H${String(number)}`))
    return { ...found, grantId: yield* grantOf(found.session.id) }
  })

/** Waits until the mission reached Review. */
export const inReview = (missionId: string) =>
  until(
    Effect.map(getMission(missionId), (mission) => mission.stage === 'review'),
    LONG,
  )

/** Waits until a special task is available to the Builder. */
export const specialAvailable = (missionId: string, task: string) =>
  until(
    Effect.map(buildingNow(missionId), (view) =>
      view.tasks.some((one) => one.id === task && one.state === 'available'),
    ),
    LONG,
  )

/** Waits until both reviewers run. */
export const reviewing = (missionId: string) =>
  until(
    Effect.map(
      autoReviewOf(missionId),
      (review) =>
        review !== null &&
        review.passes.length === 2 &&
        review.passes.every((one) => one.state === 'running'),
    ),
    LONG,
  )

/** Every line of the mission's Journal, the first first. */
export const journalOf = (missionId: string) =>
  Effect.gen(function* () {
    const lines: string[] = []
    let before: number | null = null
    for (;;) {
      const page = yield* Memory.use((memory) => memory.journal(missionId, before))
      lines.unshift(...page.lines.map((line) => line.text).toReversed())
      if (page.before === null || page.lines.length === 0) return lines
      before = page.before
    }
  })

/** The types of the mission's events, in their order. */
export const typesOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return (yield* database
      .select({ type: domainEvents.type })
      .from(domainEvents)
      .where(eq(domainEvents.entityId, missionId))
      .orderBy(asc(domainEvents.sequence))).map((row) => row.type)
  })

/** What was delivered to the mission's Builder, by role or by its lineage. */
export const toBuilder = (missionId: string, lineage: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return (yield* database
      .select()
      .from(sessionDeliveries)
      .where(eq(sessionDeliveries.ownerId, missionId)))
      .filter((row) => row.targetRole === 'builder' || row.targetLineage === lineage)
      .map((row) => `${row.kind}: ${row.body}`)
  })

/** A file of the Workspace's `api`, written as the user would, outside every agent. */
export const writtenInWorkspace = (folder: string, path: string, content: string) => {
  mkdirSync(dirname(join(folder, path)), { recursive: true })
  writeFileSync(join(folder, path), content)
}

/** The Workspace's `api` folder. */
export const apiOf = (missionId: string) =>
  Effect.map(buildingNow(missionId), (view) => view.repositories[0]?.folder ?? '')

/** The folder of a repository of the Workspace. */
export const folderOf = (missionId: string, name: string) =>
  Effect.map(
    buildingNow(missionId),
    (view) => view.repositories.find((one) => one.name === name)?.folder ?? '',
  )

/** The Impact of a mission whose Workspace holds both of Acme's repositories. */
export const BOTH = 'It touches api and web, nothing else.'

/** The targets of the special tasks born from the findings. */
export const specialTargets = Effect.gen(function* () {
  const database = yield* Database
  return (yield* database
    .select({ targets: buildingTasks.targets })
    .from(buildingTasks)
    .where(eq(buildingTasks.origin, 'review'))).map((row) => row.targets)
})

/** Waits until a scenario's proof is in a state, as the Building page reads it. */
export const proofState = (missionId: string, scenario: string, state: string) =>
  until(
    Effect.map(buildingNow(missionId), (view) =>
      view.requirements
        .flatMap((one) => one.scenarios)
        .some((one) => one.scenario === scenario && one.state === state),
    ),
    LONG,
  )

/** A mission whose RV1 changes `path` of `api`, a file at the checkpoint, to Review. */
export const throughSpecial = (world: Ending, path: string, delta: boolean) =>
  Effect.gen(function* () {
    const { mission } = yield* launched(work, withReadme)
    const builder = yield* builderOf(mission.id)
    const api = yield* apiOf(mission.id)
    writtenInWorkspace(api, 'src/x.ts', 'export const x = 1\n')
    yield* builtAll(builder.grantId)
    yield* documented(world, mission.id)
    yield* reviewed(world, mission.id, 'spec-reviewer')
    yield* reviewed(world, mission.id, 'code-reviewer', [warning(path, `Fix ${path}.`)])
    yield* specialAvailable(mission.id, 'RV1')
    yield* specialDone(builder.grantId, 'RV1', path, 'export const x = 2\n')
    if (delta) yield* documented(world, mission.id, 2)
    yield* inReview(mission.id)
    const database = yield* Database
    return {
      mission,
      passes: yield* database.select().from(documenterPasses).orderBy(asc(documenterPasses.number)),
      deltas: yield* eventsOf(mission.id, 'building.documenter_delta'),
      review: yield* autoReviewOf(mission.id),
    }
  })

/** R1.S2's proof: a test that holds once `export.ts` exists in `api`. */
export const exported = [
  "import { test } from 'node:test'",
  "import assert from 'node:assert/strict'",
  "import { existsSync } from 'node:fs'",
  '',
  "test('the scenario holds', () => {",
  "  assert.equal(existsSync(new URL('../export.ts', import.meta.url)), true, 'no export.ts')",
  '})',
  '',
].join('\n')
export const exportProof = () => ({
  'R1.S2': {
    mode: 'automated',
    actions: ['Run the test'],
    starting_data: 'None.',
    expected: 'The assertion of the test holds.',
    test: {
      repository: 'api',
      path: 'tests/export.test.mjs',
      code: exported,
      insertion: 'new_file',
      command: `"${process.execPath}" --test --test-reporter=tap tests/export.test.mjs`,
    },
    seen_today: false,
  },
})

/** R1.S2's test: green while `api/export.ts` exports `toMarkdown`. */
export const markdownTest = [
  "import { test } from 'node:test'",
  "import assert from 'node:assert/strict'",
  "import { existsSync, readFileSync } from 'node:fs'",
  '',
  "test('the scenario holds', () => {",
  "  const file = new URL('../export.ts', import.meta.url)",
  "  assert.ok(existsSync(file) && readFileSync(file, 'utf8').includes('toMarkdown'), 'no toMarkdown')",
  '})',
  '',
].join('\n')
export const markdownProof = () => ({
  'R1.S2': {
    mode: 'automated',
    actions: ['Run the test'],
    starting_data: 'None.',
    expected: 'The assertion of the test holds.',
    test: {
      repository: 'api',
      path: 'tests/export.test.mjs',
      code: markdownTest,
      insertion: 'new_file',
      command: `"${process.execPath}" --test --test-reporter=tap tests/export.test.mjs`,
    },
    seen_today: false,
  },
})

/** The verdicts of the end's attempts at the final checks, in their order; null while open. */
export const endAttempts = (missionId: string) =>
  Effect.gen(function* () {
    const view = yield* buildingNow(missionId)
    return (yield* attemptsIn(yield* Database, view.buildingId))
      .filter((one) => one.taskId === null && one.scope === 'end' && one.subject === null)
      .toSorted((a, b) => a.number - b.number)
      .map((one) => one.verdict)
  })

/** Waits until the mission has a pending error need, and answers it Retry. */
export const retried = (missionId: string) =>
  Effect.gen(function* () {
    const errorNeeds = Effect.map(getMission(missionId), (mission) =>
      mission.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
    )
    yield* until(
      Effect.map(errorNeeds, (found) => found.length > 0),
      LONG,
    )
    const [need] = yield* errorNeeds
    if (need === undefined) return yield* Effect.die(new Error('no error need'))
    yield* answerNeed({ id: need.id, answer: ChosenAnswer.make({ option: 'Retry' }), key: need.id })
    return need
  })

/** New folders for the profile and the Workspace, named after `name`. */
export const newFolders = (name: string) => {
  data = realpathSync.native(temporaryFolder(name))
  work = realpathSync.native(temporaryFolder(`${name}-work`))
}
