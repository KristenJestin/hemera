/**
 * The end of a Building (#147): once every task is done, one sequence runs the documenter, the
 * final checks, a checkpoint of the result, the two reviewers (one pass each, read-only, on the
 * checkpoint), the special tasks born from their findings, the documenter's delta and the proofs
 * made fresh again, then moves the mission to Review on its own.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent and the test driving the
 * Builder's, the documenter's and both reviewers' tools through their grants; Acme's real
 * repositories in temporary folders as the Workspace. The cold read reads, the Builder answers
 * every prompt and does nothing else; every agent after them holds its turn open until the test
 * lets it go, once it reported. The checks are a fake `TaskChecks`: none unless a test says.
 */

import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  ChosenAnswer,
  PermissionAnswer,
  type DocRecipeDraft,
  SESSION_STATES,
  SPEC_IS_RIGHT,
  START_AGAIN,
  TOOLS,
  toolsOf,
} from '@hemera/core/domain'
import { and, asc, eq } from 'drizzle-orm'
import { LaunchFailed } from '@hemera/ipc'
import { Deferred, Effect, Fiber, Layer, Predicate, type Schema, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript } from '../src/engine/agents/fake.ts'
import type { BuilderHold } from '../src/engine/building/builder.ts'
import { type CheckResult, TaskChecks } from '../src/engine/building/checks.ts'
import { STOPPED_AT_THE_END, helperRowsOf } from '../src/engine/building/helper-store.ts'
import { autoReviewOf } from '../src/engine/building/review-store.ts'
import type { SnapshotsService } from '../src/engine/building/snapshots.ts'
import { attemptsIn, buildingPartOf } from '../src/engine/building/tasks.ts'
import { projectLimits, setProjectLimits } from '../src/engine/budget.ts'
import { acceptDocRecipes } from '../src/engine/doc-recipes.ts'
import { DomainEvents } from '../src/engine/domain-events.ts'
import { Memory } from '../src/engine/memory/index.ts'
import { getMission } from '../src/engine/missions.ts'
import { answerNeed } from '../src/engine/needs.ts'
import { getRun } from '../src/engine/runs.ts'
import { TaskStates, everyTaskHolds } from '../src/engine/permissions/requests.ts'
import { REGISTRY, noticesOf } from '../src/engine/notifications.ts'
import {
  MEMORY_TOOLS,
  ROLES_REGISTERED,
  memoryContractBroken,
  roleNamed,
} from '../src/engine/sessions/roles.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import {
  type RoleSession,
  getSession,
  sessionsIn,
  sessionsOfLineage,
} from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  checkpoints,
  permissionRequests,
  documenterPasses,
  domainEvents,
  needs,
  proofRuns,
  reviewPasses,
  runnerLeases,
  sessionDeliveries,
  specProofs,
} from '../src/engine/storage/schema.ts'
import { QUIET, READING, call, eventsOf, grantOf, says } from './building-world.ts'
import { PLAN, builderOf, buildingNow, launched, taskIn } from './builder-world.ts'
import { HELPER, held, sessionsEngine, text, until, within } from './sessions-world.ts'
import { ALLOW, callTool, verdictsSaying } from './tools-world.ts'
import { ToolAccess } from '../src/engine/tools/access.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { type Verdict, Verdicts, WriteAttribution } from '../src/engine/tools/ports.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('building-end'))
  work = realpathSync.native(temporaryFolder('building-end-work'))
})
afterEach(removeFolders)

/** How long a step of the end may take on a slow runner: never a measure of speed. */
const LONG = 30_000

/** A whole end runs many steps, each bounded by `LONG`. */
const SLOW = { timeout: 180_000 }

/** What the checks of a scope say: none unless a test says; null for checks that never end. */
type ChecksOf = (asked: {
  readonly scope: string
  readonly subject: string | null
}) => ReadonlyArray<CheckResult> | null

const RED: CheckResult = {
  name: 'unit tests',
  place: 'api',
  verdict: 'red',
  detail: 'exit code 1',
  outputTail: 'FAIL the header row',
  runId: null,
}

const GREEN: CheckResult = { ...RED, verdict: 'green', detail: 'exit code 0', outputTail: '' }

interface Agents {
  readonly agents: ReadonlyArray<{
    answers: { prompts: ReadonlyArray<ReadonlyArray<{ type: string; text?: string }>> }
  }>
}

/** The engine's world, and how a test lets a held agent's turn end. */
interface Ending extends Agents {
  readonly release: (index: number) => void
}

/**
 * The engine over `dataFolder`. With `resumed`, no cold read and no Builder start first: every
 * agent holds its turn (an engine started again on a Building already under way).
 */
const ending = (
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
    starting: options.starting ?? (() => Effect.void),
    snapshots: options.snapshots ?? ((real) => real),
    tools:
      options.attribution === undefined
        ? { home: work, verdicts, taskStates }
        : { home: work, verdicts, taskStates, attribution: options.attribution },
    building: {
      hold: options.hold,
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

const README: DocRecipeDraft = {
  repository: 'api',
  path: 'README.md',
  purpose: 'What the api is, and how to export the invoices.',
  applies: 'always',
  words: [],
}

/** A launch whose Project documents its README. */
const withReadme = (projectId: string) => Effect.asVoid(acceptDocRecipes(projectId, [README]))

/** The Builder runs every task of the plan to its end: T1 writes `invoices.ts`, T2 `export.ts`. */
const builtAll = (grantId: string, exported = 'export const markdown = true\n') =>
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

const HEADINGS = {
  documenter: '## Documenter · ',
  'spec-reviewer': '## Spec reviewer · ',
  'code-reviewer': '## Code reviewer · ',
}

/**
 * The `count`-th agent of a role in the mission once it read its brief: its session, its brief,
 * its index among the agents, and a grant to drive it.
 */
const agentOf = (world: Agents, missionId: string, role: keyof typeof HEADINGS, count = 1) =>
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

const NO_DOC = 'The exports change no behaviour the README describes to its readers.'

/** The `count`-th documenter reports that nothing needed to change, and its turn ends. */
const documented = (world: Ending, missionId: string, count = 1) =>
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
const reviewed = (
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
const warning = (path: string, words: string): Schema.JsonObject => ({
  severity: 'warning',
  repository: 'api',
  path,
  text: words,
  contradicts_spec: false,
  evidence: `Read ${path} at the checkpoint.`,
})

/** The Builder runs a special task to its end, writing `path` of `api` when one is given. */
const specialDone = (grantId: string, task: string, path: string | null, content = 'fixed\n') =>
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
const helperNumbered = (missionId: string, number: number) =>
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
const inReview = (missionId: string) =>
  until(
    Effect.map(getMission(missionId), (mission) => mission.stage === 'review'),
    LONG,
  )

/** Waits until a special task is available to the Builder. */
const specialAvailable = (missionId: string, task: string) =>
  until(
    Effect.map(buildingNow(missionId), (view) =>
      view.tasks.some((one) => one.id === task && one.state === 'available'),
    ),
    LONG,
  )

/** Waits until both reviewers run. */
const reviewing = (missionId: string) =>
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
const journalOf = (missionId: string) =>
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
const typesOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return (yield* database
      .select({ type: domainEvents.type })
      .from(domainEvents)
      .where(eq(domainEvents.entityId, missionId))
      .orderBy(asc(domainEvents.sequence))).map((row) => row.type)
  })

/** What was delivered to the mission's Builder, by role or by its lineage. */
const toBuilder = (missionId: string, lineage: string) =>
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
const writtenInWorkspace = (folder: string, path: string, content: string) => {
  mkdirSync(dirname(join(folder, path)), { recursive: true })
  writeFileSync(join(folder, path), content)
}

/** The Workspace's `api` folder. */
const apiOf = (missionId: string) =>
  Effect.map(buildingNow(missionId), (view) => view.repositories[0]?.folder ?? '')

describe('The end sequence', () => {
  test(
    'every task done runs, in order: documenter, final checks, checkpoint, both reviewers, special tasks, refresh, Review; the stage moves to Review on its own with building.ended',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.scoped(
            Effect.gen(function* () {
              const { mission } = yield* launched(work, withReadme)
              const builder = yield* builderOf(mission.id)
              const committed = yield* DomainEvents.use((events) => events.subscribe)
              const told = yield* noticesOf(REGISTRY, committed).pipe(
                Stream.filter((one) => Predicate.isTagged(one, 'NoticeRaised')),
                Stream.map((one) => (Predicate.isTagged(one, 'NoticeRaised') ? one.notice : null)),
                Stream.filter(
                  (one) => one?.kind === 'building-finished' || one?.kind === 'review-waiting',
                ),
                Stream.take(2),
                Stream.runCollect,
                Effect.forkChild,
              )
              yield* builtAll(builder.grantId)
              yield* documented(world, mission.id)
              yield* reviewed(world, mission.id, 'spec-reviewer')
              const now = Memory.use((memory) => memory.now(mission.id))
              yield* until(
                Effect.map(now, (state) => state.end.length > 0),
                LONG,
              )
              const reviewingNow = yield* now
              yield* reviewed(world, mission.id, 'code-reviewer', [
                warning('README.md', 'Say how to export the invoices as Markdown.'),
              ])
              yield* specialAvailable(mission.id, 'RV1')
              const specialNow = yield* now
              yield* specialDone(builder.grantId, 'RV1', 'README.md', 'Acme api, as Markdown\n')
              yield* inReview(mission.id)
              return {
                reviewingNow,
                specialNow,
                endedNow: yield* now,
                notices: yield* Fiber.join(told),
                // The Journal projects the events a moment after they are written.
                journal: yield* until(
                  Effect.map(journalOf(mission.id), (lines) =>
                    lines.some((line) => line.startsWith('Building ended')),
                  ),
                  LONG,
                ).pipe(Effect.andThen(journalOf(mission.id))),
                types: yield* typesOf(mission.id),
                view: yield* buildingNow(mission.id),
                builder: yield* sessionsIn(SESSION_STATES, {
                  kind: 'mission',
                  missionId: mission.id,
                }),
              }
            }),
          ),
        ),
      )
      const steps = seen.types.filter((type) =>
        [
          'building.end_started',
          'building.documenter_started',
          'building.final_checks',
          'review.checkpoint_taken',
          'review.pass_started',
          'review.special_task',
          'building.proofs_refreshed',
          'mission.moved',
          'building.ended',
        ].includes(type),
      )
      expect(steps.filter((type) => type !== 'mission.moved')).toEqual([
        'building.end_started',
        'building.documenter_started',
        'building.final_checks',
        'review.checkpoint_taken',
        'review.pass_started',
        'review.pass_started',
        'review.special_task',
        'building.proofs_refreshed',
        'building.ended',
      ])
      // The special task is done before the refresh, and the move to Review comes last.
      expect(seen.types.lastIndexOf('building.task_done')).toBeLessThan(
        seen.types.indexOf('building.proofs_refreshed'),
      )
      expect(seen.types.lastIndexOf('mission.moved')).toBeGreaterThan(
        seen.types.indexOf('building.proofs_refreshed'),
      )
      // Now says where the end stands: the reviewers done, then the special tasks.
      expect(seen.reviewingNow.end).toEqual(['Automatic review: 1 of 2 reviewers done'])
      expect(seen.specialNow.end).toEqual(['Special tasks: RV1'])
      expect(seen.endedNow.end).toEqual([])
      // The end tells: the build finished, and the mission waits for its Review.
      expect([...seen.notices].map((one) => [one?.kind, one?.missionKey, one?.what])).toEqual([
        ['review-waiting', 'ACME-1', 'it waits for your Review'],
        ['building-finished', 'ACME-1', 'its Building finished'],
      ])
      expect(
        REGISTRY.kinds
          .filter((one) => one.id === 'building-finished' || one.id === 'review-waiting')
          .map((one) => [one.id, one.byDefault, one.sound]),
      ).toEqual([
        ['building-finished', true, 'done'],
        ['review-waiting', false, null],
      ])
      // Each step of the end is a line of the Journal.
      expect(seen.journal).toEqual(
        expect.arrayContaining([
          'The end of Building started: documentation, final checks, then the automatic review.',
          'The final checks: none ran.',
          'The checkpoint of the automatic review is taken.',
          'The Spec reviewer started its pass.',
          'The Code reviewer started its pass.',
          'The Spec reviewer reported no finding.',
          'The Code reviewer reported 1 warning.',
          'RV1, a special task from finding 1 of the Code reviewer: Say how to export the invoices as Markdown.',
          'Building ended: the mission moves to Review; 1 file(s) changed after the automatic review.',
        ]),
      )
      expect(seen.view).toMatchObject({ state: 'ended', phase: 'ended' })
      expect(seen.view.endedAt).not.toBeNull()
      // The Builder's session is stopped at the exit.
      const builders = seen.builder.filter((one) => one.role === 'builder')
      expect(builders.every((one) => one.state === 'ended')).toBe(true)
    },
  )

  test(
    'the full end driven from the last green runs to Review: the refresh it calls never waits on the turn that greened',
    SLOW,
    async () => {
      const markdown = [
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
      const proofs = () => ({
        'R1.S2': {
          mode: 'automated',
          actions: ['Run the test'],
          starting_data: 'None.',
          expected: 'The assertion of the test holds.',
          test: {
            repository: 'api',
            path: 'tests/export.test.mjs',
            code: markdown,
            insertion: 'new_file',
            command: `"${process.execPath}" --test --test-reporter=tap tests/export.test.mjs`,
          },
          seen_today: false,
        },
      })
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              withReadme,
              undefined,
              PLAN,
              undefined,
              undefined,
              proofs,
            )
            const builder = yield* builderOf(mission.id)
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            // T2 writes an export the proof does not accept: the end waits for its green.
            yield* builtAll(builder.grantId, 'export const toCsv = () => ""\n')
            const waited = (yield* buildingNow(mission.id)).phase
            // The last write turns the proof green, which calls the end from inside its turn.
            yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'export.ts',
              content: 'export const toMarkdown = () => ""\n',
            })
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            return { waited, types: yield* typesOf(mission.id) }
          }),
        ),
      )
      expect(seen.waited).toBe('tasks')
      expect(seen.types.indexOf('building.scenario_green')).toBeLessThan(
        seen.types.indexOf('building.end_started'),
      )
      expect(seen.types).toContain('building.proofs_refreshed')
      expect(seen.types.at(-1)).not.toBe('building.end_started')
      expect(seen.types).toContain('building.ended')
    },
  )
})

/** Waits until a scenario's proof is in a state, as the Building page reads it. */
const proofState = (missionId: string, scenario: string, state: string) =>
  until(
    Effect.map(buildingNow(missionId), (view) =>
      view.requirements
        .flatMap((one) => one.scenarios)
        .some((one) => one.scenario === scenario && one.state === state),
    ),
    LONG,
  )

describe('The reviewers', () => {
  test(
    'the reviewers’ sessions hold no write, command or Memory tool; their brief has no Journal; a replaced reviewer gets the same brief plus the restart sentence',
    SLOW,
    async () => {
      for (const id of ['spec-reviewer', 'code-reviewer'] as const) {
        const entry = roleNamed(ROLES_REGISTERED, id)
        expect(entry, id).toMatchObject({ readsMemory: false, writes: false, countsInCap: true })
        const tools = toolsOf(id)
        expect(
          tools.filter((name) => MEMORY_TOOLS.includes(name)),
          id,
        ).toEqual([])
        expect(
          tools.filter((name) => TOOLS[name].effect === 'writes' || TOOLS[name].effect === 'runs'),
          id,
        ).toEqual([])
      }
      expect(memoryContractBroken(ROLES_REGISTERED)).toEqual([])
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* call(builder.grantId, 'journal_add', {
              text: 'The CSV export keeps the header.',
            })
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            const first = yield* agentOf(world, mission.id, 'code-reviewer')
            yield* reviewing(mission.id)
            const before = world.agents.length
            yield* Sessions.use((sessions) =>
              sessions.replace(first.session.id, 'the test replaced it'),
            )
            yield* until(
              Effect.sync(() => (world.agents[before]?.answers.prompts.length ?? 0) > 0),
              LONG,
            )
            const successor = text(world.agents[before]?.answers.prompts[0] ?? [])
            return { mission, first, successor }
          }),
        ),
      )
      expect(seen.first.brief).toContain(`## Code reviewer · ${seen.mission.key} · Building`)
      expect(seen.first.brief).toContain('Checkpoint: ')
      expect(seen.first.brief).not.toContain('The CSV export keeps the header.')
      expect(seen.first.brief).not.toMatch(/Journal|## Now|## Notes/)
      expect(seen.successor).toContain(seen.first.brief.trim())
      expect(seen.successor).toContain('[hemera:resume]')
      expect(seen.successor).toContain(START_AGAIN)
    },
  )

  test(
    'checkpoint_read reads the checkpoint, not a later write in the Workspace; a .env shows "content withheld"',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            writtenInWorkspace(api, 'src/x.ts', 'export const x = "at the checkpoint"\n')
            writtenInWorkspace(api, '.env', 'TOKEN=at-the-checkpoint\n')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            const reviewer = yield* agentOf(world, mission.id, 'spec-reviewer')
            // Written after the checkpoint: the reviewer never sees it.
            writtenInWorkspace(api, 'src/x.ts', 'export const x = "later"\n')
            return {
              list: yield* call(reviewer.grantId, 'checkpoint_read', {}),
              file: yield* call(reviewer.grantId, 'checkpoint_read', {
                repository: 'api',
                path: 'src/x.ts',
              }),
              secret: yield* call(reviewer.grantId, 'checkpoint_read', {
                repository: 'api',
                path: '.env',
              }),
              read: yield* call(reviewer.grantId, 'fs_read', {
                repository: 'api',
                path: 'src/x.ts',
              }),
              folder: reviewer.session.folder,
              api,
            }
          }),
        ),
      )
      expect(seen.list).toContain('src/x.ts')
      expect(seen.list).toContain('.env')
      expect(seen.file).toContain('at the checkpoint')
      expect(seen.file).not.toContain('later')
      expect(seen.secret).toContain('content withheld: .env')
      expect(seen.secret).not.toContain('TOKEN=')
      expect(seen.read).toContain('at the checkpoint')
      expect(seen.read).not.toContain('later')
      expect(seen.folder).not.toBe(dirname(seen.api))
    },
  )
})

describe('The findings and their fate', () => {
  test(
    'a contradicting finding becomes a decision need and never reaches the Builder; "the Spec is right" makes a special task; Review waits for the answer',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer', [
              {
                severity: 'blocking',
                requirement: 'R1',
                repository: 'api',
                path: 'invoices.ts',
                text: 'The CSV has no header row, which the scenario R1.S1 asks for.',
                contradicts_spec: true,
                evidence: 'R1.S1: as CSV, it works; invoices.ts writes no header.',
              },
            ])
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(getMission(mission.id), (one) => one.needs.length > 0),
              LONG,
            )
            // Long enough for anything on its way to the Builder or to Review to arrive.
            yield* Effect.sleep('1 second')
            const waiting = yield* getMission(mission.id)
            const toldBefore = yield* toBuilder(mission.id, builder.session.lineage)
            // What the Builder reads of the Memory: that a decision waits, never the finding.
            yield* until(
              Effect.map(journalOf(mission.id), (lines) =>
                lines.some((line) => line.includes('waits on the user')),
              ),
              LONG,
            )
            const read = {
              now: yield* call(builder.grantId, 'memory_read', { part: 'now' }),
              journal: yield* call(builder.grantId, 'memory_read', { part: 'journal' }),
              brief: yield* Memory.use((memory) => memory.briefBlock(mission.id)),
            }
            const need = waiting.needs[0]
            yield* answerNeed({
              id: need?.id ?? '',
              answer: ChosenAnswer.make({ option: SPEC_IS_RIGHT }),
              key: 'spec-right',
            })
            yield* specialAvailable(mission.id, 'RV1')
            // The ready set reaches the Builder once the task is available.
            yield* until(
              Effect.map(toBuilder(mission.id, builder.session.lineage), (told) =>
                told.join('\n').includes('RV1'),
              ),
              LONG,
            )
            const toldAfter = yield* toBuilder(mission.id, builder.session.lineage)
            yield* specialDone(
              builder.grantId,
              'RV1',
              'invoices.ts',
              'export const header = true\n',
            )
            yield* documented(world, mission.id, 2)
            yield* inReview(mission.id)
            return {
              waiting,
              toldBefore,
              read,
              toldAfter,
              review: yield* autoReviewOf(mission.id),
            }
          }),
        ),
      )
      expect(seen.waiting.stage).toBe('building')
      const fields = seen.waiting.needs[0]?.fields
      expect(Predicate.isTagged(fields, 'Decision')).toBe(true)
      if (Predicate.isTagged(fields, 'Decision')) {
        expect(fields.question).toContain('The CSV has no header row')
        expect(fields.options).toEqual([
          'The Spec is right: make the code follow it',
          'The result is right: record it as a decision',
          'Dismiss',
        ])
      }
      expect(seen.toldBefore.join('\n')).not.toContain('header row')
      for (const [part, read] of Object.entries(seen.read)) {
        expect(read, part).not.toContain('header row')
        expect(read, part).not.toContain('invoices.ts writes no header')
        expect(read, part).toContain('a finding of the automatic review')
      }
      expect(seen.toldAfter.join('\n')).toContain('RV1')
      const finding = seen.review?.findings[0]
      expect(finding).toMatchObject({ fate: 'special_task', taskId: 'RV1', contradictsSpec: true })
    },
  )

  test(
    'two agreeing findings become RV1 and RV2, absent from the Spec’s tasks, delivered to the Builder, judged by checks; one red three times gives an error need; with no check, RV2 is done, not verified; neither counts in proven requirements; the percentage shows them apart',
    SLOW,
    async () => {
      const { world, run } = ending({
        checks: ({ scope, subject }) => (scope === 'task' && subject === 'RV1' ? [RED] : []),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('invoices.ts', 'Write the header row of the CSV.'),
              warning('README.md', 'Say how to export as Markdown.'),
            ])
            yield* specialAvailable(mission.id, 'RV2')
            // The ready set is stored for the Builder a moment after the tasks are available.
            yield* until(
              Effect.map(toBuilder(mission.id, builder.session.lineage), (said) =>
                ['RV1', 'RV2'].every((task) => said.join('\n').includes(task)),
              ),
              LONG,
            )
            const told = yield* toBuilder(mission.id, builder.session.lineage)
            const plan = yield* buildingPartOf(mission.id)
            const rv2 = yield* specialDone(
              builder.grantId,
              'RV2',
              'README.md',
              'Acme api, as Markdown\n',
            )
            // A red attempt stays the runner's: it fixes and finishes again, twice.
            const reds = [
              yield* specialDone(
                builder.grantId,
                'RV1',
                'invoices.ts',
                'export const header = 1\n',
              ),
            ]
            for (const _ of [2, 3]) {
              reds.push(
                yield* call(builder.grantId, 'task_finished', { task: 'RV1', summary: 'Again.' }),
              )
            }
            yield* taskIn(mission.id, 'RV1', 'blocked')
            return {
              told,
              plan,
              rv2,
              reds,
              view: yield* buildingNow(mission.id),
              mission: yield* getMission(mission.id),
            }
          }),
        ),
      )
      expect(seen.told.join('\n')).toMatch(/RV1/)
      expect(seen.told.join('\n')).toMatch(/RV2/)
      // spec_read's effective plan keeps the Spec's tasks; the special tasks are listed apart.
      const [tasksPart, specialPart] = (seen.plan ?? '').split('## Special tasks')
      expect(tasksPart).not.toContain('RV1')
      expect(specialPart).toContain('RV1')
      expect(specialPart).toContain('RV2')
      expect(seen.rv2).toMatch(/RV2 is done, not verified/)
      expect(seen.reds.at(-1)).toMatch(/red for the third time/)
      const rv1 = seen.view.tasks.find((one) => one.id === 'RV1')
      expect(rv1).toMatchObject({
        origin: 'review',
        state: 'blocked',
        scenarios: [],
        requirements: [],
      })
      expect(seen.mission.needs.some((need) => Predicate.isTagged(need.fields, 'Error'))).toBe(true)
      expect(seen.mission.stage).toBe('building')
      expect(seen.view.counts).toMatchObject({ tasksDone: 4, tasks: 4 })
      expect(seen.view.special).toEqual({ done: 1, total: 2 })
      expect(seen.view.requirements.map((one) => one.id)).toEqual(['R1'])
      expect(seen.view.percent).toBe(83)
    },
  )

  test('no second review runs after the special tasks', SLOW, async () => {
    const { world, run } = ending()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withReadme)
          const builder = yield* builderOf(mission.id)
          yield* builtAll(builder.grantId)
          yield* documented(world, mission.id)
          yield* reviewed(world, mission.id, 'spec-reviewer')
          yield* reviewed(world, mission.id, 'code-reviewer', [
            warning('invoices.ts', 'Write the header row of the CSV.'),
          ])
          yield* specialAvailable(mission.id, 'RV1')
          yield* specialDone(builder.grantId, 'RV1', 'invoices.ts', 'export const header = true\n')
          yield* documented(world, mission.id, 2)
          yield* inReview(mission.id)
          yield* Effect.sleep('500 millis')
          const sessions = yield* sessionsIn(SESSION_STATES, {
            kind: 'mission',
            missionId: mission.id,
          })
          return {
            passes: yield* Database.use((database) => database.select().from(reviewPasses)),
            reviewers: sessions.filter((one) => one.role.endsWith('-reviewer')),
            started: yield* eventsOf(mission.id, 'review.pass_started'),
          }
        }),
      ),
    )
    expect(seen.passes).toHaveLength(2)
    expect(seen.reviewers).toHaveLength(2)
    expect(seen.started).toHaveLength(2)
  })
})

/** A mission whose RV1 changes `path` of `api`, a file at the checkpoint, to Review. */
const throughSpecial = (world: Ending, path: string, delta: boolean) =>
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

describe('The documenter’s delta', () => {
  test(
    'RV1 changing src/x.ts outside the doc recipes triggers one documenter delta; a change only in README.md does not',
    SLOW,
    async () => {
      const outside = ending()
      const seen = await outside.run(({ profile }) =>
        within(profile, throughSpecial(outside.world, 'src/x.ts', true)),
      )
      expect(seen.passes.map((one) => one.mode)).toEqual(['full', 'delta'])
      expect(JSON.parse(seen.passes[1]?.files ?? '[]')).toEqual([
        { repository: 'api', path: 'src/x.ts', status: 'A' },
      ])
      expect(seen.deltas).toHaveLength(1)

      data = realpathSync.native(temporaryFolder('building-end-readme'))
      work = realpathSync.native(temporaryFolder('building-end-readme-work'))
      const inRecipe = ending()
      const only = await inRecipe.run(({ profile }) =>
        within(profile, throughSpecial(inRecipe.world, 'README.md', false)),
      )
      expect(only.passes.map((one) => one.mode)).toEqual(['full'])
      expect(only.deltas).toHaveLength(0)
    },
  )
})

/** R1.S2's proof: a test that holds once `export.ts` exists in `api`. */
const exported = [
  "import { test } from 'node:test'",
  "import assert from 'node:assert/strict'",
  "import { existsSync } from 'node:fs'",
  '',
  "test('the scenario holds', () => {",
  "  assert.equal(existsSync(new URL('../export.ts', import.meta.url)), true, 'no export.ts')",
  '})',
  '',
].join('\n')
const exportProof = () => ({
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

describe('What the review saw, and what changed after it', () => {
  test('review_changed_after lists src/x.ts, attributed to RV1', SLOW, async () => {
    const { world, run } = ending()
    const seen = await run(({ profile }) =>
      within(profile, throughSpecial(world, 'src/x.ts', true)),
    )
    expect(seen.review?.changedAfter).toContainEqual(
      expect.objectContaining({ repository: 'api', path: 'src/x.ts', status: 'M', by: 'RV1' }),
    )
    expect(seen.review?.checkpoint?.files.map((one) => `${one.repository}/${one.path}`)).toContain(
      'api/src/x.ts',
    )
  })

  test('a proof made stale by RV1 is re-run before Review', SLOW, async () => {
    const { world, run } = ending()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            withReadme,
            undefined,
            PLAN,
            undefined,
            undefined,
            exportProof,
          )
          const builder = yield* builderOf(mission.id)
          yield* proofState(mission.id, 'R1.S2', 'red_recorded')
          yield* builtAll(builder.grantId)
          yield* documented(world, mission.id)
          yield* reviewed(world, mission.id, 'spec-reviewer')
          yield* reviewed(world, mission.id, 'code-reviewer', [
            warning('export.ts', 'Export a function, not a flag.'),
          ])
          yield* specialAvailable(mission.id, 'RV1')
          yield* specialDone(
            builder.grantId,
            'RV1',
            'export.ts',
            'export const toMarkdown = () => ""\n',
          )
          yield* documented(world, mission.id, 2)
          yield* inReview(mission.id)
          const database = yield* Database
          return {
            runs: yield* database
              .select()
              .from(proofRuns)
              .where(and(eq(proofRuns.missionId, mission.id), eq(proofRuns.scenario, 'R1.S2')))
              .orderBy(asc(proofRuns.at)),
            refreshed: yield* eventsOf(mission.id, 'building.proofs_refreshed'),
            types: yield* typesOf(mission.id),
            view: yield* buildingNow(mission.id),
          }
        }),
      ),
    )
    expect(seen.runs.map((one) => one.phase)).toContain('rerun')
    expect(JSON.parse(seen.refreshed.at(-1)?.payload ?? '{}')).toMatchObject({ proofs: ['R1.S2'] })
    expect(seen.types.indexOf('building.proofs_refreshed')).toBeLessThan(
      seen.types.indexOf('building.ended'),
    )
    const proof = seen.view.requirements
      .flatMap((one) => one.scenarios)
      .find((one) => one.scenario === 'R1.S2')
    expect(proof).toMatchObject({ state: 'green', upToDate: true })
  })
})

describe('The exit', () => {
  test(
    'once the Building ended, a call the user allows runs again for a session born after the exit, never for its tree',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            // What Hemera does on a call the user allowed, as Review's own session would ask it.
            const allowed = (lineage: string) =>
              ToolAccess.use((access) =>
                access.counted({ missionId: mission.id, lineage }, Effect.succeed('ran')),
              )
            return {
              born: yield* allowed(crypto.randomUUID()),
              builder: yield* allowed(builder.session.lineage),
            }
          }),
        ),
      )
      expect(seen.born).toBe('ran')
      expect(seen.builder).toBeNull()
    },
  )
  test(
    'a write that lands after the last checks, as the end exits, is checked before Review',
    SLOW,
    async () => {
      let late: (() => void) | null = null
      const { world, run } = ending({
        snapshots: (real) => ({
          ...real,
          take: (place, owner) => {
            // The write lands as the exit looks at the Workspace, after every check of the end.
            if (owner.kind === 'review_exit' && late !== null) {
              late()
              late = null
            }
            return real.take(place, owner)
          },
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              withReadme,
              undefined,
              PLAN,
              undefined,
              undefined,
              exportProof,
            )
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            late = () => writtenInWorkspace(api, 'src/late.ts', 'export const late = true\n')
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            const database = yield* Database
            return {
              late,
              runs: yield* database
                .select()
                .from(proofRuns)
                .where(and(eq(proofRuns.missionId, mission.id), eq(proofRuns.scenario, 'R1.S2')))
                .orderBy(asc(proofRuns.at)),
              view: yield* buildingNow(mission.id),
              review: yield* autoReviewOf(mission.id),
            }
          }),
        ),
      )
      expect(seen.late).toBeNull()
      // The proof the late write made stale ran again on its tree before the move to Review.
      expect(seen.runs.map((one) => one.phase)).toContain('rerun')
      const proof = seen.view.requirements
        .flatMap((one) => one.scenarios)
        .find((one) => one.scenario === 'R1.S2')
      expect(proof).toMatchObject({ state: 'green', upToDate: true })
      expect(seen.review?.changedAfter.map((one) => one.path)).toContain('src/late.ts')
    },
  )
  test(
    'a Builder the exit sends back after a late write is handed what was queued for it before the exit',
    SLOW,
    async () => {
      let late: (() => void) | null = null
      let holding = false
      const turn = held()
      const { world, run } = ending({
        builder: {
          steps: [says('Read.')],
          between: () => (holding ? turn.promise : Promise.resolve()),
        },
        snapshots: (real) => ({
          ...real,
          take: (place, owner) => {
            if (owner.kind === 'review_exit' && late !== null) {
              late()
              late = null
            }
            return real.take(place, owner)
          },
        }),
      })
      const QUEUED = 'ACME-12 is to be named in the changelog.'
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              withReadme,
              undefined,
              PLAN,
              undefined,
              undefined,
              exportProof,
            )
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            late = () => writtenInWorkspace(api, 'src/late.ts', 'export const late = true\n')
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId)
            // The Builder is in a turn that does not end: what is delivered to it now waits.
            holding = true
            const owner = { kind: 'mission', missionId: mission.id } as const
            const target = { lineage: builder.session.lineage }
            yield* Sessions.use((sessions) =>
              sessions.deliver({ owner, target, kind: 'note', body: 'One more thing.' }),
            )
            yield* until(
              Effect.map(getSession(builder.session.id), (one) => one.state === 'working'),
              LONG,
            )
            yield* Sessions.use((sessions) =>
              sessions.deliver({ owner, target, kind: 'note', body: QUEUED }),
            )
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            return {
              late,
              handed: world.agents
                .slice(2)
                .some((agent) => agent.answers.prompts.some((one) => text(one).includes(QUEUED))),
              lineage: yield* sessionsOfLineage(builder.session.lineage),
            }
          }),
        ),
      ).finally(() => turn.release())
      expect(seen.late).toBeNull()
      // The exit went back once: the Builder's lineage was resumed, and its successor had it.
      expect(seen.lineage.length).toBeGreaterThan(1)
      expect(seen.handed).toBe(true)
    },
  )
  test(
    'a helper and a command still running at the exit are stopped before the snapshot: nothing they do after it lands',
    SLOW,
    async () => {
      // What the helper and the command do once the exit looked at the Workspace.
      let afterSnapshot: Effect.Effect<void> | null = null
      const { world, run } = ending({
        snapshots: (real) => ({
          ...real,
          take: (place, owner) =>
            real.take(place, owner).pipe(
              Effect.tap(() => {
                if (owner.kind !== 'review_exit') return Effect.void
                const after = afterSnapshot
                afterSnapshot = null
                return after ?? Effect.void
              }),
            ),
        }),
      })
      const trigger = join(work, 'trigger')
      const script = join(work, 'late-command.mjs')
      writeFileSync(
        script,
        [
          "import { existsSync, writeFileSync } from 'node:fs'",
          'const [trigger, target] = process.argv.slice(2)',
          'const wait = setInterval(() => {',
          '  if (!existsSync(trigger)) return',
          "  writeFileSync(target, 'export const command = true\\n')",
          '  clearInterval(wait)',
          '}, 20)',
          '',
        ].join('\n'),
      )
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            const byCommand = join(api, 'command.ts')
            const launch = yield* call(builder.grantId, 'helper_launch', {
              brief: 'Tidy the export.',
              writes: true,
            })
            if (launch.startsWith('refused')) return yield* Effect.die(new Error(launch))
            const helper = yield* helperNumbered(mission.id, 1)
            const context = yield* Effect.context<EngineServices>()
            const writing = yield* Deferred.make<string>()
            afterSnapshot = Effect.gen(function* () {
              writeFileSync(trigger, '')
              // Long enough for a command still running to write, and end: it holds the write lock.
              yield* until(
                Effect.sync(() => existsSync(byCommand)),
                3_000,
              ).pipe(Effect.exit)
              // Its own fiber: a write waits for the exit it lands after.
              yield* call(helper.grantId, 'fs_write', {
                repository: 'api',
                path: 'helper.ts',
                content: 'export const helper = true\n',
              }).pipe(
                Effect.flatMap((answer) => Deferred.succeed(writing, answer)),
                Effect.forkDetach,
              )
            }).pipe(Effect.provide(context))
            yield* builtAll(builder.grantId)
            // Started once its tasks are done: a command running holds the Workspace's write lock.
            const started = yield* call(builder.grantId, 'commands_run', {
              line: `"${process.execPath}" "${script}" "${trigger}" "${byCommand}"`,
              repository: 'api',
              timeout: 1,
            })
            const runId = /^run (\S+):/.exec(started)?.[1] ?? ''
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            const failed = Effect.map(helperRowsOf(mission.id), (rows) =>
              rows.find((one) => one.number === 1),
            )
            // Not a failure here: the expectations below say what was left instead.
            yield* until(
              Effect.map(failed, (row) => row?.state === 'failed'),
              LONG,
            ).pipe(Effect.exit)
            const database = yield* Database
            return {
              started,
              written: yield* Deferred.await(writing),
              helperWrote: existsSync(join(api, 'helper.ts')),
              commandWrote: existsSync(byCommand),
              run: yield* getRun(runId),
              helper: yield* failed,
              live: yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], {
                kind: 'mission',
                missionId: mission.id,
              }),
              leases: (yield* database.select().from(runnerLeases)).filter(
                (one) => one.lineage === helper.row.lineage,
              ),
              needs: (yield* getMission(mission.id)).needs,
              review: yield* autoReviewOf(mission.id),
            }
          }),
        ),
      )
      // Both still ran when the exit came.
      expect(seen.started).toContain('it keeps going')
      // The helper's write after the snapshot is refused, and the command was stopped before it.
      expect(seen.written).toBe('refused: this session has ended')
      expect(seen.helperWrote).toBe(false)
      expect(seen.commandWrote).toBe(false)
      expect(seen.run.state).toBe('stopped')
      // Nothing of the tree is left: no session, no lease, no need; the helper ended, said why.
      expect(seen.live).toEqual([])
      expect(seen.leases).toEqual([])
      expect(seen.needs).toEqual([])
      expect(seen.helper).toMatchObject({ state: 'failed', failure: STOPPED_AT_THE_END })
      expect(seen.review?.changedAfter.map((one) => one.path)).not.toContain('helper.ts')
    },
  )
  test(
    'a write the user allows as the end exits is done before the snapshot and seen, or refused: never after it unseen',
    SLOW,
    async () => {
      const snapshotted = Deferred.makeUnsafe<void>()
      const { world, run } = ending({
        verdicts: Layer.succeed(Verdicts, {
          judge: (asked) =>
            Effect.succeed<Verdict>(
              asked.tool === 'fs_write' && asked.path?.named.endsWith('approved.ts') === true
                ? { verdict: 'ask', reason: 'a file no task names', by: 'suite' }
                : ALLOW,
            ),
          // Hemera acts on the allowed call once the exit looked at the Workspace: the latest it can.
          refusal: () => Effect.as(Deferred.await(snapshotted), null),
        }),
        snapshots: (real) => ({
          ...real,
          take: (place, owner) =>
            real
              .take(place, owner)
              .pipe(
                Effect.tap(() =>
                  owner.kind === 'review_exit'
                    ? Deferred.succeed(snapshotted, undefined)
                    : Effect.void,
                ),
              ),
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            yield* builtAll(builder.grantId)
            const asked = yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'approved.ts',
              content: 'export const approved = true\n',
            })
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            const database = yield* Database
            const request = Effect.map(
              database
                .select()
                .from(permissionRequests)
                .where(eq(permissionRequests.missionId, mission.id)),
              ([row]) => row,
            )
            // The end holds at its refresh on the question.
            yield* until(
              Effect.gen(function* () {
                const view = yield* buildingNow(mission.id)
                return view.phase === 'refresh' && (yield* getMission(mission.id)).needs.length > 0
              }),
              LONG,
            )
            const row = yield* request
            if (row === undefined) return yield* Effect.die(new Error('no request'))
            yield* answerNeed({
              id: row.needId,
              answer: PermissionAnswer.make({ choice: 'allow-once' }),
              key: crypto.randomUUID(),
            })
            yield* inReview(mission.id)
            yield* until(
              Effect.map(request, (one) => one?.state === 'ended'),
              LONG,
            )
            return {
              asked,
              request: yield* request,
              wrote: existsSync(join(api, 'approved.ts')),
              review: yield* autoReviewOf(mission.id),
            }
          }),
        ),
      )
      expect(seen.asked).toContain('request #1')
      // Its session stopped at the exit: the approved write is not done, and says so.
      expect(seen.request).toMatchObject({ state: 'ended', result: 'not-executed' })
      expect(seen.wrote).toBe(false)
      expect(seen.review?.changedAfter.map((one) => one.path)).not.toContain('approved.ts')
    },
  )
  test(
    'a call the user allowed and the end refused tells the agent and the user that the end of the Building stopped it',
    SLOW,
    async () => {
      const snapshotted = Deferred.makeUnsafe<void>()
      const { world, run } = ending({
        verdicts: Layer.succeed(Verdicts, {
          judge: (asked) =>
            Effect.succeed<Verdict>(
              asked.tool === 'fs_write' && asked.path?.named.endsWith('approved.ts') === true
                ? { verdict: 'ask', reason: 'a file no task names', by: 'suite' }
                : ALLOW,
            ),
          // Hemera acts on the allowed call once the exit looked at the Workspace: the latest it can.
          refusal: () => Effect.as(Deferred.await(snapshotted), null),
        }),
        snapshots: (real) => ({
          ...real,
          take: (place, owner) =>
            real
              .take(place, owner)
              .pipe(
                Effect.tap(() =>
                  owner.kind === 'review_exit'
                    ? Deferred.succeed(snapshotted, undefined)
                    : Effect.void,
                ),
              ),
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'approved.ts',
              content: 'export const approved = true\n',
            })
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            const database = yield* Database
            const request = Effect.map(
              database
                .select()
                .from(permissionRequests)
                .where(eq(permissionRequests.missionId, mission.id)),
              ([row]) => row,
            )
            // The end holds at its refresh on the question.
            yield* until(
              Effect.gen(function* () {
                const view = yield* buildingNow(mission.id)
                return view.phase === 'refresh' && (yield* getMission(mission.id)).needs.length > 0
              }),
              LONG,
            )
            const row = yield* request
            if (row === undefined) return yield* Effect.die(new Error('no request'))
            yield* answerNeed({
              id: row.needId,
              answer: PermissionAnswer.make({ choice: 'allow-once' }),
              key: crypto.randomUUID(),
            })
            yield* inReview(mission.id)
            yield* until(
              Effect.map(request, (one) => one?.state === 'ended'),
              LONG,
            )
            const [need] = yield* database.select().from(needs).where(eq(needs.id, row.needId))
            return { request: yield* request, need }
          }),
        ),
      )
      expect(seen.request).toMatchObject({ state: 'ended', result: 'not-executed' })
      expect(seen.request?.resultText).toBe(
        `Request #1 (fs_write) was not executed: ${STOPPED_AT_THE_END}.`,
      )
      expect(seen.need).toMatchObject({ state: 'expired', endedReason: STOPPED_AT_THE_END })
    },
  )
  test(
    'a helper’s write the user allows after the helper ended, as the end exits, is refused or seen: never after the snapshot unseen',
    SLOW,
    async () => {
      const snapshotted = Deferred.makeUnsafe<void>()
      const { world, run } = ending({
        verdicts: Layer.succeed(Verdicts, {
          judge: (asked) =>
            Effect.succeed<Verdict>(
              asked.tool === 'fs_write' && asked.path?.named.endsWith('approved.ts') === true
                ? { verdict: 'ask', reason: 'a file no task names', by: 'suite' }
                : ALLOW,
            ),
          // Hemera acts on the allowed call once the exit looked at the Workspace: the latest it can.
          refusal: () => Effect.as(Deferred.await(snapshotted), null),
        }),
        snapshots: (real) => ({
          ...real,
          take: (place, owner) =>
            real
              .take(place, owner)
              .pipe(
                Effect.tap(() =>
                  owner.kind === 'review_exit'
                    ? Deferred.succeed(snapshotted, undefined)
                    : Effect.void,
                ),
              ),
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            const launch = yield* call(builder.grantId, 'helper_launch', {
              brief: 'Tidy the export.',
              writes: true,
            })
            if (launch.startsWith('refused')) return yield* Effect.die(new Error(launch))
            const helper = yield* helperNumbered(mission.id, 1)
            // The helper's agent is the last one started.
            const helperAgent = world.agents.length - 1
            const asked = yield* call(helper.grantId, 'fs_write', {
              repository: 'api',
              path: 'approved.ts',
              content: 'export const approved = true\n',
            })
            // The helper hands back its result: its lineage ends on its own, before the end.
            const handed = yield* call(helper.grantId, 'helper_result', {
              summary: 'The export is tidied.',
              changed: [],
              checked: ['Read the export by hand.'],
              left: [],
            })
            if (!handed.includes('handed to your parent'))
              return yield* Effect.die(new Error(handed))
            // Its turn ends, and with it the helper's session.
            world.release(helperAgent)
            yield* until(
              Effect.map(sessionsOfLineage(helper.row.lineage), (all) =>
                all.every((one) => one.state === 'ended'),
              ),
              LONG,
            )
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            const database = yield* Database
            const request = Effect.map(
              database
                .select()
                .from(permissionRequests)
                .where(eq(permissionRequests.missionId, mission.id)),
              ([row]) => row,
            )
            // The end holds at its refresh on the question.
            yield* until(
              Effect.gen(function* () {
                const view = yield* buildingNow(mission.id)
                return view.phase === 'refresh' && (yield* getMission(mission.id)).needs.length > 0
              }),
              LONG,
            )
            const row = yield* request
            if (row === undefined) return yield* Effect.die(new Error('no request'))
            yield* answerNeed({
              id: row.needId,
              answer: PermissionAnswer.make({ choice: 'allow-once' }),
              key: crypto.randomUUID(),
            })
            yield* inReview(mission.id)
            yield* until(
              Effect.map(request, (one) => one?.state === 'ended'),
              LONG,
            )
            const review = yield* autoReviewOf(mission.id)
            return {
              asked,
              request: yield* request,
              wrote: existsSync(join(api, 'approved.ts')),
              seen: review?.changedAfter.map((one) => one.path) ?? [],
            }
          }),
        ),
      )
      expect(seen.asked).toContain('request #1')
      // Hemera acts on it after the snapshot: the exit's mark refuses it, so nothing lands unseen.
      expect(seen.request).toMatchObject({ state: 'ended', result: 'not-executed' })
      expect(seen.wrote).toBe(false)
      expect(seen.seen).not.toContain('approved.ts')
    },
  )
  test(
    'a write the user allows, acting as the tree stops, is waited for: the snapshot sees it',
    SLOW,
    async () => {
      const acting = Deferred.makeUnsafe<void>()
      const release = Deferred.makeUnsafe<void>()
      const { world, run } = ending({
        verdicts: Layer.succeed(Verdicts, {
          judge: (asked) =>
            Effect.succeed<Verdict>(
              asked.tool === 'fs_write' &&
                ['approved.ts', 'denied.ts'].some((name) => asked.path?.named.endsWith(name))
                ? { verdict: 'ask', reason: 'a file no task names', by: 'suite' }
                : ALLOW,
            ),
          refusal: () => Effect.succeed(null),
        }),
        // Hemera's last check of the allowed call holds it, its session read live, until let go.
        taskStates: Layer.succeed(TaskStates, {
          holds: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(acting, undefined)
              yield* Deferred.await(release)
              return true
            }),
        }),
        // An exit that does not wait looks at the Workspace first, and only then lets it go.
        snapshots: (real) => ({
          ...real,
          take: (place, owner) =>
            real
              .take(place, owner)
              .pipe(
                Effect.tap(() =>
                  owner.kind === 'review_exit' ? Deferred.succeed(release, undefined) : Effect.void,
                ),
              ),
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            yield* builtAll(builder.grantId)
            for (const path of ['approved.ts', 'denied.ts']) {
              yield* call(builder.grantId, 'fs_write', {
                repository: 'api',
                path,
                content: 'export const asked = true\n',
              })
            }
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            const database = yield* Database
            const requests = database
              .select()
              .from(permissionRequests)
              .where(eq(permissionRequests.missionId, mission.id))
              .orderBy(asc(permissionRequests.number))
            // The end holds at its refresh on both questions.
            yield* until(
              Effect.gen(function* () {
                const view = yield* buildingNow(mission.id)
                return view.phase === 'refresh' && (yield* getMission(mission.id)).needs.length > 1
              }),
              LONG,
            )
            const [approved, denied] = yield* requests
            if (approved === undefined || denied === undefined) {
              return yield* Effect.die(new Error('no requests'))
            }
            const answer = (needId: string, choice: 'allow-once' | 'deny') =>
              answerNeed({
                id: needId,
                answer: PermissionAnswer.make({ choice }),
                key: crypto.randomUUID(),
              })
            yield* answer(approved.needId, 'allow-once')
            // Allowed while the Builder still runs: the second question holds the end meanwhile.
            yield* Deferred.await(acting)
            // Let go a second after the Builder stopped: long after an exit that did not wait.
            yield* Effect.gen(function* () {
              yield* until(
                Effect.map(getSession(builder.session.id), (session) => session.state === 'ended'),
                LONG,
              )
              yield* Effect.sleep('1 second')
              yield* Deferred.succeed(release, undefined)
            }).pipe(Effect.forkDetach)
            yield* answer(denied.needId, 'deny')
            yield* inReview(mission.id)
            yield* until(
              Effect.map(requests, ([one]) => one?.state === 'ended'),
              LONG,
            )
            return {
              request: (yield* requests)[0],
              wrote: existsSync(join(api, 'approved.ts')),
              review: yield* autoReviewOf(mission.id),
            }
          }),
        ),
      )
      expect(seen.request).toMatchObject({ state: 'ended', result: 'done' })
      expect(seen.wrote).toBe(true)
      expect(seen.review?.changedAfter.map((one) => one.path)).toContain('approved.ts')
    },
  )
  test(
    'a write still executing as the tree stops is waited for: the snapshot sees what it wrote',
    SLOW,
    async () => {
      const entered = Deferred.makeUnsafe<void>()
      const release = Deferred.makeUnsafe<void>()
      const { world, run } = ending({
        // The write to held.ts executes until the test lets it go.
        attribution: Layer.succeed(WriteAttribution, {
          written: () => () => Effect.void,
          command: () => Effect.succeed(null),
          holding: (file, write) =>
            Effect.gen(function* () {
              if (file.path.endsWith('held.ts')) {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(release)
              }
              return { result: yield* write, waited: null }
            }),
        }),
        // An exit that does not wait looks at the Workspace first, and only then lets it go.
        snapshots: (real) => ({
          ...real,
          take: (place, owner) =>
            real
              .take(place, owner)
              .pipe(
                Effect.tap(() =>
                  owner.kind === 'review_exit' ? Deferred.succeed(release, undefined) : Effect.void,
                ),
              ),
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            yield* builtAll(builder.grantId)
            const writing = yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'held.ts',
              content: 'export const held = true\n',
            }).pipe(Effect.forkDetach)
            yield* Deferred.await(entered)
            // Let go a second after the Builder stopped: long after an exit that did not wait.
            yield* Effect.gen(function* () {
              yield* until(
                Effect.map(getSession(builder.session.id), (session) => session.state === 'ended'),
                LONG,
              )
              yield* Effect.sleep('1 second')
              yield* Deferred.succeed(release, undefined)
            }).pipe(Effect.forkDetach)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            return {
              written: yield* Fiber.join(writing),
              wrote: existsSync(join(api, 'held.ts')),
              review: yield* autoReviewOf(mission.id),
            }
          }),
        ),
      )
      expect(seen.written).not.toContain('refused')
      expect(seen.wrote).toBe(true)
      expect(seen.review?.changedAfter.map((one) => one.path)).toContain('held.ts')
    },
  )
})

describe('The refresh', () => {
  test(
    'a proof red at the refresh is waited on, not the Builder: its green moves the end on with no turn of the Builder',
    SLOW,
    async () => {
      const markdown = [
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
      const proofs = () => ({
        'R1.S2': {
          mode: 'automated',
          actions: ['Run the test'],
          starting_data: 'None.',
          expected: 'The assertion of the test holds.',
          test: {
            repository: 'api',
            path: 'tests/export.test.mjs',
            code: markdown,
            insertion: 'new_file',
            command: `"${process.execPath}" --test --test-reporter=tap tests/export.test.mjs`,
          },
          seen_today: false,
        },
      })
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              withReadme,
              undefined,
              PLAN,
              undefined,
              undefined,
              proofs,
            )
            const builder = yield* builderOf(mission.id)
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId, 'export const toMarkdown = () => ""\n')
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('export.ts', 'Name the export after CSV.'),
            ])
            yield* specialAvailable(mission.id, 'RV1')
            // RV1 breaks what the proof reads: the refresh runs it again, red.
            yield* specialDone(builder.grantId, 'RV1', 'export.ts', 'export const toCsv = 1\n')
            yield* documented(world, mission.id, 2)
            yield* until(
              Effect.map(
                eventsOf(mission.id, 'building.proofs_refreshed'),
                (found) => found.length > 0,
              ),
              LONG,
            )
            // The rerun of the stale proof failed: it waits for its fix like a failed green.
            yield* until(
              Effect.map(
                Database.use((database) =>
                  database
                    .select()
                    .from(proofRuns)
                    .where(and(eq(proofRuns.missionId, mission.id), eq(proofRuns.phase, 'rerun'))),
                ),
                (runs) => runs.length > 0,
              ),
              LONG,
            )
            // Long enough for every turn the red started to be over.
            yield* Effect.sleep('1 second')
            // The fix lands as a write, outside any turn: the proof runs again, green.
            yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'export.ts',
              content: 'export const toMarkdown = () => ""\n',
            })
            yield* inReview(mission.id)
            return yield* buildingNow(mission.id)
          }),
        ),
      )
      const proof = seen.requirements
        .flatMap((one) => one.scenarios)
        .find((one) => one.scenario === 'R1.S2')
      expect(proof).toMatchObject({ state: 'green', upToDate: true })
    },
  )

  test(
    'a stale proof the refresh cannot run is refreshed once, said once, and holds the end on an error need instead of looping',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              withReadme,
              undefined,
              PLAN,
              undefined,
              undefined,
              exportProof,
            )
            const builder = yield* builderOf(mission.id)
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('export.ts', 'Export a function, not a flag.'),
            ])
            yield* specialAvailable(mission.id, 'RV1')
            // The proof is no longer in the Spec: nothing can run it again once RV1 makes it stale.
            const database = yield* Database
            yield* database
              .delete(specProofs)
              .where(and(eq(specProofs.missionId, mission.id), eq(specProofs.scenarioId, 'R1.S2')))
            yield* specialDone(
              builder.grantId,
              'RV1',
              'export.ts',
              'export const toMarkdown = () => ""\n',
            )
            yield* documented(world, mission.id, 2)
            const refreshes = eventsOf(mission.id, 'building.proofs_refreshed')
            const errorNeeds = Effect.map(getMission(mission.id), (one) =>
              one.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
            )
            // The end asks, or loops: each turn of a loop refreshes again.
            yield* until(
              Effect.gen(function* () {
                return (yield* errorNeeds).length > 0 || (yield* refreshes).length >= 3
              }),
              LONG,
            )
            // Long enough for a loop to show itself.
            yield* Effect.sleep('1 second')
            return {
              refreshes: yield* refreshes,
              journal: yield* journalOf(mission.id),
              needs: yield* errorNeeds,
              view: yield* buildingNow(mission.id),
              stage: (yield* getMission(mission.id)).stage,
            }
          }),
        ),
      )
      expect(seen.refreshes).toHaveLength(1)
      expect(
        seen.journal.filter((line) => line.includes('The proofs were refreshed')),
      ).toHaveLength(1)
      expect(seen.stage).toBe('building')
      expect(seen.view.phase).toBe('refresh')
      expect(seen.needs).toHaveLength(1)
      const [need] = seen.needs
      if (need !== undefined && Predicate.isTagged(need.fields, 'Error')) {
        expect(need.fields.failed).toContain('R1.S2')
        expect(need.fields.proposals).toEqual(['Retry'])
      }
    },
  )
})

describe('The reviewers count in the cap', () => {
  test('with three sub-agents running, the reviewers wait for slots', SLOW, async () => {
    const { world, run } = ending()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work, withReadme)
          const builder = yield* builderOf(mission.id)
          const limits = yield* projectLimits(project.id)
          yield* setProjectLimits(project.id, { ...limits, cap: 4 })
          yield* builtAll(builder.grantId)
          const documenter = yield* agentOf(world, mission.id, 'documenter')
          const owner = { kind: 'mission' as const, missionId: mission.id }
          const helpers: RoleSession[] = []
          for (const _ of [1, 2, 3]) {
            helpers.push(
              yield* Sessions.use((sessions) =>
                sessions.open({
                  owner,
                  role: 'helper',
                  folder: builder.session.folder,
                  requestedBy: 'agent',
                }),
              ),
            )
          }
          yield* setProjectLimits(project.id, { ...limits, cap: 3 })
          const answer = yield* callTool(documenter.grantId, 'docs_report', {
            changed: [],
            no_change_reason: NO_DOC,
          })
          if (!answer.ok) return yield* Effect.die(new Error(answer.text))
          world.release(documenter.index)
          const now = Memory.use((memory) => memory.now(mission.id))
          yield* until(
            Effect.map(now, (state) => state.slotWait !== null),
            LONG,
          )
          const waiting = yield* now
          const passes = (yield* autoReviewOf(mission.id))?.passes ?? []
          yield* Sessions.use((sessions) => sessions.end(helpers[0]?.lineage ?? '', 'done'))
          const passesNow = Effect.map(autoReviewOf(mission.id), (review) => review?.passes ?? [])
          yield* until(
            Effect.map(passesNow, (rows) => rows.some((row) => row.state === 'running')),
            LONG,
          )
          const one = yield* passesNow
          yield* Sessions.use((sessions) => sessions.end(helpers[1]?.lineage ?? '', 'done'))
          yield* reviewing(mission.id)
          return {
            waiting,
            passes,
            one,
            waited: yield* eventsOf(mission.id, 'review.pass_waiting'),
          }
        }),
      ),
    )
    expect(seen.waiting.slotWait).toBe(
      'Automatic review waits for a free agent slot (3 of 3 in use)',
    )
    expect(seen.passes.map((one) => one.state)).toEqual(['waiting', 'waiting'])
    expect(seen.one.map((one) => one.state).toSorted()).toEqual(['running', 'waiting'])
    expect(seen.waited).toHaveLength(2)
  })
})

/** The verdicts of the end's attempts at the final checks, in their order; null while open. */
const endAttempts = (missionId: string) =>
  Effect.gen(function* () {
    const view = yield* buildingNow(missionId)
    return (yield* attemptsIn(yield* Database, view.buildingId))
      .filter((one) => one.taskId === null && one.scope === 'end' && one.subject === null)
      .toSorted((a, b) => a.number - b.number)
      .map((one) => one.verdict)
  })

/** Waits until the mission has a pending error need, and answers it Retry. */
const retried = (missionId: string) =>
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

describe('A pass that fails', () => {
  test(
    'a reviewer that cannot start holds the end on an error need; Retry runs its pass again',
    SLOW,
    async () => {
      // Every agent but those already known when it is set: the reviewers.
      let known: ReadonlySet<string> | null = null
      const { world, run } = ending({
        starting: (sessionId) =>
          known === null || known.has(sessionId)
            ? Effect.void
            : Effect.fail(new LaunchFailed({ reason: 'the agent could not be spawned' })),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* agentOf(world, mission.id, 'documenter')
            known = new Set(
              (yield* sessionsIn(SESSION_STATES, { kind: 'mission', missionId: mission.id })).map(
                (one) => one.id,
              ),
            )
            yield* documented(world, mission.id)
            yield* until(
              Effect.map(
                autoReviewOf(mission.id),
                (review) =>
                  review !== null &&
                  review.passes.length === 2 &&
                  review.passes.every((one) => one.state === 'failed'),
              ),
              LONG,
            )
            // Long enough for anything on its way to move the end on.
            yield* Effect.sleep('1 second')
            const holding = yield* buildingNow(mission.id)
            known = null
            const need = yield* retried(mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            return { need, holding, review: yield* autoReviewOf(mission.id) }
          }),
        ),
      )
      expect(seen.holding.phase).toBe('review')
      expect(Predicate.isTagged(seen.need.fields, 'Error')).toBe(true)
      if (Predicate.isTagged(seen.need.fields, 'Error')) {
        expect(seen.need.fields.failed).toContain('the agent could not be spawned')
        expect(seen.need.fields.proposals).toEqual(['Retry'])
      }
      expect(seen.review?.passes.map((one) => one.state).toSorted()).toEqual([
        'done',
        'done',
        'failed',
        'failed',
      ])
    },
  )

  test(
    'a reviewer lineage that stops for good holds the end on an error need; Retry runs a new pass',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            const code = yield* agentOf(world, mission.id, 'code-reviewer')
            yield* Sessions.use((sessions) =>
              sessions.end(code.session.lineage, 'the agent was closed'),
            )
            yield* until(
              Effect.map(getMission(mission.id), (one) => one.needs.length > 0),
              LONG,
            )
            yield* Effect.sleep('1 second')
            const holding = yield* buildingNow(mission.id)
            const need = yield* retried(mission.id)
            const again = yield* agentOf(world, mission.id, 'code-reviewer', 2)
            const answer = yield* callTool(again.grantId, 'review_report', { findings: [] })
            if (!answer.ok) return yield* Effect.die(new Error(answer.text))
            world.release(again.index)
            yield* inReview(mission.id)
            return { need, holding, review: yield* autoReviewOf(mission.id) }
          }),
        ),
      )
      expect(seen.holding.phase).toBe('review')
      if (Predicate.isTagged(seen.need.fields, 'Error')) {
        expect(seen.need.fields.failed).toContain('Code reviewer')
      }
      expect(seen.review?.passes.map((one) => `${one.reviewer} ${one.state}`).toSorted()).toEqual([
        'code-reviewer done',
        'code-reviewer failed',
        'spec-reviewer done',
      ])
    },
  )
})

describe('A step that cannot go on', () => {
  test(
    'a step that throws holds the end on an error need; Retry runs the step again',
    SLOW,
    async () => {
      let failing = false
      const { world, run } = ending({
        snapshots: (real) => ({
          ...real,
          take: (place, owner) =>
            failing && owner.kind === 'checkpoint'
              ? Effect.die(new Error('the disk is full'))
              : real.take(place, owner),
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            failing = true
            yield* documented(world, mission.id)
            yield* until(
              Effect.map(getMission(mission.id), (one) => one.needs.length > 0),
              LONG,
            )
            const holding = yield* buildingNow(mission.id)
            failing = false
            const need = yield* retried(mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            return { holding, need }
          }),
        ),
      )
      expect(seen.holding.phase).toBe('checkpoint')
      if (Predicate.isTagged(seen.need.fields, 'Error')) {
        expect(seen.need.fields.failed).toContain('the disk is full')
        expect(seen.need.fields.proposals).toEqual(['Retry'])
      }
    },
  )

  test(
    'a documenter’s delta refused before its pass runs holds the end on an error need, once',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            writtenInWorkspace(api, 'src/x.ts', 'export const x = 1\n')
            yield* builtAll(builder.grantId)
            const first = yield* documented(world, mission.id)
            // A second pass already spent: the delta the special task asks for is refused.
            const database = yield* Database
            const view = yield* buildingNow(mission.id)
            yield* until(
              Effect.map(
                database.select().from(documenterPasses),
                (rows) => rows[0]?.endedAt !== null && rows.length === 1,
              ),
              LONG,
            )
            yield* database.insert(documenterPasses).values({
              id: crypto.randomUUID(),
              buildingId: view.buildingId,
              missionId: mission.id,
              number: 2,
              mode: 'full',
              files: '[]',
              state: 'reported',
              lineage: crypto.randomUUID(),
              attemptId: crypto.randomUUID(),
              noChangeReason: null,
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
            })
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('src/x.ts', 'Fix src/x.ts.'),
            ])
            yield* specialAvailable(mission.id, 'RV1')
            yield* specialDone(builder.grantId, 'RV1', 'src/x.ts', 'export const x = 2\n')
            yield* until(
              Effect.map(getMission(mission.id), (one) => one.needs.length > 0),
              LONG,
            )
            // Long enough for a loop to write its events again.
            yield* Effect.sleep('1 second')
            return {
              first,
              mission: yield* getMission(mission.id),
              view: yield* buildingNow(mission.id),
              deltas: yield* eventsOf(mission.id, 'building.documenter_delta'),
            }
          }),
        ),
      )
      expect(seen.view.phase).toBe('documenter_delta')
      expect(seen.deltas).toHaveLength(1)
      const [need] = seen.mission.needs
      expect(Predicate.isTagged(need?.fields, 'Error')).toBe(true)
      if (Predicate.isTagged(need?.fields, 'Error')) {
        expect(need.fields.failed).toContain('the documenter already ran twice')
      }
    },
  )
})

describe('A restart in the middle of the end', () => {
  test('a restart in the middle of the sequence resumes at its step', SLOW, async () => {
    const before = ending()
    const left = await before.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withReadme)
          const builder = yield* builderOf(mission.id)
          yield* builtAll(builder.grantId)
          yield* documented(before.world, mission.id)
          yield* reviewing(mission.id)
          return mission
        }),
      ),
    )
    const after = ending({ resumed: true })
    const seen = await after.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const spec = yield* reviewed(after.world, left.id, 'spec-reviewer')
          yield* reviewed(after.world, left.id, 'code-reviewer')
          yield* inReview(left.id)
          const database = yield* Database
          return {
            spec,
            documenter: yield* database.select().from(documenterPasses),
            checkpoints: yield* database.select().from(checkpoints),
            passes: yield* database.select().from(reviewPasses),
            types: yield* typesOf(left.id),
          }
        }),
      ),
    )
    expect(seen.spec.brief).toContain('[hemera:resume]')
    expect(seen.spec.brief).toContain(START_AGAIN)
    expect(seen.documenter).toHaveLength(1)
    expect(seen.checkpoints.filter((one) => one.kind === 'review')).toHaveLength(1)
    expect(seen.passes).toHaveLength(2)
    expect(seen.passes.every((one) => one.state === 'done')).toBe(true)
    expect(seen.types.filter((type) => type === 'building.end_started')).toHaveLength(1)
    expect(seen.types.filter((type) => type === 'building.ended')).toHaveLength(1)
  })

  test('a restart during the documenter’s pass runs the pass again', SLOW, async () => {
    const before = ending()
    const left = await before.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withReadme)
          const builder = yield* builderOf(mission.id)
          yield* builtAll(builder.grantId)
          yield* agentOf(before.world, mission.id, 'documenter')
          return mission
        }),
      ),
    )
    const after = ending({ resumed: true })
    const seen = await after.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* documented(after.world, left.id)
          yield* reviewed(after.world, left.id, 'spec-reviewer')
          yield* reviewed(after.world, left.id, 'code-reviewer')
          yield* inReview(left.id)
          const database = yield* Database
          return {
            documenter: yield* database
              .select()
              .from(documenterPasses)
              .orderBy(asc(documenterPasses.number)),
            mission: yield* getMission(left.id),
          }
        }),
      ),
    )
    expect(seen.documenter.map((one) => `${one.mode} ${one.state}`)).toEqual([
      'full failed',
      'full reported',
    ])
    expect(seen.mission.needs).toEqual([])
  })

  test(
    'a restart while a red of the final checks waits for the Builder counts no red until its turn ends',
    SLOW,
    async () => {
      let fixed = false
      const checks: ChecksOf = ({ scope }) => {
        if (scope !== 'end') return []
        return fixed ? [GREEN] : [RED]
      }
      let holding = false
      const turn = held()
      const before = ending({
        checks,
        builder: {
          steps: [says('Read.')],
          between: () => (holding ? turn.promise : Promise.resolve()),
        },
      })
      const left = await before
        .run(({ profile }) =>
          within(
            profile,
            Effect.gen(function* () {
              const { mission } = yield* launched(work, withReadme)
              const builder = yield* builderOf(mission.id)
              yield* builtAll(builder.grantId)
              yield* agentOf(before.world, mission.id, 'documenter')
              // The Builder's turns from now on hold: the one the red starts is not over.
              holding = true
              yield* documented(before.world, mission.id)
              yield* until(
                Effect.map(endAttempts(mission.id), (verdicts) => verdicts.length === 2),
                LONG,
              )
              yield* Effect.sleep('500 millis')
              return mission
            }),
          ),
        )
        .finally(() => turn.release())
      const after = ending({ checks, resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* until(
              Effect.sync(() => after.world.agents.length > 0),
              LONG,
            )
            // Long enough for a judgement at the start to have run.
            yield* Effect.sleep('1 second')
            const waited = yield* endAttempts(left.id)
            fixed = true
            for (const index of after.world.agents.keys()) after.world.release(index)
            yield* reviewed(after.world, left.id, 'spec-reviewer')
            yield* reviewed(after.world, left.id, 'code-reviewer')
            yield* inReview(left.id)
            return { waited, judged: yield* endAttempts(left.id) }
          }),
        ),
      )
      expect(seen.waited).toEqual(['red', null])
      expect(seen.judged).toEqual(['red', 'green'])
    },
  )

  test(
    'a restart in the middle of the exit does not bring the Builder back: nothing of its tree runs in Review',
    SLOW,
    async () => {
      const stopped = held()
      const before = ending({
        snapshots: (real) => ({
          ...real,
          // The engine stops as the exit looks at the Workspace: the tree is stopped already.
          take: (place, owner) =>
            owner.kind === 'review_exit'
              ? Effect.andThen(
                  Effect.sync(() => stopped.release()),
                  Effect.never,
                )
              : real.take(place, owner),
        }),
      })
      const left = await before.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(before.world, mission.id)
            yield* reviewed(before.world, mission.id, 'spec-reviewer')
            yield* reviewed(before.world, mission.id, 'code-reviewer')
            yield* Effect.promise(() => stopped.promise)
            return mission
          }),
        ),
      )
      // Started again, the Builder's resume is held until the exit looks at the Workspace once
      // more, and that look until the resume went past the Builder: the resume lands inside the
      // exit, after its stops.
      const looking = held()
      const resumed = held()
      let first = true
      const after = ending({
        resumed: true,
        hold: (at) => {
          if (at === 'resuming') return Effect.promise(() => looking.promise)
          if (at === 'resumed') return Effect.sync(() => resumed.release())
          return Effect.void
        },
        snapshots: (real) => ({
          ...real,
          take: (place, owner) => {
            if (owner.kind !== 'review_exit' || !first) return real.take(place, owner)
            first = false
            looking.release()
            return Effect.andThen(
              Effect.promise(() => resumed.promise),
              real.take(place, owner),
            )
          },
        }),
      })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* inReview(left.id)
            yield* Effect.promise(() => resumed.promise)
            return {
              live: yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], {
                kind: 'mission',
                missionId: left.id,
              }),
              mission: yield* getMission(left.id),
            }
          }),
        ),
      )
      expect(seen.live.map((one) => one.role)).toEqual([])
      expect(seen.mission.needs).toEqual([])
    },
  )

  test(
    'a restart after the Builder’s turn ended, while the final checks ran again, judges them once',
    SLOW,
    async () => {
      let ends = 0
      const before = ending({
        checks: ({ scope }) => {
          if (scope !== 'end') return []
          ends += 1
          return ends === 1 ? [RED] : null
        },
      })
      const left = await before.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(before.world, mission.id)
            // The Builder's turn after the red ended: the checks run again, and never end.
            yield* until(
              Effect.sync(() => ends >= 2),
              LONG,
            )
            return mission
          }),
        ),
      )
      const after = ending({
        resumed: true,
        checks: ({ scope }) => (scope === 'end' ? [GREEN] : []),
      })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* reviewed(after.world, left.id, 'spec-reviewer')
            yield* reviewed(after.world, left.id, 'code-reviewer')
            yield* inReview(left.id)
            return { judged: yield* endAttempts(left.id), mission: yield* getMission(left.id) }
          }),
        ),
      )
      expect(seen.judged).toEqual(['red', 'green'])
      expect(seen.mission.needs).toEqual([])
    },
  )
})
