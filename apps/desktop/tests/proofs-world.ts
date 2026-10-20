/**
 * What the suites of the proofs of a Building share (`building-proofs-*.test.ts`, #144): the engine
 * with the Builder of this version, the proofs' test files, and the reads of what the engine
 * recorded. One file was too long for one worker on a Windows runner (#484), so its suites are cut
 * into four files, and what they share lives here.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import type { Duration, Layer } from 'effect'
import { Deferred, Effect, Predicate, Schema } from 'effect'
import type { FakeScript } from '../src/engine/agents/fake.ts'
import type { AskBeforeRunning } from '../src/engine/ask-before-running.ts'
import type { BuildingEnd } from '../src/engine/building/builder.ts'
import { type BuilderHold } from '../src/engine/building/builder.ts'
import { type OutsideSettings } from '../src/engine/building/outside.ts'
import { type SnapshotsService } from '../src/engine/building/snapshots.ts'
import { proofsRead } from '../src/engine/building/proofs.ts'
import { readEvidence } from '../src/engine/memory/evidence.ts'
import { getMission } from '../src/engine/missions.ts'
import { listActions } from '../src/engine/tools/actions.ts'
import { type SecretsRegistry } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import { activeBuildingIn, decisionsIn } from '../src/engine/building/tasks.ts'
import {
  buildingAttempts,
  scenarioProofs,
  sessionDeliveries,
} from '../src/engine/storage/schema.ts'
import { QUIET, READING, call, eventsOf } from './building-world.ts'
import { PLAN, builderAgents, builderOf, buildingNow, launched } from './builder-world.ts'
import { git } from './repositories.ts'
import { HELPER, sessionsEngine, until, within } from './sessions-world.ts'
import { ALLOW, verdictsSaying } from './tools-world.ts'
import { temporaryFolder } from './storage.ts'

export let data: string
export let work: string
export let scratch: string

/** The engine with the Builder of this version, and every call the agents make allowed. */
export const proofsEngine = (
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
    /** Who answers a command marked "ask before running". */
    readonly askBeforeRunning?: Layer.Layer<AskBeforeRunning>
    /** The values the engine masks. */
    readonly secrets?: SecretsRegistry
  } = {},
) =>
  sessionsEngine(dataFolder, agents, {
    roles: [HELPER],
    secrets: more.secrets,
    askBeforeRunning: more.askBeforeRunning,
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
export const busyBuilder = () => {
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
export const launchedWith = (
  proofs: (api: string) => Readonly<Record<string, Schema.JsonObject>>,
  plan: ReadonlyArray<(typeof PLAN)[number]> = PLAN,
) => launched(work, undefined, undefined, plan, undefined, undefined, proofs)

/** What runs a test file of `api`, its report in TAP whatever the terminal. */
export const testLine = (path: string) => `"${process.execPath}" --test --test-reporter=tap ${path}`

/** An automated proof whose test is a new file of `api`. */
export const automated = (
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
export const testFile = (body: string, imports: ReadonlyArray<string> = []) =>
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
export const EXPORT_PATH = 'tests/export.test.mjs'
export const EXPORT_TEST = testFile(
  "  assert.equal(existsSync(new URL('../export.ts', import.meta.url)), true, 'export.ts exports nothing yet')",
)
export const exportProof = () => ({ 'R1.S2': automated(EXPORT_PATH, EXPORT_TEST) })

/** R1.S2's test: red until `api/export.ts` exports `toMarkdown`. */
export const MARKDOWN_TEST = testFile(
  [
    "  const file = new URL('../export.ts', import.meta.url)",
    "  assert.ok(existsSync(file) && readFileSync(file, 'utf8').includes('toMarkdown'), 'export.ts has no toMarkdown')",
  ].join('\n'),
)
export const markdownProof = () => ({ 'R1.S2': automated(EXPORT_PATH, MARKDOWN_TEST) })
export const WRONG_EXPORT = 'export const toCsv = () => ""\n'
export const RIGHT_EXPORT = 'export const toMarkdown = () => ""\n'

/** A test that notes each run in `log`, waits for `release` when it names one, then fails. */
export const loggedTest = (log: string, release: string | null = null) =>
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
export const runsIn = (log: string) =>
  existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').length : 0

/** The mission's proofs, as the page reads them, once its Building exists. */
export const proofsOf = (missionId: string) =>
  Effect.gen(function* () {
    yield* buildingNow(missionId)
    const view = yield* proofsRead(missionId)
    if (view === null) return yield* Effect.die(new Error('no Building'))
    return view
  })

/** A scenario's proof, as the page reads it. */
export const proofOf = (missionId: string, scenario: string) =>
  Effect.gen(function* () {
    const found = (yield* proofsOf(missionId)).scenarios.find((one) => one.scenario === scenario)
    if (found === undefined) return yield* Effect.die(new Error(`no proof of ${scenario}`))
    return found
  })

/** Waits until a scenario's proof is in a state. */
export const proofIn = (missionId: string, scenario: string, state: string) =>
  until(
    Effect.map(proofOf(missionId, scenario), (proof) => proof.state === state),
    20_000,
  )

/** The attempts on a scenario's proof, as Hemera keeps them; on every proof for null. */
export const proofAttemptsOf = (scenario: string | null) =>
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
export const deliveredTo = (missionId: string, start: string) =>
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
export const needOf = (missionId: string, tag: 'Decision' | 'Environment' | 'Error') =>
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
export const payloadsOf = (missionId: string, type: string) =>
  Effect.map(eventsOf(missionId, type), (rows) => rows.map((row) => JSON.parse(row.payload)))

/** The Workspace's `api` folder. */
export const apiOf = (missionId: string) =>
  Effect.map(
    buildingNow(missionId),
    (view) => view.repositories.find((one) => one.name === 'api')?.folder ?? '',
  )

/** Starts a task, writes its files in `api`, and finishes it. */
export const builds = (
  grantId: string,
  taskId: string,
  writes: ReadonlyArray<[string, string]> = [],
) =>
  Effect.gen(function* () {
    yield* call(grantId, 'task_start', { task: taskId })
    for (const [path, content] of writes) {
      yield* call(grantId, 'fs_read', { repository: 'api', path })
      yield* call(grantId, 'fs_write', { repository: 'api', path, content })
    }
    return yield* call(grantId, 'task_finished', { task: taskId, summary: `${taskId} built.` })
  })

/** A port nothing listens on: taken, then let go. */
export const closedPort = () =>
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
export const EXISTING_PATH = 'tests/invoices.test.mjs'
export const EXISTING = testFile("  assert.equal(1, 1, 'one is one')")
export const ADDED = [
  '',
  "test('the invoices export as Markdown', () => {",
  "  assert.equal(existsSync(new URL('../export.ts', import.meta.url)), true, 'export.ts exports nothing yet')",
  '})',
  '',
].join('\n')
export const WITH_ADDITION = `${EXISTING}${ADDED}`

/**
 * `api` with its test file committed and pushed, the base of the Freeze; answers the proof that
 * adds R1.S2's test to it, its patch made by Git against that commit.
 */
export const withExisting = (
  api: string,
  existing = EXISTING,
  addition = ADDED,
): Schema.JsonObject => {
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

/** A folder outside every place of the mission, where a planted link leads. */
export const outsideFolder = () => {
  const folder = join(scratch, 'outside')
  mkdirSync(folder, { recursive: true })
  return folder
}

/** Whether this machine makes a symbolic link to a file: Windows needs a privilege for it. */
export const linksFiles = () => {
  try {
    symlinkSync(join(scratch, 'nowhere'), join(scratch, 'probe'), 'file')
    return true
  } catch {
    return false
  }
}

/** What the Builder is told when a proof's file could not be written. */
export const HANDED = 'Integrate the test by hand'

/**
 * The mission launched with these proofs, `plant` run in the Workspace's `api` while the Builder is
 * held at `at`, then the proofs written: their event, the file writes Hemera recorded and, for a
 * conflict, what the Builder was told and what proof_run answers it.
 */
export const writtenAfter = (
  at: 'proving' | 'placed',
  proofs: (api: string) => Readonly<Record<string, Schema.JsonObject>>,
  plant: (api: string) => void,
) => {
  const reached = Deferred.makeUnsafe<void>()
  const go = Deferred.makeUnsafe<void>()
  const hold: BuilderHold = (point) =>
    point === at
      ? Effect.andThen(Deferred.succeed(reached, undefined), Deferred.await(go))
      : Effect.void
  return proofsEngine(data, hold).run(({ profile }) =>
    within(
      profile,
      Effect.gen(function* () {
        const { mission } = yield* launchedWith(proofs)
        yield* Deferred.await(reached)
        const api = yield* apiOf(mission.id)
        plant(api)
        yield* Deferred.succeed(go, undefined)
        const written = payloadsOf(mission.id, 'building.proofs_written')
        yield* until(Effect.map(written, (events) => events.length > 0))
        const events = yield* written
        const writes = (yield* listActions()).filter((one) => one.kind === 'file.write')
        if (events[0]?.conflicts?.length !== 1) {
          return { api, events, writes, delivered: '', proofRun: '' }
        }
        const delivered = yield* deliveredTo(mission.id, HANDED)
        const { grantId } = yield* builderOf(mission.id)
        // A conflict's proof is not in place: proof_run says so, whatever stands there.
        const proofRun = yield* call(grantId, 'proof_run', { scenario: 'R1.S2' })
        return { api, events, writes, delivered, proofRun }
      }),
    ),
  )
}

/**
 * The mission launched with the export proof, `plant` run on its test file in `api` right before
 * Hemera reads it for its red run, and the file put back once read, so the run itself runs the
 * real test: the run recorded, its evidence, and whether the engine answered a call meanwhile.
 */
export const ranAfter = (plant: (file: string) => void) => {
  const reading = Deferred.makeUnsafe<void>()
  const planted = Deferred.makeUnsafe<void>()
  const read = Deferred.makeUnsafe<void>()
  const back = Deferred.makeUnsafe<void>()
  const hold: BuilderHold = (point) => {
    if (point === 'test-reading') {
      return Effect.andThen(Deferred.succeed(reading, undefined), Deferred.await(planted))
    }
    if (point === 'test-read') {
      return Effect.andThen(Deferred.succeed(read, undefined), Deferred.await(back))
    }
    return Effect.void
  }
  return proofsEngine(data, hold).run(({ profile }) =>
    within(
      profile,
      Effect.gen(function* () {
        const { mission } = yield* launchedWith(exportProof)
        yield* Deferred.await(reading)
        const file = join(yield* apiOf(mission.id), EXPORT_PATH)
        const original = readFileSync(file)
        rmSync(file)
        plant(file)
        yield* Deferred.succeed(planted, undefined)
        yield* Deferred.await(read)
        // Another call of the engine, answered while the proof's test file was read.
        const answered = yield* proofOf(mission.id, 'R1.S2')
        rmSync(file)
        writeFileSync(file, original)
        yield* Deferred.succeed(back, undefined)
        yield* until(
          Effect.map(proofOf(mission.id, 'R1.S2'), (proof) => proof.runs.length > 0),
          20_000,
        )
        const run = (yield* proofOf(mission.id, 'R1.S2')).runs[0]
        const evidence = yield* readEvidence(mission.id, run?.evidenceId ?? '')
        return {
          answered: answered.scenario,
          run,
          evidence: new TextDecoder().decode(evidence.bytes),
        }
      }),
    ),
  )
}

/**
 * `api` as a Go module `example.com/m`, its `go.mod` and a script that prints what `go test
 * ./internal/...` prints when `TestSaves` fails in package `example.com/m/internal/pkg`, committed
 * and pushed; answers the proof that adds `TestSaves` in a new file at `path`, run by that script.
 */
export const goModuleProof = (api: string, path: string): Schema.JsonObject => {
  writeFileSync(join(api, 'go.mod'), 'module example.com/m\n\ngo 1.22\n')
  const output = [
    '--- FAIL: TestSaves (0.00s)',
    '    saves_test.go:6: got 1, want 2',
    'FAIL',
    'FAIL\texample.com/m/internal/pkg\t0.002s',
    'FAIL',
    '',
  ].join('\n')
  writeFileSync(
    join(api, 'go-red.mjs'),
    `process.stdout.write(${JSON.stringify(output)})\nprocess.exitCode = 1\n`,
  )
  git(api, 'add', '.')
  git(api, 'commit', '-q', '-m', 'go module')
  git(api, 'push', '-q', 'origin', 'HEAD')
  git(api, 'fetch', '-q', 'origin')
  const code =
    'package pkg\n\nimport "testing"\n\nfunc TestSaves(t *testing.T) {\n\tt.Errorf("got 1, want 2")\n}\n'
  return automated(path, code, {
    test: {
      repository: 'api',
      path,
      code,
      insertion: 'new_file',
      command: `"${process.execPath}" go-red.mjs`,
    },
  })
}

/** Holds the Builder once at `point`, until `go`: `reached` says it got there. */
export const holdOnce = (point: string) => {
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
export const redsRun = () => {
  const over = Deferred.makeUnsafe<void>()
  const hold: BuilderHold = (at) =>
    at === 'greens-due' ? Effect.asVoid(Deferred.succeed(over, undefined)) : Effect.void
  return { hold, over }
}

/** Everything stored for the mission's sessions (the Builder), as text. */
export const deliveriesOf = (missionId: string) =>
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
export const unmovedOf = (missionId: string) =>
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
export const writes = (grantId: string, path: string, content: string, repository = 'api') =>
  Effect.gen(function* () {
    yield* call(grantId, 'fs_read', { repository, path })
    return yield* call(grantId, 'fs_write', { repository, path, content })
  })

/** Whether the end was called: #147's port, here the event it writes. */
export const endCalled = (missionId: string) =>
  Effect.map(eventsOf(missionId, 'building.tasks_done'), (rows) => rows.length > 0)

/** New folders for the profile, the Workspace and the scratch files, named after `name`. */
export const newFolders = (name: string) => {
  data = realpathSync.native(temporaryFolder(name))
  work = realpathSync.native(temporaryFolder(`${name}-work`))
  scratch = realpathSync.native(temporaryFolder(`${name}-scratch`))
}
