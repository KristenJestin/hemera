/**
 * Hemera owns the tasks' states and hands the agent the whole ready set (design D10-03, D10-04,
 * D10-07, D10-08).
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

import { Builds, UnknownBuildError } from '#engine/build/build.ts'
import { TOOL_ARGUMENTS } from '#engine/tools/arguments.ts'

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
    // The try ended when the agent said it finished; the verdict only gives it its result.
    const finishedAt = seen.checking.tasks[0]?.attempts[0]?.endedAt ?? null
    expect(finishedAt).not.toBeNull()
    expect(seen.checking.tasks[0]?.attempts[0]?.result).toBeNull()
    expect(seen.judged.tasks[0]?.attempts[0]?.endedAt).toBe(finishedAt)
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

describe('A human task waits for the user', () => {
  const HUMAN = [
    { title: 'Write the exporter' },
    { title: 'Sign the export format', executor: 'human' as const },
    { title: 'Publish it', dependsOn: ['Sign the export format'] },
  ]

  test('it is yours, the others go on, and Done moves it on', async () => {
    const { agent, handed } = buildAgent()
    opened = await openWindow(dataFolder, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, HUMAN)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        const waiting = yield* eventually(
          buildOf(sessionId),
          (view) => view.tasks[0]?.state === 'done',
        )
        const builds = yield* Builds
        const refused = yield* Effect.flip(
          builds.taskDone(waiting.sessionId, waiting.tasks[0]?.id ?? ''),
        )
        // Named from another build, the user's task is none of that build's.
        const elsewhere = yield* Effect.flip(
          builds.taskDone('another-build', waiting.tasks[1]?.id ?? ''),
        )
        yield* builds.taskDone(waiting.sessionId, waiting.tasks[1]?.id ?? '')
        const after = yield* eventually(
          buildOf(sessionId),
          (view) => view.tasks[2]?.state === 'done',
        )
        return {
          sessionId,
          waiting,
          refused,
          elsewhere,
          after,
          journal: yield* journalOf(sessionId),
        }
      }),
    )
    expect(statesOf(seen.waiting)).toEqual({ T1: 'done', T2: 'yours', T3: 'waiting' })
    expect(seen.elsewhere).toBeInstanceOf(UnknownBuildError)
    // The window is told, and draws the banner from the view (D10-08).
    expect(opened.built).toContain(seen.sessionId)
    // Never handed to the agent, never acknowledged by Hemera.
    expect(handed.some((text) => handedLabels(text).includes('T2'))).toBe(false)
    expect(seen.refused.message).toBe('T1 is not waiting for you.')
    expect(statesOf(seen.after)).toEqual({ T1: 'done', T2: 'done', T3: 'done' })
    expect(seen.journal.filter((line) => line.type === 'task.yours')).toHaveLength(1)
    const done = seen.journal.find(
      (line) => line.type === 'task.done' && line.entity_id === seen.after.tasks[1]?.id,
    )
    expect(JSON.parse(done?.payload ?? '{}')).toEqual({ label: 'T2' })
  })

  test('Skip with a reason moves it on, its dependants let go on', async () => {
    const { agent } = buildAgent()
    opened = await openWindow(dataFolder, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, HUMAN)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        const waiting = yield* eventually(
          buildOf(sessionId),
          (view) => view.tasks[0]?.state === 'done',
        )
        const builds = yield* Builds
        const refused = yield* Effect.flip(
          builds.taskSkip(waiting.sessionId, waiting.tasks[1]?.id ?? '', ' ', true),
        )
        yield* builds.taskSkip(
          waiting.sessionId,
          waiting.tasks[1]?.id ?? '',
          'The format is the old one',
          true,
        )
        const after = yield* eventually(
          buildOf(sessionId),
          (view) => view.tasks[2]?.state === 'done',
        )
        return { refused, after, journal: yield* journalOf(sessionId) }
      }),
    )
    expect(seen.refused.message).toBe('Say why the task is skipped.')
    expect(statesOf(seen.after)).toEqual({ T1: 'done', T2: 'skipped', T3: 'done' })
    expect(seen.after.tasks[1]?.skipReason).toBe('The format is the old one')
    expect(seen.after.tasks[1]?.skipUnblocks).toBe(true)
    // The revision the build was started on, which the window opens read only.
    expect(seen.after.revision).toBe(1)
    const skipped = seen.journal.find((line) => line.type === 'task.skipped')
    expect(JSON.parse(skipped?.payload ?? '{}')).toEqual({
      label: 'T2',
      reason: 'The format is the old one',
      unblocks: true,
    })
  })
})

describe('A task skipped without its dependants', () => {
  test('skips them too, each with its reason, and the build reaches verify', async () => {
    const TASKS = [
      { title: 'Write the exporter' },
      { title: 'Sign the export format', executor: 'human' as const },
      { title: 'Publish it', dependsOn: ['Sign the export format'] },
      { title: 'Announce it', dependsOn: ['Publish it'] },
    ]
    const { agent } = buildAgent()
    opened = await openWindow(dataFolder, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, TASKS)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        const waiting = yield* eventually(
          buildOf(sessionId),
          (view) => view.tasks[0]?.state === 'done',
        )
        yield* (yield* Builds).taskSkip(
          waiting.sessionId,
          waiting.tasks[1]?.id ?? '',
          'Not signed this year',
          false,
        )
        const after = yield* eventually(buildOf(sessionId), (view) => view.phase === 'verify')
        return { after, journal: yield* journalOf(sessionId) }
      }),
    )
    expect(statesOf(seen.after)).toEqual({
      T1: 'done',
      T2: 'skipped',
      T3: 'skipped',
      T4: 'skipped',
    })
    expect(seen.after.tasks.map((task) => task.skipReason)).toEqual([
      null,
      'Not signed this year',
      'T2, which it depends on, was skipped',
      'T3, which it depends on, was skipped',
    ])
    expect(
      seen.journal
        .filter((line) => line.type === 'task.skipped')
        .map((line) => JSON.parse(line.payload).label),
    ).toEqual(['T2', 'T3', 'T4'])
  })
})

describe('A blocker suspends the task and its dependants only', () => {
  test('T1 and T3 are blocked, T2 goes on, and dismissing it with a note makes T1 ready again', async () => {
    const TASKS = [
      { title: 'Write the exporter' },
      { title: 'Write the reader' },
      { title: 'Wire the exporter', dependsOn: ['Write the exporter'] },
    ]
    const { agent, handed } = buildAgent({
      execute: (labels, text) => {
        if (text.includes('The user dismissed it')) return labels.map(finished)
        return labels.flatMap((label) =>
          label === 'T1'
            ? [
                {
                  does: 'uses' as const,
                  call: 'task_blocked',
                  arguments: { task: 'T1', reason: 'The Spec asks for CSV and for JSON at once' },
                },
              ]
            : [finished(label)],
        )
      },
    })
    opened = await openWindow(dataFolder, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, TASKS)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        const blocked = yield* eventually(
          buildOf(sessionId),
          (view) => view.tasks[1]?.state === 'done' && view.tasks[0]?.state === 'blocked',
        )
        const dismissed = yield* (yield* Builds).dismissBlocker(
          blocked.sessionId,
          blocked.blockers[0]?.id ?? '',
          'The exporter takes the CSV header from the Spec.',
        )
        const after = yield* eventually(buildOf(sessionId), (view) => view.phase === 'verify')
        return { blocked, dismissed, after, journal: yield* journalOf(sessionId) }
      }),
    )
    expect(statesOf(seen.blocked)).toEqual({ T1: 'blocked', T2: 'done', T3: 'blocked' })
    expect(seen.blocked.blockers.map((one) => [one.label, one.reason, one.dismissedAt])).toEqual([
      ['T1', 'The Spec asks for CSV and for JSON at once', null],
    ])
    expect(statesOf(seen.dismissed)).toEqual({ T1: 'ready', T2: 'done', T3: 'waiting' })
    // Handed again with the dismissal, then carried out, T3 after it.
    expect(handed.some((text) => text.includes('# Blockers the user dismissed'))).toBe(true)
    // What the user wrote beside the dismissal goes to the agent with it.
    expect(
      handed.some((text) =>
        text.includes('The user adds: "The exporter takes the CSV header from the Spec."'),
      ),
    ).toBe(true)
    expect(statesOf(seen.after)).toEqual({ T1: 'done', T2: 'done', T3: 'done' })
    expect(
      seen.journal
        .filter((line) => line.type === 'task.blocked')
        .map((line) => JSON.parse(line.payload)),
    ).toEqual([
      { label: 'T1', reason: 'The Spec asks for CSV and for JSON at once' },
      { label: 'T3', because: 'T1' },
    ])
  })
})

describe('A dismissed blocker costs no try', () => {
  test('the task goes on with the try the blocker interrupted', async () => {
    const { agent } = buildAgent({
      execute: (labels, text) => {
        if (text.includes('The user dismissed it')) return labels.map(finished)
        return labels.includes('T1')
          ? [
              {
                does: 'uses' as const,
                call: 'task_blocked',
                arguments: { task: 'T1', reason: 'The Spec asks for CSV and for JSON at once' },
              },
              { does: 'uses' as const, call: 'build_read', arguments: { task: 'T1' } },
            ]
          : []
      },
    })
    opened = await openWindow(dataFolder, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, [{ title: 'Write the exporter' }])
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        const blocked = yield* eventually(
          buildOf(sessionId),
          (view) => view.tasks[0]?.state === 'blocked',
        )
        // The agent reads the task while it is blocked, then the user dismisses the blocker.
        yield* eventually(
          Effect.sync(() => agent.answers.used.length),
          (used) => used === 2,
        )
        yield* (yield* Builds).dismissBlocker(
          blocked.sessionId,
          blocked.blockers[0]?.id ?? '',
          null,
        )
        const done = yield* eventually(
          buildOf(sessionId),
          (view) => view.tasks[0]?.state === 'done',
        )
        return { blocked, done }
      }),
    )
    // Interrupted, not ended: the try is still the task's own.
    expect(
      seen.blocked.tasks[0]?.attempts.map((attempt) => [
        attempt.number,
        attempt.endedAt,
        attempt.result,
      ]),
    ).toEqual([[1, null, null]])
    expect(seen.done.tasks[0]?.attempts.map((attempt) => [attempt.number, attempt.result])).toEqual(
      [[1, 'unverified']],
    )
    // Read while blocked, the try is said as it is: stopped, not running.
    const read = agent.answers.used.find((used) => used.tool === 'build_read')
    expect(read?.text).toContain('## Attempt 1: stopped by the blocker')
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

describe('What the agent says it did goes to the Journal', () => {
  test('the summary of task_finished is on its Journal line, as the tool says', async () => {
    const { agent } = buildAgent({
      execute: (labels) =>
        labels.includes('T1')
          ? [
              {
                does: 'uses',
                call: 'task_finished',
                arguments: { task: 'T1', summary: 'Streams the rows' },
              },
            ]
          : [],
    })
    opened = await openWindow(dataFolder, agent)
    const lines = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        yield* eventually(buildOf(sessionId), (view) => view.tasks[0]?.state === 'done')
        return yield* journalOf(sessionId)
      }),
    )
    const said = lines.find((line) => line.type === 'task.finished')
    expect(JSON.parse(said?.payload ?? '{}')).toMatchObject({
      label: 'T1',
      summary: 'Streams the rows',
    })
    expect(TOOL_ARGUMENTS.task_finished.shape.summary.description).toContain('Journal')
  })
})
