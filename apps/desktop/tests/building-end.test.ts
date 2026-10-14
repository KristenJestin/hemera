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

import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, win32 } from 'node:path'

import {
  ChosenAnswer,
  PermissionAnswer,
  type DocRecipeDraft,
  SESSION_STATES,
  SPEC_IS_RIGHT,
  REVIEWERS,
  START_AGAIN,
  TOOLS,
  WrittenAnswer,
  toolsOf,
} from '@hemera/core/domain'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { LaunchFailed } from '@hemera/ipc'
import {
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Predicate,
  type Schema,
  Semaphore,
  Stream,
} from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript, FakeStep } from '../src/engine/agents/fake.ts'
import type { BuilderHold } from '../src/engine/building/builder.ts'
import { BuildDesk } from '../src/engine/building/desk.ts'
import { type CheckResult, TaskChecks } from '../src/engine/building/checks.ts'
import { STOPPED_AT_THE_END, helperRowsOf } from '../src/engine/building/helper-store.ts'
import { autoReviewOf } from '../src/engine/building/review-store.ts'
import { insideCopy, reviewFolderOf } from '../src/engine/building/review.ts'
import { type EndHold, withheldIn } from '../src/engine/building/end.ts'
import type { OutsideSettings } from '../src/engine/building/outside.ts'
import type { SnapshotsService } from '../src/engine/building/snapshots.ts'
import { attemptsIn, buildingEvent, buildingPartOf } from '../src/engine/building/tasks.ts'
import { projectLimits, setProjectLimits } from '../src/engine/budget.ts'
import { acceptDocRecipes } from '../src/engine/doc-recipes.ts'
import { saveCommand } from '../src/engine/catalogue.ts'
import { setProofLimit } from '../src/engine/project-checks.ts'
import { DomainEvents } from '../src/engine/domain-events.ts'
import { Memory } from '../src/engine/memory/index.ts'
import { getMission } from '../src/engine/missions.ts'
import { NeedOwners, answerNeed, getNeed, retryNeed } from '../src/engine/needs.ts'
import { Runs, getRun } from '../src/engine/runs.ts'
import { TaskStates, everyTaskHolds } from '../src/engine/permissions/requests.ts'
import { REGISTRY, noticesOf } from '../src/engine/notifications.ts'
import {
  MEMORY_TOOLS,
  ROLES_REGISTERED,
  memoryContractBroken,
  roleNamed,
} from '../src/engine/sessions/roles.ts'
import { type SessionHold, Sessions } from '../src/engine/sessions/service.ts'
import {
  type RoleSession,
  getSession,
  sessionsIn,
  sessionsOfLineage,
} from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import { mutate } from '../src/engine/transaction.ts'
import {
  agentSessions,
  buildingTasks,
  buildings,
  checkpointFiles,
  checkpoints,
  missions,
  permissionRequests,
  documenterPasses,
  domainEvents,
  needDeliveries,
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
import { ProfileHome } from '../src/engine/profile-home.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { type Verdict, Verdicts, WriteAttribution } from '../src/engine/tools/ports.ts'
import { sweepDiagnostics } from '../src/engine/retention.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { git } from './repositories.ts'

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

/** The folder of a repository of the Workspace. */
const folderOf = (missionId: string, name: string) =>
  Effect.map(
    buildingNow(missionId),
    (view) => view.repositories.find((one) => one.name === name)?.folder ?? '',
  )

/** The Impact of a mission whose Workspace holds both of Acme's repositories. */
const BOTH = 'It touches api and web, nothing else.'

/** The targets of the special tasks born from the findings. */
const specialTargets = Effect.gen(function* () {
  const database = yield* Database
  return (yield* database
    .select({ targets: buildingTasks.targets })
    .from(buildingTasks)
    .where(eq(buildingTasks.origin, 'review'))).map((row) => row.targets)
})

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

  test(
    'checkpoint_read of a path without a repository, in a two-repository Workspace: changed in one, it reads that one; changed in both, unchanged or in neither, it is refused with both names',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme, BOTH)
            const builder = yield* builderOf(mission.id)
            const web = yield* folderOf(mission.id, 'web')
            writtenInWorkspace(web, 'invoices.ts', 'export const fromWeb = true\n')
            writtenInWorkspace(web, 'page.ts', 'export const page = "web"\n')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            const reviewer = yield* agentOf(world, mission.id, 'spec-reviewer')
            const read = (path: string) => call(reviewer.grantId, 'checkpoint_read', { path })
            return {
              inApi: yield* read('export.ts'),
              inWeb: yield* read('page.ts'),
              inBoth: yield* read('invoices.ts'),
              unchanged: yield* read('package.json'),
              nowhere: yield* read('nowhere.ts'),
            }
          }),
        ),
      )
      expect(seen.inApi).toContain('## api/export.ts')
      expect(seen.inApi).toContain('export const markdown = true')
      expect(seen.inWeb).toContain('## web/page.ts')
      expect(seen.inWeb).toContain('export const page = "web"')
      for (const answer of [seen.inBoth, seen.unchanged, seen.nowhere]) {
        expect(answer).toMatch(/^refused: /)
        expect(answer).toContain('api, web')
        expect(answer).not.toContain('"name": "api"')
      }
      expect(seen.inBoth).toContain('invoices.ts')
      expect(seen.unchanged).toContain('package.json')
    },
  )

  test(
    'in a one-repository Workspace, a path without a repository names it: checkpoint_read reads an unchanged file there, and a finding on it targets it',
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
            const reviewer = yield* agentOf(world, mission.id, 'spec-reviewer')
            const unchanged = yield* call(reviewer.grantId, 'checkpoint_read', {
              path: 'package.json',
            })
            yield* reviewed(world, mission.id, 'spec-reviewer', [
              {
                severity: 'warning',
                path: 'package.json',
                text: 'The package names no export script.',
                contradicts_spec: false,
              },
            ])
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* specialAvailable(mission.id, 'RV1')
            return { unchanged, targets: yield* specialTargets }
          }),
        ),
      )
      expect(seen.unchanged).toContain('## api/package.json, unchanged since the merge base')
      expect(seen.unchanged).toContain('"name": "api"')
      expect(seen.targets.map((one) => JSON.parse(one))).toEqual([
        [{ repository: 'api', path: 'package.json', intent: 'change' }],
      ])
    },
  )

  test(
    'a finding with a path and no repository, in a two-repository Workspace: refused with both names when the path is changed in both or unchanged; kept on the one repository whose changed files hold it, written with ./ or backslashes, its special task targeting it',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme, BOTH)
            const builder = yield* builderOf(mission.id)
            const web = yield* folderOf(mission.id, 'web')
            writtenInWorkspace(web, 'invoices.ts', 'export const fromWeb = true\n')
            writtenInWorkspace(web, 'page.ts', 'export const page = "web"\n')
            writtenInWorkspace(web, 'src/view.ts', 'export const view = "web"\n')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            const reviewer = yield* agentOf(world, mission.id, 'spec-reviewer')
            const report = (path: string) =>
              call(reviewer.grantId, 'review_report', {
                findings: [
                  {
                    severity: 'warning',
                    path,
                    text: `Look again at ${path}.`,
                    contradicts_spec: false,
                  },
                ],
              })
            const inBoth = yield* report('invoices.ts')
            const unchanged = yield* report('package.json')
            // Written from where the reviewer stands, or with Windows separators: the same file.
            const inWeb = yield* report('./page.ts')
            world.release(reviewer.index)
            yield* reviewed(world, mission.id, 'code-reviewer', [
              {
                severity: 'warning',
                path: 'src\\view.ts',
                text: 'Look again at the view.',
                contradicts_spec: false,
              },
            ])
            yield* specialAvailable(mission.id, 'RV2')
            return {
              inBoth,
              unchanged,
              inWeb,
              review: yield* autoReviewOf(mission.id),
              targets: yield* specialTargets,
            }
          }),
        ),
      )
      expect(seen.inBoth).toBe(
        'refused: finding 1: invoices.ts names no single repository: say which, one of api, web. Nothing was kept.',
      )
      expect(seen.unchanged).toBe(
        'refused: finding 1: package.json names no single repository: say which, one of api, web. Nothing was kept.',
      )
      expect(seen.inWeb).toContain('Your report is kept.')
      expect(seen.review?.findings).toHaveLength(2)
      expect(seen.review?.findings[0]).toMatchObject({ repository: 'web', path: 'page.ts' })
      expect(seen.review?.findings[1]).toMatchObject({ repository: 'web', path: 'src/view.ts' })
      expect(seen.targets.map((one) => JSON.parse(one))).toEqual([
        [{ repository: 'web', path: 'page.ts', intent: 'change' }],
        [{ repository: 'web', path: 'src/view.ts', intent: 'change' }],
      ])
    },
  )

  test(
    'a .env of the checkpoint, read through the copy with fs_read or search, with or without a glob: content withheld, none of its lines printed',
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
            // Written and left uncommitted: the checkpoint keeps a stand-in for it.
            writtenInWorkspace(api, '.env', 'TOKEN=left-in-the-workspace\n')
            // Committed: the checkpoint's tree holds its content as it is.
            writtenInWorkspace(api, 'config/.env.production', 'TOKEN=committed-to-the-branch\n')
            git(api, 'add', '-f', 'config/.env.production')
            git(api, 'commit', '-q', '-m', 'production settings')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            const reviewer = yield* agentOf(world, mission.id, 'spec-reviewer')
            const read = (path: string) =>
              call(reviewer.grantId, 'fs_read', { repository: 'api', path })
            const asked = { repository: 'api', pattern: 'TOKEN' }
            const search = (glob: string | null) =>
              call(reviewer.grantId, 'search', glob === null ? asked : { ...asked, glob })
            return {
              reads: [yield* read('.env'), yield* read('config/.env.production')],
              searches: [
                yield* search(null),
                yield* search('**/.env*'),
                yield* search('.env'),
                yield* search('.env.production'),
              ],
              checkpoint: yield* call(reviewer.grantId, 'checkpoint_read', {
                repository: 'api',
                path: 'config/.env.production',
              }),
            }
          }),
        ),
      )
      for (const answer of seen.reads) {
        expect(answer).toContain('content withheld')
      }
      for (const answer of [...seen.reads, ...seen.searches, seen.checkpoint]) {
        expect(answer).not.toContain('TOKEN=')
        expect(answer).not.toContain('left-in-the-workspace')
        expect(answer).not.toContain('committed-to-the-branch')
      }
    },
  )

  test.skipIf(process.platform === 'win32')(
    'a link in the copy of the checkpoint to its .env, or to a file outside it, read with fs_read or search: content withheld, none of its lines printed',
    SLOW,
    async () => {
      const outside = join(work, 'outside-secret.txt')
      writeFileSync(outside, 'TOKEN=outside-the-copy\n')
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            writtenInWorkspace(api, 'config/.env.production', 'TOKEN=committed-to-the-branch\n')
            symlinkSync('config/.env.production', join(api, 'settings.txt'))
            symlinkSync(outside, join(api, 'elsewhere.txt'))
            git(api, 'add', '-f', 'config/.env.production', 'settings.txt', 'elsewhere.txt')
            git(api, 'commit', '-q', '-m', 'linked settings')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            const reviewer = yield* agentOf(world, mission.id, 'spec-reviewer')
            const read = (path: string) =>
              call(reviewer.grantId, 'fs_read', { repository: 'api', path })
            return {
              answers: [
                yield* read('settings.txt'),
                yield* read('elsewhere.txt'),
                yield* call(reviewer.grantId, 'search', { repository: 'api', pattern: 'TOKEN' }),
                yield* call(reviewer.grantId, 'search', {
                  repository: 'api',
                  pattern: 'TOKEN',
                  glob: '*.txt',
                }),
              ],
            }
          }),
        ),
      )
      expect(seen.answers[0]).toContain('content withheld: api/config/.env.production')
      expect(seen.answers[1]).toContain('content withheld: api/elsewhere.txt')
      for (const answer of seen.answers) {
        expect(answer).not.toContain('TOKEN=')
        expect(answer).not.toContain('committed-to-the-branch')
        expect(answer).not.toContain('outside-the-copy')
      }
    },
  )

  test.skipIf(process.platform === 'win32')(
    'a committed link to a folder outside the copy, and a link to the copy itself: the review runs, and the link out reads content withheld',
    SLOW,
    async () => {
      const outside = join(work, 'outside-folder')
      mkdirSync(outside)
      writeFileSync(join(outside, '.env'), 'TOKEN=outside-the-copy\n')
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            symlinkSync(outside, join(api, 'out'))
            symlinkSync('.', join(api, 'self'))
            git(api, 'add', 'out', 'self')
            git(api, 'commit', '-q', '-m', 'linked folders')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewing(mission.id)
            const reviewer = yield* agentOf(world, mission.id, 'spec-reviewer')
            return {
              out: yield* call(reviewer.grantId, 'fs_read', { repository: 'api', path: 'out' }),
              search: yield* call(reviewer.grantId, 'search', {
                repository: 'api',
                pattern: 'TOKEN',
              }),
            }
          }),
        ),
      )
      expect(seen.out).toContain('content withheld: api/out')
      expect(seen.search).not.toContain('outside-the-copy')
      expect(readFileSync(join(outside, '.env'), 'utf8')).toBe('TOKEN=outside-the-copy\n')
    },
  )

  test(
    'a copy of the checkpoint made before the withholding is withheld when it is used again',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const { dataFolder } = yield* ProfileHome
            const folder = reviewFolderOf(dataFolder, (yield* buildingNow(mission.id)).buildingId)
            // A copy left by an engine that did not withhold, as an upgrade mid-end finds it.
            writtenInWorkspace(folder, 'api/.env', 'TOKEN=in-an-old-copy\n')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            const reviewer = yield* agentOf(world, mission.id, 'spec-reviewer')
            return yield* call(reviewer.grantId, 'fs_read', { repository: 'api', path: '.env' })
          }),
        ),
      )
      expect(seen).toContain('content withheld: api/.env')
      expect(seen).not.toContain('in-an-old-copy')
    },
  )

  test('on Windows, a finding’s path on another drive is not inside the checkpoint', () => {
    const root = 'C:\\Users\\someone\\hemera\\reviews\\b1\\api'
    expect(insideCopy(root, 'src\\x.ts', win32)).toBe(true)
    expect(insideCopy(root, '..\\web\\x.ts', win32)).toBe(false)
    expect(insideCopy(root, 'D:\\secrets\\x.ts', win32)).toBe(false)
    expect(insideCopy(root, 'D:x.ts', win32)).toBe(false)
  })
})

describe('The copy the reviewers read', () => {
  /** A copy of the checkpoint holding `api`, in a reviews folder of its own. */
  const copyIn = () => {
    const copy = join(work, 'reviews', 'b1.partial')
    mkdirSync(join(copy, 'api'), { recursive: true })
    writeFileSync(join(copy, 'api', 'README.md'), 'Acme api\n')
    return copy
  }
  const isLink = (path: string) => lstatSync(path).isSymbolicLink()
  const read = (path: string) => readFileSync(path, 'utf8')

  test('a .env template is withheld, as checkpoint_read withholds it', () => {
    const copy = copyIn()
    writeFileSync(join(copy, 'api', '.env.example'), 'TOKEN=a-real-value\n')
    withheldIn(copy)
    expect(read(join(copy, 'api', '.env.example'))).toBe('content withheld: api/.env.example\n')
    expect(read(join(copy, 'api', 'README.md'))).toBe('Acme api\n')
  })

  test.skipIf(process.platform === 'win32')(
    'a link to a folder outside the copy is withheld as a link, and nothing outside is touched',
    () => {
      const copy = copyIn()
      const outside = join(work, 'outside-folder')
      mkdirSync(outside)
      writeFileSync(join(outside, '.env'), 'TOKEN=outside-the-copy\n')
      symlinkSync(join(outside, '.env'), join(outside, 'link'))
      symlinkSync(outside, join(copy, 'api', 'out'))
      withheldIn(copy)
      expect(isLink(join(copy, 'api', 'out'))).toBe(false)
      expect(read(join(copy, 'api', 'out'))).toBe('content withheld: api/out\n')
      expect(read(join(outside, '.env'))).toBe('TOKEN=outside-the-copy\n')
      expect(isLink(join(outside, 'link'))).toBe(true)
    },
  )

  test.skipIf(process.platform === 'win32')(
    'a link to the copy itself is kept and never walked through',
    () => {
      const copy = copyIn()
      writeFileSync(join(copy, 'api', '.env'), 'TOKEN=in-the-copy\n')
      symlinkSync('.', join(copy, 'api', 'self'))
      symlinkSync('..', join(copy, 'api', 'root'))
      withheldIn(copy)
      expect(isLink(join(copy, 'api', 'self'))).toBe(true)
      expect(isLink(join(copy, 'api', 'root'))).toBe(true)
      expect(read(join(copy, 'api', 'self', '.env'))).toBe('content withheld: api/.env\n')
    },
  )

  test.skipIf(process.platform === 'win32')(
    'a link to a folder inside the copy that holds a .env is kept, and reads the .env withheld',
    () => {
      const copy = copyIn()
      mkdirSync(join(copy, 'api', 'config'))
      writeFileSync(join(copy, 'api', 'config', '.env.production'), 'TOKEN=in-the-copy\n')
      symlinkSync('config', join(copy, 'api', 'settings'))
      withheldIn(copy)
      expect(isLink(join(copy, 'api', 'settings'))).toBe(true)
      expect(read(join(copy, 'api', 'settings', '.env.production'))).toBe(
        'content withheld: api/config/.env.production\n',
      )
    },
  )

  test.skipIf(process.platform === 'win32')(
    'a link whose text stays in the copy but whose path leads out through another link is withheld',
    () => {
      const copy = copyIn()
      writeFileSync(join(work, 'reviews', 'secret.txt'), 'TOKEN=beside-the-copy\n')
      // `up` leads to the copy's root, so `up/..` is the folder above the copy, not `api`.
      symlinkSync('..', join(copy, 'api', 'up'))
      symlinkSync('up/../secret.txt', join(copy, 'api', 'beside'))
      withheldIn(copy)
      expect(isLink(join(copy, 'api', 'up'))).toBe(true)
      expect(read(join(copy, 'api', 'beside'))).toBe('content withheld: api/beside\n')
    },
  )

  test('a reviewer reading a withheld file while its copy is reused (a Retry) keeps reading it', () => {
    const copy = copyIn()
    writeFileSync(join(copy, 'api', '.env'), 'TOKEN=in-the-copy\n')
    withheldIn(copy)
    const path = join(copy, 'api', '.env')
    // The reader opened the stand-in before the reuse, and still holds it.
    const reader = openSync(path, 'r')
    try {
      const opened = fstatSync(reader, { bigint: true }).ino
      withheldIn(copy)
      expect(statSync(path, { bigint: true }).ino).toBe(opened)
      expect(readFileSync(reader, 'utf8')).toBe('content withheld: api/.env\n')
    } finally {
      closeSync(reader)
    }
    expect(read(path)).toBe('content withheld: api/.env\n')
  })

  test('withholding a copy twice leaves it as once', () => {
    const copy = copyIn()
    writeFileSync(join(copy, 'api', '.env'), 'TOKEN=in-the-copy\n')
    withheldIn(copy)
    withheldIn(copy)
    expect(read(join(copy, 'api', '.env'))).toBe('content withheld: api/.env\n')
  })
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
    'a written answer to a contradicting finding is taken as "the Spec is right": its special task carries the user’s words',
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
            const need = (yield* getMission(mission.id)).needs[0]
            yield* answerNeed({
              id: need?.id ?? '',
              answer: WrittenAnswer.make({ text: 'Add the header, and keep the column order.' }),
              key: 'written',
            })
            yield* specialAvailable(mission.id, 'RV1')
            const database = yield* Database
            return {
              tasks: yield* database
                .select({ id: buildingTasks.id, result: buildingTasks.result })
                .from(buildingTasks)
                .where(eq(buildingTasks.origin, 'review')),
              review: yield* autoReviewOf(mission.id),
            }
          }),
        ),
      )
      expect(seen.tasks).toHaveLength(1)
      expect(seen.tasks[0]?.result).toContain('The CSV has no header row')
      expect(seen.tasks[0]?.result).toContain('Add the header, and keep the column order.')
      const finding = seen.review?.findings[0]
      expect(finding).toMatchObject({ fate: 'special_task', taskId: 'RV1' })
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
  test(
    'a question raised as the tree stops holds the exit with the Builder back, to take its answer',
    SLOW,
    async () => {
      const entered = Deferred.makeUnsafe<void>()
      const release = Deferred.makeUnsafe<void>()
      const asking = Deferred.makeUnsafe<void>()
      const { world, run } = ending({
        // The write to held.ts executes until the test lets it go: the exit settles on it.
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
        // The write to question.ts becomes a question once the tree stopped.
        verdicts: Layer.succeed(Verdicts, {
          judge: (asked) =>
            asked.tool === 'fs_write' && asked.path?.named.endsWith('question.ts') === true
              ? Effect.as(Deferred.await(asking), {
                  verdict: 'ask',
                  reason: 'a file no task names',
                  by: 'suite',
                } satisfies Verdict)
              : Effect.succeed<Verdict>(ALLOW),
          refusal: () => Effect.succeed(null),
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const owner = { kind: 'mission', missionId: mission.id } as const
            yield* builtAll(builder.grantId)
            yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'held.ts',
              content: 'export const held = true\n',
            }).pipe(Effect.forkDetach)
            yield* Deferred.await(entered)
            yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'question.ts',
              content: 'export const question = true\n',
            }).pipe(Effect.forkDetach)
            // Once the Builder stopped, its call asks; once asked, the exit's settle ends.
            yield* Effect.gen(function* () {
              yield* until(
                Effect.map(getSession(builder.session.id), (session) => session.state === 'ended'),
                LONG,
              )
              yield* Deferred.succeed(asking, undefined)
              yield* until(
                Effect.map(getMission(mission.id), (one) => one.needs.length > 0),
                LONG,
              )
              yield* Deferred.succeed(release, undefined)
            }).pipe(Effect.forkDetach)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* Deferred.await(release)
            // The exit holds on the question, and the Builder works again meanwhile.
            const liveBuilder = Effect.map(
              sessionsIn(['starting', 'working', 'idle'], owner),
              (rows) => rows.filter((row) => row.role === 'builder'),
            )
            yield* until(
              Effect.map(liveBuilder, (rows) => rows.length > 0),
              LONG,
            )
            const holding = yield* buildingNow(mission.id)
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no question'))
            yield* answerNeed({
              id: need.id,
              answer: PermissionAnswer.make({ choice: 'allow-once' }),
              key: crypto.randomUUID(),
            })
            yield* inReview(mission.id)
            return {
              phase: holding.phase,
              builders: yield* liveBuilder,
              live: yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], owner),
            }
          }),
        ),
      )
      expect(seen.phase).toBe('refresh')
      // The exit that follows the answer stops it again: nothing of the tree runs in Review.
      expect(seen.live).toEqual([])
    },
  )

  test(
    'a question raised as the tree stops, answered with its hand-over failing, holds the exit after the stops: the end says it, and its Retry hands it over',
    SLOW,
    async () => {
      const entered = Deferred.makeUnsafe<void>()
      const release = Deferred.makeUnsafe<void>()
      const asking = Deferred.makeUnsafe<void>()
      const { world, run } = ending({
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
        verdicts: Layer.succeed(Verdicts, {
          judge: (asked) =>
            asked.tool === 'fs_write' && asked.path?.named.endsWith('question.ts') === true
              ? Effect.as(Deferred.await(asking), {
                  verdict: 'ask',
                  reason: 'a file no task names',
                  by: 'suite',
                } satisfies Verdict)
              : Effect.succeed<Verdict>(ALLOW),
          refusal: () => Effect.succeed(null),
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const database = yield* Database
            yield* builtAll(builder.grantId)
            yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'held.ts',
              content: 'export const held = true\n',
            }).pipe(Effect.forkDetach)
            yield* Deferred.await(entered)
            yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'question.ts',
              content: 'export const question = true\n',
            }).pipe(Effect.forkDetach)
            // Once the Builder stopped, its call asks: the user answers it while the exit still
            // stops the tree, and every hand-over of an answer fails; then the stops end.
            yield* Effect.gen(function* () {
              yield* until(
                Effect.map(getSession(builder.session.id), (session) => session.state === 'ended'),
                LONG,
              )
              yield* Deferred.succeed(asking, undefined)
              yield* until(
                Effect.map(getMission(mission.id), (one) => one.needs.length > 0),
                LONG,
              )
              const need = (yield* getMission(mission.id)).needs[0]
              if (need === undefined) return yield* Effect.die(new Error('no question'))
              yield* database.run(sql`CREATE TRIGGER refuse_hand_overs BEFORE UPDATE OF delivered_at
                ON need_deliveries BEGIN SELECT RAISE(ABORT, 'refused'); END`)
              yield* answerNeed({
                id: need.id,
                answer: PermissionAnswer.make({ choice: 'allow-once' }),
                key: crypto.randomUUID(),
              })
              yield* Deferred.succeed(release, undefined)
            }).pipe(Effect.forkDetach)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* Deferred.await(release)
            // The exit's check after the stops sees the answer not handed over, and hands it
            // over: that fails, and the end says so rather than close the Building.
            const errors = Effect.map(getMission(mission.id), (one) =>
              one.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
            )
            const state = Effect.map(
              database
                .select({ state: buildings.state })
                .from(buildings)
                .where(eq(buildings.missionId, mission.id)),
              (rows) => rows[0]?.state,
            )
            yield* until(
              Effect.gen(function* () {
                return (yield* state) !== 'active' || (yield* errors).length > 0
              }),
              LONG,
            )
            const holding = { state: yield* state, errors: yield* errors }
            yield* database.run(sql`DROP TRIGGER refuse_hand_overs`)
            if (holding.state !== 'active') return { holding, undelivered: [] }
            yield* retried(mission.id)
            yield* inReview(mission.id)
            const undelivered = yield* database
              .select()
              .from(needDeliveries)
              .where(isNull(needDeliveries.deliveredAt))
            return { holding, undelivered }
          }),
        ),
      )
      expect(seen.holding.state).toBe('active')
      expect(seen.holding.errors).toHaveLength(1)
      const [error] = seen.holding.errors
      if (error !== undefined && Predicate.isTagged(error.fields, 'Error')) {
        expect(error.fields.failed).toContain('A step of the end did not run (refresh)')
      }
      expect(seen.undelivered).toEqual([])
    },
  )
})

/** R1.S2's test: green while `api/export.ts` exports `toMarkdown`. */
const markdownTest = [
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
const markdownProof = () => ({
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
    'a proof red at the refresh that the Builder looks at and leaves unfixed asks the user: Try again, or End without it, which moves the end on',
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
              markdownProof,
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
            // RV1 breaks what the proof reads: the refresh runs it again, red, and the Builder,
            // told, ends its turn without writing.
            yield* specialDone(builder.grantId, 'RV1', 'export.ts', 'export const toCsv = 1\n')
            yield* documented(world, mission.id, 2)
            const decisions = Effect.map(getMission(mission.id), (one) =>
              one.needs.filter((need) => Predicate.isTagged(need.fields, 'Decision')),
            )
            yield* until(
              Effect.map(decisions, (found) => found.length > 0),
              LONG,
            )
            const [asked] = yield* decisions
            if (asked === undefined) return yield* Effect.die(new Error('no question'))
            yield* answerNeed({
              id: asked.id,
              answer: ChosenAnswer.make({ option: 'End without it' }),
              key: asked.id,
            })
            // A Builder the exit brings back to take the answer holds its turn: it is let go.
            yield* until(
              Effect.gen(function* () {
                for (const index of world.agents.keys()) world.release(index)
                return (yield* getMission(mission.id)).stage === 'review'
              }),
              LONG,
            )
            return {
              asked,
              view: yield* buildingNow(mission.id),
              told: yield* toBuilder(mission.id, builder.session.lineage),
            }
          }),
        ),
      )
      const fields = seen.asked.fields
      if (!Predicate.isTagged(fields, 'Decision')) throw new Error('not a decision')
      expect(fields.question).toContain('R1.S2 is not proven')
      // Said as it is at the refresh: no task was skipped, and no answer came before.
      expect(fields.question).toContain("its proof failed again at the end's refresh")
      expect(fields.options).toEqual(['Try again', 'End without it'])
      // The end was called already: the summary it asked for is told what was left out.
      expect(seen.told.some((one) => one.includes('say so in the summary'))).toBe(true)
      const proof = seen.view.requirements
        .flatMap((one) => one.scenarios)
        .find((one) => one.scenario === 'R1.S2')
      expect(proof?.state).toBe('not_proven')
      // The end is called once: the refresh never calls it again.
      expect(seen.told.filter((one) => one.startsWith('done: '))).toHaveLength(1)
    },
  )

  test(
    'a proof red at the refresh whose Builder writes a file unchanged, then leaves it, still asks the user',
    SLOW,
    async () => {
      let holding = false
      const turns: Array<ReturnType<typeof held>> = []
      const { world, run } = ending({
        builder: {
          ...QUIET,
          between: () => {
            if (!holding) return Promise.resolve()
            const turn = held()
            turns.push(turn)
            return turn.promise
          },
        },
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
              markdownProof,
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
            yield* specialDone(builder.grantId, 'RV1', 'export.ts', 'export const toCsv = 1\n')
            yield* until(
              Effect.map(sessionsIn(['idle'], { kind: 'mission', missionId: mission.id }), (rows) =>
                rows.some((row) => row.role === 'builder'),
              ),
              LONG,
            )
            // The Builder's turn on the refresh's red holds while it writes.
            holding = true
            yield* documented(world, mission.id, 2)
            const database = yield* Database
            yield* until(
              Effect.map(
                database
                  .select({ state: sessionDeliveries.state, body: sessionDeliveries.body })
                  .from(sessionDeliveries)
                  .where(
                    and(
                      eq(sessionDeliveries.ownerId, mission.id),
                      eq(sessionDeliveries.kind, 'red'),
                    ),
                  ),
                (reds) =>
                  reds.some((one) => one.state === 'sent' && one.body.startsWith("R1.S2's proof")),
              ),
              LONG,
            )
            // The same content again: no tree moves, nothing runs the proof again.
            yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'export.ts',
              content: 'export const toCsv = 1\n',
            })
            yield* Effect.sleep('1 second')
            holding = false
            for (const turn of turns) turn.release()
            const decisions = Effect.map(getMission(mission.id), (one) =>
              one.needs.filter((need) => Predicate.isTagged(need.fields, 'Decision')),
            )
            yield* until(
              Effect.map(decisions, (found) => found.length > 0),
              LONG,
            )
            return yield* decisions
          }),
        ),
      ).finally(() => {
        holding = false
        for (const turn of turns) turn.release()
      })
      const fields = seen[0]?.fields
      expect(Predicate.isTagged(fields, 'Decision') ? fields.question : '').toContain(
        'R1.S2 is not proven',
      )
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
  test(
    'a refresh whose own snapshot sees a change is not run again on that same tree: the stale proof it cannot run asks the user after one refresh',
    SLOW,
    async () => {
      // A change no snapshot saw yet lands as the refresh takes its own snapshot.
      let unseen: (() => void) | null = null
      const { world, run } = ending({
        snapshots: (real) => ({
          ...real,
          take: (place, owner) => {
            if (owner.kind === 'run' && owner.runId.startsWith('refresh-') && unseen !== null) {
              unseen()
              unseen = null
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
            unseen = () => writtenInWorkspace(api, 'notes.md', 'A note of the user.\n')
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
            yield* until(
              Effect.gen(function* () {
                return (yield* errorNeeds).length > 0 || (yield* refreshes).length >= 3
              }),
              LONG,
            )
            // Long enough for a second refresh to show itself.
            yield* Effect.sleep('1 second')
            return {
              refreshes: yield* refreshes,
              needs: yield* errorNeeds,
              unseen,
            }
          }),
        ),
      )
      expect(seen.unseen).toBeNull()
      expect(seen.refreshes).toHaveLength(1)
      expect(seen.needs).toHaveLength(1)
    },
  )
  test(
    'a stale final check the refresh cannot run again is refreshed once and holds the end on an error need instead of looping',
    SLOW,
    async () => {
      // The end's check answers once, on a tree the Workspace has moved past; run again, the
      // Project has it no more.
      let ends = 0
      const { world, run } = ending({
        checks: ({ scope }) => {
          if (scope !== 'end') return []
          ends += 1
          return ends === 1
            ? [{ ...GREEN, trees: [{ repository: 'api', tree: '0'.repeat(40) }] }]
            : []
        },
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
            yield* reviewed(world, mission.id, 'code-reviewer')
            const refreshes = eventsOf(mission.id, 'building.proofs_refreshed')
            const errorNeeds = Effect.map(getMission(mission.id), (one) =>
              one.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
            )
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
              needs: yield* errorNeeds,
              view: yield* buildingNow(mission.id),
              stage: (yield* getMission(mission.id)).stage,
              ends,
            }
          }),
        ),
      )
      expect(seen.refreshes).toHaveLength(1)
      expect(seen.ends).toBe(2)
      expect(seen.stage).toBe('building')
      expect(seen.view.phase).toBe('refresh')
      expect(seen.needs).toHaveLength(1)
      const [need] = seen.needs
      if (need !== undefined && Predicate.isTagged(need.fields, 'Error')) {
        expect(need.fields.failed).toContain('unit tests · api')
        expect(need.fields.proposals).toEqual(['Retry'])
      }
    },
  )
})

describe('The refresh and an environment need', () => {
  test(
    'an environment need’s Retry at the refresh, its rerun not recorded yet when the end judges, raises no "stayed stale" error, and the end moves on once it is green',
    SLOW,
    async () => {
      let proofCommand = ''
      let portHeld = false
      // The Retry's rerun, held once it ran and before its result is recorded.
      let arming = false
      const reached = Deferred.makeUnsafe<void>()
      const go = Deferred.makeUnsafe<void>()
      // Each pass of the end over its steps, numbered as it begins, and those that finished.
      let begun = 0
      const finished: Array<number> = []
      const { world, run } = ending({
        proofMinute: Duration.seconds(2),
        hold: (at) =>
          at === 'greening' && arming
            ? Effect.gen(function* () {
                arming = false
                yield* Deferred.succeed(reached, undefined)
                yield* Deferred.await(go)
              })
            : Effect.void,
        endHold: (at) =>
          Effect.sync(() => {
            if (at === 'advancing') begun += 1
            if (at === 'advanced') finished.push(begun)
          }),
      })
      const errors = (missionId: string) =>
        Effect.map(getMission(missionId), (one) =>
          one.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
        )
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              (projectId) =>
                Effect.gen(function* () {
                  yield* withReadme(projectId)
                  yield* setProofLimit(projectId, 1)
                  const saved = yield* saveCommand({
                    projectId,
                    id: null,
                    command: {
                      name: 'export proof',
                      type: 'script',
                      line: `"${process.execPath}" --test --test-reporter=tap api/tests/export.test.mjs`,
                      lineWindows: null,
                      lineLinux: null,
                      repositoryId: null,
                      folder: null,
                      scope: 'workspace',
                      portless: false,
                      portlessName: null,
                      check: false,
                      atOpen: false,
                      askBeforeRunning: false,
                      readOnly: false,
                      writeGlobs: [],
                    },
                  })
                  proofCommand = saved.id
                  // Free until the refresh; then another mission's service holds the port.
                  const runs = yield* Runs
                  const real = runs.reservations.current
                  runs.reservations.current = {
                    enter: (asked) =>
                      asked.commandId === proofCommand && portHeld
                        ? Effect.succeed({ names: ['the dev port'], wait: () => Effect.never })
                        : real.enter(asked),
                  }
                }),
              undefined,
              PLAN,
              undefined,
              undefined,
              () => ({
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
                    command: proofCommand,
                  },
                  seen_today: false,
                },
              }),
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
            // RV1 keeps the proof passing on a new tree: the refresh runs it again, and its rerun
            // waits for the port until the Project's limit.
            portHeld = true
            yield* specialDone(
              builder.grantId,
              'RV1',
              'export.ts',
              'export const toMarkdown = () => "md"\n',
            )
            yield* documented(world, mission.id, 2)
            const environment = Effect.map(getMission(mission.id), (one) =>
              one.needs.find((need) => Predicate.isTagged(need.fields, 'Environment')),
            )
            yield* until(
              Effect.map(environment, (need) => need !== undefined),
              LONG,
            )
            const need = yield* environment
            if (need === undefined) return yield* Effect.die(new Error('no environment need'))
            // The user frees the port and Retries: the rerun runs, and is held before its record.
            portHeld = false
            arming = true
            yield* retryNeed(need.id)
            yield* Deferred.await(reached)
            // Meanwhile the end is driven (the Builder's turn on the Retry ends, say): a whole
            // pass over its steps, begun once the rerun was held.
            const from = begun
            yield* mutate('driving the end', () =>
              Effect.succeed({
                result: undefined,
                events: [buildingEvent(mission.id, 'building.end_retried')],
              }),
            )
            yield* until(
              Effect.sync(() => finished.some((one) => one > from)),
              LONG,
            )
            const meanwhile = yield* errors(mission.id)
            yield* Deferred.succeed(go, undefined)
            yield* until(
              Effect.gen(function* () {
                for (const index of world.agents.keys()) world.release(index)
                const stage = (yield* getMission(mission.id)).stage
                return stage === 'review' || (yield* errors(mission.id)).length > 0
              }),
              LONG,
            )
            // Recorded, the rerun is no longer said to run: a later stale proof is judged again.
            yield* until(
              Effect.map(
                BuildDesk.use((desk) => desk.rerunning(mission.id)),
                (left) => left.length === 0,
              ),
              LONG,
            )
            return {
              meanwhile,
              after: yield* errors(mission.id),
              view: yield* buildingNow(mission.id),
              stage: (yield* getMission(mission.id)).stage,
            }
          }),
        ),
      )
      expect(seen.meanwhile.map((one) => one.fields)).toEqual([])
      expect(seen.after).toEqual([])
      expect(seen.stage).toBe('review')
      const proof = seen.view.requirements
        .flatMap((one) => one.scenarios)
        .find((one) => one.scenario === 'R1.S2')
      expect(proof).toMatchObject({ state: 'green', upToDate: true })
    },
  )
  test(
    'a Retry’s rerun at the refresh that passes on a tree moved meanwhile is run again, never left stale',
    SLOW,
    async () => {
      let proofCommand = ''
      let portHeld = false
      // The Retry's rerun, held once it ran and before its result is recorded.
      let arming = false
      const reached = Deferred.makeUnsafe<void>()
      const go = Deferred.makeUnsafe<void>()
      // Each pass of the end over its steps, numbered as it begins, and those that finished.
      let begun = 0
      const finished: Array<number> = []
      let taking: SnapshotsService | null = null
      const { world, run } = ending({
        snapshots: (real) => {
          taking = real
          return real
        },
        // Its compare would drive the end on the change below: only the fix may.
        outside: { compareEveryMillis: 3_600_000 },
        proofMinute: Duration.seconds(2),
        hold: (at) =>
          at === 'greening' && arming
            ? Effect.gen(function* () {
                arming = false
                yield* Deferred.succeed(reached, undefined)
                yield* Deferred.await(go)
              })
            : Effect.void,
        endHold: (at) =>
          Effect.sync(() => {
            if (at === 'advancing') begun += 1
            if (at === 'advanced') finished.push(begun)
          }),
      })
      const errors = (missionId: string) =>
        Effect.map(getMission(missionId), (one) =>
          one.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
        )
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              (projectId) =>
                Effect.gen(function* () {
                  yield* withReadme(projectId)
                  yield* setProofLimit(projectId, 1)
                  const saved = yield* saveCommand({
                    projectId,
                    id: null,
                    command: {
                      name: 'export proof',
                      type: 'script',
                      line: `"${process.execPath}" --test --test-reporter=tap api/tests/export.test.mjs`,
                      lineWindows: null,
                      lineLinux: null,
                      repositoryId: null,
                      folder: null,
                      scope: 'workspace',
                      portless: false,
                      portlessName: null,
                      check: false,
                      atOpen: false,
                      askBeforeRunning: false,
                      readOnly: false,
                      writeGlobs: [],
                    },
                  })
                  proofCommand = saved.id
                  // Free until the refresh; then another mission's service holds the port.
                  const runs = yield* Runs
                  const real = runs.reservations.current
                  runs.reservations.current = {
                    enter: (asked) =>
                      asked.commandId === proofCommand && portHeld
                        ? Effect.succeed({ names: ['the dev port'], wait: () => Effect.never })
                        : real.enter(asked),
                  }
                }),
              undefined,
              PLAN,
              undefined,
              undefined,
              () => ({
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
                    command: proofCommand,
                  },
                  seen_today: false,
                },
              }),
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
            // RV1 keeps the proof passing on a new tree: the refresh runs it again, and its rerun
            // waits for the port until the Project's limit.
            portHeld = true
            yield* specialDone(
              builder.grantId,
              'RV1',
              'export.ts',
              'export const toMarkdown = () => "md"\n',
            )
            yield* documented(world, mission.id, 2)
            const environment = Effect.map(getMission(mission.id), (one) =>
              one.needs.find((need) => Predicate.isTagged(need.fields, 'Environment')),
            )
            yield* until(
              Effect.map(environment, (need) => need !== undefined),
              LONG,
            )
            const need = yield* environment
            if (need === undefined) return yield* Effect.die(new Error('no environment need'))
            // The user frees the port and Retries: the rerun runs, and is held before its record.
            portHeld = false
            arming = true
            yield* retryNeed(need.id)
            yield* Deferred.await(reached)
            // Meanwhile the end is driven (the Builder's turn on the Retry ends, say): a whole
            // pass over its steps, begun once the rerun was held.
            const from = begun
            yield* mutate('driving the end', () =>
              Effect.succeed({
                result: undefined,
                events: [buildingEvent(mission.id, 'building.end_retried')],
              }),
            )
            yield* until(
              Effect.sync(() => finished.some((one) => one > from)),
              LONG,
            )
            const meanwhile = yield* errors(mission.id)
            // A change lands, and a snapshot sees it, while the rerun is held: it passed on a tree
            // that is no longer the current one.
            const api = yield* apiOf(mission.id)
            writtenInWorkspace(api, 'notes.md', 'A note of the user.\n')
            if (taking === null) return yield* Effect.die(new Error('no snapshots'))
            yield* taking.take(
              { name: 'api', folder: api },
              { kind: 'run', missionId: mission.id, runId: crypto.randomUUID(), side: 'before' },
            )
            const proven = Effect.map(buildingNow(mission.id), (view) =>
              view.requirements
                .flatMap((one) => one.scenarios)
                .find((one) => one.scenario === 'R1.S2'),
            )
            yield* Deferred.succeed(go, undefined)
            // Recorded stale, no longer said to run: the end is judged again and runs it again,
            // with no agent's turn to drive it.
            yield* until(
              Effect.map(proven, (proof) => proof?.state === 'green'),
              LONG,
            )
            yield* until(
              Effect.gen(function* () {
                for (const index of world.agents.keys()) world.release(index)
                const stage = (yield* getMission(mission.id)).stage
                return stage === 'review' || (yield* errors(mission.id)).length > 0
              }),
              LONG,
            )
            return {
              meanwhile,
              after: yield* errors(mission.id),
              view: yield* buildingNow(mission.id),
              stage: (yield* getMission(mission.id)).stage,
            }
          }),
        ),
      )
      expect(seen.meanwhile.map((one) => one.fields)).toEqual([])
      expect(seen.after).toEqual([])
      expect(seen.stage).toBe('review')
      const proof = seen.view.requirements
        .flatMap((one) => one.scenarios)
        .find((one) => one.scenario === 'R1.S2')
      expect(proof).toMatchObject({ state: 'green', upToDate: true })
    },
  )
})

describe('A Builder stopped at a provider limit', () => {
  test(
    'a Builder stopped at a provider limit is not resumed while the end waits at refresh: the limit need is left to the user',
    SLOW,
    async () => {
      let limiting = false
      const limit: FakeStep = { does: 'limits', title: 'The Acme account has no available quota.' }
      const { world, run } = ending({
        builder: {
          get steps() {
            return limiting ? [limit] : [says('Read.')]
          },
        },
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            // The Builder's next turn meets the provider's limit: its session ends, the user is asked.
            limiting = true
            yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner: { kind: 'mission', missionId: mission.id },
                target: { lineage: builder.session.lineage },
                kind: 'note',
                body: 'One more thing.',
              }),
            )
            const limitNeeds = Effect.map(getMission(mission.id), (one) =>
              one.needs.filter(
                (need) =>
                  Predicate.isTagged(need.fields, 'Environment') &&
                  need.fields.missing.includes('provider limit'),
              ),
            )
            yield* until(
              Effect.map(limitNeeds, (found) => found.length === 1),
              LONG,
            )
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            // The end waits at its last step on the user's answer.
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            // Mission events, as a proof run or a need brings them: each drives the end again.
            for (let count = 0; count < 3; count += 1) {
              yield* mutate('driving the end', () =>
                Effect.succeed({
                  result: undefined,
                  events: [buildingEvent(mission.id, 'building.resumed')],
                }),
              )
              yield* Effect.sleep('200 millis')
            }
            // Long enough for a resume to show itself.
            yield* Effect.sleep('1 second')
            return {
              lineage: yield* sessionsOfLineage(builder.session.lineage),
              needs: yield* limitNeeds,
              view: yield* buildingNow(mission.id),
            }
          }),
        ),
      )
      expect(seen.lineage.map((one) => one.state)).toEqual(['ended'])
      expect(seen.needs).toHaveLength(1)
      expect(seen.view.phase).toBe('refresh')
    },
  )
})

describe('The Builder while the end waits on it', () => {
  test(
    'a red of the final checks delivered while a Builder turn runs is judged again only after a turn that started once it was delivered',
    SLOW,
    async () => {
      // Once armed, each turn of the Builder holds until the test lets it go.
      let holding = false
      const turns: Array<ReturnType<typeof held>> = []
      const { world, run } = ending({
        checks: ({ scope }) => (scope === 'end' ? [RED] : []),
        builder: {
          steps: [says('Read.')],
          between: () => {
            if (!holding) return Promise.resolve()
            const turn = held()
            turns.push(turn)
            return turn.promise
          },
        },
      })
      const turnsHeld = (count: number) =>
        until(
          Effect.sync(() => turns.length >= count),
          LONG,
        )
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            // The Builder is in a turn of its own before the final checks run.
            holding = true
            yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner: { kind: 'mission', missionId: mission.id },
                target: { role: 'builder' },
                kind: 'note',
                body: 'Read the export once more.',
              }),
            )
            yield* turnsHeld(1)
            yield* documented(world, mission.id)
            yield* until(
              Effect.map(endAttempts(mission.id), (verdicts) => verdicts.length === 2),
              LONG,
            )
            // The turn that started before the red ends: the red is taken by the next one.
            turns[0]?.release()
            yield* turnsHeld(2)
            // Long enough for a judgement on the first turn's end to have run.
            yield* Effect.sleep('1 second')
            const whileTaken = yield* endAttempts(mission.id)
            turns[1]?.release()
            yield* until(
              Effect.map(endAttempts(mission.id), (verdicts) => verdicts.length === 3),
              LONG,
            )
            return { whileTaken, after: yield* endAttempts(mission.id) }
          }),
        ),
      ).finally(() => {
        holding = false
        for (const turn of turns) turn.release()
      })
      expect(seen.whileTaken).toEqual(['red', null])
      expect(seen.after).toEqual(['red', 'red', null])
    },
  )

  test(
    'a turn end the end takes in late, once the red it left queued was taken, does not count as the turn on the red',
    SLOW,
    async () => {
      let holding = false
      const turns: Array<ReturnType<typeof held>> = []
      // Once armed, the end takes in a Builder's turn end only when the test lets it.
      let late: ReturnType<typeof held> | null = null
      const { world, run } = ending({
        checks: ({ scope }) => (scope === 'end' ? [RED] : []),
        builder: {
          steps: [says('Read.')],
          between: () => {
            if (!holding) return Promise.resolve()
            const turn = held()
            turns.push(turn)
            return turn.promise
          },
        },
        endHold: () => {
          const gate = late
          return gate === null ? Effect.void : Effect.promise(() => gate.promise)
        },
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            holding = true
            yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner: { kind: 'mission', missionId: mission.id },
                target: { role: 'builder' },
                kind: 'note',
                body: 'Read the export once more.',
              }),
            )
            yield* until(
              Effect.sync(() => turns.length >= 1),
              LONG,
            )
            yield* documented(world, mission.id)
            yield* until(
              Effect.map(endAttempts(mission.id), (verdicts) => verdicts.length === 2),
              LONG,
            )
            // The end of the turn that started before the red is taken in only once the next
            // turn took the red.
            const gate = held()
            late = gate
            turns[0]?.release()
            yield* until(
              Effect.sync(() => turns.length >= 2),
              LONG,
            )
            late = null
            gate.release()
            // Long enough for a judgement on the late turn end to have run.
            yield* Effect.sleep('1 second')
            return { whileTaken: yield* endAttempts(mission.id) }
          }),
        ),
      ).finally(() => {
        holding = false
        late?.release()
        for (const turn of turns) turn.release()
      })
      expect(seen.whileTaken).toEqual(['red', null])
    },
  )

  test(
    'a red of the final checks no turn took, its Builder ended mid-turn, is judged again only after the Builder brought back took it',
    SLOW,
    async () => {
      let holding = false
      const turns: Array<ReturnType<typeof held>> = []
      const { world, run } = ending({
        checks: ({ scope }) => (scope === 'end' ? [RED] : []),
        builder: {
          steps: [says('Read.')],
          between: () => {
            if (!holding) return Promise.resolve()
            const turn = held()
            turns.push(turn)
            return turn.promise
          },
        },
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            holding = true
            yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner: { kind: 'mission', missionId: mission.id },
                target: { role: 'builder' },
                kind: 'note',
                body: 'Read the export once more.',
              }),
            )
            yield* until(
              Effect.sync(() => turns.length >= 1),
              LONG,
            )
            yield* documented(world, mission.id)
            yield* until(
              Effect.map(endAttempts(mission.id), (verdicts) => verdicts.length === 2),
              LONG,
            )
            // Its session ends in the turn that started before the red: nobody took the red.
            yield* Sessions.use((sessions) =>
              sessions.end(builder.session.lineage, 'the test ended it'),
            )
            // The end brings it back, and the red reaches its first turn, which holds.
            const database = yield* Database
            yield* until(
              Effect.map(
                database
                  .select({ state: sessionDeliveries.state })
                  .from(sessionDeliveries)
                  .where(
                    and(
                      eq(sessionDeliveries.ownerId, mission.id),
                      eq(sessionDeliveries.kind, 'red'),
                    ),
                  ),
                (reds) => reds.length === 1 && reds[0]?.state === 'sent',
              ),
              LONG,
            )
            yield* Effect.sleep('1 second')
            const whileTaken = yield* endAttempts(mission.id)
            for (const index of world.agents.keys()) world.release(index)
            yield* until(
              Effect.map(endAttempts(mission.id), (verdicts) => verdicts.length >= 3),
              LONG,
            )
            // Let go, the Builder may already have ended its turn on the third red too.
            return { whileTaken, after: (yield* endAttempts(mission.id)).slice(0, 2) }
          }),
        ),
      ).finally(() => {
        holding = false
        for (const turn of turns) turn.release()
      })
      expect(seen.whileTaken).toEqual(['red', null])
      expect(seen.after).toEqual(['red', 'red'])
    },
  )

  /** A Builder session that ended with no need of its own, as the store reads it. */
  const endedQuietly = (sessionId: string) =>
    Effect.gen(function* () {
      const database = yield* Database
      yield* database
        .update(agentSessions)
        .set({ state: 'ended', stateReason: null, endedAt: new Date().toISOString() })
        .where(eq(agentSessions.id, sessionId))
    })

  /** Mission events, as a proof run or a need brings them: each drives the end again. */
  const driven = (missionId: string) =>
    Effect.gen(function* () {
      for (let count = 0; count < 3; count += 1) {
        yield* mutate('driving the end', () =>
          Effect.succeed({
            result: undefined,
            events: [buildingEvent(missionId, 'building.resumed')],
          }),
        )
        yield* Effect.sleep('200 millis')
      }
      // Long enough for a resume to show itself.
      yield* Effect.sleep('1 second')
    })

  /** The Builder's question, which holds the end at refresh until the user answers it. */
  const asked = (grantId: string) =>
    call(grantId, 'report_need', {
      kind: 'decision',
      text: 'Which separator do the exports use?',
      options: ['Comma', 'Semicolon'],
      tasks: [],
    })

  const errorNeedsOf = (missionId: string) =>
    Effect.map(getMission(missionId), (one) =>
      one.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
    )

  test(
    'a Builder that was live when the end first waited at refresh, then stopped with no need, is brought back: only a resume the end started counts',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const lineage = sessionsOfLineage(builder.session.lineage)
            yield* builtAll(builder.grantId)
            yield* asked(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            // The end first waits at refresh with its Builder live: nothing to bring back.
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            yield* driven(mission.id)
            const first = yield* lineage
            // Then the Builder stops, with no need of its own.
            yield* endedQuietly(builder.session.id)
            yield* driven(mission.id)
            return { first, lineage: yield* lineage, view: yield* buildingNow(mission.id) }
          }),
        ),
      )
      expect(seen.first).toHaveLength(1)
      expect(seen.lineage.map((one) => one.state)).toEqual(['ended', 'working'])
      expect(seen.view.phase).toBe('refresh')
    },
  )

  test(
    'a Builder the end brought back that stops again with no need holds the end on an error need, and its Retry brings the Builder back',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const lineage = sessionsOfLineage(builder.session.lineage)
            yield* builtAll(builder.grantId)
            yield* asked(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            // A Builder session that ended with no need of its own, before the end reaches refresh.
            yield* endedQuietly(builder.session.id)
            yield* reviewed(world, mission.id, 'code-reviewer')
            // The end brings it back as it first waits at refresh.
            yield* until(
              Effect.map(lineage, (rows) => rows.length === 2),
              LONG,
            )
            // Its successor ends too, with no need: mission events drive the end again.
            yield* endedQuietly((yield* lineage).at(-1)?.id ?? '')
            yield* driven(mission.id)
            const holding = {
              lineage: yield* lineage,
              needs: yield* errorNeedsOf(mission.id),
              view: yield* buildingNow(mission.id),
            }
            // The user's Retry brings the Builder back once more.
            yield* retried(mission.id)
            yield* until(
              Effect.map(lineage, (rows) => rows.length === 3 && rows[2]?.state === 'working'),
              LONG,
            )
            return { holding, lineage: yield* lineage }
          }),
        ),
      )
      expect(seen.holding.lineage).toHaveLength(2)
      expect(seen.holding.view.phase).toBe('refresh')
      expect(seen.holding.needs).toHaveLength(1)
      const [need] = seen.holding.needs
      if (need !== undefined && Predicate.isTagged(need.fields, 'Error')) {
        expect(need.fields.failed).toContain('The Builder stopped')
        expect(need.fields.proposals).toEqual(['Retry'])
      }
      expect(seen.lineage.map((one) => one.state)).toEqual(['ended', 'ended', 'working'])
    },
  )

  test(
    'a Builder the end brings back whose start fails before it has a driver holds the end on an error need',
    SLOW,
    async () => {
      let failing = false
      const { world, run } = ending({
        // Once armed, a Builder's start fails before anything of it starts: no driver, no turn.
        sessionHold: (at, session) =>
          at === 'starting' && failing && session.role === 'builder'
            ? Effect.die(new Error('the brief could not be read'))
            : Effect.void,
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const lineage = sessionsOfLineage(builder.session.lineage)
            yield* builtAll(builder.grantId)
            yield* asked(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* endedQuietly(builder.session.id)
            // The end brings the Builder back at refresh, and that start fails.
            failing = true
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(errorNeedsOf(mission.id), (found) => found.length > 0),
              LONG,
            )
            return { lineage: yield* lineage, view: yield* buildingNow(mission.id) }
          }),
        ),
      )
      expect(seen.lineage.map((one) => one.state)).toEqual(['ended', 'failed'])
      expect(seen.view.phase).toBe('refresh')
    },
  )

  test(
    'a Builder whose failure is written after the end of its turn was heard is still brought back',
    SLOW,
    async () => {
      let dying = false
      let failing = false
      const entered = Deferred.makeUnsafe<void>()
      const release = Deferred.makeUnsafe<void>()
      const { world, run } = ending({
        builder: {
          get steps(): ReadonlyArray<FakeStep> {
            return dying ? [{ does: 'dies' }] : [says('Read.')]
          },
        },
        // Once armed, the next agent to start cannot: its turn ends, then its session fails.
        starting: () =>
          Effect.suspend(() => {
            if (!failing) return Effect.void
            failing = false
            return Effect.fail(new LaunchFailed({ reason: 'the agent could not be spawned' }))
          }),
        // The Builder's failure is written only once the test lets it, after its turn's end.
        sessionHold: (at, session) =>
          at === 'failing' && session.role === 'builder'
            ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
            : Effect.void,
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const lineage = sessionsOfLineage(builder.session.lineage)
            const turned = Effect.map(buildingNow(mission.id), (view) => view.buildingId).pipe(
              Effect.flatMap((id) =>
                Database.use((database) =>
                  database
                    .select({ at: buildings.builderTurnedAt })
                    .from(buildings)
                    .where(eq(buildings.id, id)),
                ),
              ),
              Effect.map((rows) => rows[0]?.at ?? null),
            )
            yield* builtAll(builder.grantId)
            yield* asked(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            // The end waits at refresh on the question, its Builder live.
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            yield* Effect.sleep('500 millis')
            const before = yield* turned
            // The Builder's process dies, and its replacement cannot start.
            dying = true
            failing = true
            yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner: { kind: 'mission', missionId: mission.id },
                target: { lineage: builder.session.lineage },
                kind: 'note',
                body: 'One more thing.',
              }),
            )
            // The end hears the replacement's turn end while its session still reads live.
            yield* Deferred.await(entered)
            yield* until(
              Effect.map(turned, (at) => at !== before),
              LONG,
            )
            yield* Effect.sleep('1 second')
            yield* Deferred.succeed(release, undefined)
            yield* until(
              Effect.map(lineage, (rows) =>
                ['starting', 'working', 'idle'].includes(rows.at(-1)?.state ?? ''),
              ),
              LONG,
            )
            return yield* lineage
          }),
        ),
      ).finally(() => Effect.runSync(Deferred.succeed(release, undefined)))
      expect(seen.map((one) => one.state)).toContain('failed')
    },
  )

  test(
    'after a restart, a Builder the start cannot bring back holds the end on an error need',
    SLOW,
    async () => {
      const checks: ChecksOf = ({ scope }) => (scope === 'end' ? [RED] : [])
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
              // The Builder's last session is one its lineage cannot be started again from.
              yield* Database.use((database) =>
                database
                  .update(agentSessions)
                  .set({ state: 'replaced', endedAt: new Date().toISOString() })
                  .where(eq(agentSessions.id, builder.session.id)),
              )
              return mission
            }),
          ),
        )
        .finally(() => turn.release())
      // The start is held once it tried the Builder, while the end is driven at the start.
      const settled = held()
      const after = ending({
        checks,
        resumed: true,
        hold: (at) => (at === 'resumed' ? Effect.promise(() => settled.promise) : Effect.void),
      })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* Effect.sleep('2 seconds')
            settled.release()
            yield* until(
              Effect.map(errorNeedsOf(left.id), (found) => found.length > 0),
              LONG,
            )
            return { needs: yield* errorNeedsOf(left.id), view: yield* buildingNow(left.id) }
          }),
        ),
      )
      expect(seen.view.phase).toBe('final_checks')
      expect(seen.needs).toHaveLength(1)
    },
  )

  test(
    'an answer the Builder acted on releases the exit even when the end of its turn could not be kept',
    SLOW,
    async () => {
      let gate: ReturnType<typeof held> | null = null
      const first = held()
      const second = held()
      const { world, run } = ending({
        builder: {
          steps: [says('Read.')],
          between: () => gate?.promise ?? Promise.resolve(),
        },
      })
      await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const database = yield* Database
            const answers = Effect.map(
              database
                .select()
                .from(sessionDeliveries)
                .where(
                  and(
                    eq(sessionDeliveries.ownerId, mission.id),
                    eq(sessionDeliveries.kind, 'answer'),
                  ),
                ),
              (rows) => rows.map((row) => row.state),
            )
            yield* builtAll(builder.grantId)
            yield* asked(builder.grantId)
            gate = first
            yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner: { kind: 'mission', missionId: mission.id },
                target: { lineage: builder.session.lineage },
                kind: 'note',
                body: 'One more thing.',
              }),
            )
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no question'))
            yield* answerNeed({
              id: need.id,
              answer: ChosenAnswer.make({ option: 'Comma' }),
              key: crypto.randomUUID(),
            })
            gate = second
            first.release()
            yield* until(
              Effect.map(answers, (rows) => rows.includes('sent')),
              LONG,
            )
            // From now on, the end of a Builder's turn cannot be written.
            yield* database.run(sql`CREATE TRIGGER refuse_turns BEFORE UPDATE OF builder_turned_at
              ON buildings BEGIN SELECT RAISE(ABORT, 'refused'); END`)
            gate = null
            second.release()
            yield* inReview(mission.id)
          }),
        ),
      ).finally(() => {
        first.release()
        second.release()
      })
    },
  )

  test(
    'a Builder that cannot be started for want of a Workspace says so, not that Retry starts it',
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
            yield* asked(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            // The Builder stops, and the Building has no Workspace to open one in any more.
            yield* endedQuietly(builder.session.id)
            const database = yield* Database
            yield* database
              .update(agentSessions)
              .set({ role: 'retired' })
              .where(eq(agentSessions.id, builder.session.id))
            yield* database
              .update(buildings)
              .set({ workspaceId: null })
              .where(eq(buildings.missionId, mission.id))
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(errorNeedsOf(mission.id), (found) => found.length > 0),
              LONG,
            )
            return yield* errorNeedsOf(mission.id)
          }),
        ),
      )
      const [need] = seen
      const failed =
        need !== undefined && Predicate.isTagged(need.fields, 'Error') ? need.fields.failed : ''
      expect(failed).toContain('no Workspace')
      expect(failed).not.toContain('Retry starts it again')
    },
  )

  test(
    'a Builder that cannot be spoken to while a red of the final checks waits on it is brought back',
    SLOW,
    async () => {
      let dying = false
      let failing = false
      // The Builder's turns hold before each step while the gate is set.
      let gate: ReturnType<typeof held> | null = null
      const turn = held()
      const { world, run } = ending({
        checks: ({ scope }) => (scope === 'end' ? [RED] : []),
        builder: {
          get steps(): ReadonlyArray<FakeStep> {
            return dying ? [says('Working.'), { does: 'dies' }] : [says('Read.')]
          },
          between: () => gate?.promise ?? Promise.resolve(),
        },
        // Once armed, the next agent to start cannot: its session fails, with no need.
        starting: () =>
          Effect.suspend(() => {
            if (!failing) return Effect.void
            failing = false
            return Effect.fail(new LaunchFailed({ reason: 'the agent could not be spawned' }))
          }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const lineage = sessionsOfLineage(builder.session.lineage)
            yield* builtAll(builder.grantId)
            // The Builder's next turn holds, then dies once let go.
            dying = true
            gate = turn
            yield* documented(world, mission.id)
            // The red of the final checks waits on the Builder, live in its held turn.
            yield* until(
              Effect.map(endAttempts(mission.id), (verdicts) => verdicts.length === 2),
              LONG,
            )
            yield* Effect.sleep('500 millis')
            // Its process dies, and its replacement cannot start.
            failing = true
            turn.release()
            yield* until(
              Effect.map(lineage, (rows) => rows.some((row) => row.state === 'failed')),
              LONG,
            )
            yield* until(
              Effect.map(lineage, (rows) =>
                ['starting', 'working', 'idle'].includes(rows.at(-1)?.state ?? ''),
              ),
              LONG,
            )
            return {
              lineage: yield* lineage,
              view: yield* buildingNow(mission.id),
              needs: (yield* getMission(mission.id)).needs,
            }
          }),
        ),
      ).finally(() => turn.release())
      expect(seen.lineage.map((one) => one.state)).toContain('failed')
      expect(seen.view.phase).toBe('final_checks')
      expect(seen.needs).toEqual([])
    },
  )

  test(
    'a Builder that stops with no need while a special task waits on it is brought back',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const lineage = sessionsOfLineage(builder.session.lineage)
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('export.ts', 'Name the export after CSV.'),
            ])
            yield* specialAvailable(mission.id, 'RV1')
            // RV1 is the Builder's, and the Builder stops with no need of its own.
            yield* endedQuietly(builder.session.id)
            yield* driven(mission.id)
            return { lineage: yield* lineage, view: yield* buildingNow(mission.id) }
          }),
        ),
      )
      expect(seen.lineage.map((one) => one.state)).toEqual(['ended', 'working'])
      expect(seen.view.phase).toBe('special_tasks')
    },
  )

  test(
    'an answer that reaches the Builder once the exit looked at the Workspace sends the exit back, and waits for a turn of the Builder on it',
    SLOW,
    async () => {
      const looking = Deferred.makeUnsafe<void>()
      const answered = Deferred.makeUnsafe<void>()
      let first = true
      const { world, run } = ending({
        // The exit's first look at the Workspace waits until an answer reached the Builder.
        snapshots: (real) => ({
          ...real,
          take: (place, owner) => {
            if (owner.kind !== 'review_exit' || !first) return real.take(place, owner)
            first = false
            return Deferred.succeed(looking, undefined).pipe(
              Effect.andThen(Deferred.await(answered)),
              Effect.andThen(real.take(place, owner)),
            )
          },
        }),
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
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* Deferred.await(looking)
            // An answer the user gave a moment before, stored for the Builder only now.
            const id = yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner: { kind: 'mission', missionId: mission.id },
                target: { role: 'builder' },
                kind: 'answer',
                body: 'The user answered: Comma',
              }),
            )
            yield* Deferred.succeed(answered, undefined)
            // The exit goes back to the Builder, started again to take the answer: its turn ends.
            const lineage = sessionsOfLineage(builder.session.lineage)
            yield* until(
              Effect.map(lineage, (rows) => rows.at(-1)?.state === 'working'),
              LONG,
            )
            yield* until(
              Effect.sync(() => world.agents.length > 0),
              LONG,
            )
            for (const index of world.agents.keys()) world.release(index)
            yield* inReview(mission.id)
            const database = yield* Database
            const [answer] = yield* database
              .select()
              .from(sessionDeliveries)
              .where(eq(sessionDeliveries.id, id))
            const [ended] = yield* database
              .select({ turned: buildings.builderTurnedAt })
              .from(buildings)
              .where(eq(buildings.missionId, mission.id))
            return { answer, turned: ended?.turned ?? null }
          }),
        ),
      )
      expect(seen.answer?.state).toBe('sent')
      expect(seen.turned).not.toBeNull()
      expect((seen.turned ?? '') > (seen.answer?.sentAt ?? '')).toBe(true)
    },
  )

  /** The answers kept for a mission's agents, and the state of its Building. */
  const answersAndBuilding = (missionId: string) =>
    Effect.gen(function* () {
      const database = yield* Database
      const answers = yield* database
        .select()
        .from(sessionDeliveries)
        .where(and(eq(sessionDeliveries.ownerId, missionId), eq(sessionDeliveries.kind, 'answer')))
      const [building] = yield* database
        .select({ state: buildings.state, turned: buildings.builderTurnedAt })
        .from(buildings)
        .where(eq(buildings.missionId, missionId))
      return { answers, building }
    })

  /** The Builder's event follower, held as it takes in an answer once `lagging` is set. */
  const laggingFollower = () => {
    const state = { lagging: false }
    const entered = Deferred.makeUnsafe<void>()
    const behind = held()
    const hold: BuilderHold = (at) =>
      at === 'answering' && state.lagging
        ? Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Effect.promise(() => behind.promise)),
          )
        : Effect.void
    return { state, entered, behind, hold }
  }

  test(
    'an answer applied while the Builder’s event follower lags behind is kept for the Builder before the end can close the Building, and its turn on it is waited for',
    SLOW,
    async () => {
      const follower = laggingFollower()
      const { world, run } = ending({ hold: follower.hold })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* asked(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no question'))
            follower.state.lagging = true
            yield* answerNeed({
              id: need.id,
              answer: ChosenAnswer.make({ option: 'Comma' }),
              key: crypto.randomUUID(),
            })
            // The answer is applied; the follower that acts on it has not taken it in yet.
            yield* Deferred.await(follower.entered)
            // Whatever drives the end meanwhile, it does not close the Building on that answer.
            yield* driven(mission.id)
            const lagged = yield* answersAndBuilding(mission.id)
            follower.behind.release()
            yield* inReview(mission.id)
            return { lagged, after: yield* answersAndBuilding(mission.id) }
          }),
        ),
      ).finally(() => follower.behind.release())
      expect(seen.lagged.building?.state).toBe('active')
      expect(seen.lagged.answers).toHaveLength(1)
      expect(seen.lagged.answers[0]?.body).toContain('The user answered: Comma')
      // One answer, sent to the Builder, and a turn of the Builder ended after it was sent.
      expect(seen.after.answers.map((one) => one.state)).toEqual(['sent'])
      const [answer] = seen.after.answers
      expect((seen.after.building?.turned ?? '') > (answer?.sentAt ?? '~')).toBe(true)
    },
  )

  test(
    'an answer applied right before a stop, its Builder’s event follower behind, reaches the Builder after the start before the end closes the Building',
    SLOW,
    async () => {
      const follower = laggingFollower()
      const before = ending({ hold: follower.hold })
      const left = await before
        .run(({ profile }) =>
          within(
            profile,
            Effect.gen(function* () {
              const { mission } = yield* launched(work, withReadme)
              const builder = yield* builderOf(mission.id)
              yield* builtAll(builder.grantId)
              yield* asked(builder.grantId)
              yield* documented(before.world, mission.id)
              yield* reviewed(before.world, mission.id, 'spec-reviewer')
              yield* reviewed(before.world, mission.id, 'code-reviewer')
              yield* until(
                Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
                LONG,
              )
              const need = (yield* getMission(mission.id)).needs[0]
              if (need === undefined) return yield* Effect.die(new Error('no question'))
              follower.state.lagging = true
              yield* answerNeed({
                id: need.id,
                answer: ChosenAnswer.make({ option: 'Comma' }),
                key: crypto.randomUUID(),
              })
              // Hemera stops with the answer applied and its follower behind.
              yield* Deferred.await(follower.entered)
              return mission
            }),
          ),
        )
        .finally(() => follower.behind.release())
      const after = ending({ resumed: true })
      // Every agent of the start ends its turn as soon as it is given one.
      for (let index = 0; index < 8; index += 1) after.world.release(index)
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* inReview(left.id)
            return {
              kept: yield* answersAndBuilding(left.id),
              prompts: after.world.agents.flatMap((agent) =>
                agent.answers.prompts.map((one) => text(one)),
              ),
            }
          }),
        ),
      )
      expect(seen.kept.answers.map((one) => one.state)).toEqual(['sent'])
      expect(seen.prompts.some((one) => one.includes('The user answered: Comma'))).toBe(true)
      const [answer] = seen.kept.answers
      expect((seen.kept.building?.turned ?? '') > (answer?.sentAt ?? '~')).toBe(true)
    },
  )

  test(
    'an answer given before the end is called, its Builder’s turn on it still running at the refresh, holds the exit until that turn ended',
    SLOW,
    async () => {
      let gate: ReturnType<typeof held> | null = null
      const turn = held()
      const { world, run } = ending({
        builder: {
          steps: [says('Read.')],
          between: () => gate?.promise ?? Promise.resolve(),
        },
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* asked(builder.grantId)
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no question'))
            // The Builder's turn on the answer, before its last task ends, stays open.
            gate = turn
            yield* answerNeed({
              id: need.id,
              answer: ChosenAnswer.make({ option: 'Comma' }),
              key: crypto.randomUUID(),
            })
            yield* until(
              Effect.map(answersAndBuilding(mission.id), (now) =>
                now.answers.some((one) => one.state === 'sent'),
              ),
              LONG,
            )
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            yield* driven(mission.id)
            const waiting = yield* answersAndBuilding(mission.id)
            gate = null
            turn.release()
            yield* inReview(mission.id)
            const [called] = yield* (yield* Database)
              .select({ at: buildings.endCalledAt })
              .from(buildings)
              .where(eq(buildings.missionId, mission.id))
            return {
              called: called?.at ?? '',
              waiting,
              after: yield* answersAndBuilding(mission.id),
            }
          }),
        ),
      ).finally(() => turn.release())
      // Stored before the end was called, and waited on all the same.
      expect((seen.waiting.answers[0]?.createdAt ?? '~') < seen.called).toBe(true)
      expect(seen.waiting.building?.state).toBe('active')
      expect(seen.after.answers.map((one) => one.state)).toEqual(['sent'])
      const [answer] = seen.after.answers
      expect((seen.after.building?.turned ?? '') > (answer?.sentAt ?? '~')).toBe(true)
    },
  )

  test(
    'an answer the user gave at the refresh that is not handed to the Builder yet holds the exit, and reaches the Builder before Review',
    SLOW,
    async () => {
      const handing = held()
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* asked(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no question'))
            // Another round of answers holds the hand-over: this one is answered, not handed yet.
            const owners = yield* NeedOwners
            const other = yield* Semaphore.withPermits(
              owners.delivering,
              1,
            )(Effect.promise(() => handing.promise)).pipe(Effect.forkChild)
            const answering = yield* answerNeed({
              id: need.id,
              answer: ChosenAnswer.make({ option: 'Comma' }),
              key: crypto.randomUUID(),
            }).pipe(Effect.forkChild)
            yield* until(
              Effect.map(getNeed(need.id), (one) => one.state === 'answered'),
              LONG,
            )
            yield* driven(mission.id)
            const lagged = yield* answersAndBuilding(mission.id)
            handing.release()
            yield* Fiber.join(other)
            yield* Fiber.join(answering)
            yield* inReview(mission.id)
            return { lagged, after: yield* answersAndBuilding(mission.id) }
          }),
        ),
      ).finally(() => handing.release())
      expect(seen.lagged.building?.state).toBe('active')
      expect(seen.lagged.answers).toEqual([])
      expect(seen.after.answers.map((one) => one.state)).toEqual(['sent'])
      const [answer] = seen.after.answers
      expect((seen.after.building?.turned ?? '') > (answer?.sentAt ?? '~')).toBe(true)
    },
  )

  test(
    'an answer whose hand-over to the Builder failed is handed over again by the end, which waits for it before Review',
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
            yield* asked(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no question'))
            // The hand-over's write fails once: the answer is kept, not handed over.
            const database = yield* Database
            yield* database.run(sql`CREATE TRIGGER refuse_answers BEFORE INSERT ON session_deliveries
              WHEN NEW.kind = 'answer' BEGIN SELECT RAISE(ABORT, 'refused'); END`)
            yield* answerNeed({
              id: need.id,
              answer: ChosenAnswer.make({ option: 'Comma' }),
              key: crypto.randomUUID(),
            })
            const failed = yield* answersAndBuilding(mission.id)
            yield* database.run(sql`DROP TRIGGER refuse_answers`)
            // Nothing hands it over on its own now: the end, driven, does.
            yield* driven(mission.id)
            yield* inReview(mission.id)
            return { failed, after: yield* answersAndBuilding(mission.id) }
          }),
        ),
      )
      expect(seen.failed.answers).toEqual([])
      expect(seen.after.answers.map((one) => one.state)).toEqual(['sent'])
      const [answer] = seen.after.answers
      expect((seen.after.building?.turned ?? '') > (answer?.sentAt ?? '~')).toBe(true)
    },
  )

  test(
    'an answer the Builder took in the tasks phase, its Builder stopped before the end and impossible to bring back, does not hold the exit: the Building reaches Review',
    SLOW,
    async () => {
      let failing = false
      let gate: ReturnType<typeof held> | null = null
      const turn = held()
      const { world, run } = ending({
        builder: {
          steps: [says('Read.')],
          between: () => gate?.promise ?? Promise.resolve(),
        },
        // Once armed, a Builder's start fails: it cannot be brought back.
        sessionHold: (at, session) =>
          at === 'starting' && failing && session.role === 'builder'
            ? Effect.die(new Error('the provider is down'))
            : Effect.void,
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* asked(builder.grantId)
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no question'))
            yield* answerNeed({
              id: need.id,
              answer: ChosenAnswer.make({ option: 'Comma' }),
              key: crypto.randomUUID(),
            })
            // The Builder takes the answer in the tasks phase and ends its turn on it.
            yield* until(
              Effect.map(answersAndBuilding(mission.id), (now) =>
                now.answers.some((one) => one.state === 'sent'),
              ),
              LONG,
            )
            yield* Sessions.use((sessions) => sessions.settled(builder.session.id))
            // From now on its turns stay open: none ends once the end is called. It finishes the
            // plan, then stops, and cannot be started again.
            gate = turn
            yield* builtAll(builder.grantId)
            yield* endedQuietly(builder.session.id)
            failing = true
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            const errors = Effect.map(getMission(mission.id), (one) =>
              one.needs.filter((found) => Predicate.isTagged(found.fields, 'Error')),
            )
            yield* until(
              Effect.gen(function* () {
                return (
                  (yield* getMission(mission.id)).stage === 'review' || (yield* errors).length > 0
                )
              }),
              LONG,
            )
            return { mission: yield* getMission(mission.id), errors: yield* errors }
          }),
        ),
      ).finally(() => turn.release())
      expect(seen.errors).toEqual([])
      expect(seen.mission.stage).toBe('review')
    },
  )

  /**
   * The Builder's question at the refresh, turned by hand into an answer the hand-over skips, as
   * `changed` rewrites its need; then the end is driven, up to Review.
   */
  const skippedAnswer = (changed: (needId: string) => ReturnType<typeof sql>) => {
    const { world, run } = ending()
    return run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withReadme)
          const builder = yield* builderOf(mission.id)
          yield* builtAll(builder.grantId)
          yield* asked(builder.grantId)
          yield* documented(world, mission.id)
          yield* reviewed(world, mission.id, 'spec-reviewer')
          yield* reviewed(world, mission.id, 'code-reviewer')
          yield* until(
            Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
            LONG,
          )
          const need = (yield* getMission(mission.id)).needs[0]
          if (need === undefined) return yield* Effect.die(new Error('no question'))
          const database = yield* Database
          yield* database.run(sql`UPDATE needs SET state = 'answered',
            answer = '{"_tag":"Chosen","option":"Comma"}', ended_at = ${new Date().toISOString()}
            WHERE id = ${need.id}`)
          yield* database.run(changed(need.id))
          yield* database.insert(needDeliveries).values({ needId: need.id, deliveredAt: null })
          yield* driven(mission.id)
          yield* inReview(mission.id)
          return yield* getMission(mission.id)
        }),
      ),
    )
  }

  test(
    'an answer to a need no service takes, which the hand-over always skips, does not hold the exit',
    SLOW,
    async () => {
      const seen = await skippedAnswer(
        (needId) => sql`UPDATE needs SET service = 'nobody' WHERE id = ${needId}`,
      )
      expect(seen.stage).toBe('review')
    },
  )

  test(
    'an answer to a need this version cannot read, which the hand-over always skips, does not hold the exit',
    SLOW,
    async () => {
      const seen = await skippedAnswer(
        (needId) => sql`UPDATE needs SET fields = '{"_tag":"Unknown"}' WHERE id = ${needId}`,
      )
      expect(seen.stage).toBe('review')
    },
  )

  test(
    'a Retry of the Builder’s environment need at the refresh, its event follower behind, is kept for the Builder before the end can close the Building',
    SLOW,
    async () => {
      const state = { lagging: false }
      const entered = Deferred.makeUnsafe<void>()
      const behind = held()
      const { world, run } = ending({
        hold: (at) =>
          at === 'releasing' && state.lagging
            ? Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Effect.promise(() => behind.promise)),
              )
            : Effect.void,
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* call(builder.grantId, 'report_need', {
              kind: 'environment',
              text: 'The staging database is down.',
              tasks: [],
            })
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no need'))
            state.lagging = true
            yield* retryNeed(need.id)
            // The need is withdrawn; the follower that tells the Builder has not taken it in yet.
            yield* Deferred.await(entered)
            yield* driven(mission.id)
            const lagged = yield* answersAndBuilding(mission.id)
            behind.release()
            yield* inReview(mission.id)
            return { lagged, after: yield* answersAndBuilding(mission.id) }
          }),
        ),
      ).finally(() => behind.release())
      expect(seen.lagged.building?.state).toBe('active')
      expect(seen.lagged.answers).toHaveLength(1)
      expect(seen.lagged.answers[0]?.body).toContain('The user says it is fixed')
      expect(seen.after.answers.map((one) => one.state)).toEqual(['sent'])
      const [answer] = seen.after.answers
      expect((seen.after.building?.turned ?? '') > (answer?.sentAt ?? '~')).toBe(true)
    },
  )

  test(
    'a Builder the user’s Retry starts again after the exit marked the mission runs the calls the user allowed',
    SLOW,
    async () => {
      let limiting = false
      const limit: FakeStep = { does: 'limits', title: 'The Acme account has no available quota.' }
      const { run } = ending({
        builder: {
          get steps() {
            return limiting ? [limit] : [says('Read.')]
          },
        },
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const owner = { kind: 'mission', missionId: mission.id } as const
            // The Builder's next turn meets the provider's limit: its session ends, the user is asked.
            limiting = true
            yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner,
                target: { lineage: builder.session.lineage },
                kind: 'note',
                body: 'One more thing.',
              }),
            )
            const limitNeed = Effect.map(getMission(mission.id), (one) =>
              one.needs.find(
                (need) =>
                  Predicate.isTagged(need.fields, 'Environment') &&
                  need.fields.missing.includes('provider limit'),
              ),
            )
            yield* until(
              Effect.map(limitNeed, (found) => found !== undefined),
              LONG,
            )
            limiting = false
            // The exit marked the mission as its tree stopped, then asked for the Builder back, as
            // it does on a question raised meanwhile: the Builder waits on its own need.
            yield* ToolAccess.use((access) => access.exiting(mission.id, [builder.session.lineage]))
            yield* BuildDesk.use((desk) => desk.ensureBuilder(mission.id))
            // The user's Retry of that need starts the Builder again, through the sessions.
            yield* retryNeed((yield* limitNeed)?.id ?? '')
            yield* until(
              Effect.map(sessionsIn(['working', 'idle'], owner), (rows) =>
                rows.some((row) => row.role === 'builder'),
              ),
              LONG,
            )
            return {
              allowed: yield* ToolAccess.use((access) =>
                access.counted(
                  { missionId: mission.id, lineage: builder.session.lineage },
                  Effect.succeed('ran'),
                ),
              ),
            }
          }),
        ),
      )
      expect(seen.allowed).toBe('ran')
    },
  )

  test(
    'an answer to the Builder’s question holds the exit until a turn of the Builder on it ended',
    SLOW,
    async () => {
      // The Builder's turns hold on the gate set when they start, until the test lets it go.
      let gate: ReturnType<typeof held> | null = null
      const first = held()
      const second = held()
      const { world, run } = ending({
        builder: {
          steps: [says('Read.')],
          between: () => gate?.promise ?? Promise.resolve(),
        },
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const database = yield* Database
            const answers = Effect.map(
              database
                .select()
                .from(sessionDeliveries)
                .where(
                  and(
                    eq(sessionDeliveries.ownerId, mission.id),
                    eq(sessionDeliveries.kind, 'answer'),
                  ),
                ),
              (rows) => rows.map((row) => row.state),
            )
            const stage = Effect.map(getMission(mission.id), (one) => one.stage)
            yield* builtAll(builder.grantId)
            yield* asked(builder.grantId)
            // The Builder is in a long turn: what is delivered between turns waits for its end.
            gate = first
            yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner: { kind: 'mission', missionId: mission.id },
                target: { lineage: builder.session.lineage },
                kind: 'note',
                body: 'One more thing.',
              }),
            )
            yield* until(
              Effect.map(getSession(builder.session.id), (session) => session.state === 'working'),
              LONG,
            )
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no question'))
            yield* answerNeed({
              id: need.id,
              answer: ChosenAnswer.make({ option: 'Comma' }),
              key: crypto.randomUUID(),
            })
            yield* until(
              Effect.map(answers, (rows) => rows.length > 0),
              LONG,
            )
            // Long enough for an exit to have run.
            yield* Effect.sleep('1 second')
            const queued = { stage: yield* stage, answers: yield* answers }
            // The long turn ends; the next one takes the answer, and holds in turn.
            gate = second
            first.release()
            yield* until(
              Effect.map(answers, (rows) => rows.includes('sent')),
              LONG,
            )
            yield* Effect.sleep('1 second')
            const taken = { stage: yield* stage, answers: yield* answers }
            gate = null
            second.release()
            yield* inReview(mission.id)
            return { queued, taken }
          }),
        ),
      ).finally(() => {
        first.release()
        second.release()
      })
      expect(seen.queued).toEqual({ stage: 'building', answers: ['queued'] })
      expect(seen.taken).toEqual({ stage: 'building', answers: ['sent'] })
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

  test(
    'a restart while a reviewer runs and three sub-agents hold the cap: the rebuilt reviewer waits for a slot',
    SLOW,
    async () => {
      const before = ending()
      const left = await before.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { project, mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const limits = yield* projectLimits(project.id)
            yield* setProjectLimits(project.id, { ...limits, cap: 6 })
            yield* builtAll(builder.grantId)
            const owner = { kind: 'mission' as const, missionId: mission.id }
            const helpers: string[] = []
            for (const _ of [1, 2, 3]) {
              const helper = yield* Sessions.use((sessions) =>
                sessions.open({
                  owner,
                  role: 'helper',
                  folder: builder.session.folder,
                  requestedBy: 'agent',
                }),
              )
              helpers.push(helper.lineage)
            }
            yield* documented(before.world, mission.id)
            yield* reviewing(mission.id)
            // The cap lowered while the engine was stopped: three slots for five sessions.
            yield* setProjectLimits(project.id, { ...limits, cap: 3 })
            return { mission, helpers }
          }),
        ),
      )
      // The reviewers start only once the three sub-agents hold every slot.
      const reviewersHeld = held()
      const after = ending({
        resumed: true,
        sessionHold: (at, session) =>
          at === 'starting' && REVIEWERS.some((one) => one === session.role)
            ? Effect.promise(() => reviewersHeld.promise)
            : Effect.void,
      })
      const missionId = left.mission.id
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const live = Effect.map(
              sessionsIn(['starting', 'working', 'idle'], { kind: 'mission', missionId }),
              (rows) => rows.filter((row) => row.role !== 'builder'),
            )
            const running = Effect.map(live, (rows) =>
              rows.filter((row) => row.state !== 'starting'),
            )
            yield* until(
              Effect.map(
                running,
                (rows) => rows.filter((row) => row.role === 'helper').length === 3,
              ),
              LONG,
            )
            reviewersHeld.release()
            const now = Memory.use((memory) => memory.now(missionId))
            yield* until(
              Effect.map(now, (state) => state.slotWait !== null),
              LONG,
            )
            // Long enough for a reviewer that took no slot to start working.
            yield* Effect.sleep('1 second')
            const full = { now: yield* now, live: yield* live, running: yield* running }
            yield* Sessions.use((sessions) => sessions.end(left.helpers[0] ?? '', 'done'))
            yield* until(
              Effect.map(running, (rows) =>
                rows.some((row) => REVIEWERS.some((one) => one === row.role)),
              ),
              LONG,
            )
            yield* Effect.sleep('1 second')
            return { full, freed: yield* running }
          }),
        ),
      )
      expect(seen.full.live.filter((row) => row.role !== 'helper').map((row) => row.state)).toEqual(
        ['starting', 'starting'],
      )
      expect(seen.full.running.map((row) => row.role)).toEqual(['helper', 'helper', 'helper'])
      expect(seen.full.now.slotWait).toContain('3 of 3 in use')
      // A slot freed: one reviewer takes it, never more than the cap.
      expect(seen.freed).toHaveLength(3)
      expect(seen.freed.filter((row) => row.role === 'helper')).toHaveLength(2)
    },
  )

  test(
    'a restart while one pass runs, the other waits for its slot, and three sub-agents hold the cap: never more agents than the cap',
    SLOW,
    async () => {
      const before = ending()
      const left = await before.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { project, mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const limits = yield* projectLimits(project.id)
            yield* setProjectLimits(project.id, { ...limits, cap: 4 })
            yield* builtAll(builder.grantId)
            yield* agentOf(before.world, mission.id, 'documenter')
            const owner = { kind: 'mission' as const, missionId: mission.id }
            for (const _ of [1, 2, 3]) {
              yield* Sessions.use((sessions) =>
                sessions.open({
                  owner,
                  role: 'helper',
                  folder: builder.session.folder,
                  requestedBy: 'agent',
                }),
              )
            }
            yield* documented(before.world, mission.id)
            // The documenter's slot goes to one reviewer; the other waits for one.
            yield* until(
              Effect.map(
                autoReviewOf(mission.id),
                (review) =>
                  (review?.passes.map((one) => one.state).toSorted() ?? []).join() ===
                  'running,waiting',
              ),
              LONG,
            )
            yield* setProjectLimits(project.id, { ...limits, cap: 3 })
            return mission
          }),
        ),
      )
      const after = ending({ resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const running = Effect.map(
              sessionsIn(['working', 'idle'], { kind: 'mission', missionId: left.id }),
              (rows) => rows.filter((row) => row.role !== 'builder'),
            )
            // Every look from the start: the most agents seen running at once.
            let most = 0
            const look = Effect.map(running, (rows) => {
              most = Math.max(most, rows.length)
              return rows
            })
            yield* until(
              Effect.map(look, (rows) => rows.length === 3),
              LONG,
            )
            for (const _ of Array.from({ length: 50 })) {
              yield* look
              yield* Effect.sleep('20 millis')
            }
            const full = yield* running
            const passes = (yield* autoReviewOf(left.id))?.passes ?? []
            const first = full[0]
            if (first === undefined) return yield* Effect.die(new Error('nothing runs'))
            yield* Sessions.use((sessions) => sessions.end(first.lineage, 'done'))
            yield* until(
              Effect.map(
                look,
                (rows) => rows.length === 3 && !rows.some((row) => row.id === first.id),
              ),
              LONG,
            )
            for (const _ of Array.from({ length: 50 })) {
              yield* look
              yield* Effect.sleep('20 millis')
            }
            return { most, full, passes, freed: yield* running }
          }),
        ),
      )
      expect(seen.most).toBe(3)
      expect(seen.full).toHaveLength(3)
      expect(seen.freed).toHaveLength(3)
      // No pass is recorded again for the restart.
      expect(seen.passes).toHaveLength(2)
    },
  )
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

describe('What the review read is kept', () => {
  test(
    'retention run over a finished Building keeps its review checkpoint, and the database refuses to drop it',
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
            const database = yield* Database
            // The mission is over: nothing of it is live for the sweep any more.
            yield* database
              .update(missions)
              .set({ stage: 'done' })
              .where(eq(missions.id, mission.id))
            const [building] = yield* database
              .select()
              .from(buildings)
              .where(eq(buildings.missionId, mission.id))
            const kept = building?.reviewCheckpointId ?? ''
            const filesOf = database
              .select()
              .from(checkpointFiles)
              .where(eq(checkpointFiles.checkpointId, kept))
            const before = yield* filesOf
            // Retention driven a year ahead, its total bound at nothing: all it may sweep goes.
            const swept = yield* sweepDiagnostics(data, {
              now: Date.now() + 365 * 24 * 60 * 60 * 1000,
              maxTotalBytes: 0,
            })
            const dropped = yield* Effect.exit(
              database.delete(checkpoints).where(eq(checkpoints.id, kept)),
            )
            return {
              kept,
              swept,
              before,
              after: yield* filesOf,
              checkpoints: yield* database
                .select()
                .from(checkpoints)
                .where(eq(checkpoints.id, kept)),
              passes: yield* database
                .select()
                .from(reviewPasses)
                .where(eq(reviewPasses.missionId, mission.id)),
              dropped,
            }
          }),
        ),
      )
      expect(seen.swept.runs.length + seen.swept.threads.length).toBeGreaterThan(0)
      expect(seen.checkpoints).toHaveLength(1)
      expect(seen.before.length).toBeGreaterThan(0)
      expect(seen.after).toEqual(seen.before)
      expect(seen.passes.map((one) => one.checkpointId)).toEqual([seen.kept, seen.kept])
      // A review pass and the Building point to it: the database itself refuses to drop it.
      expect(Exit.isFailure(seen.dropped)).toBe(true)
    },
  )
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

  test(
    'a restart between the checkpoint’s taking and its saving: one review checkpoint for the Building, no orphan',
    SLOW,
    async () => {
      const taken = held()
      const before = ending({
        // The engine stops once the review checkpoint is taken, before the end moves on.
        endHold: (at) =>
          at === 'checkpoint_taken'
            ? Effect.andThen(
                Effect.sync(() => taken.release()),
                Effect.never,
              )
            : Effect.void,
      })
      const left = await before.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(before.world, mission.id)
            yield* Effect.promise(() => taken.promise)
            return mission
          }),
        ),
      )
      const after = ending({ resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* reviewed(after.world, left.id, 'spec-reviewer')
            yield* reviewed(after.world, left.id, 'code-reviewer')
            yield* inReview(left.id)
            const database = yield* Database
            return {
              checkpoints: yield* database
                .select()
                .from(checkpoints)
                .where(and(eq(checkpoints.missionId, left.id), eq(checkpoints.kind, 'review'))),
              buildings: yield* database
                .select()
                .from(buildings)
                .where(eq(buildings.missionId, left.id)),
              passes: yield* database.select().from(reviewPasses),
            }
          }),
        ),
      )
      expect(seen.checkpoints).toHaveLength(1)
      const [checkpoint] = seen.checkpoints
      expect(seen.buildings.map((one) => one.reviewCheckpointId)).toEqual([checkpoint?.id])
      expect(seen.passes.map((one) => one.checkpointId)).toEqual([checkpoint?.id, checkpoint?.id])
    },
  )

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
    'after a restart, a stopped Builder a red of the final checks waits on is brought back only once the start settled what the stop left',
    SLOW,
    async () => {
      const checks: ChecksOf = ({ scope }) => (scope === 'end' ? [RED] : [])
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
              // The Builder stops with no need of its own before the engine does.
              yield* Database.use((database) =>
                database
                  .update(agentSessions)
                  .set({ state: 'ended', stateReason: null, endedAt: new Date().toISOString() })
                  .where(eq(agentSessions.id, builder.session.id)),
              )
              return { mission, lineage: builder.session.lineage }
            }),
          ),
        )
        .finally(() => turn.release())
      // Started again, the start's resume is held before it settles what the stop left.
      const settling = held()
      const after = ending({
        checks,
        resumed: true,
        hold: (at) => (at === 'resuming' ? Effect.promise(() => settling.promise) : Effect.void),
      })
      const seen = await after
        .run(({ profile }) =>
          within(
            profile,
            Effect.gen(function* () {
              const lineage = sessionsOfLineage(left.lineage)
              // Long enough for the end, driven at the start, to have brought it back.
              yield* Effect.sleep('2 seconds')
              const waited = yield* lineage
              settling.release()
              yield* until(
                Effect.map(lineage, (rows) =>
                  ['starting', 'working', 'idle'].includes(rows.at(-1)?.state ?? ''),
                ),
                LONG,
              )
              return { waited, lineage: yield* lineage }
            }),
          ),
        )
        .finally(() => settling.release())
      expect(seen.waited.map((one) => one.state)).toEqual(['ended'])
      expect(seen.lineage).toHaveLength(2)
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
    'a Builder resume that lands between the exit’s stops and its commit sends the commit back, and the exit runs again',
    SLOW,
    async () => {
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
      // Started again, the Builder's resume reads the end's step while the reviewers run, then is
      // held until the exit's stops are done: it brings the Builder back between them and the
      // commit, and the exit's first look at the Workspace waits for it.
      const stopped = held()
      const resumed = held()
      let exits = 0
      const after = ending({
        resumed: true,
        hold: (at) => {
          if (at === 'bringing') return Effect.promise(() => stopped.promise)
          if (at === 'resumed') return Effect.sync(() => resumed.release())
          return Effect.void
        },
        snapshots: (real) => ({
          ...real,
          take: (place, owner) => {
            if (owner.kind !== 'review_exit') return real.take(place, owner)
            exits += 1
            if (exits > 1) return real.take(place, owner)
            stopped.release()
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
            yield* reviewed(after.world, left.id, 'spec-reviewer')
            yield* reviewed(after.world, left.id, 'code-reviewer')
            yield* inReview(left.id)
            return {
              live: yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], {
                kind: 'mission',
                missionId: left.id,
              }),
              types: yield* typesOf(left.id),
            }
          }),
        ),
      )
      // The commit went back once: the exit stopped the resumed Builder and looked again.
      expect(exits).toBe(2)
      expect(seen.live.map((one) => one.role)).toEqual([])
      expect(seen.types.filter((type) => type === 'building.ended')).toHaveLength(1)
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

  test(
    'a Builder resume that reaches the sessions once the exit moved the mission to Review starts nothing',
    SLOW,
    async () => {
      const engine = ending()
      const seen = await engine.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(engine.world, mission.id)
            yield* reviewed(engine.world, mission.id, 'spec-reviewer')
            yield* reviewed(engine.world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            // A start-up resume that read the Building before the exit's stops reaches the
            // sessions only now: the exit's commit is in.
            const rows = yield* sessionsOfLineage(builder.session.lineage)
            const resumed = yield* Sessions.use((sessions) =>
              sessions.resume(rows.at(-1)?.id ?? ''),
            )
            return {
              resumed,
              live: yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], {
                kind: 'mission',
                missionId: mission.id,
              }),
            }
          }),
        ),
      )
      expect(seen.resumed).toBeNull()
      expect(seen.live.map((one) => one.role)).toEqual([])
    },
  )

  test(
    'a restart that finds the Builder live once the mission is in Review ends it and starts no successor',
    SLOW,
    async () => {
      const before = ending()
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
            yield* inReview(mission.id)
            // What a restart reads when it took the live sessions before the exit stopped the
            // tree, and replaces them only after the exit's commit: the Builder still live.
            const rows = yield* sessionsOfLineage(builder.session.lineage)
            const database = yield* Database
            yield* database
              .update(agentSessions)
              .set({ state: 'idle', stateReason: null, endedAt: null })
              .where(eq(agentSessions.id, rows.at(-1)?.id ?? ''))
            return { mission, lineage: builder.session.lineage, sessions: rows.length }
          }),
        ),
      )
      const after = ending({ resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const lineage = sessionsOfLineage(left.lineage)
            yield* until(
              Effect.map(lineage, (rows) =>
                rows.every((one) => !['starting', 'working', 'idle', 'stuck'].includes(one.state)),
              ),
              LONG,
            )
            return {
              lineage: yield* lineage,
              live: yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], {
                kind: 'mission',
                missionId: left.mission.id,
              }),
            }
          }),
        ),
      )
      expect(seen.live.map((one) => one.role)).toEqual([])
      expect(seen.lineage).toHaveLength(left.sessions)
    },
  )
})
