/**
 * Hemera owns the tasks' states and hands the agent the whole ready set (design D10-03, D10-04,
 * D10-07, D10-08; L1, L6).
 *
 * Every suite is named after the scenario of `Spec · build-tasks` it covers, and runs the whole
 * engine on the fake agent, driven by deliveries, with the Project's checks scripted where a
 * verdict has to be controlled.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { held } from './application.ts'
import {
  THREE,
  aReadySpec,
  buildAgent,
  buildOf,
  eventually,
  finished,
  handedLabels,
  journalOf,
  launched,
  scriptedChecks,
  statesOf,
} from './build-harness.ts'
import { type OpenWindow, openWindow, openWindowChecked } from './window.ts'

let dataFolder: string
let opened: OpenWindow | undefined

beforeEach(() => {
  dataFolder = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-build-tasks-')))
})

afterEach(async () => {
  await opened?.close()
  opened = undefined
  rmSync(dataFolder, { recursive: true, force: true })
})

describe('Every ready task is handed at once', () => {
  test('the first execute delivery hands T1 and T2, and T3 only once both are done', async () => {
    const { agent, handed } = buildAgent()
    opened = await openWindow(dataFolder, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        return yield* eventually(buildOf(sessionId), (view) => view.phase === 'verify')
      }),
    )
    const executes = handed.filter((text) => text.includes('# Tasks handed now'))
    expect(executes[0]).toContain('Every task ready now, handed at once: T1, T2.')
    expect(executes[0]).toContain('## T1 · Write the exporter')
    expect(executes[0]).toContain('## T2 · Write the reader')
    expect(handedLabels(executes[0] ?? '')).toEqual(['T1', 'T2'])
    expect(executes[1]).toContain('Every task ready now, handed at once: T3.')
    // T3 was handed after both were done, never before.
    const [one, two, three] = seen.tasks
    expect(three?.handedAt ?? '').not.toBe('')
    expect(one?.endedAt !== null && (three?.handedAt ?? '') >= (one?.endedAt ?? '')).toBe(true)
    expect(two?.endedAt !== null && (three?.handedAt ?? '') >= (two?.endedAt ?? '')).toBe(true)
    expect(statesOf(seen)).toEqual({ T1: 'done', T2: 'done', T3: 'done' })
  })
})

describe("The agent's signal is not a verdict", () => {
  test('a red check leaves the task checking, then in progress with a new attempt carrying it', async () => {
    const verdict = held()
    const checks = scriptedChecks(async (request) => {
      if (request.when !== 'task') return []
      await verdict.promise
      return [{ name: 'lint', verdict: 'red', output: 'src/export.ts:1 missing semicolon' }]
    })
    // The agent finishes T1 once, and does nothing with its failure.
    const { agent, handed } = buildAgent({
      execute: (labels, text) =>
        text.includes('was red') ? [] : labels.filter((label) => label === 'T1').map(finished),
    })
    opened = await openWindowChecked(dataFolder, checks, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        const checking = yield* eventually(
          buildOf(sessionId),
          (view) => view.tasks[0]?.state === 'checking',
        )
        verdict.carryOn()
        const judged = yield* eventually(
          buildOf(sessionId),
          (view) => view.tasks[0]?.state === 'in_progress' && handed.length === 3,
        )
        return { checking, judged }
      }),
    )
    expect(seen.checking.tasks[0]?.state).toBe('checking')
    const t1 = seen.judged.tasks[0]
    expect(t1?.state).toBe('in_progress')
    expect(t1?.attempts.map((attempt) => [attempt.number, attempt.result])).toEqual([
      [1, 'red'],
      [2, null],
    ])
    expect(t1?.attempts[0]?.checks.map((check) => [check.name, check.verdict])).toEqual([
      ['lint', 'red'],
    ])
    // The failure is told at the next safe point, with the task handed again.
    expect(handed[2]).toContain('## T1 · Write the exporter')
    expect(handed[2]).toContain('Attempt 1 was red')
    expect(handed[2]).toContain('src/export.ts:1 missing semicolon')
  })
})

describe('Three red attempts come back to the user', () => {
  test('the third red attempt makes the task yours, with the three failures shown', async () => {
    let run = 0
    const checks = scriptedChecks((request) => {
      if (request.when !== 'task') return []
      run += 1
      return [{ name: 'test', verdict: 'red', output: `failure ${run}` }]
    })
    const { agent } = buildAgent({
      execute: (labels) => labels.filter((label) => label === 'T1').map(finished),
    })
    opened = await openWindowChecked(dataFolder, checks, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        const view = yield* eventually(buildOf(sessionId), (one) => one.tasks[0]?.state === 'yours')
        return { view, journal: yield* journalOf(sessionId) }
      }),
    )
    const t1 = seen.view.tasks[0]
    expect(t1?.state).toBe('yours')
    expect(t1?.endedAt).not.toBeNull()
    expect(
      t1?.attempts.map((attempt) => [
        attempt.number,
        attempt.result,
        attempt.checks.map((check) => check.outputTail),
      ]),
    ).toEqual([
      [1, 'red', ['failure 1']],
      [2, 'red', ['failure 2']],
      [3, 'red', ['failure 3']],
    ])
    const yours = seen.journal.find((line) => line.type === 'task.yours')
    expect(JSON.parse(yours?.payload ?? '{}')).toEqual({ label: 'T1', reason: '3 red attempts' })
  })
})

describe('The agent signals only about the tasks it was handed', () => {
  test('an unknown label, a task not handed and a task already finished are refused with a sentence', async () => {
    const { agent } = buildAgent({
      execute: (labels) =>
        labels.includes('T1')
          ? [
              finished('T9'),
              finished('T3'),
              finished('T1'),
              finished('T1'),
              { does: 'uses', call: 'build_read', arguments: { task: 't1' } },
            ]
          : [],
    })
    opened = await openWindow(dataFolder, agent)
    await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        yield* launched(spec.specId, spec.workspaceId)
        yield* eventually(
          Effect.sync(() => agent.answers.used.length),
          (used) => used === 5,
        )
      }),
    )
    const [unknown, notHanded, first, again, read] = agent.answers.used
    expect(unknown?.isError).toBe(true)
    expect(unknown?.text).toContain('there is no task T9 in this build: its tasks are T1 to T3')
    expect(notHanded?.isError).toBe(true)
    expect(notHanded?.text).toContain('T3 was not handed to you')
    expect(first?.text).toBe('T1 is being checked by Hemera; carry on')
    expect(again?.isError).toBe(true)
    expect(again?.text).toMatch(/T1 is already (done|being checked by Hemera)/)
    // One task, read with its attempts, by its label whatever its case.
    expect(read?.isError).toBe(false)
    expect(read?.text).toContain('# T1 · Write the exporter')
    expect(read?.text).toContain('## Attempt 1')
  })
})
