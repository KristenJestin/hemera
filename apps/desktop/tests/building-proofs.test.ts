/**
 * Red first, then green (#144): Hemera writes each automated scenario's test into the Workspace at
 * the Building's start, runs it before any task and judges its red (CT-35, CT-37), holds the tasks
 * covering a scenario until its red is recorded, runs it green once those tasks are done, marks it
 * to run again when its repository moves (CT-38), and keeps the user's verdict on a scenario
 * verified by hand (CT-36).
 *
 * On the engine as it starts, with the fake agent of #32 as every agent, the test driving the
 * Builder's tools through its grant; Acme's real repositories in temporary folders as the
 * Workspace, and real `node --test` files as the proofs.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { ChosenAnswer, WrittenAnswer } from '@hemera/core/domain'
import { and, eq } from 'drizzle-orm'
import {
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Predicate,
  Schema,
  Semaphore,
} from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript } from '../src/engine/agents/fake.ts'
import {
  BuildingEnd,
  type BuilderHold,
  builderLayer,
  buildingOf,
} from '../src/engine/building/builder.ts'
import { BuildDesk } from '../src/engine/building/desk.ts'
import { OutsideChanges, type OutsideSettings } from '../src/engine/building/outside.ts'
import { SnapshotFailed, type SnapshotsService } from '../src/engine/building/snapshots.ts'
import {
  ACCEPT_RED,
  CANCEL_MISSION,
  END_WITHOUT,
  NOT_REPRODUCIBLE,
  SEND_BACK,
  TRY_AGAIN,
  judgeManual,
  proofsRead,
} from '../src/engine/building/proofs.ts'
import { readEvidence } from '../src/engine/memory/evidence.ts'
import { getMission } from '../src/engine/missions.ts'
import { NeedOwners, answerNeed, expireNeed, getNeed, retryNeed } from '../src/engine/needs.ts'
import { PROOF_LIMIT, proofLimitFor } from '../src/engine/building/proof-runner.ts'
import { saveCheck, setProofLimit } from '../src/engine/project-checks.ts'
import { saveCommand } from '../src/engine/catalogue.ts'
import { Runs } from '../src/engine/runs.ts'
import { Database } from '../src/engine/storage/database.ts'
import { mutate } from '../src/engine/transaction.ts'
import { activeBuildingIn, decisionsIn, tasksIn } from '../src/engine/building/tasks.ts'
import {
  buildingAttempts,
  buildingDecisions,
  buildingTasks,
  commandRuns,
  scenarioProofs,
  sessionDeliveries,
} from '../src/engine/storage/schema.ts'
import { QUIET, READING, call, eventsOf } from './building-world.ts'
import { PLAN, builderAgents, builderOf, buildingNow, launched, taskIn } from './builder-world.ts'
import { git } from './repositories.ts'
import { HELPER, sessionsEngine, until, within } from './sessions-world.ts'
import { ALLOW, verdictsSaying } from './tools-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string
let scratch: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('building-proofs'))
  work = realpathSync.native(temporaryFolder('building-proofs-work'))
  scratch = realpathSync.native(temporaryFolder('building-proofs-scratch'))
})
afterEach(removeFolders)

/** The engine with the Builder of this version, and every call the agents make allowed. */
const proofsEngine = (
  dataFolder: string,
  hold: BuilderHold = () => Effect.void,
  end?: Layer.Layer<BuildingEnd>,
  agents: (index: number) => FakeScript = builderAgents,
  more: {
    /** How long a proof may run (#290). */
    readonly proofLimit?: Duration.Duration
    /** How long a minute of the Project's limit lasts (#321). */
    readonly proofMinute?: Duration.Duration
    /** The snapshot service as the suite sees it, wrapped around the real one. */
    readonly snapshots?: (real: SnapshotsService) => SnapshotsService
    /** The detector of changes outside Hemera's timers. */
    readonly outside?: Partial<OutsideSettings>
  } = {},
) =>
  sessionsEngine(dataFolder, agents, {
    roles: [HELPER],
    tools: { home: work, verdicts: verdictsSaying(() => ALLOW).layer },
    snapshots: more.snapshots ?? ((real) => real),
    building:
      end === undefined
        ? {
            hold,
            proofLimit: more.proofLimit,
            proofMinute: more.proofMinute,
            outside: more.outside ?? {},
          }
        : {
            hold,
            end,
            proofLimit: more.proofLimit,
            proofMinute: more.proofMinute,
            outside: more.outside ?? {},
          },
  })

/**
 * A Builder still at work: once `busy` is called, the turn it is in or starts next stays open until
 * the test ends, so it can always act on what it is told.
 */
const busyBuilder = () => {
  let busy = false
  const never = new Promise<void>(() => undefined)
  return {
    agents: (index: number): FakeScript =>
      index === 0 ? READING : { ...QUIET, between: () => (busy ? never : Promise.resolve()) },
    busy: Effect.sync(() => {
      busy = true
    }),
  }
}

/** The mission launched with these Proof blocks (every other one by hand), and this plan. */
const launchedWith = (
  proofs: (api: string) => Readonly<Record<string, Schema.JsonObject>>,
  plan: ReadonlyArray<(typeof PLAN)[number]> = PLAN,
) => launched(work, undefined, undefined, plan, undefined, undefined, proofs)

/** What runs a test file of `api`, its report in TAP whatever the terminal. */
const testLine = (path: string) => `"${process.execPath}" --test --test-reporter=tap ${path}`

/** An automated proof whose test is a new file of `api`. */
const automated = (
  path: string,
  code: string,
  more: Schema.JsonObject = {},
): Schema.JsonObject => ({
  mode: 'automated',
  actions: ['Run the test'],
  starting_data: 'None.',
  expected: 'The assertion of the test holds.',
  test: { repository: 'api', path, code, insertion: 'new_file', command: testLine(path) },
  seen_today: false,
  ...more,
})

/** A `node --test` file of one test whose body is `body`. */
const testFile = (body: string, imports: ReadonlyArray<string> = []) =>
  [
    "import { test } from 'node:test'",
    "import assert from 'node:assert/strict'",
    "import { appendFileSync, existsSync, readFileSync } from 'node:fs'",
    ...imports,
    '',
    "test('the scenario holds', async () => {",
    body,
    '})',
    '',
  ].join('\n')

/** R1.S2's test: red until `api/export.ts` exists, which T2 creates. */
const EXPORT_PATH = 'tests/export.test.mjs'
const EXPORT_TEST = testFile(
  "  assert.equal(existsSync(new URL('../export.ts', import.meta.url)), true, 'export.ts exports nothing yet')",
)
const exportProof = () => ({ 'R1.S2': automated(EXPORT_PATH, EXPORT_TEST) })

/** R1.S2's test: red until `api/export.ts` exports `toMarkdown`. */
const MARKDOWN_TEST = testFile(
  [
    "  const file = new URL('../export.ts', import.meta.url)",
    "  assert.ok(existsSync(file) && readFileSync(file, 'utf8').includes('toMarkdown'), 'export.ts has no toMarkdown')",
  ].join('\n'),
)
const markdownProof = () => ({ 'R1.S2': automated(EXPORT_PATH, MARKDOWN_TEST) })
const WRONG_EXPORT = 'export const toCsv = () => ""\n'
const RIGHT_EXPORT = 'export const toMarkdown = () => ""\n'

/** A test that notes each run in `log`, waits for `release` when it names one, then fails. */
const loggedTest = (log: string, release: string | null = null) =>
  testFile(
    [
      `  appendFileSync(${JSON.stringify(log)}, 'ran\\n')`,
      release === null
        ? ''
        : `  while (!existsSync(${JSON.stringify(release)})) await new Promise((done) => setTimeout(done, 20))`,
      "  assert.fail('not built yet')",
    ].join('\n'),
  )

/** How many times a logged test ran. */
const runsIn = (log: string) =>
  existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').length : 0

/** The mission's proofs, as the page reads them, once its Building exists. */
const proofsOf = (missionId: string) =>
  Effect.gen(function* () {
    yield* buildingNow(missionId)
    const view = yield* proofsRead(missionId)
    if (view === null) return yield* Effect.die(new Error('no Building'))
    return view
  })

/** A scenario's proof, as the page reads it. */
const proofOf = (missionId: string, scenario: string) =>
  Effect.gen(function* () {
    const found = (yield* proofsOf(missionId)).scenarios.find((one) => one.scenario === scenario)
    if (found === undefined) return yield* Effect.die(new Error(`no proof of ${scenario}`))
    return found
  })

/** Waits until a scenario's proof is in a state. */
const proofIn = (missionId: string, scenario: string, state: string) =>
  until(
    Effect.map(proofOf(missionId, scenario), (proof) => proof.state === state),
    20_000,
  )

/** The attempts on a scenario's proof, as Hemera keeps them; on every proof for null. */
const proofAttemptsOf = (scenario: string | null) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(buildingAttempts)
      .where(
        and(
          eq(buildingAttempts.scope, 'proof'),
          scenario === null ? undefined : eq(buildingAttempts.subject, scenario),
        ),
      )
  })

/** Everything delivered to the mission's sessions (the Builder), once something says `start`. */
const deliveredTo = (missionId: string, start: string) =>
  Effect.gen(function* () {
    const bodies = Effect.gen(function* () {
      const database = yield* Database
      const rows = yield* database
        .select({ body: sessionDeliveries.body })
        .from(sessionDeliveries)
        .where(
          and(eq(sessionDeliveries.ownerKind, 'mission'), eq(sessionDeliveries.ownerId, missionId)),
        )
      return rows.map((row) => row.body).join('\n')
    })
    yield* until(Effect.map(bodies, (all) => all.includes(start)))
    return yield* bodies
  })

/** The mission's need of one kind, once there is one. */
const needOf = (missionId: string, tag: 'Decision' | 'Environment' | 'Error') =>
  Effect.gen(function* () {
    const found = Effect.map(getMission(missionId), (mission) =>
      mission.needs.find((need) => Predicate.isTagged(need.fields, tag)),
    )
    yield* until(
      Effect.map(found, (need) => need !== undefined),
      20_000,
    )
    const need = yield* found
    if (need === undefined) return yield* Effect.die(new Error('no need'))
    return need
  })

/** The payloads of the mission's events of a type. */
const payloadsOf = (missionId: string, type: string) =>
  Effect.map(eventsOf(missionId, type), (rows) => rows.map((row) => JSON.parse(row.payload)))

/** The Workspace's `api` folder. */
const apiOf = (missionId: string) =>
  Effect.map(
    buildingNow(missionId),
    (view) => view.repositories.find((one) => one.name === 'api')?.folder ?? '',
  )

/** Starts a task, writes its files in `api`, and finishes it. */
const builds = (grantId: string, taskId: string, writes: ReadonlyArray<[string, string]> = []) =>
  Effect.gen(function* () {
    yield* call(grantId, 'task_start', { task: taskId })
    for (const [path, content] of writes) {
      yield* call(grantId, 'fs_read', { repository: 'api', path })
      yield* call(grantId, 'fs_write', { repository: 'api', path, content })
    }
    return yield* call(grantId, 'task_finished', { task: taskId, summary: `${taskId} built.` })
  })

/** A port nothing listens on: taken, then let go. */
const closedPort = () =>
  new Promise<number>((done) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(
        server.address(),
      )
      server.close(() => done(port))
    })
  })

/** `api`'s test file at the base, and the test a proof adds at its end. */
const EXISTING_PATH = 'tests/invoices.test.mjs'
const EXISTING = testFile("  assert.equal(1, 1, 'one is one')")
const ADDED = [
  '',
  "test('the invoices export as Markdown', () => {",
  "  assert.equal(existsSync(new URL('../export.ts', import.meta.url)), true, 'export.ts exports nothing yet')",
  '})',
  '',
].join('\n')
const WITH_ADDITION = `${EXISTING}${ADDED}`

/**
 * `api` with its test file committed and pushed, the base of the Freeze; answers the proof that
 * adds R1.S2's test to it, its patch made by Git against that commit.
 */
const withExisting = (api: string, existing = EXISTING, addition = ADDED): Schema.JsonObject => {
  const added = `${existing}${addition}`
  mkdirSync(join(api, 'tests'), { recursive: true })
  writeFileSync(join(api, EXISTING_PATH), existing)
  git(api, 'add', '.')
  git(api, 'commit', '-q', '-m', 'tests')
  git(api, 'push', '-q', 'origin', 'main')
  git(api, 'fetch', '-q', 'origin')
  writeFileSync(join(api, EXISTING_PATH), added)
  // The helper trims what Git prints: a patch ends with its newline.
  const patch = `${git(api, 'diff', '--', EXISTING_PATH)}\n`
  git(api, 'checkout', '-q', '--', EXISTING_PATH)
  return automated(EXISTING_PATH, added, {
    test: {
      repository: 'api',
      path: EXISTING_PATH,
      code: added,
      insertion: 'addition',
      patch,
      against: git(api, 'rev-parse', 'HEAD').trim(),
      command: testLine(EXISTING_PATH),
    },
  })
}

describe('The proofs written into the Workspace (CT-37)', () => {
  test('a proof in a new file is written whole', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(exportProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const api = yield* apiOf(mission.id)
          return {
            written: readFileSync(join(api, EXPORT_PATH), 'utf8'),
            events: yield* payloadsOf(mission.id, 'building.proofs_written'),
          }
        }),
      ),
    )
    expect(seen.written).toBe(EXPORT_TEST)
    expect(seen.events).toEqual([{ scenarios: ['R1.S2'], conflicts: [] }])
  })

  test('an addition merges cleanly into an existing test file', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith((api) => ({
            'R1.S2': withExisting(api),
          }))
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const api = yield* apiOf(mission.id)
          return { merged: readFileSync(join(api, EXISTING_PATH), 'utf8') }
        }),
      ),
    )
    // A Windows checkout keeps its CRLF lines through the merge (git.test.ts covers it).
    expect(seen.merged.replaceAll('\r\n', '\n')).toBe(WITH_ADDITION)
  })

  test('an addition against a file changed since the Freeze conflicts, writes nothing, and gives the Builder an attempt with the three versions', async () => {
    const reached = Deferred.makeUnsafe<void>()
    const go = Deferred.makeUnsafe<void>()
    const hold: BuilderHold = (at) =>
      at === 'proving'
        ? Effect.andThen(Deferred.succeed(reached, undefined), Deferred.await(go))
        : Effect.void
    const theirs = `${EXISTING}\ntest('another', () => {})\n`
    const seen = await proofsEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith((api) => ({
            'R1.S2': withExisting(api),
          }))
          yield* Deferred.await(reached)
          // Someone changed the file in the Workspace, where the test goes, since the Freeze.
          const api = yield* apiOf(mission.id)
          writeFileSync(join(api, EXISTING_PATH), theirs)
          yield* Deferred.succeed(go, undefined)
          const { grantId } = yield* builderOf(mission.id)
          const delivered = yield* deliveredTo(mission.id, 'Integrate the test by hand')
          const evidenceId = /\(evidence ([0-9a-f-]+)\)/.exec(delivered)?.[1] ?? ''
          const evidence = yield* readEvidence(mission.id, evidenceId)
          return {
            versions: new TextDecoder().decode(evidence.bytes),
            file: readFileSync(join(api, EXISTING_PATH), 'utf8'),
            attempts: yield* proofAttemptsOf('R1.S2'),
            delivered,
            proof: yield* proofOf(mission.id, 'R1.S2'),
            events: yield* payloadsOf(mission.id, 'building.proofs_written'),
            started: yield* call(grantId, 'task_start', { task: 'T2' }),
          }
        }),
      ),
    )
    expect(seen.file).toBe(theirs)
    expect(seen.events).toEqual([{ scenarios: [], conflicts: ['R1.S2'] }])
    expect(seen.attempts.map((one) => [one.number, one.verdict])).toEqual([[1, 'red']])
    expect(seen.delivered).toContain('changed since the Freeze and the test')
    // The three versions, whole, in the evidence the attempt names.
    expect(seen.versions).toContain(`## api/${EXISTING_PATH} at the Freeze\n\n\`\`\`\n${EXISTING}`)
    expect(seen.versions).toContain(`## api/${EXISTING_PATH} in the Workspace\n\n\`\`\`\n${theirs}`)
    expect(seen.versions).toContain(
      `## api/${EXISTING_PATH} with the proof's addition\n\n\`\`\`\n${WITH_ADDITION}`,
    )
    expect(seen.proof.state).toBe('waiting_red')
    expect(seen.started).toContain('waits for the red of R1.S2')
  })
})

describe('The red phase (CT-35)', () => {
  test('an assertion of the expected result that fails records the red', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(exportProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          yield* taskIn(mission.id, 'T2', 'available')
          return {
            proof: yield* proofOf(mission.id, 'R1.S2'),
            events: yield* payloadsOf(mission.id, 'building.red_recorded'),
          }
        }),
      ),
    )
    expect(seen.proof.red).toMatchObject({
      phase: 'red',
      classification: 'assertion_failed',
      testPath: `api/${EXPORT_PATH}`,
    })
    expect(seen.proof.red?.evidenceId).not.toBeNull()
    expect(seen.proof.red?.testEvidenceId).not.toBeNull()
    expect(seen.events).toEqual([{ scenario: 'R1.S2' }])
  })

  test('a compilation error is error_before_test and comes back as an attempt', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(EXPORT_PATH, testFile('  const = 1')),
          }))
          const delivered = yield* deliveredTo(mission.id, 'Fix the setup')
          return {
            delivered,
            proof: yield* proofsOf(mission.id),
            attempts: yield* proofAttemptsOf('R1.S2'),
            events: yield* payloadsOf(mission.id, 'building.red_invalid'),
          }
        }),
      ),
    )
    const s2 = seen.proof.scenarios.find((one) => one.scenario === 'R1.S2')
    expect(s2?.state).toBe('waiting_red')
    expect(s2?.runs.map((one) => one.classification)).toEqual(['error_before_test'])
    expect(seen.events).toEqual([{ scenario: 'R1.S2', classification: 'error_before_test' }])
    expect(seen.attempts.map((one) => one.verdict)).toEqual(['red'])
    expect(seen.delivered).toContain('did not run')
  })

  test('an unreachable service gives an environment need, its words untouched by the time limit', async () => {
    const port = await closedPort()
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(
              EXPORT_PATH,
              testFile(
                `  await new Promise((done, fail) => connect(${String(port)}, '127.0.0.1').on('connect', done).on('error', fail))`,
                ["import { connect } from 'node:net'"],
              ),
            ),
          }))
          const need = yield* needOf(mission.id, 'Environment')
          const held = yield* proofOf(mission.id, 'R1.S2')
          const view = yield* buildingNow(mission.id)
          yield* retryNeed(need.id)
          yield* until(
            Effect.map(proofOf(mission.id, 'R1.S2'), (proof) => proof.runs.length === 2),
            20_000,
          )
          return { held, view, need }
        }),
      ),
    )
    expect(seen.held.state).toBe('held')
    expect(seen.held.runs.map((one) => one.classification)).toEqual(['environment'])
    expect(seen.need.fields).toMatchObject({
      missing: expect.stringContaining(
        "R1.S2's proof could not run: the environment kept it from running.",
      ),
      action: 'Fix what it says (a service, a port), then Retry: Hemera runs the proof again.',
      settingsSection: null,
    })
    expect(seen.view.tasks.find((task) => task.id === 'T2')?.state).toBe('blocked')
  })

  test('a stop between an environment need’s Retry and its decision leaves nothing behind the withdrawn need: after the start, the proof is run again and asked about anew', async () => {
    const port = await closedPort()
    const spec = () => ({
      'R1.S2': automated(
        EXPORT_PATH,
        testFile(
          `  await new Promise((done, fail) => connect(${String(port)}, '127.0.0.1').on('connect', done).on('error', fail))`,
          ["import { connect } from 'node:net'"],
        ),
      ),
    })
    // The engine stops once the need is withdrawn, before anything else of the Retry is done.
    const stop = holdOnce('releasing')
    const first = await proofsEngine(data, stop.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(spec)
          const need = yield* needOf(mission.id, 'Environment')
          yield* retryNeed(need.id)
          yield* Deferred.await(stop.reached)
          return { mission, need }
        }),
      ),
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const again = yield* needOf(first.mission.id, 'Environment')
          const database = yield* Database
          const building = yield* activeBuildingIn(database, first.mission.id)
          if (building === null) return yield* Effect.die(new Error('no Building'))
          const decision = (yield* decisionsIn(database, building.id)).find(
            (one) => one.needId === first.need.id,
          )
          const cause = (yield* tasksIn(database, building.id)).find(
            (one) => one.id === 'T2',
          )?.blockedBy
          const blockedOn = Predicate.isTagged(cause, 'Need') ? cause.needId : null
          return { again, decision: decision?.state, blockedOn }
        }),
      ),
    )
    expect(seen.again.id).not.toBe(first.need.id)
    expect(seen.decision).toBe('withdrawn')
    expect(seen.blockedOn).toBe(seen.again.id)
  })

  test('a Retry that reaches the Builder’s needs before the Builder runs is refused, never taken without moving its proof', async () => {
    const port = await closedPort()
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(
              EXPORT_PATH,
              testFile(
                `  await new Promise((done, fail) => connect(${String(port)}, '127.0.0.1').on('connect', done).on('error', fail))`,
                ["import { connect } from 'node:net'"],
              ),
            ),
          }))
          const need = yield* needOf(mission.id, 'Environment')
          // The handler of a Builder whose layer is not built yet, as at the engine's start.
          const early = builderLayer(() => undefined).handler.retriedIn
          if (early === undefined) return yield* Effect.die(new Error('no Retry hook'))
          return Exit.isFailure(
            yield* Effect.exit(
              mutate('a Retry before the Builder runs', (transaction) =>
                Effect.map(early(need, transaction), (events) => ({ result: undefined, events })),
              ),
            ),
          )
        }),
      ),
    )
    expect(seen).toBe(true)
  })

  /** A bug seen today: what Planning observed, its key line, and where it was seen. */
  const seenToday = (api: string, observed: string, keyLine: string): Schema.JsonObject =>
    automated(
      EXPORT_PATH,
      testFile('  assert.fail(`total is wrong in ${fileURLToPath(import.meta.url)} after 12ms`)', [
        "import { fileURLToPath } from 'node:url'",
      ]),
      {
        seen_today: true,
        observed,
        key_line: keyLine,
        base_commit: [{ repository: 'api', commit: git(api, 'rev-parse', 'HEAD').trim() }],
      },
    )

  test('a bug scenario whose key line is found again after normalising colours, paths and durations matches', async () => {
    const line = "error: 'total is wrong in /home/planner/acme/api/tests/export.test.mjs after 3ms'"
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith((api) => ({
            'R1.S2': seenToday(api, `not ok 1 - the scenario holds\n  ${line}`, line),
          }))
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          return yield* proofOf(mission.id, 'R1.S2')
        }),
      ),
    )
    expect(seen.red?.keyLineMatched).toBe(true)
  })

  test('a different key line gives the decision need with both outputs, and only the covering tasks are blocked', async () => {
    const line = "error: 'rounding is off by a cent'"
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith((api) => ({
            'R1.S2': seenToday(api, `not ok 1 - the scenario holds\n  ${line}`, line),
          }))
          const need = yield* needOf(mission.id, 'Decision')
          return {
            need,
            proof: yield* proofOf(mission.id, 'R1.S2'),
            view: yield* buildingNow(mission.id),
            events: yield* payloadsOf(mission.id, 'building.red_mismatch'),
          }
        }),
      ),
    )
    const fields = seen.need.fields
    const question = Predicate.isTagged(fields, 'Decision') ? fields.question : ''
    expect(question).toContain('rounding is off by a cent')
    expect(question).toContain('total is wrong in')
    expect(seen.proof.state).toBe('held')
    expect(seen.events).toEqual([{ scenario: 'R1.S2' }])
    const states = Object.fromEntries(seen.view.tasks.map((task) => [task.id, task.state]))
    expect(states).toMatchObject({ T1: 'available', T2: 'blocked', T4: 'available' })
  })

  const PASSING = { 'R1.S2': automated(EXPORT_PATH, testFile("  assert.equal(1, 1, 'it passes')")) }

  test('a scenario that already passes gives the three-choice need; "cancel" cancels the mission', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => PASSING)
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: CANCEL_MISSION }),
            key: 'answer-1',
          })
          yield* until(
            Effect.map(getMission(mission.id), (one) => one.stage === 'cancelled'),
            20_000,
          )
          // Its stops run with it: the Building ends as cancelled.
          yield* until(Effect.map(buildingOf(mission.id), (view) => view?.state === 'cancelled'))
          return { need, events: yield* payloadsOf(mission.id, 'building.already_passes') }
        }),
      ),
    )
    const fields = seen.need.fields
    expect(Predicate.isTagged(fields, 'Decision') ? fields.options : []).toEqual([
      'More information',
      NOT_REPRODUCIBLE,
      CANCEL_MISSION,
    ])
    expect(seen.events).toEqual([{ scenario: 'R1.S2' }])
  })

  test('a scenario that already passes, judged "not reproducible", lets its tasks go on', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => PASSING)
          const need = yield* needOf(mission.id, 'Decision')
          const before = yield* buildingNow(mission.id)
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: NOT_REPRODUCIBLE }),
            key: 'answer-1',
          })
          yield* taskIn(mission.id, 'T2', 'available')
          return {
            before: before.tasks.find((task) => task.id === 'T2')?.state,
            proof: yield* proofOf(mission.id, 'R1.S2'),
            events: yield* payloadsOf(mission.id, 'building.not_reproducible'),
          }
        }),
      ),
    )
    expect(seen.before).toBe('blocked')
    expect(seen.proof.state).toBe('not_reproducible')
    expect(seen.events).toEqual([{ scenario: 'R1.S2' }])
  })

  test('a requirement whose other automated scenarios are green is proven without its scenario set aside as not reproducible', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S1': automated(
              'tests/invoices.test.mjs',
              testFile(
                "  assert.ok(readFileSync(new URL('../invoices.ts', import.meta.url), 'utf8').includes('[1]'), 'no invoice yet')",
              ),
            ),
            ...PASSING,
          }))
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: NOT_REPRODUCIBLE }),
            key: 'answer-1',
          })
          yield* proofIn(mission.id, 'R1.S1', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T1', [['invoices.ts', 'export const invoices = [1]\n']])
          yield* builds(grantId, 'T4')
          yield* proofIn(mission.id, 'R1.S1', 'green')
          return yield* buildingNow(mission.id)
        }),
      ),
    )
    expect(seen.requirements.find((one) => one.id === 'R1')?.proven).toBe(true)
  })

  test('a task covering S3 does not start before the red of S3', async () => {
    const log = join(scratch, 's3.log')
    const release = join(scratch, 's3.release')
    const plan = PLAN.map((task) =>
      task.title === 'Document the exports' ? Object.assign({}, task, { depends_on: [] }) : task,
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(
            () => ({ 'R1.S3': automated('tests/readme.test.mjs', loggedTest(log, release)) }),
            plan,
          )
          const { grantId } = yield* builderOf(mission.id)
          yield* until(Effect.sync(() => runsIn(log) === 1))
          const early = yield* call(grantId, 'task_start', { task: 'T3' })
          const before = (yield* buildingNow(mission.id)).tasks.find(
            (task) => task.id === 'T3',
          )?.state
          writeFileSync(release, '')
          yield* proofIn(mission.id, 'R1.S3', 'red_recorded')
          yield* taskIn(mission.id, 'T3', 'available')
          return { early, before, later: yield* call(grantId, 'task_start', { task: 'T3' }) }
        }),
      ),
    )
    expect(seen.early).toContain('waits for the red of R1.S3')
    expect(seen.before).not.toBe('available')
    expect(seen.later).not.toContain('refused')
  })
})

describe('The green runs', () => {
  test('once the tasks are done, the green run makes the scenario then the requirement proven; a later write in that repository makes it to_rerun', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(exportProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', 'export const toMarkdown = () => ""\n']])
          yield* proofIn(mission.id, 'R1.S2', 'green')
          const green = yield* proofOf(mission.id, 'R1.S2')
          const proven = yield* buildingNow(mission.id)
          yield* builds(grantId, 'T1', [['invoices.ts', 'export const invoices = [1]\n']])
          yield* proofIn(mission.id, 'R1.S2', 'to_rerun')
          return {
            green,
            proven,
            events: yield* payloadsOf(mission.id, 'building.requirement_proven'),
            stale: yield* payloadsOf(mission.id, 'building.proof_stale'),
          }
        }),
      ),
    )
    expect(seen.green.green).toMatchObject({ phase: 'green', classification: 'passed' })
    expect(seen.green.upToDate).toBe(true)
    expect(seen.green.testChanged).toBe(false)
    const r1 = seen.proven.requirements.find((one) => one.id === 'R1')
    expect(r1?.proven).toBe(true)
    expect(r1?.byHand).toEqual({ total: 2, validated: 0 })
    expect(seen.proven.counts).toMatchObject({ requirementsProven: 1, requirements: 1 })
    expect(seen.events).toEqual([{ requirement: 'R1' }])
    expect(seen.stale).toContainEqual({ repository: 'api', scenarios: ['R1.S2'], manual: [] })
  })

  test('refresh runs it again, and a final check that went stale', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            (projectId) =>
              Effect.asVoid(
                saveCheck(projectId, null, {
                  name: 'build',
                  commandId: null,
                  line: `"${process.execPath}" --version`,
                  where: 'root',
                  repository: null,
                  when: 'end',
                  expect: null,
                  files: null,
                }),
              ),
            undefined,
            undefined,
            undefined,
            undefined,
            exportProof,
          )
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', 'export const toMarkdown = () => ""\n']])
          yield* proofIn(mission.id, 'R1.S2', 'green')
          yield* BuildDesk.use((desk) => desk.judgeScope(mission.id, 'end', null))
          const fresh = yield* proofsOf(mission.id)
          // A change made in `api` since: the proof and the final check tested another tree.
          writeFileSync(
            join(yield* apiOf(mission.id), 'invoices.ts'),
            'export const invoices = [2]\n',
          )
          const refreshed = yield* BuildDesk.use((desk) => desk.refreshProofs(mission.id))
          return {
            fresh,
            refreshed,
            after: yield* proofsOf(mission.id),
            events: yield* payloadsOf(mission.id, 'building.proofs_refreshed'),
          }
        }),
      ),
    )
    expect(seen.fresh.finalChecks.map((one) => [one.name, one.upToDate])).toEqual([['build', true]])
    expect(seen.refreshed).toMatchObject({ proofs: ['R1.S2'], checks: ['build'] })
    // The trees its own snapshot took first, which the end keeps (#306).
    expect(seen.refreshed.trees.map((one) => one.repository)).toEqual(['api'])
    const s2 = seen.after.scenarios.find((one) => one.scenario === 'R1.S2')
    expect(s2?.state).toBe('green')
    expect(s2?.runs.map((one) => one.phase)).toEqual(['red', 'green', 'rerun'])
    expect(seen.after.finalChecks.map((one) => [one.name, one.upToDate])).toEqual([['build', true]])
    expect(seen.events).toEqual([{ proofs: ['R1.S2'], checks: ['build'] }])
  })
})

describe('A scenario verified by hand (CT-36)', () => {
  test('a manual scenario is to_verify, validated with a note and a tree, and back to to_verify after a change', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const first = yield* proofOf(mission.id, 'R1.S1')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T1', [['invoices.ts', 'export const invoices = [1]\n']])
          const validated = yield* judgeManual(mission.id, 'R1.S1', 'validated', 'The CSV opens.')
          yield* builds(grantId, 'T4', [['invoices.ts', 'export const invoices = [1, 2]\n']])
          yield* proofIn(mission.id, 'R1.S1', 'to_verify')
          return {
            first,
            validated,
            events: yield* payloadsOf(mission.id, 'proof.manual_validated'),
          }
        }),
      ),
    )
    expect([seen.first.mode, seen.first.state]).toEqual(['by_hand', 'to_verify'])
    expect(seen.validated.state).toBe('validated')
    expect(seen.validated.manual).toMatchObject({
      verdict: 'validated',
      by: 'user',
      note: 'The CSV opens.',
    })
    expect(seen.validated.manual?.trees.map((one) => one.repository)).toEqual(['api'])
    expect(seen.events).toEqual([{ scenario: 'R1.S1', note: 'The CSV opens.' }])
  })

  test('a refusal emits its event', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          yield* buildingNow(mission.id)
          const refused = yield* judgeManual(
            mission.id,
            'R1.S3',
            'refused',
            'The README says nothing.',
          )
          return { refused, events: yield* payloadsOf(mission.id, 'proof.manual_refused') }
        }),
      ),
    )
    expect(seen.refused.state).toBe('refused')
    expect(seen.events).toEqual([{ scenario: 'R1.S3', note: 'The README says nothing.' }])
  })

  test('proof_run on a manual scenario is refused', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { grantId } = yield* builderOf(mission.id)
          return yield* call(grantId, 'proof_run', { scenario: 'R1.S1' })
        }),
      ),
    )
    expect(seen).toBe(
      'refused: R1.S1 is verified by hand: it has no red, and the user validates it in Review.',
    )
  })
})

describe('A restart in the middle of the red phase', () => {
  test('a restart in the middle of the red phase keeps the reds recorded and runs the others', async () => {
    const s1 = join(scratch, 's1.log')
    const s2 = join(scratch, 's2.log')
    const release = join(scratch, 's2.release')
    const proofs = () => ({
      'R1.S1': automated('tests/csv.test.mjs', loggedTest(s1)),
      'R1.S2': automated(EXPORT_PATH, loggedTest(s2, release)),
    })
    const first = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(proofs)
          yield* proofIn(mission.id, 'R1.S1', 'red_recorded')
          yield* until(Effect.sync(() => runsIn(s2) === 1))
          return { mission }
        }),
      ),
    )
    writeFileSync(release, '')
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* proofIn(first.mission.id, 'R1.S2', 'red_recorded')
          return yield* proofsOf(first.mission.id)
        }),
      ),
    )
    expect(runsIn(s1)).toBe(1)
    expect(runsIn(s2)).toBe(2)
    const runs = (scenario: string) =>
      seen.scenarios.find((one) => one.scenario === scenario)?.runs.map((one) => one.phase)
    expect(runs('R1.S1')).toEqual(['red'])
    expect(runs('R1.S2')).toEqual(['red'])
  })
})

/** Holds the Builder once at `point`, until `go`: `reached` says it got there. */
const holdOnce = (point: string) => {
  const reached = Deferred.makeUnsafe<void>()
  const go = Deferred.makeUnsafe<void>()
  let armed = true
  const hold: BuilderHold = (at) =>
    at === point && armed
      ? Effect.gen(function* () {
          armed = false
          yield* Deferred.succeed(reached, undefined)
          yield* Deferred.await(go)
        })
      : Effect.void
  return { hold, reached, go }
}

/** A start's red phase over, its sent-back reds and its reds run: the start's hold before its greens. */
const redsRun = () => {
  const over = Deferred.makeUnsafe<void>()
  const hold: BuilderHold = (at) =>
    at === 'greens-due' ? Effect.asVoid(Deferred.succeed(over, undefined)) : Effect.void
  return { hold, over }
}

/** Everything stored for the mission's sessions (the Builder), as text. */
const deliveriesOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select({ body: sessionDeliveries.body })
      .from(sessionDeliveries)
      .where(eq(sessionDeliveries.ownerId, missionId))
    return rows.map((row) => row.body).join('\n')
  })

/**
 * The scenarios waiting for their red that nothing stored will move: no attempt on the proof left
 * open, no decision on it pending, and nothing said to the Builder about it since it began to wait.
 */
const unmovedOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const building = yield* activeBuildingIn(database, missionId)
    if (building === null) return []
    const waiting = yield* database
      .select()
      .from(scenarioProofs)
      .where(
        and(eq(scenarioProofs.buildingId, building.id), eq(scenarioProofs.state, 'waiting_red')),
      )
    const attempts = yield* proofAttemptsOf(null)
    const decisions = yield* decisionsIn(database, building.id)
    const told = yield* database
      .select()
      .from(sessionDeliveries)
      .where(eq(sessionDeliveries.ownerId, missionId))
    return waiting
      .filter(
        (row) =>
          !attempts.some((one) => one.subject === row.scenario && one.endedAt === null) &&
          !decisions.some(
            (one) =>
              one.scope === 'proof' && one.subject === row.scenario && one.state === 'pending',
          ) &&
          !told.some((one) => one.createdAt >= row.updatedAt && one.body.includes(row.scenario)),
      )
      .map((row) => row.scenario)
  })

/** Writes a file of `api` through the Builder's tools, read first. */
const writes = (grantId: string, path: string, content: string, repository = 'api') =>
  Effect.gen(function* () {
    yield* call(grantId, 'fs_read', { repository, path })
    return yield* call(grantId, 'fs_write', { repository, path, content })
  })

/** Whether the end was called: #147's port, here the event it writes. */
const endCalled = (missionId: string) =>
  Effect.map(eventsOf(missionId, 'building.tasks_done'), (rows) => rows.length > 0)

describe('A proof_run while a task runs', () => {
  test('a proof_run during the task does not stop the green once the task is done', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(exportProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T2' })
          yield* writes(grantId, 'export.ts', RIGHT_EXPORT)
          const informed = yield* call(grantId, 'proof_run', { scenario: 'R1.S2' })
          yield* call(grantId, 'task_finished', { task: 'T2', summary: 'Markdown.' })
          yield* proofIn(mission.id, 'R1.S2', 'green')
          return { informed, proof: yield* proofOf(mission.id, 'R1.S2') }
        }),
      ),
    )
    expect(seen.informed).toContain('R1.S2: passed')
    expect(seen.proof.runs.map((one) => one.phase)).toEqual(['red', 'info', 'green'])
  })

  test('a restart in the middle of a green run runs the green at the next start', async () => {
    const { hold, reached } = holdOnce('greening')
    const first = await proofsEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(exportProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* Effect.forkChild(builds(grantId, 'T2', [['export.ts', RIGHT_EXPORT]]))
          yield* Deferred.await(reached)
          return { mission }
        }),
      ),
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* proofIn(first.mission.id, 'R1.S2', 'green')
          return yield* proofOf(first.mission.id, 'R1.S2')
        }),
      ),
    )
    expect(seen.state).toBe('green')
    expect(seen.green?.classification).toBe('passed')
  })
})

describe('A failed green', () => {
  test('a failed green opens a proof attempt that stays open until the scenario is green', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(markdownProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
          const delivered = yield* deliveredTo(mission.id, "R1.S2's proof is not green")
          const open = yield* proofAttemptsOf('R1.S2')
          yield* writes(grantId, 'export.ts', RIGHT_EXPORT)
          yield* proofIn(mission.id, 'R1.S2', 'green')
          return { delivered, open, closed: yield* proofAttemptsOf('R1.S2') }
        }),
      ),
    )
    expect(seen.open.map((one) => [one.number, one.endedAt, one.verdict])).toEqual([
      [1, null, null],
    ])
    expect(seen.closed.map((one) => [one.number, one.verdict])).toEqual([[1, 'green']])
    expect(seen.closed[0]?.endedAt).not.toBeNull()
  })

  test('a failed green runs again once the Builder’s next write in that repository settles', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(markdownProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
          yield* deliveredTo(mission.id, "R1.S2's proof is not green")
          yield* writes(grantId, 'export.ts', RIGHT_EXPORT)
          yield* proofIn(mission.id, 'R1.S2', 'green')
          return yield* proofOf(mission.id, 'R1.S2')
        }),
      ),
    )
    expect(seen.runs.map((one) => [one.phase, one.classification])).toEqual([
      ['red', 'assertion_failed'],
      ['green', 'assertion_failed'],
      ['green', 'passed'],
    ])
  })

  test('a write whose file could not be read before it, a file it creates, counts: the failed green runs again', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(markdownProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          // T2 done without the file it creates: its green fails on its absence.
          yield* builds(grantId, 'T2')
          yield* deliveredTo(mission.id, "R1.S2's proof is not green")
          yield* writes(grantId, 'export.ts', RIGHT_EXPORT)
          yield* proofIn(mission.id, 'R1.S2', 'green')
          return yield* proofOf(mission.id, 'R1.S2')
        }),
      ),
    )
    expect(seen.runs.map((one) => [one.phase, one.classification])).toEqual([
      ['red', 'assertion_failed'],
      ['green', 'assertion_failed'],
      ['green', 'passed'],
    ])
  })

  test('a failed green runs again after the Builder’s next task_finished', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(markdownProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
          yield* deliveredTo(mission.id, "R1.S2's proof is not green")
          // Fixed on disk where no write of a tool reaches: only the next task's end runs it.
          writeFileSync(join(yield* apiOf(mission.id), 'export.ts'), RIGHT_EXPORT)
          yield* builds(grantId, 'T1')
          yield* proofIn(mission.id, 'R1.S2', 'green')
          return yield* proofOf(mission.id, 'R1.S2')
        }),
      ),
    )
    expect(seen.state).toBe('green')
  })

  test('refresh runs a failed green again', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(markdownProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
          yield* deliveredTo(mission.id, "R1.S2's proof is not green")
          writeFileSync(join(yield* apiOf(mission.id), 'export.ts'), RIGHT_EXPORT)
          const refreshed = yield* BuildDesk.use((desk) => desk.refreshProofs(mission.id))
          return { refreshed, proof: yield* proofOf(mission.id, 'R1.S2') }
        }),
      ),
    )
    expect(seen.refreshed.proofs).toEqual(['R1.S2'])
    expect(seen.proof.state).toBe('green')
  })

  test('proof_run runs a failed green again and closes its attempt', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(markdownProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
          yield* deliveredTo(mission.id, "R1.S2's proof is not green")
          writeFileSync(join(yield* apiOf(mission.id), 'export.ts'), RIGHT_EXPORT)
          const answer = yield* call(grantId, 'proof_run', { scenario: 'R1.S2' })
          return {
            answer,
            proof: yield* proofOf(mission.id, 'R1.S2'),
            attempts: yield* proofAttemptsOf('R1.S2'),
          }
        }),
      ),
    )
    expect(seen.answer).toContain('Its proof is green')
    expect(seen.proof.state).toBe('green')
    expect(seen.attempts.map((one) => one.verdict)).toEqual(['green'])
  })

  test('an end whose sequence runs the proofs again completes when the last green comes from proof_run', async () => {
    // The end of #147 refreshes the proofs: it takes the mission's turn on them again.
    let refresh: ((missionId: string) => Effect.Effect<unknown>) | null = null
    const ended: string[] = []
    const end = Layer.succeed(BuildingEnd, {
      end: (missionId: string) =>
        Effect.gen(function* () {
          if (refresh !== null) yield* refresh(missionId)
          ended.push(missionId)
        }),
    })
    const seen = await proofsEngine(data, undefined, end).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const desk = yield* BuildDesk
          refresh = (missionId) => desk.refreshProofs(missionId)
          const { mission } = yield* launchedWith(markdownProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T1')
          yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
          yield* builds(grantId, 'T4')
          yield* builds(grantId, 'T3')
          yield* deliveredTo(mission.id, 'The end waits')
          writeFileSync(join(yield* apiOf(mission.id), 'export.ts'), RIGHT_EXPORT)
          const answer = yield* call(grantId, 'proof_run', { scenario: 'R1.S2' }).pipe(
            Effect.timeout('15 seconds'),
          )
          yield* until(
            Effect.sync(() => ended.length > 0),
            15_000,
          )
          return { answer, mission }
        }),
      ),
    )
    expect(seen.answer).toContain('Its proof is green')
    expect(ended).toEqual([seen.mission.id])
  })

  test('a stale proof whose rerun fails runs again once the Builder’s next write settles', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(markdownProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', RIGHT_EXPORT]])
          yield* proofIn(mission.id, 'R1.S2', 'green')
          // Broken since, out of any tool: the refresh finds it stale, and its rerun fails.
          writeFileSync(join(yield* apiOf(mission.id), 'export.ts'), WRONG_EXPORT)
          yield* BuildDesk.use((desk) => desk.refreshProofs(mission.id))
          const failed = (yield* proofOf(mission.id, 'R1.S2')).state
          yield* writes(grantId, 'export.ts', RIGHT_EXPORT)
          yield* proofIn(mission.id, 'R1.S2', 'green')
          return { failed, attempts: yield* proofAttemptsOf('R1.S2') }
        }),
      ),
    )
    expect(seen.failed).toBe('to_rerun')
    expect(seen.attempts.map((one) => one.verdict)).toEqual(['green'])
  })

  test('a failed green runs again once a fix in a repository its run did not record settles', async () => {
    const path = 'tests/export.test.mjs'
    const code = testFile(
      "  assert.equal(existsSync(new URL('../../web/fix.txt', import.meta.url)), true, 'web has no fix yet')",
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            undefined,
            'The exports change api, web and nothing else',
            undefined,
            undefined,
            undefined,
            () => ({ 'R1.S2': automated(path, code) }),
          )
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', RIGHT_EXPORT]])
          yield* deliveredTo(mission.id, "R1.S2's proof is not green")
          yield* writes(grantId, 'fix.txt', 'fixed\n', 'web')
          yield* proofIn(mission.id, 'R1.S2', 'green')
          return yield* proofOf(mission.id, 'R1.S2')
        }),
      ),
    )
    expect(seen.state).toBe('green')
  })

  test('a stop between a failed green run and its attempt opens the attempt at the next start', async () => {
    const { hold, reached } = holdOnce('greening')
    const first = await proofsEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(markdownProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* Effect.forkChild(builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]]))
          yield* Deferred.await(reached)
          return { mission }
        }),
      ),
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* deliveredTo(first.mission.id, "R1.S2's proof is not green")
          return yield* proofAttemptsOf('R1.S2')
        }),
      ),
    )
    expect(seen.map((one) => [one.number, one.endedAt])).toEqual([[1, null]])
  })

  test('"the end waits" is said again only when what it waits for changes', async () => {
    const builder = busyBuilder()
    const seen = await proofsEngine(data, undefined, undefined, builder.agents).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S1': automated(
              'tests/invoices.test.mjs',
              testFile(
                "  assert.ok(readFileSync(new URL('../invoices.ts', import.meta.url), 'utf8').includes('[1'), 'no invoice yet')",
              ),
            ),
            ...markdownProof(),
          }))
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          yield* proofIn(mission.id, 'R1.S1', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builder.busy
          yield* builds(grantId, 'T1', [['invoices.ts', 'export const invoices = [1]\n']])
          yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
          yield* builds(grantId, 'T4')
          yield* builds(grantId, 'T3')
          yield* proofIn(mission.id, 'R1.S1', 'green')
          yield* deliveredTo(mission.id, "The end waits: R1.S2's proof is not green.")
          const said = (all: string) => all.split('The end waits').length - 1
          yield* Effect.sleep('1 second')
          const before = said(yield* deliveredTo(mission.id, 'The end waits'))
          // R1.S1 goes stale and green again: the end still waits on R1.S2 alone.
          writeFileSync(
            join(yield* apiOf(mission.id), 'invoices.ts'),
            'export const invoices = [1, 2]\n',
          )
          yield* BuildDesk.use((desk) => desk.refreshProofs(mission.id))
          yield* proofIn(mission.id, 'R1.S1', 'green')
          yield* Effect.sleep('1 second')
          return said(yield* deliveredTo(mission.id, 'The end waits')) - before
        }),
      ),
    )
    expect(seen).toBe(0)
  })

  test('the end is not called while a proof of a done requirement is red, and the Builder is told which', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(markdownProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T1')
          yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
          yield* builds(grantId, 'T4')
          yield* builds(grantId, 'T3')
          const waits = yield* deliveredTo(mission.id, 'The end waits')
          const before = yield* endCalled(mission.id)
          yield* writes(grantId, 'export.ts', RIGHT_EXPORT)
          yield* until(endCalled(mission.id), 20_000)
          return { waits, before }
        }),
      ),
    )
    expect(seen.before).toBe(false)
    expect(seen.waits).toContain("The end waits: R1.S2's proof is not green.")
  })

  test('a proof held on its environment need is not named to the Builder as one the end waits on: only the user’s Retry moves it', async () => {
    let proofCommand = ''
    let held = false
    const seen = await proofsEngine(data, undefined, undefined, undefined, {
      proofMinute: Duration.seconds(2),
    }).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            (projectId) =>
              Effect.gen(function* () {
                yield* setProofLimit(projectId, 1)
                const saved = yield* saveCommand({
                  projectId,
                  id: null,
                  command: {
                    name: 'export proof',
                    type: 'script',
                    line: testLine(`api/${EXPORT_PATH}`),
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
                // Free for the red; from the green on, another mission's service holds the port.
                const runs = yield* Runs
                const real = runs.reservations.current
                runs.reservations.current = {
                  enter: (run) =>
                    run.commandId === proofCommand && held
                      ? Effect.succeed({ names: ['the dev port'], wait: () => Effect.never })
                      : real.enter(run),
                }
              }),
            undefined,
            undefined,
            undefined,
            undefined,
            () => ({
              'R1.S1': automated(
                'tests/invoices.test.mjs',
                testFile(
                  "  assert.ok(readFileSync(new URL('../invoices.ts', import.meta.url), 'utf8').includes('[1'), 'no invoice yet')",
                ),
              ),
              'R1.S2': automated(EXPORT_PATH, EXPORT_TEST, {
                test: {
                  repository: 'api',
                  path: EXPORT_PATH,
                  code: EXPORT_TEST,
                  insertion: 'new_file',
                  command: proofCommand,
                },
              }),
            }),
          )
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          yield* proofIn(mission.id, 'R1.S1', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          held = true
          yield* builds(grantId, 'T2', [['export.ts', RIGHT_EXPORT]])
          yield* needOf(mission.id, 'Environment')
          // R1.S1's green fails: the Builder's to fix, beside R1.S2 held on the user.
          yield* builds(grantId, 'T1', [['invoices.ts', 'export const invoices = [2]\n']])
          yield* builds(grantId, 'T4')
          yield* builds(grantId, 'T3')
          return yield* deliveredTo(mission.id, 'The end waits')
        }),
      ),
    )
    expect(seen).toContain("The end waits: R1.S1's proof is not green.")
    expect(seen).not.toContain("R1.S2's proof is not green")
  })
})

describe('The end never waits on a scenario nothing can move', () => {
  const line = "error: 'rounding is off by a cent'"
  /** R1.S2 red, but not as Planning saw it. */
  const mismatch = (api: string) => ({
    'R1.S2': automated(EXPORT_PATH, testFile("  assert.fail('total is wrong')"), {
      seen_today: true,
      observed: `not ok 1 - the scenario holds\n  ${line}`,
      key_line: line,
      base_commit: [{ repository: 'api', commit: git(api, 'rev-parse', 'HEAD').trim() }],
    }),
  })

  /** The decisions Hemera asked about the scenarios the end waits on. */
  const unprovenAsked = Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(buildingDecisions)
      .where(eq(buildingDecisions.kind, 'proofs_unproven'))
  })

  /** The need of the pending one, once there is one. */
  const unprovenNeed = Effect.gen(function* () {
    yield* until(
      Effect.map(unprovenAsked, (rows) => rows.some((one) => one.state === 'pending')),
      20_000,
    )
    const rows = yield* unprovenAsked
    return rows.find((one) => one.state === 'pending')?.needId ?? ''
  })

  /**
   * R1.S2's red sent back to the Builder, then T2, the only task covering it, skipped by the user:
   * once the other tasks are done, nothing of the plan runs its proof any more.
   */
  const stuck = Effect.gen(function* () {
    const { mission } = yield* launchedWith(mismatch)
    const need = yield* needOf(mission.id, 'Decision')
    yield* answerNeed({ id: need.id, answer: ChosenAnswer.make({ option: SEND_BACK }), key: 'a' })
    yield* deliveredTo(mission.id, 'the user sent this red back')
    const database = yield* Database
    yield* database
      .update(buildingTasks)
      .set({ state: 'skipped' })
      .where(eq(buildingTasks.id, 'T2'))
    const { grantId } = yield* builderOf(mission.id)
    yield* builds(grantId, 'T1')
    yield* builds(grantId, 'T4')
    yield* builds(grantId, 'T3')
    return { mission, grantId, needId: yield* unprovenNeed }
  })

  test('the user is asked about it, and "try again" runs its proof again', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, needId } = yield* stuck
          const before = yield* endCalled(mission.id)
          const asked = yield* getNeed(needId)
          yield* answerNeed({
            id: needId,
            answer: ChosenAnswer.make({ option: TRY_AGAIN }),
            key: 'b',
          })
          yield* until(
            Effect.map(proofOf(mission.id, 'R1.S2'), (proof) => proof.runs.length === 2),
            20_000,
          )
          return { before, asked, proof: yield* proofOf(mission.id, 'R1.S2') }
        }),
      ),
    )
    expect(seen.before).toBe(false)
    expect(
      Predicate.isTagged(seen.asked.fields, 'Decision') && seen.asked.fields.question,
    ).toContain('R1.S2 is not proven')
    expect(seen.proof.runs.map((one) => one.phase)).toEqual(['red', 'red'])
  })

  test('"end without it" records the scenario as not proven and calls the end, which says so', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, needId } = yield* stuck
          yield* answerNeed({
            id: needId,
            answer: ChosenAnswer.make({ option: END_WITHOUT }),
            key: 'b',
          })
          yield* until(endCalled(mission.id), 20_000)
          return {
            proof: yield* proofOf(mission.id, 'R1.S2'),
            delivered: yield* deliveredTo(mission.id, 'Write the final summary'),
            events: yield* payloadsOf(mission.id, 'building.not_proven'),
          }
        }),
      ),
    )
    expect(seen.proof.state).toBe('not_proven')
    expect(seen.delivered).toContain('ended without proving R1.S2')
    expect(seen.events).toEqual([{ scenarios: ['R1.S2'] }])
  })

  test('"end without it" never sets a scenario that went green since to not proven', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, needId } = yield* stuck
          // Moved since it was asked, out of anything that judges the end again.
          const database = yield* Database
          yield* database
            .update(scenarioProofs)
            .set({ state: 'green' })
            .where(eq(scenarioProofs.scenario, 'R1.S2'))
          yield* answerNeed({
            id: needId,
            answer: ChosenAnswer.make({ option: END_WITHOUT }),
            key: 'b',
          })
          yield* until(endCalled(mission.id), 20_000)
          return yield* proofOf(mission.id, 'R1.S2')
        }),
      ),
    )
    expect(seen.state).toBe('green')
  })

  test('a listed scenario that moves withdraws the need, and the end is judged again', async () => {
    const builder = busyBuilder()
    const seen = await proofsEngine(data, undefined, undefined, builder.agents).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* stuck
          // Still at work: its turn on what it is told stays open.
          yield* builder.busy
          // The Builder makes the test fail as Planning saw it: its red is a decision again.
          writeFileSync(
            join(yield* apiOf(mission.id), EXPORT_PATH),
            testFile("  assert.fail('rounding is off by a cent')"),
          )
          yield* call(grantId, 'proof_run', { scenario: 'R1.S2' })
          yield* until(
            Effect.map(unprovenAsked, (rows) => rows.every((one) => one.state !== 'pending')),
            20_000,
          )
          return { asked: yield* unprovenAsked, proof: yield* proofOf(mission.id, 'R1.S2') }
        }),
      ),
    )
    expect(seen.proof.state).toBe('red_recorded')
    expect(seen.asked.map((one) => one.state)).toEqual(['withdrawn'])
  })

  test('a need about them that expires unanswered is asked again while they stay stuck', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { needId } = yield* stuck
          yield* expireNeed(needId, 'The mission moved on.')
          yield* until(
            Effect.map(unprovenAsked, (rows) => rows.length === 2),
            20_000,
          )
          return yield* unprovenAsked
        }),
      ),
    )
    expect(seen.map((one) => one.state)).toEqual(['expired', 'pending'])
  })

  test('"end without it" closes the attempt left open on the scenario', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, needId } = yield* stuck
          const building = yield* buildingNow(mission.id)
          const database = yield* Database
          yield* database.insert(buildingAttempts).values({
            id: 'left-open',
            buildingId: building.buildingId,
            taskId: null,
            scope: 'proof',
            subject: 'R1.S2',
            number: 9,
            runner: 'builder',
            epoch: 0,
            starts: '[]',
            startedAt: new Date().toISOString(),
            outside: '[]',
          })
          yield* answerNeed({
            id: needId,
            answer: ChosenAnswer.make({ option: END_WITHOUT }),
            key: 'b',
          })
          yield* until(endCalled(mission.id), 20_000)
          return yield* proofAttemptsOf('R1.S2')
        }),
      ),
    )
    expect(seen.filter((one) => one.endedAt === null)).toEqual([])
  })

  test('a failed green its Builder no longer acts on is stuck: the user is asked, and can end without it', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          // R1.S2's tasks skipped, its green judged against the requirement's tasks fails.
          const { mission } = yield* launchedWith(markdownProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const database = yield* Database
          yield* database
            .update(buildingTasks)
            .set({ state: 'skipped' })
            .where(eq(buildingTasks.id, 'T2'))
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T1')
          yield* builds(grantId, 'T4')
          yield* builds(grantId, 'T3')
          yield* deliveredTo(mission.id, 'The end waits')
          // Three reds, which the user answers; the Builder then ends its turn writing nothing.
          yield* writes(grantId, 'export.ts', 'export const toCsv = () => "a"\n')
          yield* until(
            Effect.map(proofAttemptsOf('R1.S2'), (rows) => rows.length === 2),
            20_000,
          )
          yield* writes(grantId, 'export.ts', 'export const toCsv = () => "b"\n')
          const error = yield* needOf(mission.id, 'Error')
          // What the third red set going has settled: only the answer judges the end again.
          yield* Effect.sleep('1 second')
          yield* answerNeed({
            id: error.id,
            answer: WrittenAnswer.make({ text: 'Export as Markdown, not CSV.' }),
            key: 'e',
          })
          const needId = yield* unprovenNeed
          yield* answerNeed({
            id: needId,
            answer: ChosenAnswer.make({ option: END_WITHOUT }),
            key: 'b',
          })
          yield* until(endCalled(mission.id), 20_000)
          return {
            proof: yield* proofOf(mission.id, 'R1.S2'),
            open: (yield* proofAttemptsOf('R1.S2')).filter((one) => one.endedAt === null),
          }
        }),
      ),
    )
    expect(seen.proof.state).toBe('not_proven')
    expect(seen.open).toEqual([])
  })

  test('skipped tasks do not make a failed green stuck while a write can run it again', async () => {
    const builder = busyBuilder()
    const seen = await proofsEngine(data, undefined, undefined, builder.agents).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(markdownProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const database = yield* Database
          yield* database
            .update(buildingTasks)
            .set({ state: 'skipped' })
            .where(eq(buildingTasks.id, 'T2'))
          const { grantId } = yield* builderOf(mission.id)
          yield* builder.busy
          yield* builds(grantId, 'T1')
          yield* builds(grantId, 'T4')
          yield* builds(grantId, 'T3')
          yield* deliveredTo(mission.id, 'The end waits')
          const asked = yield* unprovenAsked
          yield* writes(grantId, 'export.ts', RIGHT_EXPORT)
          yield* until(endCalled(mission.id), 20_000)
          return asked
        }),
      ),
    )
    expect(seen).toEqual([])
  })

  test('after the user answered three reds, the next red is not stuck: the Builder works on the answer', async () => {
    const builder = busyBuilder()
    const seen = await proofsEngine(data, undefined, undefined, builder.agents).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(markdownProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builder.busy
          yield* builds(grantId, 'T1')
          yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
          yield* builds(grantId, 'T4')
          yield* builds(grantId, 'T3')
          yield* deliveredTo(mission.id, "R1.S2's proof is not green")
          // Two more reds: the third is an error need for the user.
          yield* writes(grantId, 'export.ts', 'export const toCsv = () => "a"\n')
          yield* until(
            Effect.map(proofAttemptsOf('R1.S2'), (rows) => rows.length === 2),
            20_000,
          )
          yield* writes(grantId, 'export.ts', 'export const toCsv = () => "b"\n')
          const error = yield* needOf(mission.id, 'Error')
          yield* answerNeed({
            id: error.id,
            answer: WrittenAnswer.make({ text: 'Export as Markdown, not CSV.' }),
            key: 'e',
          })
          yield* writes(grantId, 'export.ts', 'export const toCsv = () => "c"\n')
          yield* until(
            Effect.map(proofAttemptsOf('R1.S2'), (rows) => rows.length === 4),
            20_000,
          )
          yield* Effect.sleep('1 second')
          return yield* unprovenAsked
        }),
      ),
    )
    expect(seen).toEqual([])
  })
})

describe('A proof is stuck only once the Builder stopped acting on it', () => {
  /** The decisions Hemera asked about the scenarios the end waits on. */
  const unprovenAsked = Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(buildingDecisions)
      .where(eq(buildingDecisions.kind, 'proofs_unproven'))
  })

  /** R1.S2's test, which waits for `release` to exist before it checks `export.ts`. */
  const heldProof = (log: string, release: string) => () => ({
    'R1.S2': automated(
      EXPORT_PATH,
      testFile(
        [
          `  appendFileSync(${JSON.stringify(log)}, 'ran\\n')`,
          `  while (!existsSync(${JSON.stringify(release)})) await new Promise((done) => setTimeout(done, 20))`,
          "  const file = new URL('../export.ts', import.meta.url)",
          "  assert.ok(existsSync(file) && readFileSync(file, 'utf8').includes('toMarkdown'), 'export.ts has no toMarkdown')",
        ].join('\n'),
      ),
    ),
  })

  test('a turn that runs a command which rewrites the failing file, then ends: no question, and the proof is run again', async () => {
    // Once held, the Builder's turns stay open until the test lets them end.
    let held = false
    let open: () => void = () => undefined
    const gate = new Promise<void>((done) => {
      open = done
    })
    const agents = (index: number): FakeScript =>
      index === 0 ? READING : { ...QUIET, between: () => (held ? gate : Promise.resolve()) }
    // A command that writes the fix where it runs: what a formatter or a codegen script does.
    const fixer = join(scratch, 'fix.mjs')
    writeFileSync(
      fixer,
      `import { writeFileSync } from 'node:fs'\nwriteFileSync('export.ts', ${JSON.stringify(RIGHT_EXPORT)})\n`,
    )
    const seen = await proofsEngine(data, undefined, undefined, agents).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(markdownProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          held = true
          yield* builds(grantId, 'T1')
          yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
          yield* builds(grantId, 'T4')
          yield* builds(grantId, 'T3')
          yield* deliveredTo(mission.id, 'The end waits')
          const ran = yield* call(grantId, 'commands_run', {
            line: `"${process.execPath}" "${fixer}"`,
            repository: 'api',
          })
          // The turn ends, having written through the command only.
          open()
          yield* until(endCalled(mission.id), 20_000)
          return {
            ran,
            asked: yield* unprovenAsked,
            proof: yield* proofOf(mission.id, 'R1.S2'),
          }
        }),
      ),
    )
    expect(seen.ran).toMatch(/exit code 0/)
    expect(seen.asked).toEqual([])
    expect(seen.proof.state).toBe('green')
    expect(seen.proof.runs.map((one) => [one.phase, one.classification])).toEqual([
      ['red', 'assertion_failed'],
      ['green', 'assertion_failed'],
      ['green', 'passed'],
    ])
  })

  test('a command whose changes are known but whose attribution then fails: its write still counts, no question, and the proof is run again', async () => {
    let held = false
    let open: () => void = () => undefined
    const gate = new Promise<void>((done) => {
      open = done
    })
    const agents = (index: number): FakeScript =>
      index === 0 ? READING : { ...QUIET, between: () => (held ? gate : Promise.resolve()) }
    const fixer = join(scratch, 'fix.mjs')
    writeFileSync(
      fixer,
      `import { writeFileSync } from 'node:fs'\nwriteFileSync('export.ts', ${JSON.stringify(RIGHT_EXPORT)})\n`,
    )
    // Once the command ran, copying its changes fails: what follows the changes known never ends.
    let failing = false
    const snapshots = (real: SnapshotsService): SnapshotsService => ({
      ...real,
      capture: (missionId, place, from, to, files) =>
        failing
          ? Effect.fail(
              new SnapshotFailed({ repository: place.name, owner: 'run', said: 'disk full' }),
            )
          : real.capture(missionId, place, from, to, files),
    })
    const seen = await proofsEngine(data, undefined, undefined, agents, { snapshots }).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launchedWith(markdownProof)
            yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
            const { grantId } = yield* builderOf(mission.id)
            held = true
            yield* builds(grantId, 'T1')
            yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
            yield* builds(grantId, 'T4')
            yield* builds(grantId, 'T3')
            yield* deliveredTo(mission.id, 'The end waits')
            failing = true
            const ran = yield* call(grantId, 'commands_run', {
              line: `"${process.execPath}" "${fixer}"`,
              repository: 'api',
            })
            open()
            yield* until(endCalled(mission.id), 20_000)
            return {
              ran,
              asked: yield* unprovenAsked,
              proof: yield* proofOf(mission.id, 'R1.S2'),
            }
          }),
        ),
    )
    expect(seen.ran).toMatch(/exit code 0/)
    expect(seen.asked).toEqual([])
    expect(seen.proof.state).toBe('green')
  })

  /** A hold that only counts the file tool writes the Builder's hook counted. */
  const countingWrites = () => {
    let counted = 0
    const hold: BuilderHold = (at) =>
      Effect.sync(() => {
        if (at === 'wrote') counted += 1
      })
    return { hold, counted: Effect.sync(() => counted) }
  }

  test('a Builder turn that rewrites the failing file with the same content, then ends: the question is not withdrawn and does not come back', async () => {
    const counting = countingWrites()
    const seen = await proofsEngine(data, counting.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(markdownProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T1')
          yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
          yield* builds(grantId, 'T4')
          yield* builds(grantId, 'T3')
          // The failed green, which the quiet Builder no longer acts on: the user is asked.
          yield* until(
            Effect.map(unprovenAsked, (rows) => rows.some((one) => one.state === 'pending')),
            20_000,
          )
          const before = yield* counting.counted
          // The Builder writes the failing file again as it was, and its turn ends. The hook
          // counts a write before the call returns: none is counted, so nothing wakes.
          const wrote = yield* call(grantId, 'fs_write', {
            repository: 'api',
            path: 'export.ts',
            content: WRONG_EXPORT,
          })
          return {
            wrote,
            counted: (yield* counting.counted) - before,
            asked: (yield* unprovenAsked).map((one) => one.state),
            runs: (yield* proofOf(mission.id, 'R1.S2')).runs.length,
          }
        }),
      ),
    )
    expect(seen.wrote).not.toMatch(/refused/)
    expect(seen.counted).toBe(0)
    expect(seen.asked).toEqual(['pending'])
    expect(seen.runs).toBe(2)
  })

  test('a Builder write that changes the failing file is counted before its call returns', async () => {
    const counting = countingWrites()
    const seen = await proofsEngine(data, counting.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(markdownProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
          const before = yield* counting.counted
          const wrote = yield* call(grantId, 'fs_write', {
            repository: 'api',
            path: 'export.ts',
            content: RIGHT_EXPORT,
          })
          return { wrote, counted: (yield* counting.counted) - before }
        }),
      ),
    )
    expect(seen.wrote).not.toMatch(/refused/)
    expect(seen.counted).toBe(1)
  })

  test('Try again, then a Builder turn that writes nothing while the proof runs: the question does not come back before the run ends', async () => {
    const log = join(scratch, 'runs.log')
    const release = join(scratch, 'release')
    writeFileSync(release, '')
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(heldProof(log, release))
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T1')
          yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
          yield* builds(grantId, 'T4')
          yield* builds(grantId, 'T3')
          // The failed green, which the quiet Builder no longer acts on: the user is asked.
          yield* until(
            Effect.map(unprovenAsked, (rows) => rows.some((one) => one.state === 'pending')),
            20_000,
          )
          const needId = (yield* unprovenAsked)[0]?.needId ?? ''
          rmSync(release)
          yield* answerNeed({
            id: needId,
            answer: ChosenAnswer.make({ option: TRY_AGAIN }),
            key: 'b',
          })
          yield* until(Effect.sync(() => runsIn(log) === 3))
          // The Builder's turn on the answer ends, writing nothing, while the proof still runs.
          yield* deliveredTo(mission.id, `The user answered: ${TRY_AGAIN}`)
          yield* Effect.sleep('2 seconds')
          const during = yield* unprovenAsked
          writeFileSync(release, '')
          yield* until(
            Effect.map(unprovenAsked, (rows) => rows.length === 2),
            20_000,
          )
          return {
            during: during.map((one) => one.state),
            after: (yield* unprovenAsked).map((one) => one.state),
            runs: (yield* proofOf(mission.id, 'R1.S2')).runs.length,
          }
        }),
      ),
    )
    expect(seen.during).toEqual(['answered'])
    // Once the run failed again, the Builder still writing nothing, it is asked again.
    expect(seen.after).toEqual(['answered', 'pending'])
    expect(seen.runs).toBe(3)
  })
})

describe('A proof run that never ends', () => {
  /** The decisions Hemera asked about the scenarios the end waits on. */
  const unprovenAsked = Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(buildingDecisions)
      .where(eq(buildingDecisions.kind, 'proofs_unproven'))
  })

  test('a Project with no value keeps 10 minutes', () => {
    expect(PROOF_LIMIT).toEqual(Duration.minutes(10))
    expect(proofLimitFor(null)).toEqual(PROOF_LIMIT)
    expect(proofLimitFor(25)).toEqual(Duration.minutes(25))
    // A suite's default and its minute, never the Project's value.
    expect(
      proofLimitFor(null, { limit: Duration.seconds(6), minute: Duration.seconds(1) }),
    ).toEqual(Duration.seconds(6))
    expect(proofLimitFor(4, { limit: Duration.seconds(6), minute: Duration.seconds(1) })).toEqual(
      Duration.seconds(4),
    )
  })

  test('a timed-out red: the need names the Project’s limit, says to change the proof’s command when it never ends, and points at the Checks section', async () => {
    const seen = await proofsEngine(data, undefined, undefined, undefined, {
      proofMinute: Duration.seconds(3),
    }).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            (projectId) => Effect.asVoid(setProofLimit(projectId, 1)),
            undefined,
            undefined,
            undefined,
            undefined,
            () => ({
              'R1.S2': automated(
                EXPORT_PATH,
                testFile('  await new Promise(() => setInterval(() => undefined, 1000))'),
              ),
            }),
          )
          return {
            need: yield* needOf(mission.id, 'Environment'),
            proof: yield* proofOf(mission.id, 'R1.S2'),
          }
        }),
      ),
    )
    expect(seen.proof.runs.map((one) => one.classification)).toEqual(['environment'])
    const fields = seen.need.fields
    if (!Predicate.isTagged(fields, 'Environment')) throw new Error('not an environment need')
    expect(fields.settingsSection).toBe('checks')
    expect(fields.missing).toContain(
      "R1.S2's proof ran past the Project's limit of 1 minute: Hemera ended it.",
    )
    expect(fields.action).toContain('If its command never ends on its own (a watch mode')
    expect(fields.action).toContain('Otherwise raise the limit in the Checks settings')
    expect(fields.action).toContain('then Retry')
  })

  test('a proof that never ends: its run ends at its limit as a red that timed out, and the question comes', async () => {
    const log = join(scratch, 'runs.log')
    const pid = join(scratch, 'pid')
    // Red until export.ts exists; from then on it never ends, as a watch mode would not.
    const hanging = () => ({
      'R1.S2': automated(
        EXPORT_PATH,
        testFile(
          [
            `  appendFileSync(${JSON.stringify(log)}, 'ran\\n')`,
            "  if (existsSync(new URL('../export.ts', import.meta.url))) {",
            `    writeFileSync(${JSON.stringify(pid)}, String(process.pid))`,
            '    await new Promise(() => setInterval(() => undefined, 1000))',
            '  }',
            "  assert.fail('export.ts exports nothing yet')",
          ].join('\n'),
          ["import { writeFileSync } from 'node:fs'"],
        ),
      ),
    })
    // The Project's limit of 2 minutes, a minute lasting 3 seconds here: the default stays 10.
    const seen = await proofsEngine(data, undefined, undefined, undefined, {
      proofMinute: Duration.seconds(3),
    }).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            (projectId) => Effect.asVoid(setProofLimit(projectId, 2)),
            undefined,
            undefined,
            undefined,
            undefined,
            hanging,
          )
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T1')
          yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
          yield* builds(grantId, 'T4')
          yield* builds(grantId, 'T3')
          yield* until(
            Effect.map(unprovenAsked, (rows) => rows.some((one) => one.state === 'pending')),
            25_000,
          )
          return { proof: yield* proofOf(mission.id, 'R1.S2') }
        }),
      ),
    )
    const green = seen.proof.runs.at(-1)
    expect(seen.proof.runs.map((one) => one.phase)).toEqual(['red', 'green'])
    expect(green?.classification).toBe('environment')
    expect(green?.outputTail).toMatch(/timed out after 6s/)
    // The test's process, under the runner's, was ended with the run.
    const ended = () => {
      try {
        process.kill(Number(readFileSync(pid, 'utf8')), 0)
        return false
      } catch {
        return true
      }
    }
    expect(ended()).toBe(true)
  })
})

describe('A proof waiting for an exclusive resource', () => {
  test('a proof whose command waits for a resource held elsewhere ends at the Project’s limit as an environment red that says what it waited for', async () => {
    let proofCommand = ''
    const seen = await proofsEngine(data, undefined, undefined, undefined, {
      proofMinute: Duration.seconds(2),
    }).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            (projectId) =>
              Effect.gen(function* () {
                yield* setProofLimit(projectId, 1)
                const saved = yield* saveCommand({
                  projectId,
                  id: null,
                  command: {
                    name: 'export proof',
                    type: 'script',
                    line: testLine(EXPORT_PATH),
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
                // The port of another mission's service holds it, and is never given back.
                const runs = yield* Runs
                const real = runs.reservations.current
                runs.reservations.current = {
                  enter: (run) =>
                    run.commandId === proofCommand
                      ? Effect.succeed({ names: ['the dev port'], wait: () => Effect.never })
                      : real.enter(run),
                }
              }),
            undefined,
            undefined,
            undefined,
            undefined,
            () => ({
              'R1.S2': automated(EXPORT_PATH, EXPORT_TEST, {
                test: {
                  repository: 'api',
                  path: EXPORT_PATH,
                  code: EXPORT_TEST,
                  insertion: 'new_file',
                  command: proofCommand,
                },
              }),
            }),
          )
          return {
            need: yield* needOf(mission.id, 'Environment'),
            proof: yield* proofOf(mission.id, 'R1.S2'),
          }
        }),
      ),
    )
    expect(seen.proof.runs.map((one) => one.classification)).toEqual(['environment'])
    const fields = seen.need.fields
    if (!Predicate.isTagged(fields, 'Environment')) throw new Error('not an environment need')
    expect(fields.missing).toContain("R1.S2's proof could not run")
    expect(fields.missing).toContain('it waited 2s for the dev port, held elsewhere')
  })

  test('a stale proof whose rerun at the refresh waits for a resource held elsewhere asks the user to free it, and its Retry runs it again, with no attempt for the Builder', async () => {
    let proofCommand = ''
    let held = false
    const seen = await proofsEngine(data, undefined, undefined, undefined, {
      proofMinute: Duration.seconds(2),
    }).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            (projectId) =>
              Effect.gen(function* () {
                yield* setProofLimit(projectId, 1)
                const saved = yield* saveCommand({
                  projectId,
                  id: null,
                  command: {
                    name: 'export proof',
                    type: 'script',
                    line: testLine(`api/${EXPORT_PATH}`),
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
                // Free until the refresh; from then on another mission's service holds the port.
                const runs = yield* Runs
                const real = runs.reservations.current
                runs.reservations.current = {
                  enter: (run) =>
                    run.commandId === proofCommand && held
                      ? Effect.succeed({ names: ['the dev port'], wait: () => Effect.never })
                      : real.enter(run),
                }
              }),
            undefined,
            undefined,
            undefined,
            undefined,
            () => ({
              'R1.S2': automated(EXPORT_PATH, EXPORT_TEST, {
                test: {
                  repository: 'api',
                  path: EXPORT_PATH,
                  code: EXPORT_TEST,
                  insertion: 'new_file',
                  command: proofCommand,
                },
              }),
            }),
          )
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', RIGHT_EXPORT]])
          yield* proofIn(mission.id, 'R1.S2', 'green')
          held = true
          writeFileSync(
            join(yield* apiOf(mission.id), 'invoices.ts'),
            'export const invoices = [2]\n',
          )
          yield* BuildDesk.use((desk) => desk.refreshProofs(mission.id))
          const need = yield* needOf(mission.id, 'Environment')
          const waiting = yield* proofOf(mission.id, 'R1.S2')
          const attempts = yield* proofAttemptsOf('R1.S2')
          held = false
          yield* retryNeed(need.id)
          yield* proofIn(mission.id, 'R1.S2', 'green')
          return { need, waiting, attempts, after: yield* proofOf(mission.id, 'R1.S2') }
        }),
      ),
    )
    const fields = seen.need.fields
    if (!Predicate.isTagged(fields, 'Environment')) throw new Error('not an environment need')
    expect(fields.missing).toContain("R1.S2's proof could not run")
    expect(fields.missing).toContain('it waited 2s for the dev port, held elsewhere')
    expect(seen.waiting.state).toBe('held')
    expect(seen.attempts).toEqual([])
    expect(seen.after.runs.map((one) => [one.phase, one.classification])).toEqual([
      ['red', 'assertion_failed'],
      ['green', 'passed'],
      ['rerun', 'environment'],
      ['rerun', 'passed'],
    ])
  })

  test('a Retry whose own write fails leaves the environment need open and its proof held, and the next Retry runs it again', async () => {
    let proofCommand = ''
    let held = false
    // The Retry's write of the proof, refused once by the data folder.
    let refusing = false
    const seen = await proofsEngine(
      data,
      (at) =>
        at === 'retrying' && refusing
          ? Effect.suspend(() => {
              refusing = false
              return Effect.die(new Error('the data folder refused the write'))
            })
          : Effect.void,
      undefined,
      undefined,
      { proofMinute: Duration.seconds(2) },
    ).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            (projectId) =>
              Effect.gen(function* () {
                yield* setProofLimit(projectId, 1)
                const saved = yield* saveCommand({
                  projectId,
                  id: null,
                  command: {
                    name: 'export proof',
                    type: 'script',
                    line: testLine(`api/${EXPORT_PATH}`),
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
                // Free for the red; from the green on, another mission's service holds the port.
                const runs = yield* Runs
                const real = runs.reservations.current
                runs.reservations.current = {
                  enter: (run) =>
                    run.commandId === proofCommand && held
                      ? Effect.succeed({ names: ['the dev port'], wait: () => Effect.never })
                      : real.enter(run),
                }
              }),
            undefined,
            undefined,
            undefined,
            undefined,
            () => ({
              'R1.S2': automated(EXPORT_PATH, EXPORT_TEST, {
                test: {
                  repository: 'api',
                  path: EXPORT_PATH,
                  code: EXPORT_TEST,
                  insertion: 'new_file',
                  command: proofCommand,
                },
              }),
            }),
          )
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          held = true
          yield* builds(grantId, 'T2', [['export.ts', RIGHT_EXPORT]])
          const need = yield* needOf(mission.id, 'Environment')
          held = false
          refusing = true
          const failed = Exit.isFailure(yield* Effect.exit(retryNeed(need.id)))
          const left = {
            need: (yield* getNeed(need.id)).state,
            proof: (yield* proofOf(mission.id, 'R1.S2')).state,
          }
          // Withdrawn, the need has no Retry left: nothing would run the proof again.
          if (left.need !== 'pending') return { failed, left, need: left.need }
          yield* retryNeed(need.id)
          yield* proofIn(mission.id, 'R1.S2', 'green')
          return { failed, left, need: (yield* getNeed(need.id)).state }
        }),
      ),
    )
    expect(seen.failed).toBe(true)
    expect(seen.left).toEqual({ need: 'pending', proof: 'held' })
    expect(seen.need).toBe('withdrawn')
  })

  test('a stale proof the Builder runs while a resource held elsewhere keeps it from running is stale again at its Retry, never back to its red', async () => {
    let proofCommand = ''
    let held = false
    // The Retry's run, held once it ran and before it is judged.
    let arming = false
    const reached = Deferred.makeUnsafe<void>()
    const go = Deferred.makeUnsafe<void>()
    let taking: SnapshotsService | null = null
    const seen = await proofsEngine(
      data,
      (at) =>
        at === 'greening' && arming
          ? Effect.gen(function* () {
              arming = false
              yield* Deferred.succeed(reached, undefined)
              yield* Deferred.await(go)
            })
          : Effect.void,
      undefined,
      undefined,
      {
        proofMinute: Duration.seconds(2),
        snapshots: (real) => {
          taking = real
          return real
        },
      },
    ).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            (projectId) =>
              Effect.gen(function* () {
                yield* setProofLimit(projectId, 1)
                const saved = yield* saveCommand({
                  projectId,
                  id: null,
                  command: {
                    name: 'export proof',
                    type: 'script',
                    line: testLine(`api/${EXPORT_PATH}`),
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
                // Free until the Builder runs the stale proof; then another mission's service
                // holds the port, until the user frees it.
                const runs = yield* Runs
                const real = runs.reservations.current
                runs.reservations.current = {
                  enter: (run) =>
                    run.commandId === proofCommand && held
                      ? Effect.succeed({ names: ['the dev port'], wait: () => Effect.never })
                      : real.enter(run),
                }
              }),
            undefined,
            undefined,
            undefined,
            undefined,
            () => ({
              'R1.S2': automated(EXPORT_PATH, EXPORT_TEST, {
                test: {
                  repository: 'api',
                  path: EXPORT_PATH,
                  code: EXPORT_TEST,
                  insertion: 'new_file',
                  command: proofCommand,
                },
              }),
            }),
          )
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', RIGHT_EXPORT]])
          yield* proofIn(mission.id, 'R1.S2', 'green')
          // A change a snapshot sees makes the proof stale.
          const api = yield* apiOf(mission.id)
          writeFileSync(join(api, 'invoices.ts'), 'export const invoices = [2]\n')
          if (taking === null) return yield* Effect.die(new Error('no snapshots'))
          yield* taking.take(
            { name: 'api', folder: api },
            { kind: 'run', missionId: mission.id, runId: crypto.randomUUID(), side: 'before' },
          )
          yield* proofIn(mission.id, 'R1.S2', 'to_rerun')
          held = true
          yield* call(grantId, 'proof_run', { scenario: 'R1.S2' })
          const need = yield* needOf(mission.id, 'Environment')
          held = false
          arming = true
          yield* retryNeed(need.id)
          yield* Deferred.await(reached)
          const retried = yield* proofOf(mission.id, 'R1.S2')
          yield* Deferred.succeed(go, undefined)
          yield* proofIn(mission.id, 'R1.S2', 'green')
          return { retried, after: yield* proofOf(mission.id, 'R1.S2') }
        }),
      ),
    )
    expect(seen.retried.state).toBe('to_rerun')
    expect(seen.after.runs.map((one) => [one.phase, one.classification])).toEqual([
      ['red', 'assertion_failed'],
      ['green', 'passed'],
      ['rerun', 'environment'],
      ['rerun', 'passed'],
    ])
  })
})

describe('A proof whose run started and then met its environment', () => {
  /**
   * R1.S2's test: red while `api/export.ts` is missing; once it exists without `toMarkdown`, its
   * code never answers and the runner gives up in its own words, an environment failure the
   * Builder's code causes (#306).
   */
  const TIMING_OUT_TEST = testFile(
    [
      "  const file = new URL('../export.ts', import.meta.url)",
      "  assert.ok(existsSync(file), 'export.ts exports nothing yet')",
      "  if (!readFileSync(file, 'utf8').includes('toMarkdown')) throw new Error('Test timed out in 5000ms')",
    ].join('\n'),
  )
  const timingOutProof = () => ({ 'R1.S2': automated(EXPORT_PATH, TIMING_OUT_TEST) })

  /** The mission's environment needs. */
  const environmentNeeds = (missionId: string) =>
    Effect.map(getMission(missionId), (mission) =>
      mission.needs.filter((need) => Predicate.isTagged(need.fields, 'Environment')),
    )

  test('a green whose started run says its test timed out goes to the Builder as an attempt, never to the user as an environment need', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(timingOutProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
          const delivered = yield* deliveredTo(mission.id, "R1.S2's proof is not green")
          const failed = yield* proofOf(mission.id, 'R1.S2')
          const needs = yield* environmentNeeds(mission.id)
          const open = yield* proofAttemptsOf('R1.S2')
          yield* writes(grantId, 'export.ts', RIGHT_EXPORT)
          yield* proofIn(mission.id, 'R1.S2', 'green')
          return { delivered, failed, needs, open }
        }),
      ),
    )
    expect(seen.failed.runs.map((one) => [one.phase, one.classification])).toEqual([
      ['red', 'assertion_failed'],
      ['green', 'environment'],
    ])
    expect(seen.failed.state).toBe('red_recorded')
    expect(seen.needs).toEqual([])
    expect(seen.open.map((one) => [one.number, one.endedAt])).toEqual([[1, null]])
    expect(seen.delivered).toContain('Test timed out in 5000ms')
  })

  test('a stale proof whose started rerun at the refresh says its test timed out goes to the Builder as an attempt, never to the user as an environment need', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(timingOutProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', RIGHT_EXPORT]])
          yield* proofIn(mission.id, 'R1.S2', 'green')
          // Broken since, out of any tool: the refresh finds it stale, and its rerun times out.
          writeFileSync(join(yield* apiOf(mission.id), 'export.ts'), WRONG_EXPORT)
          yield* BuildDesk.use((desk) => desk.refreshProofs(mission.id))
          const failed = yield* proofOf(mission.id, 'R1.S2')
          const needs = yield* environmentNeeds(mission.id)
          const open = yield* proofAttemptsOf('R1.S2')
          yield* writes(grantId, 'export.ts', RIGHT_EXPORT)
          yield* proofIn(mission.id, 'R1.S2', 'green')
          return { failed, needs, open }
        }),
      ),
    )
    expect(seen.failed.runs.map((one) => [one.phase, one.classification])).toEqual([
      ['red', 'assertion_failed'],
      ['green', 'passed'],
      ['rerun', 'environment'],
    ])
    expect(seen.failed.state).toBe('to_rerun')
    expect(seen.needs).toEqual([])
    expect(seen.open.map((one) => [one.number, one.endedAt])).toEqual([[1, null]])
  })
})

describe('A restart while a proof waits on its fix', () => {
  /** The decisions Hemera asked about the scenarios the end waits on. */
  const unprovenAsked = Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(buildingDecisions)
      .where(eq(buildingDecisions.kind, 'proofs_unproven'))
  })

  test('a restart after the fix landed during the stop: the idle Builder is not judged stuck between the reds and the greens it runs again', async () => {
    const builder = busyBuilder()
    const first = await proofsEngine(data, undefined, undefined, builder.agents).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launchedWith(markdownProof)
            yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
            const { grantId } = yield* builderOf(mission.id)
            // At work until the stop: nothing is stuck before it.
            yield* builder.busy
            yield* builds(grantId, 'T1')
            yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
            yield* builds(grantId, 'T4')
            yield* builds(grantId, 'T3')
            yield* deliveredTo(mission.id, 'The end waits')
            return { mission, api: yield* apiOf(mission.id), asked: yield* unprovenAsked }
          }),
        ),
    )
    // The fix lands while Hemera is stopped.
    writeFileSync(join(first.api, 'export.ts'), RIGHT_EXPORT)
    const { hold, reached, go } = holdOnce('greens-due')
    const seen = await proofsEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          // Between the reds and the greens of the start, the restored Builder idle and quiet.
          yield* Deferred.await(reached)
          // The detector compares the Workspace, as its timer does: the tree moved during the stop.
          yield* OutsideChanges.use((outside) => outside.compare(first.mission.id, null))
          yield* Effect.sleep('3 seconds')
          const between = yield* unprovenAsked
          yield* Deferred.succeed(go, undefined)
          // The end called on the green, or the user asked.
          yield* until(
            Effect.zipWith(
              endCalled(first.mission.id),
              unprovenAsked,
              (called, asked) => called || asked.length > 0,
            ),
            20_000,
          )
          return {
            between,
            asked: yield* unprovenAsked,
            proof: yield* proofOf(first.mission.id, 'R1.S2'),
          }
        }),
      ),
    )
    expect(first.asked).toEqual([])
    expect(seen.between).toEqual([])
    expect(seen.asked).toEqual([])
    expect(seen.proof.state).toBe('green')
  })

  /** The detector's timer never comes during a test: only a compare Hemera makes itself runs. */
  const NO_TIMER = { outside: { compareEveryMillis: 3_600_000 } }

  /** The mission brought to its failed green, the Builder at work until the stop. */
  const stoppedOnItsFix = Effect.gen(function* () {
    const { mission } = yield* launchedWith(markdownProof)
    yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
    const { grantId } = yield* builderOf(mission.id)
    return { mission, grantId }
  })

  test('a fix written to disk while Hemera is stopped: at the restart, the green runs again at once, before any timer of the outside detector', async () => {
    const builder = busyBuilder()
    const first = await proofsEngine(data, undefined, undefined, builder.agents, NO_TIMER).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission, grantId } = yield* stoppedOnItsFix
            yield* builder.busy
            yield* builds(grantId, 'T1')
            yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
            yield* builds(grantId, 'T4')
            yield* builds(grantId, 'T3')
            yield* deliveredTo(mission.id, 'The end waits')
            return { mission, api: yield* apiOf(mission.id) }
          }),
        ),
    )
    // The fix lands while Hemera is stopped.
    writeFileSync(join(first.api, 'export.ts'), RIGHT_EXPORT)
    const seen = await proofsEngine(data, undefined, undefined, undefined, NO_TIMER).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* until(
              Effect.zipWith(
                endCalled(first.mission.id),
                unprovenAsked,
                (called, asked) => called || asked.length > 0,
              ),
              20_000,
            )
            return {
              asked: yield* unprovenAsked,
              proof: yield* proofOf(first.mission.id, 'R1.S2'),
            }
          }),
        ),
    )
    expect(seen.asked).toEqual([])
    expect(seen.proof.state).toBe('green')
    // Run once again on the fix, never twice.
    expect(seen.proof.runs.map((one) => [one.phase, one.classification])).toEqual([
      ['red', 'assertion_failed'],
      ['green', 'assertion_failed'],
      ['green', 'passed'],
    ])
  })

  test('a restart with nothing changed during the stop: the failed green is not run again, and the quiet Builder’s question comes', async () => {
    const builder = busyBuilder()
    const first = await proofsEngine(data, undefined, undefined, builder.agents, NO_TIMER).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission, grantId } = yield* stoppedOnItsFix
            yield* builder.busy
            yield* builds(grantId, 'T1')
            yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
            yield* builds(grantId, 'T4')
            yield* builds(grantId, 'T3')
            yield* deliveredTo(mission.id, 'The end waits')
            return { mission }
          }),
        ),
    )
    const seen = await proofsEngine(data, undefined, undefined, undefined, NO_TIMER).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* until(
              Effect.map(unprovenAsked, (rows) => rows.some((one) => one.state === 'pending')),
              20_000,
            )
            return {
              called: yield* endCalled(first.mission.id),
              proof: yield* proofOf(first.mission.id, 'R1.S2'),
            }
          }),
        ),
    )
    expect(seen.called).toBe(false)
    expect(seen.proof.state).toBe('red_recorded')
    expect(seen.proof.runs.map((one) => [one.phase, one.classification])).toEqual([
      ['red', 'assertion_failed'],
      ['green', 'assertion_failed'],
    ])
  })
})

describe('A failed green and a change made outside Hemera', () => {
  /** The decisions Hemera asked about the scenarios the end waits on. */
  const unprovenAsked = Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(buildingDecisions)
      .where(eq(buildingDecisions.kind, 'proofs_unproven'))
  })

  /** The detector's timer never comes during a test: only the compares a test makes run. */
  const NO_TIMER = { outside: { compareEveryMillis: 3_600_000 } }

  /**
   * The points the Builder reached, in order; `more` may hold one. `taken(from)` waits until a
   * change outside Hemera was taken in after `from`, a settle of the writes began after it, and
   * every settle begun is done.
   */
  const reaching = (more: BuilderHold = () => Effect.void) => {
    const reached: string[] = []
    const count = (at: string, from = 0) => reached.slice(from).filter((one) => one === at).length
    const hold: BuilderHold = (at) =>
      Effect.andThen(
        Effect.sync(() => {
          reached.push(at)
        }),
        more(at),
      )
    return {
      hold,
      mark: Effect.sync(() => reached.length),
      count: (at: string, from = 0) => Effect.sync(() => count(at, from)),
      taken: (from: number) =>
        until(
          Effect.sync(() => {
            const outside = reached.indexOf('outside', from)
            return (
              outside >= 0 &&
              reached.indexOf('settling', outside) >= 0 &&
              count('settling') === count('settled')
            )
          }),
          20_000,
        ),
      /** Every change the mission's detector recorded was taken in, and its settle is done. */
      takenAll: (missionId: string) =>
        until(
          Effect.map(eventsOf(missionId, 'mission.changed_outside'), (said) => {
            const outside = reached.lastIndexOf('outside')
            return (
              said.length === count('outside') &&
              outside >= 0 &&
              reached.indexOf('settling', outside) >= 0 &&
              count('settling') === count('settled')
            )
          }),
          20_000,
        ),
    }
  }

  /** A Builder whose turns stay open from `hold` until `release`, so it is never judged quiet. */
  const heldBuilder = () => {
    let held = false
    const { promise: released, resolve: release } = Promise.withResolvers<void>()
    return {
      agents: (index: number): FakeScript =>
        index === 0 ? READING : { ...QUIET, between: () => (held ? released : Promise.resolve()) },
      hold: Effect.sync(() => {
        held = true
      }),
      release: Effect.sync(() => {
        held = false
        release()
      }),
    }
  }

  /** The detector's compare of the mission's Workspace, as its timer makes it. */
  const compared = (missionId: string) =>
    OutsideChanges.use((outside) => outside.compare(missionId, null))

  /** The proof's runs, by phase and class. */
  const runsOf = (missionId: string) =>
    Effect.map(proofOf(missionId, 'R1.S2'), (proof) =>
      proof.runs.map((one) => [one.phase, one.classification]),
    )

  test('a fix written to disk outside Hemera while the Builder is quiet: the detector’s compare runs the failed green again once, and the “not proven” question does not come', async () => {
    const builder = heldBuilder()
    const seen = await proofsEngine(data, undefined, undefined, builder.agents, NO_TIMER).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launchedWith(markdownProof)
            yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
            const { grantId } = yield* builderOf(mission.id)
            yield* builder.hold
            yield* builds(grantId, 'T1')
            yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
            yield* builds(grantId, 'T4')
            yield* builds(grantId, 'T3')
            yield* deliveredTo(mission.id, 'The end waits')
            // The user fixes the file in their editor; the Builder writes nothing.
            writeFileSync(join(yield* apiOf(mission.id), 'export.ts'), RIGHT_EXPORT)
            yield* compared(mission.id)
            yield* proofIn(mission.id, 'R1.S2', 'green')
            // The Builder's turn ends without a write: the end goes on, nobody is asked.
            yield* builder.release
            yield* until(
              Effect.zipWith(
                endCalled(mission.id),
                unprovenAsked,
                (called, asked) => called || asked.length > 0,
              ),
              20_000,
            )
            return { asked: yield* unprovenAsked, runs: yield* runsOf(mission.id) }
          }),
        ),
    )
    expect(seen.asked).toEqual([])
    expect(seen.runs).toEqual([
      ['red', 'assertion_failed'],
      ['green', 'assertion_failed'],
      ['green', 'passed'],
    ])
  })

  test('a compare that finds nothing changed runs no green and is not taken in as a write', async () => {
    const points = reaching()
    const seen = await proofsEngine(data, points.hold, undefined, builderAgents, NO_TIMER).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launchedWith(markdownProof)
            yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
            const { grantId } = yield* builderOf(mission.id)
            yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
            yield* deliveredTo(mission.id, "R1.S2's proof is not green")
            const from = yield* points.mark
            // The first compare takes in the Builder's own writes; the second finds the same tree.
            yield* compared(mission.id)
            yield* compared(mission.id)
            const quiet = yield* runsOf(mission.id)
            // Then a real change, compared: the only one taken in. The events are followed in
            // order, so a change taken in for the compares before would be counted first.
            writeFileSync(join(yield* apiOf(mission.id), 'export.ts'), RIGHT_EXPORT)
            yield* compared(mission.id)
            yield* points.taken(from)
            return {
              quiet,
              outside: yield* points.count('outside', from),
              runs: yield* runsOf(mission.id),
            }
          }),
        ),
    )
    expect(seen.quiet).toEqual([
      ['red', 'assertion_failed'],
      ['green', 'assertion_failed'],
    ])
    expect(seen.outside).toBe(1)
    expect(seen.runs).toEqual([
      ['red', 'assertion_failed'],
      ['green', 'assertion_failed'],
      ['green', 'passed'],
    ])
  })

  test('a change outside Hemera and a Builder write settling at the same moment: the failed green runs again once', async () => {
    const go = Deferred.makeUnsafe<void>()
    const points = reaching((at) => (at === 'settling' ? Deferred.await(go) : Effect.void))
    const seen = await proofsEngine(data, points.hold, undefined, builderAgents, NO_TIMER).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launchedWith(markdownProof)
            yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
            const { grantId } = yield* builderOf(mission.id)
            yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
            yield* deliveredTo(mission.id, "R1.S2's proof is not green")
            const from = yield* points.mark
            // The Builder's fix: its settle begins, and is held there.
            yield* writes(grantId, 'export.ts', RIGHT_EXPORT)
            yield* until(Effect.map(points.count('settling', from), (count) => count === 1))
            // The user's change, compared while it is held: a second settle begins beside it.
            writeFileSync(join(yield* apiOf(mission.id), 'notes.md'), 'Checked by hand.\n')
            yield* compared(mission.id)
            yield* until(Effect.map(points.count('settling', from), (count) => count === 2))
            // Both read the trees and look for the greens due at once.
            yield* Deferred.succeed(go, undefined)
            yield* points.taken(from)
            return yield* runsOf(mission.id)
          }),
        ),
    )
    expect(seen).toEqual([
      ['red', 'assertion_failed'],
      ['green', 'assertion_failed'],
      ['green', 'passed'],
    ])
  })

  /** The ways the Builder or the user run a failed green again, each of which allows one more rerun. */
  const resets = [
    [
      'a Builder write',
      (_missionId: string, grantId: string) => writes(grantId, 'notes.md', 'Read again.\n'),
    ],
    ['a task end', (_missionId: string, grantId: string) => builds(grantId, 'T1')],
    [
      'a proof_run',
      (_missionId: string, grantId: string) => call(grantId, 'proof_run', { scenario: 'R1.S2' }),
    ],
    ['a refresh', (missionId: string) => BuildDesk.use((desk) => desk.refreshProofs(missionId))],
  ] as const

  for (const [reset, act] of resets) {
    test(`changes outside Hemera rerun a failed green once, then not again until ${reset} allows one more`, async () => {
      const points = reaching()
      const seen = await proofsEngine(data, points.hold, undefined, builderAgents, NO_TIMER).run(
        ({ profile }) =>
          within(
            profile,
            Effect.gen(function* () {
              const { mission } = yield* launchedWith(markdownProof)
              yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
              const { grantId } = yield* builderOf(mission.id)
              yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
              yield* deliveredTo(mission.id, "R1.S2's proof is not green")
              const api = yield* apiOf(mission.id)
              const outside = (content: string) =>
                Effect.gen(function* () {
                  const from = yield* points.mark
                  writeFileSync(join(api, 'export.ts'), content)
                  yield* compared(mission.id)
                  yield* points.taken(from)
                  return yield* runsOf(mission.id)
                })
              // Half a fix: it runs the green again, which fails on it.
              const once = yield* outside('export const toJson = () => ""\n')
              // Another change: that failure's rerun is spent.
              const spent = yield* outside('export const toYaml = () => ""\n')
              // The Builder or the user runs it: one more rerun is allowed.
              yield* act(mission.id, grantId)
              yield* until(Effect.map(runsOf(mission.id), (runs) => runs.length === 4))
              yield* until(
                Effect.zipWith(
                  points.count('settling'),
                  points.count('settled'),
                  (begun, done) => begun === done,
                ),
              )
              const fixed = yield* outside(RIGHT_EXPORT)
              return { once, spent, fixed }
            }),
          ),
      )
      const failed = ['green', 'assertion_failed']
      expect(seen.once).toEqual([['red', 'assertion_failed'], failed, failed])
      expect(seen.spent).toEqual(seen.once)
      expect(seen.fixed).toEqual([
        ['red', 'assertion_failed'],
        failed,
        failed,
        failed,
        ['green', 'passed'],
      ])
    })
  }

  /** The mission past its failed green, then a change outside Hemera that spent its rerun. */
  const spentOnce = (points: ReturnType<typeof reaching>) =>
    Effect.gen(function* () {
      const { mission } = yield* launchedWith(markdownProof)
      yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
      const { grantId } = yield* builderOf(mission.id)
      yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
      yield* deliveredTo(mission.id, "R1.S2's proof is not green")
      const api = yield* apiOf(mission.id)
      const outside = (path: string, content: string) =>
        Effect.gen(function* () {
          const from = yield* points.mark
          writeFileSync(join(api, path), content)
          yield* compared(mission.id)
          yield* points.taken(from)
          return yield* runsOf(mission.id)
        })
      const spent = yield* outside('export.ts', 'export const toJson = () => ""\n')
      return { mission, grantId, api, outside, spent }
    })

  const FAILED = ['green', 'assertion_failed']

  test('a Builder write and a change outside Hemera in the same settle: the failed green runs again once, as for a Builder write, and the next change outside Hemera may run it again', async () => {
    const window = Deferred.makeUnsafe<void>()
    const reached = Deferred.makeUnsafe<void>()
    let armed = false
    const points = reaching((at) =>
      Effect.gen(function* () {
        if (!armed) return
        // The Builder's write holds its settle's window open…
        if (at === 'window') {
          yield* Deferred.succeed(reached, undefined)
          yield* Deferred.await(window)
        }
        // …until the change outside Hemera has joined it.
        if (at === 'joined') {
          armed = false
          yield* Deferred.succeed(window, undefined)
        }
      }),
    )
    const seen = await proofsEngine(data, points.hold, undefined, builderAgents, NO_TIMER).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission, grantId, api, outside, spent } = yield* spentOnce(points)
            const from = yield* points.mark
            armed = true
            yield* writes(grantId, 'export.ts', 'export const toYaml = () => ""\n')
            yield* Deferred.await(reached)
            writeFileSync(join(api, 'notes.md'), 'Checked by hand.\n')
            yield* compared(mission.id)
            yield* points.taken(from)
            const together = yield* runsOf(mission.id)
            // Run for the Builder's write, it left the budget whole: the next change runs it.
            const fixed = yield* outside('export.ts', RIGHT_EXPORT)
            return { spent, together, fixed }
          }),
        ),
    )
    expect(seen.spent).toEqual([['red', 'assertion_failed'], FAILED, FAILED])
    expect(seen.together).toEqual([['red', 'assertion_failed'], FAILED, FAILED, FAILED])
    expect(seen.fixed).toEqual([
      ['red', 'assertion_failed'],
      FAILED,
      FAILED,
      FAILED,
      ['green', 'passed'],
    ])
  })

  test('a task end on trees unchanged since the failure runs nothing, and still allows a change outside Hemera one more rerun', async () => {
    const points = reaching()
    const seen = await proofsEngine(data, points.hold, undefined, builderAgents, NO_TIMER).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission, grantId, outside, spent } = yield* spentOnce(points)
            // T1 writes nothing: its end finds the greens due on the trees they failed on.
            yield* builds(grantId, 'T1')
            const ended = yield* runsOf(mission.id)
            const fixed = yield* outside('export.ts', RIGHT_EXPORT)
            return { spent, ended, fixed }
          }),
        ),
    )
    expect(seen.spent).toEqual([['red', 'assertion_failed'], FAILED, FAILED])
    expect(seen.ended).toEqual(seen.spent)
    expect(seen.fixed).toEqual([['red', 'assertion_failed'], FAILED, FAILED, ['green', 'passed']])
  })

  test('the question’s Try again allows a change outside Hemera one more rerun', async () => {
    const points = reaching()
    const seen = await proofsEngine(data, points.hold, undefined, builderAgents, NO_TIMER).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launchedWith(markdownProof)
            yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
            const { grantId } = yield* builderOf(mission.id)
            yield* builds(grantId, 'T1')
            yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
            yield* builds(grantId, 'T4')
            yield* builds(grantId, 'T3')
            const api = yield* apiOf(mission.id)
            const outside = (content: string) =>
              Effect.gen(function* () {
                const from = yield* points.mark
                writeFileSync(join(api, 'export.ts'), content)
                yield* compared(mission.id)
                yield* points.taken(from)
                return yield* runsOf(mission.id)
              })
            yield* outside('export const toJson = () => ""\n')
            const spent = yield* outside('export const toYaml = () => ""\n')
            // The quiet Builder's question, answered Try again: the green runs, and fails.
            yield* until(
              Effect.map(unprovenAsked, (rows) => rows.some((one) => one.state === 'pending')),
              20_000,
            )
            const asked = (yield* unprovenAsked).find((one) => one.state === 'pending')
            if (asked === undefined) return yield* Effect.die(new Error('not asked'))
            yield* answerNeed({
              id: asked.needId,
              answer: ChosenAnswer.make({ option: TRY_AGAIN }),
              key: 'b',
            })
            yield* until(Effect.map(runsOf(mission.id), (runs) => runs.length === 4))
            const fixed = yield* outside(RIGHT_EXPORT)
            return { spent, fixed }
          }),
        ),
    )
    expect(seen.spent).toEqual([['red', 'assertion_failed'], FAILED, FAILED])
    expect(seen.fixed).toEqual([
      ['red', 'assertion_failed'],
      FAILED,
      FAILED,
      FAILED,
      ['green', 'passed'],
    ])
  })

  test('a failed green whose run leaves a process writing into the Workspace runs again once, never in a loop', async () => {
    const points = reaching()
    const starts = join(scratch, 'starts')
    const child = join(scratch, 'late.mjs')
    const done = join(scratch, 'done')
    // Each run's child counts its start, then writes `ran.log` once the test lets it, by `go-<n>`;
    // it ends once the test is done, its folder out of the test's, which Windows could not remove.
    writeFileSync(
      child,
      [
        "import { appendFileSync, existsSync, readFileSync } from 'node:fs'",
        `appendFileSync(${JSON.stringify(starts)}, 'x')`,
        `const n = readFileSync(${JSON.stringify(starts)}, 'utf8').length`,
        'const until = Date.now() + 20_000',
        'const tick = () => {',
        `  if (existsSync(${JSON.stringify(done)})) return`,
        `  if (existsSync(${JSON.stringify(scratch)} + '/go-' + n)) { appendFileSync(process.argv[2], 'late-' + n + '\\n'); return }`,
        '  if (Date.now() < until) setTimeout(tick, 20)',
        '}',
        'tick()',
      ].join('\n'),
    )
    const lingering = () => ({
      'R1.S2': automated(
        EXPORT_PATH,
        testFile(
          [
            `  spawn(process.execPath, [${JSON.stringify(child)}, fileURLToPath(new URL('../ran.log', import.meta.url))], { cwd: tmpdir(), detached: true, stdio: 'ignore' }).unref()`,
            "  assert.fail('not built yet')",
          ].join('\n'),
          [
            "import { spawn } from 'node:child_process'",
            "import { tmpdir } from 'node:os'",
            "import { fileURLToPath } from 'node:url'",
          ],
        ),
      ),
    })
    const phases = (missionId: string) =>
      Effect.map(proofOf(missionId, 'R1.S2'), (proof) => proof.runs.map((one) => one.phase))
    /** The child of run `n` writes, and the detector's timer compares. */
    const late = (missionId: string, n: number) =>
      Effect.gen(function* () {
        const log = join(yield* apiOf(missionId), 'ran.log')
        const from = yield* points.mark
        writeFileSync(join(scratch, `go-${n}`), '')
        yield* until(
          Effect.sync(() => existsSync(log) && readFileSync(log, 'utf8').includes(`late-${n}`)),
        )
        yield* compared(missionId)
        yield* points.taken(from)
        return yield* phases(missionId)
      })
    const seen = await proofsEngine(data, points.hold, undefined, builderAgents, NO_TIMER).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launchedWith(lingering)
            yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
            const { grantId } = yield* builderOf(mission.id)
            yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
            yield* deliveredTo(mission.id, "R1.S2's proof is not green")
            // The red's child and the green's.
            yield* until(
              Effect.sync(() => existsSync(starts) && readFileSync(starts, 'utf8').length === 2),
            )
            const one = yield* late(mission.id, 2)
            yield* until(
              Effect.sync(() => existsSync(starts) && readFileSync(starts, 'utf8').length === 3),
            )
            const two = yield* late(mission.id, 3)
            return { one, two }
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                writeFileSync(done, '')
              }),
            ),
          ),
        ),
    )
    expect(seen.one).toEqual(['red', 'green', 'green'])
    expect(seen.two).toEqual(['red', 'green', 'green'])
  })

  /** R1.S2's test notes each run in `api/ran.log`, as coverage or a cache would, and checks the export. */
  const notedExport = () => ({
    'R1.S2': automated(
      EXPORT_PATH,
      testFile(
        [
          "  appendFileSync(new URL('../ran.log', import.meta.url), `${Date.now()}\\n`)",
          "  const file = new URL('../export.ts', import.meta.url)",
          "  assert.ok(existsSync(file) && readFileSync(file, 'utf8').includes('toMarkdown'), 'no toMarkdown')",
        ].join('\n'),
      ),
    ),
  })

  /** The states of the questions about the proofs the end waits on. */
  const askedStates = Effect.map(unprovenAsked, (rows) => rows.map((one) => one.state))

  for (const [order, gated] of [
    ['in the natural order', false],
    ['its change taken in only once the question is pending', true],
  ] as const) {
    test(`a failed green whose run writes into the Workspace, then the quiet Builder’s question, ${order}: the question is not withdrawn and does not come back`, async () => {
      const go = Deferred.makeUnsafe<void>()
      let closed = false
      const points = reaching((at) =>
        at === 'outside' && closed ? Deferred.await(go) : Effect.void,
      )
      const seen = await proofsEngine(data, points.hold, undefined, builderAgents, NO_TIMER).run(
        ({ profile }) =>
          within(
            profile,
            Effect.gen(function* () {
              const { mission } = yield* launchedWith(notedExport)
              yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
              // What the red's run wrote is taken in before the follower is held.
              yield* points.takenAll(mission.id)
              closed = gated
              const { grantId } = yield* builderOf(mission.id)
              yield* builds(grantId, 'T1')
              yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
              yield* builds(grantId, 'T4')
              yield* builds(grantId, 'T3')
              // The failed green, which the quiet Builder no longer acts on: the user is asked.
              yield* until(
                Effect.map(askedStates, (states) => states.includes('pending')),
                20_000,
              )
              const first = yield* askedStates
              closed = false
              yield* Deferred.succeed(go, undefined)
              // What the green's run wrote is taken in, and its settle judged the end again.
              yield* points.takenAll(mission.id)
              return {
                first,
                asked: yield* askedStates,
                runs: yield* runsOf(mission.id),
              }
            }),
          ),
      )
      expect(seen.first).toEqual(['pending'])
      expect(seen.asked).toEqual(['pending'])
      expect(seen.runs).toEqual([
        ['red', 'assertion_failed'],
        ['green', 'assertion_failed'],
      ])
    })
  }

  test('a failed green whose own run writes into the Workspace: the change the detector sees from it does not run it again', async () => {
    const points = reaching()
    // R1.S2's test notes each run in `api/ran.log`, a file of the Workspace, and fails.
    const noting = () => ({
      'R1.S2': automated(
        EXPORT_PATH,
        testFile(
          [
            "  appendFileSync(new URL('../ran.log', import.meta.url), `${Date.now()}\\n`)",
            "  assert.fail('not built yet')",
          ].join('\n'),
        ),
      ),
    })
    const seen = await proofsEngine(data, points.hold, undefined, builderAgents, NO_TIMER).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launchedWith(noting)
            yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
            const { grantId } = yield* builderOf(mission.id)
            yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
            yield* deliveredTo(mission.id, "R1.S2's proof is not green")
            const from = yield* points.mark
            // The compare after the failed run finds what it wrote, outside Hemera: taken in.
            yield* until(
              Effect.map(
                OutsideChanges.use((outside) => outside.list(mission.id)),
                (found) =>
                  found.some((one) =>
                    one.changes.some(
                      (change) => change.path === 'ran.log' && change.status === 'M',
                    ),
                  ),
              ),
            )
            yield* points.takenAll(mission.id)
            return {
              greening: yield* points.count('greening', from),
              runs: yield* runsOf(mission.id),
            }
          }),
        ),
    )
    expect(seen.greening).toBe(0)
    expect(seen.runs).toEqual([
      ['red', 'assertion_failed'],
      ['green', 'assertion_failed'],
    ])
  })

  /**
   * R1.S2's test, held while it runs: run `n` reads `api/export.ts`, says so with `read-<n>` and
   * waits for `go-<n>` before it judges what it read. With `cache`, it first notes the run in
   * `api/ran.log`, as coverage or a cache would.
   */
  const heldExport = (cache: boolean) => () => {
    const runs = JSON.stringify(join(scratch, 'runs'))
    const folder = JSON.stringify(scratch)
    return {
      'R1.S2': automated(
        EXPORT_PATH,
        testFile(
          [
            `  appendFileSync(${runs}, 'x')`,
            `  const n = readFileSync(${runs}, 'utf8').length`,
            "  const file = new URL('../export.ts', import.meta.url)",
            "  const read = existsSync(file) ? readFileSync(file, 'utf8') : ''",
            ...(cache
              ? ["  appendFileSync(new URL('../ran.log', import.meta.url), `run ${n}\\n`)"]
              : []),
            `  writeFileSync(${folder} + '/read-' + n, '')`,
            '  await new Promise((resolve, reject) => {',
            '    const until = Date.now() + 20_000',
            '    const tick = () => {',
            `      if (existsSync(${folder} + '/go-' + n)) resolve()`,
            "      else if (Date.now() > until) reject(new Error('never let go'))",
            '      else setTimeout(tick, 20)',
            '    }',
            '    tick()',
            '  })',
            "  assert.ok(read.includes('toMarkdown'), 'export.ts has no toMarkdown')",
          ].join('\n'),
          ["import { writeFileSync } from 'node:fs'"],
        ),
      ),
    }
  }

  /** Runs `n` of the held test are not held. */
  const letGo = (...n: ReadonlyArray<number>) =>
    Effect.sync(() => {
      for (const one of n) writeFileSync(join(scratch, `go-${one}`), '')
    })

  /** Run `n` of the held test has read `export.ts`: `meanwhile` happens, then it is let go. */
  const whileHeld = <E, R>(n: number, meanwhile: Effect.Effect<void, E, R>) =>
    Effect.gen(function* () {
      yield* until(
        Effect.sync(() => existsSync(join(scratch, `read-${n}`))),
        20_000,
      )
      yield* meanwhile
      yield* letGo(n)
    })

  /** The user writes a file of `api` in their editor. */
  const edits = (missionId: string, content: string, path = 'export.ts') =>
    Effect.gen(function* () {
      writeFileSync(join(yield* apiOf(missionId), path), content)
    })

  test('a fix written outside Hemera while the failed green’s run is held: once the run ends, the green runs again once, and the “not proven” question does not come', async () => {
    const builder = heldBuilder()
    const seen = await proofsEngine(data, undefined, undefined, builder.agents, NO_TIMER).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* letGo(1, 3)
            const { mission } = yield* launchedWith(heldExport(false))
            yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
            const { grantId } = yield* builderOf(mission.id)
            yield* builder.hold
            const building = yield* Effect.forkChild(
              Effect.gen(function* () {
                yield* builds(grantId, 'T1')
                yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
                yield* builds(grantId, 'T4')
                yield* builds(grantId, 'T3')
              }),
            )
            // The green has read the wrong export; the user fixes it before the run ends.
            yield* whileHeld(2, edits(mission.id, RIGHT_EXPORT))
            yield* proofIn(mission.id, 'R1.S2', 'green')
            yield* Fiber.join(building)
            // The Builder's turn ends without a write: the end goes on, nobody is asked.
            yield* builder.release
            yield* until(
              Effect.zipWith(
                endCalled(mission.id),
                unprovenAsked,
                (called, asked) => called || asked.length > 0,
              ),
              20_000,
            )
            return { asked: yield* unprovenAsked, runs: yield* runsOf(mission.id) }
          }),
        ),
    )
    expect(seen.asked).toEqual([])
    expect(seen.runs).toEqual([
      ['red', 'assertion_failed'],
      ['green', 'assertion_failed'],
      ['green', 'passed'],
    ])
  })

  for (const [what, fix, runs] of [
    [
      'writes its own cache, and nothing else lands: it does not run again',
      false,
      [
        ['red', 'assertion_failed'],
        ['green', 'assertion_failed'],
      ],
    ],
    [
      'writes its own cache while a fix lands outside Hemera: it runs again once',
      true,
      [
        ['red', 'assertion_failed'],
        ['green', 'assertion_failed'],
        ['green', 'passed'],
      ],
    ],
  ] as const) {
    test(`a failed green whose held run ${what}`, async () => {
      const points = reaching()
      const seen = await proofsEngine(data, points.hold, undefined, builderAgents, NO_TIMER).run(
        ({ profile }) =>
          within(
            profile,
            Effect.gen(function* () {
              yield* letGo(1, 3)
              const { mission } = yield* launchedWith(heldExport(true))
              yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
              const { grantId } = yield* builderOf(mission.id)
              const building = yield* Effect.forkChild(
                builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]]),
              )
              yield* whileHeld(2, fix ? edits(mission.id, RIGHT_EXPORT) : Effect.void)
              yield* Fiber.join(building)
              yield* deliveredTo(mission.id, "R1.S2's proof is not green")
              // What the green's run wrote, and the fix, are taken in, and their settle is done.
              yield* points.takenAll(mission.id)
              return yield* runsOf(mission.id)
            }),
          ),
      )
      expect(seen).toEqual(runs)
    })
  }

  test('a change outside Hemera landing during each failed run: the green runs again once, then not for the change that landed during that rerun', async () => {
    const points = reaching()
    const seen = await proofsEngine(data, points.hold, undefined, builderAgents, NO_TIMER).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* letGo(1, 4)
            const { mission } = yield* launchedWith(heldExport(true))
            yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
            const { grantId } = yield* builderOf(mission.id)
            const building = yield* Effect.forkChild(
              builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]]),
            )
            // Two tries of the user, each landing while a run is held, neither of them a fix; the
            // second in a file no run changed yet, so that it lands too.
            yield* whileHeld(2, edits(mission.id, 'export const toCsv = () => "1"\n'))
            yield* Fiber.join(building)
            yield* whileHeld(3, edits(mission.id, 'export const notes = []\n', 'notes.ts'))
            yield* until(
              Effect.map(runsOf(mission.id), (runs) => runs.length === 3),
              20_000,
            )
            yield* points.takenAll(mission.id)
            return yield* runsOf(mission.id)
          }),
        ),
    )
    expect(seen).toEqual([
      ['red', 'assertion_failed'],
      ['green', 'assertion_failed'],
      ['green', 'assertion_failed'],
    ])
  })
})

describe('What the reviewers see of the red phase', () => {
  test('the Builder’s writes outside the proof files before a scenario’s red are recorded for the reviewers', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          // R1.S2 already passes: it waits for its red on the user's answer, its file lock free.
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(EXPORT_PATH, testFile("  assert.equal(1, 1, 'it passes')")),
          }))
          const need = yield* needOf(mission.id, 'Decision')
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* writes(grantId, 'invoices.ts', 'export const invoices = [1]\n')
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: NOT_REPRODUCIBLE }),
            key: 'answer-1',
          })
          yield* proofIn(mission.id, 'R1.S2', 'not_reproducible')
          yield* writes(grantId, 'README.md', 'Acme api, once nothing waits for a red\n')
          return yield* proofsOf(mission.id)
        }),
      ),
    )
    expect(
      seen.writtenBeforeRed.map((one) => [one.repository, one.path, one.task, one.scenarios]),
    ).toEqual([['api', 'invoices.ts', 'T1', ['R1.S2']]])
  })

  test('a green held on its environment is no red to wait for: the Builder’s writes meanwhile are not recorded as written before it', async () => {
    let proofCommand = ''
    let held = false
    const seen = await proofsEngine(data, undefined, undefined, undefined, {
      proofMinute: Duration.seconds(2),
    }).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            (projectId) =>
              Effect.gen(function* () {
                yield* setProofLimit(projectId, 1)
                const saved = yield* saveCommand({
                  projectId,
                  id: null,
                  command: {
                    name: 'export proof',
                    type: 'script',
                    line: testLine(`api/${EXPORT_PATH}`),
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
                // Free for the red; from the green on, another mission's service holds the port.
                const runs = yield* Runs
                const real = runs.reservations.current
                runs.reservations.current = {
                  enter: (run) =>
                    run.commandId === proofCommand && held
                      ? Effect.succeed({ names: ['the dev port'], wait: () => Effect.never })
                      : real.enter(run),
                }
              }),
            undefined,
            undefined,
            undefined,
            undefined,
            () => ({
              'R1.S2': automated(EXPORT_PATH, EXPORT_TEST, {
                test: {
                  repository: 'api',
                  path: EXPORT_PATH,
                  code: EXPORT_TEST,
                  insertion: 'new_file',
                  command: proofCommand,
                },
              }),
            }),
          )
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          held = true
          yield* builds(grantId, 'T2', [['export.ts', RIGHT_EXPORT]])
          yield* needOf(mission.id, 'Environment')
          const waiting = (yield* proofOf(mission.id, 'R1.S2')).state
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* writes(grantId, 'invoices.ts', 'export const invoices = [1]\n')
          return { waiting, view: yield* proofsOf(mission.id) }
        }),
      ),
    )
    expect(seen.waiting).toBe('held')
    expect(seen.view.writtenBeforeRed).toEqual([])
  })

  test('the detector of changes outside Hemera does not report Hemera’s proof writes', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(exportProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          yield* OutsideChanges.use((outside) => outside.compare(mission.id, null))
          return yield* OutsideChanges.use((outside) => outside.list(mission.id))
        }),
      ),
    )
    expect(seen.flatMap((repository) => repository.changes.map((one) => one.path))).toEqual([])
  })

  test('the ready set says why: T3 waits for the red of R1.S3', async () => {
    const log = join(scratch, 's3.log')
    const release = join(scratch, 's3.release')
    const plan = PLAN.map((task) =>
      task.title === 'Document the exports' ? Object.assign({}, task, { depends_on: [] }) : task,
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          // R1.S2's red lets T2 on, which is delivered while R1.S3's red still runs.
          const { mission } = yield* launchedWith(
            () => ({
              'R1.S2': automated(EXPORT_PATH, EXPORT_TEST),
              'R1.S3': automated('tests/readme.test.mjs', loggedTest(log, release)),
            }),
            plan,
          )
          yield* until(Effect.sync(() => runsIn(log) === 1))
          const delivered = yield* deliveredTo(mission.id, 'T3 waits for the red of R1.S3')
          const view = yield* buildingNow(mission.id)
          writeFileSync(release, '')
          return { delivered, t3: view.tasks.find((task) => task.id === 'T3') }
        }),
      ),
    )
    expect(seen.delivered).toContain('T3 waits for the red of R1.S3')
    expect(seen.t3?.waiting).toBe('waits for the red of R1.S3')
  })
})

describe('The proofs’ reach', () => {
  test('a scenario with no covering task runs its green once every task of its requirement is done', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(exportProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          // An amendment left R1.S2 to no task of the plan.
          const database = yield* Database
          yield* database
            .update(buildingTasks)
            .set({ scenarios: '[]' })
            .where(eq(buildingTasks.id, 'T2'))
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', RIGHT_EXPORT]])
          yield* builds(grantId, 'T1')
          const halfway = (yield* proofOf(mission.id, 'R1.S2')).state
          yield* builds(grantId, 'T4')
          yield* builds(grantId, 'T3')
          yield* proofIn(mission.id, 'R1.S2', 'green')
          return { halfway }
        }),
      ),
    )
    expect(seen.halfway).toBe('red_recorded')
  })

  test('freshness covers every repository its tasks wrote: a test in web, a fix in api, a later change in api makes it to_rerun', async () => {
    const path = 'tests/export.test.mjs'
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            undefined,
            'The exports change api, web and nothing else',
            undefined,
            undefined,
            undefined,
            () => ({
              'R1.S2': automated(
                path,
                testFile(
                  "  assert.equal(existsSync(new URL('../../api/export.ts', import.meta.url)), true, 'export.ts exports nothing yet')",
                ),
                {
                  test: {
                    repository: 'web',
                    path,
                    code: testFile(
                      "  assert.equal(existsSync(new URL('../../api/export.ts', import.meta.url)), true, 'export.ts exports nothing yet')",
                    ),
                    insertion: 'new_file',
                    command: testLine(path),
                  },
                },
              ),
            }),
          )
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', RIGHT_EXPORT]])
          yield* proofIn(mission.id, 'R1.S2', 'green')
          const green = yield* proofOf(mission.id, 'R1.S2')
          yield* builds(grantId, 'T1', [['invoices.ts', 'export const invoices = [1]\n']])
          yield* proofIn(mission.id, 'R1.S2', 'to_rerun')
          return { green }
        }),
      ),
    )
    expect(seen.green.green?.trees.map((one) => one.repository).toSorted()).toEqual(['api', 'web'])
  })

  test('a green whose repository moved during its run is to_rerun, never green', async () => {
    const { hold, reached, go } = holdOnce('greening')
    const seen = await proofsEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(exportProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* Effect.forkChild(builds(grantId, 'T2', [['export.ts', RIGHT_EXPORT]]))
          yield* Deferred.await(reached)
          // T1's end is a snapshot of `api`: its tree moves under the green just run.
          yield* builds(grantId, 'T1', [['invoices.ts', 'export const invoices = [1]\n']])
          yield* Deferred.succeed(go, undefined)
          yield* proofIn(mission.id, 'R1.S2', 'to_rerun')
          return yield* proofOf(mission.id, 'R1.S2')
        }),
      ),
    )
    expect(seen.green).toBeNull()
    expect(seen.runs.map((one) => one.phase)).toEqual(['red', 'green'])
  })

  test('an existing failing test in the same file is not taken as the scenario’s red', async () => {
    const broken = testFile("  assert.equal(1, 2, 'it was broken already')")
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          // The scenario's own test passes: only the test that was broken before fails.
          const { mission } = yield* launchedWith((api) => ({
            'R1.S2': withExisting(
              api,
              broken,
              ADDED.replace(/assert\.equal\(.*\)/, 'assert.ok(true)'),
            ),
          }))
          yield* deliveredTo(mission.id, 'Fix the setup')
          return {
            proof: yield* proofOf(mission.id, 'R1.S2'),
            events: yield* payloadsOf(mission.id, 'building.red_invalid'),
          }
        }),
      ),
    )
    expect(seen.proof.state).toBe('waiting_red')
    expect(seen.events).toEqual([{ scenario: 'R1.S2', classification: 'assertion_failed' }])
  })

  test('proof_run before the Builder integrated a conflicting addition is refused, never a false "already passes"', async () => {
    const { hold, reached, go } = holdOnce('proving')
    const theirs = `${EXISTING}\ntest('another', () => {})\n`
    const seen = await proofsEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith((api) => ({ 'R1.S2': withExisting(api) }))
          yield* Deferred.await(reached)
          writeFileSync(join(yield* apiOf(mission.id), EXISTING_PATH), theirs)
          yield* Deferred.succeed(go, undefined)
          const { grantId } = yield* builderOf(mission.id)
          yield* deliveredTo(mission.id, 'Integrate the test by hand')
          return {
            answer: yield* call(grantId, 'proof_run', { scenario: 'R1.S2' }),
            mission: yield* getMission(mission.id),
          }
        }),
      ),
    )
    expect(seen.answer).toContain("R1.S2's test is not in place yet")
    expect(seen.mission.needs).toEqual([])
  })

  test('an engine stopped between the proofs written and a conflict’s hand-over hands it over at the next start', async () => {
    const conflict = holdOnce('proving')
    const handing = holdOnce('handing')
    const hold: BuilderHold = (at) =>
      at === 'handing' ? Effect.andThen(handing.hold(at), Effect.never) : conflict.hold(at)
    const theirs = `${EXISTING}\ntest('another', () => {})\n`
    const first = await proofsEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith((api) => ({ 'R1.S2': withExisting(api) }))
          yield* Deferred.await(conflict.reached)
          writeFileSync(join(yield* apiOf(mission.id), EXISTING_PATH), theirs)
          yield* Deferred.succeed(conflict.go, undefined)
          yield* Deferred.await(handing.reached)
          return { mission }
        }),
      ),
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* deliveredTo(first.mission.id, 'Integrate the test by hand')
          return yield* proofAttemptsOf('R1.S2')
        }),
      ),
    )
    expect(seen.map((one) => one.verdict)).toEqual(['red'])
  })
})

describe('What the user answers on a red', () => {
  const line = "error: 'rounding is off by a cent'"
  const mismatch = (api: string) => ({
    'R1.S2': automated(
      EXPORT_PATH,
      testFile('  assert.fail(`total is wrong in ${fileURLToPath(import.meta.url)} after 12ms`)', [
        "import { fileURLToPath } from 'node:url'",
      ]),
      {
        seen_today: true,
        observed: `not ok 1 - the scenario holds\n  ${line}`,
        key_line: line,
        base_commit: [{ repository: 'api', commit: git(api, 'rev-parse', 'HEAD').trim() }],
      },
    ),
  })

  test('"accept this red" records it and lets the covering tasks on', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(mismatch)
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: ACCEPT_RED }),
            key: 'answer-1',
          })
          yield* taskIn(mission.id, 'T2', 'available')
          return yield* proofOf(mission.id, 'R1.S2')
        }),
      ),
    )
    expect(seen.state).toBe('red_recorded')
    expect(seen.red?.keyLineMatched).toBe(false)
  })

  test('"send it back" opens an attempt for the Builder with both outputs', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(mismatch)
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: SEND_BACK }),
            key: 'answer-1',
          })
          const delivered = yield* deliveredTo(mission.id, 'the user sent this red back')
          return {
            delivered,
            attempts: yield* proofAttemptsOf('R1.S2'),
            proof: yield* proofOf(mission.id, 'R1.S2'),
          }
        }),
      ),
    )
    expect(seen.delivered).toContain('rounding is off by a cent')
    expect(seen.delivered).toContain('total is wrong in')
    expect(seen.attempts.map((one) => one.verdict)).toEqual(['red'])
    expect(seen.proof.state).toBe('waiting_red')
  })

  test('"more information" is delivered to the Builder', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(EXPORT_PATH, testFile("  assert.equal(1, 1, 'it passes')")),
          }))
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: WrittenAnswer.make({ text: 'It fails on the March invoices only.' }),
            key: 'answer-1',
          })
          return {
            // The answer itself is kept for the Builder as it is applied; what it means comes next.
            delivered: yield* deliveredTo(
              mission.id,
              'R1.S2 already passes, and the user says more',
            ),
            proof: yield* proofOf(mission.id, 'R1.S2'),
          }
        }),
      ),
    )
    expect(seen.delivered).toContain(
      'R1.S2 already passes, and the user says more: It fails on the March invoices only.',
    )
    expect(seen.proof.state).toBe('waiting_red')
  })

  /** The engine stopped once an answer is applied, its follower not past it. */
  const stoppedOnAnswer = () => {
    const answering = holdOnce('answering')
    const hold: BuilderHold = (at) =>
      at === 'answering' ? Effect.andThen(answering.hold(at), Effect.never) : Effect.void
    return { answering, hold }
  }

  /** Once the start acted on the answer, or asked the user again. */
  const actedOrAsked = (missionId: string, acted: Effect.Effect<boolean, unknown, Database>) =>
    until(
      Effect.gen(function* () {
        if (yield* acted) return true
        const mission = yield* getMission(missionId)
        return mission.needs.some((need) => Predicate.isTagged(need.fields, 'Decision'))
      }),
    )

  test('"send it back" answered right before a stop opens the attempt with both outputs after the start, and asks nothing again', async () => {
    const stop = stoppedOnAnswer()
    const first = await proofsEngine(data, stop.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(mismatch)
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: SEND_BACK }),
            key: 'answer-1',
          })
          yield* Deferred.await(stop.answering.reached)
          return { mission }
        }),
      ),
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* actedOrAsked(
            first.mission.id,
            Effect.map(proofAttemptsOf('R1.S2'), (rows) => rows.length > 0),
          )
          return {
            attempts: yield* proofAttemptsOf('R1.S2'),
            mission: yield* getMission(first.mission.id),
            delivered: yield* deliveredTo(first.mission.id, 'the user sent this red back'),
            unmoved: yield* unmovedOf(first.mission.id),
          }
        }),
      ),
    )
    expect(seen.attempts.map((one) => one.verdict)).toEqual(['red'])
    expect(seen.mission.needs).toEqual([])
    expect(seen.delivered).toContain('total is wrong in')
    expect(seen.unmoved).toEqual([])
  })

  test('"send it back" answered a second time right before a stop opens its own attempt after the start, and asks nothing again', async () => {
    const stop = stoppedOnAnswer()
    let stopping = false
    const hold: BuilderHold = (at) => (stopping ? stop.hold(at) : Effect.void)
    const first = await proofsEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(mismatch)
          const once = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: once.id,
            answer: ChosenAnswer.make({ option: SEND_BACK }),
            key: 'answer-1',
          })
          yield* deliveredTo(mission.id, 'the user sent this red back')
          // The Builder runs the proof again: the same red, asked about again.
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'proof_run', { scenario: 'R1.S2' })
          const pendingDecision = Effect.map(getMission(mission.id), (one) =>
            one.needs.find((need) => Predicate.isTagged(need.fields, 'Decision')),
          )
          yield* until(Effect.map(pendingDecision, (found) => found !== undefined))
          const twice = yield* pendingDecision
          if (twice === undefined) return yield* Effect.die(new Error('not asked again'))
          stopping = true
          yield* answerNeed({
            id: twice.id,
            answer: ChosenAnswer.make({ option: SEND_BACK }),
            key: 'answer-2',
          })
          yield* Deferred.await(stop.answering.reached)
          return { mission, before: yield* proofAttemptsOf('R1.S2') }
        }),
      ),
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* actedOrAsked(
            first.mission.id,
            Effect.map(proofAttemptsOf('R1.S2'), (rows) => rows.length > first.before.length),
          )
          return {
            attempts: yield* proofAttemptsOf('R1.S2'),
            mission: yield* getMission(first.mission.id),
            unmoved: yield* unmovedOf(first.mission.id),
          }
        }),
      ),
    )
    expect(seen.attempts).toHaveLength(first.before.length + 1)
    expect(seen.attempts.at(-1)?.verdict).toBe('red')
    expect(seen.mission.needs).toEqual([])
    expect(seen.unmoved).toEqual([])
  })

  test('"more information" answered right before a stop reaches the Builder after the start', async () => {
    const stop = stoppedOnAnswer()
    const first = await proofsEngine(data, stop.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(EXPORT_PATH, testFile("  assert.equal(1, 1, 'it passes')")),
          }))
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: WrittenAnswer.make({ text: 'It fails on the March invoices only.' }),
            key: 'answer-1',
          })
          yield* Deferred.await(stop.answering.reached)
          return { mission }
        }),
      ),
    )
    const told = 'R1.S2 already passes, and the user says more'
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const database = yield* Database
          const bodies = Effect.map(
            database
              .select({ body: sessionDeliveries.body })
              .from(sessionDeliveries)
              .where(eq(sessionDeliveries.ownerId, first.mission.id)),
            (rows) => rows.map((row) => row.body).join('\n'),
          )
          yield* actedOrAsked(
            first.mission.id,
            Effect.map(bodies, (all) => all.includes(told)),
          )
          return { bodies: yield* bodies, unmoved: yield* unmovedOf(first.mission.id) }
        }),
      ),
    )
    expect(seen.bodies).toContain(`${told}: It fails on the March invoices only.`)
    expect(seen.unmoved).toEqual([])
  })

  test('"cancel the mission" answered right before a stop cancels the mission and its Building after the start', async () => {
    const stop = stoppedOnAnswer()
    const first = await proofsEngine(data, stop.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(EXPORT_PATH, testFile("  assert.equal(1, 1, 'it passes')")),
          }))
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: CANCEL_MISSION }),
            key: 'answer-1',
          })
          yield* Deferred.await(stop.answering.reached)
          return { mission }
        }),
      ),
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(
            Effect.map(buildingOf(first.mission.id), (view) => view?.state === 'cancelled'),
          )
          return {
            mission: yield* getMission(first.mission.id),
            building: yield* buildingOf(first.mission.id),
          }
        }),
      ),
    )
    expect(seen.mission.stage).toBe('cancelled')
    expect(seen.mission.unstopped).toEqual([])
    expect(seen.building?.state).toBe('cancelled')
  })

  test('"cancel the mission" answered, then a stop before its hand-over: after the start the mission and its Building are cancelled, and no proof runs first', async () => {
    const handing = Deferred.makeUnsafe<void>()
    const runsOfMission = (missionId: string) =>
      Effect.gen(function* () {
        const database = yield* Database
        return yield* database
          .select()
          .from(commandRuns)
          .where(eq(commandRuns.missionId, missionId))
      })
    const first = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(EXPORT_PATH, testFile("  assert.equal(1, 1, 'it passes')")),
          }))
          const need = yield* needOf(mission.id, 'Decision')
          // Another round of answers holds the hand-over: this one is answered, not handed yet.
          const owners = yield* NeedOwners
          yield* Semaphore.withPermits(
            owners.delivering,
            1,
          )(Deferred.await(handing)).pipe(Effect.forkChild)
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: CANCEL_MISSION }),
            key: 'answer-1',
          }).pipe(Effect.forkChild)
          yield* until(Effect.map(getNeed(need.id), (one) => one.state === 'answered'))
          return {
            mission,
            stage: (yield* getMission(mission.id)).stage,
            runs: (yield* runsOfMission(mission.id)).length,
          }
        }),
      ),
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(
            Effect.map(
              getMission(first.mission.id),
              (one) => one.stage === 'cancelled' && one.unstopped.length === 0,
            ),
          )
          return {
            building: yield* buildingOf(first.mission.id),
            runs: (yield* runsOfMission(first.mission.id)).length,
          }
        }),
      ),
    )
    expect(first.stage).toBe('building')
    expect(seen.building?.state).toBe('cancelled')
    expect(seen.runs).toBe(first.runs)
  })

  test('"more information" told to the Builder, then a stop before its proof_run: after the start the proof waits for the Builder, and nothing is asked again', async () => {
    const first = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(EXPORT_PATH, testFile("  assert.equal(1, 1, 'it passes')")),
          }))
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: WrittenAnswer.make({ text: 'It fails on the March invoices only.' }),
            key: 'answer-1',
          })
          yield* deliveredTo(mission.id, 'R1.S2 already passes, and the user says more')
          return { mission, runs: (yield* proofOf(mission.id, 'R1.S2')).runs.length }
        }),
      ),
    )
    const start = redsRun()
    const seen = await proofsEngine(data, start.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* Deferred.await(start.over)
          return {
            mission: yield* getMission(first.mission.id),
            proof: yield* proofOf(first.mission.id, 'R1.S2'),
            unmoved: yield* unmovedOf(first.mission.id),
          }
        }),
      ),
    )
    expect(seen.mission.needs).toEqual([])
    expect(seen.proof.state).toBe('waiting_red')
    expect(seen.proof.runs).toHaveLength(first.runs)
    expect(seen.unmoved).toEqual([])
  })

  test('"send it back" whose attempt is opened right before a stop, the Builder not told yet: after the start the Builder is told, and nothing is asked again', async () => {
    const telling = holdOnce('telling')
    const hold: BuilderHold = (at) =>
      at === 'telling' ? Effect.andThen(telling.hold(at), Effect.never) : Effect.void
    const first = await proofsEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(mismatch)
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: SEND_BACK }),
            key: 'answer-1',
          })
          yield* Deferred.await(telling.reached)
          return { mission }
        }),
      ),
    )
    const start = redsRun()
    const seen = await proofsEngine(data, start.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* Deferred.await(start.over)
          return {
            mission: yield* getMission(first.mission.id),
            delivered: yield* deliveriesOf(first.mission.id),
            attempts: yield* proofAttemptsOf('R1.S2'),
            unmoved: yield* unmovedOf(first.mission.id),
          }
        }),
      ),
    )
    expect(seen.delivered).toContain('the user sent this red back')
    expect(seen.delivered).toContain('total is wrong in')
    expect(seen.attempts.map((one) => one.verdict)).toEqual(['red'])
    expect(seen.mission.needs).toEqual([])
    expect(seen.unmoved).toEqual([])
  })

  test('a third red of a proof opened right before a stop, its need not raised yet: after the start the user is asked', async () => {
    let tellings = 0
    const third = Deferred.makeUnsafe<void>()
    const hold: BuilderHold = (at) =>
      at === 'telling' && ++tellings === 3
        ? Effect.andThen(Deferred.succeed(third, undefined), Effect.never)
        : Effect.void
    const first = await proofsEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(EXPORT_PATH, testFile('  const = 1')),
          }))
          yield* deliveredTo(mission.id, 'Fix the setup')
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'proof_run', { scenario: 'R1.S2' })
          yield* Effect.forkChild(call(grantId, 'proof_run', { scenario: 'R1.S2' }))
          yield* Deferred.await(third)
          return { mission }
        }),
      ),
    )
    const start = redsRun()
    const seen = await proofsEngine(data, start.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* Deferred.await(start.over)
          return {
            mission: yield* getMission(first.mission.id),
            attempts: yield* proofAttemptsOf('R1.S2'),
            unmoved: yield* unmovedOf(first.mission.id),
          }
        }),
      ),
    )
    expect(seen.attempts).toHaveLength(3)
    expect(seen.mission.needs).toHaveLength(1)
    expect(
      seen.mission.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
    ).toHaveLength(1)
    expect(seen.unmoved).toEqual([])
  })

  test('a Retry of the Builder’s environment need after a red sent back, stopped before its follower: after the start the red runs again', async () => {
    const port = await closedPort()
    const log = join(scratch, 'runs.log')
    // The red unlike Planning's, then the Builder's run kept from running, then that red again.
    const spec = (api: string) => ({
      'R1.S2': automated(
        EXPORT_PATH,
        testFile(
          [
            `  appendFileSync(${JSON.stringify(log)}, 'ran\\n')`,
            `  if (readFileSync(${JSON.stringify(log)}, 'utf8').trim().split('\\n').length === 2)`,
            `    await new Promise((done, fail) => connect(${String(port)}, '127.0.0.1').on('connect', done).on('error', fail))`,
            '  assert.fail(`total is wrong in ${fileURLToPath(import.meta.url)} after 12ms`)',
          ].join('\n'),
          ["import { connect } from 'node:net'", "import { fileURLToPath } from 'node:url'"],
        ),
        {
          seen_today: true,
          observed: `not ok 1 - the scenario holds\n  ${line}`,
          key_line: line,
          base_commit: [{ repository: 'api', commit: git(api, 'rev-parse', 'HEAD').trim() }],
        },
      ),
    })
    const releasing = holdOnce('releasing')
    let stopping = false
    const hold: BuilderHold = (at) =>
      stopping && at === 'releasing'
        ? Effect.andThen(releasing.hold(at), Effect.never)
        : Effect.void
    const first = await proofsEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(spec)
          const asked = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: asked.id,
            answer: ChosenAnswer.make({ option: SEND_BACK }),
            key: 'answer-1',
          })
          yield* deliveredTo(mission.id, 'the user sent this red back')
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'proof_run', { scenario: 'R1.S2' })
          const need = yield* needOf(mission.id, 'Environment')
          stopping = true
          yield* retryNeed(need.id)
          yield* Deferred.await(releasing.reached)
          return { mission }
        }),
      ),
    )
    const start = redsRun()
    const seen = await proofsEngine(data, start.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* Deferred.await(start.over)
          return {
            proof: yield* proofOf(first.mission.id, 'R1.S2'),
            unmoved: yield* unmovedOf(first.mission.id),
          }
        }),
      ),
    )
    expect(runsIn(log)).toBe(3)
    expect(seen.proof.state).toBe('held')
    expect(seen.unmoved).toEqual([])
  })

  test('touched names the proofs and the final checks whose repository changed', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            (projectId) =>
              Effect.asVoid(
                saveCheck(projectId, null, {
                  name: 'build',
                  commandId: null,
                  line: `"${process.execPath}" --version`,
                  where: 'root',
                  repository: null,
                  when: 'end',
                  expect: null,
                  files: null,
                }),
              ),
            undefined,
            undefined,
            undefined,
            undefined,
            exportProof,
          )
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', RIGHT_EXPORT]])
          yield* proofIn(mission.id, 'R1.S2', 'green')
          yield* BuildDesk.use((desk) => desk.judgeScope(mission.id, 'end', null))
          const untouched = yield* BuildDesk.use((desk) => desk.touchedProofs(mission.id, ['api']))
          yield* builds(grantId, 'T1', [['invoices.ts', 'export const invoices = [1]\n']])
          return {
            untouched,
            api: yield* BuildDesk.use((desk) => desk.touchedProofs(mission.id, ['api'])),
            web: yield* BuildDesk.use((desk) => desk.touchedProofs(mission.id, ['web'])),
          }
        }),
      ),
    )
    expect(seen.untouched).toEqual({ proofs: [], checks: [] })
    expect(seen.api).toEqual({ proofs: ['R1.S2'], checks: ['build'] })
    expect(seen.web).toEqual({ proofs: [], checks: [] })
  })
})
