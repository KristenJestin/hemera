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

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { ChosenAnswer } from '@hemera/core/domain'
import { and, eq } from 'drizzle-orm'
import { Deferred, Effect, Predicate, Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { BuilderHold } from '../src/engine/building/builder.ts'
import { BuildDesk } from '../src/engine/building/desk.ts'
import {
  CANCEL_MISSION,
  NOT_REPRODUCIBLE,
  judgeManual,
  proofsRead,
} from '../src/engine/building/proofs.ts'
import { readEvidence } from '../src/engine/memory/evidence.ts'
import { getMission } from '../src/engine/missions.ts'
import { answerNeed, retryNeed } from '../src/engine/needs.ts'
import { saveCheck } from '../src/engine/project-checks.ts'
import { Database } from '../src/engine/storage/database.ts'
import { buildingAttempts, sessionDeliveries } from '../src/engine/storage/schema.ts'
import { call, eventsOf } from './building-world.ts'
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
const proofsEngine = (dataFolder: string, hold: BuilderHold = () => Effect.void) =>
  sessionsEngine(dataFolder, builderAgents, {
    roles: [HELPER],
    tools: { home: work, verdicts: verdictsSaying(() => ALLOW).layer },
    building: { hold },
  })

/** The mission launched with these Proof blocks (every other one by hand), and this plan. */
const launchedWith = (
  proofs: (api: string) => Readonly<Record<string, Schema.JsonObject>>,
  plan: ReadonlyArray<(typeof PLAN)[number]> = PLAN,
) => launched(work, undefined, undefined, plan, undefined, proofs)

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
    "import { appendFileSync, existsSync } from 'node:fs'",
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

/** The attempts on a scenario's proof, as Hemera keeps them. */
const proofAttemptsOf = (scenario: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(buildingAttempts)
      .where(and(eq(buildingAttempts.scope, 'proof'), eq(buildingAttempts.subject, scenario)))
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
const needOf = (missionId: string, tag: 'Decision' | 'Environment') =>
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
const withExisting = (api: string): Schema.JsonObject => {
  mkdirSync(join(api, 'tests'), { recursive: true })
  writeFileSync(join(api, EXISTING_PATH), EXISTING)
  git(api, 'add', '.')
  git(api, 'commit', '-q', '-m', 'tests')
  git(api, 'push', '-q', 'origin', 'main')
  git(api, 'fetch', '-q', 'origin')
  writeFileSync(join(api, EXISTING_PATH), WITH_ADDITION)
  // The helper trims what Git prints: a patch ends with its newline.
  const patch = `${git(api, 'diff', '--', EXISTING_PATH)}\n`
  git(api, 'checkout', '-q', '--', EXISTING_PATH)
  return automated(EXISTING_PATH, WITH_ADDITION, {
    test: {
      repository: 'api',
      path: EXISTING_PATH,
      code: WITH_ADDITION,
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
    expect(seen.merged).toBe(WITH_ADDITION)
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

  test('an unreachable service gives an environment need', async () => {
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
          return { held, view }
        }),
      ),
    )
    expect(seen.held.state).toBe('held')
    expect(seen.held.runs.map((one) => one.classification)).toEqual(['environment'])
    expect(seen.view.tasks.find((task) => task.id === 'T2')?.state).toBe('blocked')
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
    expect(seen.refreshed).toEqual({ proofs: ['R1.S2'], checks: ['build'] })
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
