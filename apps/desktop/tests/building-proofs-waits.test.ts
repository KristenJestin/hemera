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
 *
 * This file: a proof that waits, is stuck or never ends, and the end that never waits on one.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ChosenAnswer, WrittenAnswer } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Deferred, Duration, Effect, Exit, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import type { FakeScript } from '../src/engine/agents/fake.ts'
import { type BuilderHold } from '../src/engine/building/builder.ts'
import { BuildDesk } from '../src/engine/building/desk.ts'
import { OutsideChanges } from '../src/engine/building/outside.ts'
import { SnapshotFailed, type SnapshotsService } from '../src/engine/building/snapshots.ts'
import { END_WITHOUT, SEND_BACK, TRY_AGAIN } from '../src/engine/building/proofs.ts'
import { getMission } from '../src/engine/missions.ts'
import { answerNeed, expireNeed, getNeed, retryNeed } from '../src/engine/needs.ts'
import { PROOF_LIMIT, proofLimitFor } from '../src/engine/building/proof-runner.ts'
import { setProofLimit } from '../src/engine/project-checks.ts'
import { saveCommand } from '../src/engine/catalogue.ts'
import { Runs } from '../src/engine/runs.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  buildingAttempts,
  buildingDecisions,
  buildingTasks,
  scenarioProofs,
} from '../src/engine/storage/schema.ts'
import { QUIET, READING, call } from './building-world.ts'
import { PLAN, builderOf, buildingNow, launched } from './builder-world.ts'
import { git } from './repositories.ts'
import { until, within } from './sessions-world.ts'
import { removeFolders } from './storage.ts'
import {
  data,
  work,
  scratch,
  proofsEngine,
  busyBuilder,
  launchedWith,
  testLine,
  automated,
  testFile,
  EXPORT_PATH,
  EXPORT_TEST,
  markdownProof,
  WRONG_EXPORT,
  RIGHT_EXPORT,
  runsIn,
  proofOf,
  proofIn,
  proofAttemptsOf,
  deliveredTo,
  needOf,
  payloadsOf,
  apiOf,
  builds,
  holdOnce,
  writes,
  endCalled,
  newFolders,
} from './proofs-world.ts'

beforeEach(() => newFolders('building-proofs'))
afterEach(removeFolders)

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
          // One task for all three scenarios: the reds come from R1.S2's proof and the answer to
          // the third, not from how many tasks the Building has, and each task is some twenty Git
          // processes, tens of milliseconds each on Windows (#444).
          const { mission } = yield* launchedWith(
            markdownProof,
            PLAN.filter((task) => task.title === 'Export as Markdown').map((task) =>
              Object.assign({}, task, { scenarios: ['R1.S1', 'R1.S2', 'R1.S3'] }),
            ),
          )
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builder.busy
          yield* builds(grantId, 'T1', [['export.ts', WRONG_EXPORT]])
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
