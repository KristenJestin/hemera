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
 * This file: a failed green and a change made outside Hemera, and the proofs' reach.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ChosenAnswer } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Deferred, Effect, Fiber } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import type { FakeScript } from '../src/engine/agents/fake.ts'
import { type BuilderHold } from '../src/engine/building/builder.ts'
import { BuildDesk } from '../src/engine/building/desk.ts'
import { OutsideChanges } from '../src/engine/building/outside.ts'
import { TRY_AGAIN } from '../src/engine/building/proofs.ts'
import { getMission } from '../src/engine/missions.ts'
import { answerNeed } from '../src/engine/needs.ts'
import { Database } from '../src/engine/storage/database.ts'
import { buildingDecisions, buildingTasks } from '../src/engine/storage/schema.ts'
import { QUIET, READING, call, eventsOf } from './building-world.ts'
import { builderAgents, builderOf, launched } from './builder-world.ts'
import { until, within } from './sessions-world.ts'
import { removeFolders } from './storage.ts'
import {
  data,
  work,
  scratch,
  proofsEngine,
  launchedWith,
  testLine,
  automated,
  testFile,
  EXPORT_PATH,
  exportProof,
  markdownProof,
  WRONG_EXPORT,
  RIGHT_EXPORT,
  proofOf,
  proofIn,
  proofAttemptsOf,
  deliveredTo,
  payloadsOf,
  apiOf,
  builds,
  EXISTING_PATH,
  EXISTING,
  ADDED,
  withExisting,
  holdOnce,
  writes,
  endCalled,
  newFolders,
} from './proofs-world.ts'

beforeEach(() => newFolders('building-proofs'))
afterEach(removeFolders)

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
   * every settle queued is done, those a failed green queues itself included.
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
              count('queued') === count('settled')
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
              count('queued') === count('settled')
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
            yield* edits(mission.id, 'export const notes = []\n', 'notes.ts')
            const { grantId } = yield* builderOf(mission.id)
            const building = yield* Effect.forkChild(
              builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]]),
            )
            // Two tries of the user, each landing while a run is held, neither of them a fix; the
            // second changes a file there before the runs that no run changed, so it lands too.
            yield* whileHeld(2, edits(mission.id, 'export const toCsv = () => "1"\n'))
            yield* Fiber.join(building)
            yield* whileHeld(3, edits(mission.id, 'export const notes = [1]\n', 'notes.ts'))
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

  test('a fix lands during the first failed run, and the settle of what its compare found is over before the failure is recorded: the green still runs again once', async () => {
    const builder = heldBuilder()
    const gate = { on: false, go: Deferred.makeUnsafe<void>() }
    const points = reaching((at) =>
      at === 'greening' && gate.on ? Deferred.await(gate.go) : Effect.void,
    )
    const seen = await proofsEngine(data, points.hold, undefined, builder.agents, NO_TIMER).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* letGo(1, 3)
            const { mission } = yield* launchedWith(heldExport(false))
            yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
            gate.on = true
            const { grantId } = yield* builderOf(mission.id)
            yield* builder.hold
            const building = yield* Effect.forkChild(
              builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]]),
            )
            const from = yield* points.mark
            yield* whileHeld(2, edits(mission.id, RIGHT_EXPORT))
            // The green's run ended and its compare found the fix; that settle is over before the
            // failure is recorded, and found no failed green to run.
            yield* points.taken(from)
            gate.on = false
            yield* Deferred.succeed(gate.go, undefined)
            yield* proofIn(mission.id, 'R1.S2', 'green')
            yield* Fiber.join(building)
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

  for (const [what, line] of [
    [
      'a file of a new name on every run',
      "  writeFileSync(new URL('../out-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.log', import.meta.url), 'x')",
    ],
    [
      'a file its red never wrote',
      "  if (existsSync(new URL('../export.ts', import.meta.url))) appendFileSync(new URL('../green.log', import.meta.url), 'g')",
    ],
  ] as const) {
    test(`a failed green whose run writes ${what}, then the quiet Builder’s question: nothing runs again on unchanged code, and a Builder write runs it once`, async () => {
      const points = reaching()
      const proof = () => ({
        'R1.S2': automated(
          EXPORT_PATH,
          testFile(
            [
              line,
              "  const file = new URL('../export.ts', import.meta.url)",
              "  assert.ok(existsSync(file) && readFileSync(file, 'utf8').includes('toMarkdown'), 'no toMarkdown')",
            ].join('\n'),
            ["import { writeFileSync } from 'node:fs'"],
          ),
        ),
      })
      const seen = await proofsEngine(data, points.hold, undefined, builderAgents, NO_TIMER).run(
        ({ profile }) =>
          within(
            profile,
            Effect.gen(function* () {
              const { mission } = yield* launchedWith(proof)
              yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
              const { grantId } = yield* builderOf(mission.id)
              yield* builds(grantId, 'T1')
              yield* builds(grantId, 'T2', [['export.ts', WRONG_EXPORT]])
              yield* builds(grantId, 'T4')
              yield* builds(grantId, 'T3')
              yield* until(
                Effect.map(askedStates, (states) => states.includes('pending')),
                20_000,
              )
              // What the runs wrote is taken in, and every settle of it is over.
              yield* points.takenAll(mission.id)
              const asked = yield* askedStates
              const quiet = yield* runsOf(mission.id)
              // A Builder write that fixes nothing runs it once.
              const from = yield* points.mark
              yield* writes(grantId, 'notes.md', 'Read again.\n')
              yield* until(
                Effect.map(runsOf(mission.id), (runs) => runs.length > quiet.length),
                20_000,
              )
              yield* points.taken(from)
              yield* points.takenAll(mission.id)
              return { asked, quiet, runs: yield* runsOf(mission.id) }
            }),
          ),
      )
      expect(seen.asked).toEqual(['pending'])
      expect(seen.quiet).toEqual([
        ['red', 'assertion_failed'],
        ['green', 'assertion_failed'],
      ])
      expect(seen.runs).toEqual([
        ['red', 'assertion_failed'],
        ['green', 'assertion_failed'],
        ['green', 'assertion_failed'],
      ])
    })
  }
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
