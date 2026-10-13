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
import { Deferred, Effect, Layer, Predicate, Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript } from '../src/engine/agents/fake.ts'
import { BuildingEnd, type BuilderHold } from '../src/engine/building/builder.ts'
import { BuildDesk } from '../src/engine/building/desk.ts'
import { OutsideChanges } from '../src/engine/building/outside.ts'
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
import { answerNeed, expireNeed, getNeed, retryNeed } from '../src/engine/needs.ts'
import { saveCheck } from '../src/engine/project-checks.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  buildingAttempts,
  buildingDecisions,
  buildingTasks,
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
) =>
  sessionsEngine(dataFolder, agents, {
    roles: [HELPER],
    tools: { home: work, verdicts: verdictsSaying(() => ALLOW).layer },
    building: end === undefined ? { hold } : { hold, end },
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
            delivered: yield* deliveredTo(mission.id, 'It fails on the March invoices only.'),
            proof: yield* proofOf(mission.id, 'R1.S2'),
          }
        }),
      ),
    )
    expect(seen.delivered).toContain('R1.S2 already passes, and the user says more')
    expect(seen.proof.state).toBe('waiting_red')
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
