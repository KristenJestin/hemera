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
 * This file: the green runs, a scenario verified by hand, and a failed green.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Deferred, Duration, Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { BuildingEnd } from '../src/engine/building/builder.ts'
import { BuildDesk } from '../src/engine/building/desk.ts'
import { judgeManual } from '../src/engine/building/proofs.ts'
import { saveCheck, setProofLimit } from '../src/engine/project-checks.ts'
import { saveCommand } from '../src/engine/catalogue.ts'
import { Runs } from '../src/engine/runs.ts'
import { secretsRegistry } from '../src/engine/secrets.ts'
import { call } from './building-world.ts'
import { builderOf, buildingNow, launched } from './builder-world.ts'
import { until, within } from './sessions-world.ts'
import { removeFolders } from './storage.ts'
import {
  data,
  work,
  proofsEngine,
  busyBuilder,
  launchedWith,
  testLine,
  automated,
  testFile,
  EXPORT_PATH,
  EXPORT_TEST,
  exportProof,
  markdownProof,
  WRONG_EXPORT,
  RIGHT_EXPORT,
  proofsOf,
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

  test('a proof whose test prints a known value hands its run back through proof_run masked (#392)', async () => {
    const value = 'violet-heron-5521-quartz'
    const secrets = secretsRegistry()
    secrets.register('suite', [value])
    // The value is put together as the test runs (a proof is kept masked, so a value written in
    // its code never runs), and printed in the failure's message, which the run's tail holds.
    const printing = testFile(
      "  assert.equal(existsSync(new URL('../export.ts', import.meta.url)), true, 'export.ts exports nothing yet; region ' + ['violet-heron', '5521-quartz'].join('-'))",
    )
    const seen = await proofsEngine(data, undefined, undefined, undefined, { secrets }).run(
      ({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launchedWith(() => ({
              'R1.S2': automated(EXPORT_PATH, printing),
            }))
            yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
            const { grantId } = yield* builderOf(mission.id)
            return yield* call(grantId, 'proof_run', { scenario: 'R1.S2' })
          }),
        ),
    )
    expect(seen).toContain('region •••')
    expect(seen).not.toContain(value)
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
