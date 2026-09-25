/**
 * The `build` protocol: `prepare`, `execute` and `verify`, the Spec's status, a pause and a restart
 * (design D10-01, D10-02, D10-09, D10-10; L2, L3, L8, L9, L10).
 *
 * Every suite is named after the scenario of `Spec · build-protocol` it covers, and runs the whole
 * engine on the fake agent, which a build drives through deliveries alone: a `ready` Spec of three
 * tasks — T1 and T2 with no dependency, T3 depending on both — built in the Project's `main`.
 */

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect, Result } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeStep } from '#engine/agents/fake.ts'
import { AgentRuntime } from '#engine/agents/runtime.ts'
import { Builds, PAUSED, recoveredBuilds } from '#engine/build/build.ts'
import { OBSOLETE } from '#engine/build/tasks.ts'
import { Specs } from '#engine/specs/specs.ts'
import { Launches } from '#engine/workspaces/launches.ts'
import { recovered } from '#engine/workspaces/preparation.ts'

import { gated, held, threadOf } from './application.ts'
import {
  THREE,
  aReadySpec,
  buildAgent,
  buildOf,
  eventually,
  finished,
  journalOf,
  launched,
  NOTE,
  scriptedChecks,
  statesOf,
} from './build-harness.ts'
import { type OpenWindow, openWindow, openWindowChecked } from './window.ts'

let dataFolder: string
let opened: OpenWindow | undefined

beforeEach(() => {
  dataFolder = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-build-')))
})

afterEach(async () => {
  await opened?.close()
  opened = undefined
  rmSync(dataFolder, { recursive: true, force: true })
})

describe('A build prepares before it executes', () => {
  test('every task has a row, the free ones are ready, and nothing starts before the note', async () => {
    // The agent looks at the Workspace, then is held before it answers with its note.
    const gate = gated(1)
    const { agent, handed } = buildAgent(
      {
        prepare: [
          { does: 'uses', call: 'fs_list' },
          { does: 'says', text: NOTE },
        ],
        execute: () => [],
      },
      { between: gate.between },
    )
    opened = await openWindow(dataFolder, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        const before = yield* eventually(buildOf(sessionId), () => agent.answers.used.length === 1)
        gate.carryOn()
        const after = yield* eventually(buildOf(sessionId), (view) => view.phase === 'execute')
        return { before, after, spec: yield* (yield* Specs).read(spec.specId) }
      }),
    )
    expect(seen.before.phase).toBe('prepare')
    expect(seen.before.note).toBeNull()
    expect(seen.before.tasks.map((task) => [task.label, task.title, task.state])).toEqual([
      ['T1', 'Write the exporter', 'ready'],
      ['T2', 'Write the reader', 'ready'],
      ['T3', 'Wire them', 'waiting'],
    ])
    // A Hemera call in `prepare` starts nothing: no task was handed yet (L3).
    expect(agent.answers.used[0]?.isError).toBe(false)
    expect(seen.before.tasks.every((task) => task.attempts.length === 0)).toBe(true)
    expect(handed[0]).toContain('# Phase: prepare')
    expect(handed[0]).toContain('### T3 · Wire them')
    // The note is the agent's answer to the `prepare` brief, and `execute` follows (L2).
    expect(seen.after.note).toBe(NOTE)
    expect(seen.spec.spec.status).toBe('ready')
  })
})

describe('The first task started moves the Spec to in progress', () => {
  test('the first call after the tasks were handed starts them, and a Rework is refused', async () => {
    const { agent } = buildAgent({ execute: () => [{ does: 'uses', call: 'build_read' }] })
    opened = await openWindow(dataFolder, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        const view = yield* eventually(buildOf(sessionId), (one) =>
          one.tasks.some((task) => task.state === 'in_progress'),
        )
        const specs = yield* Specs
        const refused = yield* Effect.flip(
          specs.reopen({
            specId: spec.specId,
            expectedRevisionId: spec.revisionId,
            sessionId: spec.writerId,
          }),
        )
        return { view, refused, status: (yield* specs.read(spec.specId)).spec.status }
      }),
    )
    expect(statesOf(seen.view)).toEqual({ T1: 'in_progress', T2: 'in_progress', T3: 'waiting' })
    expect(seen.view.tasks[0]?.attempts.map((attempt) => attempt.number)).toEqual([1])
    expect(seen.status).toBe('in_progress')
    expect(seen.refused.message).toContain('The build has started')
  })

  test('a Rework and a first task start are never both accepted', async () => {
    const { agent } = buildAgent({ execute: () => [] })
    opened = await openWindow(dataFolder, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        // T1 and T2 handed, and nothing called yet: the next Hemera call starts them.
        yield* eventually(
          buildOf(sessionId),
          (view) => view.tasks.filter((task) => task.handedAt !== null).length === 2,
        )
        const builds = yield* Builds
        const [reworked, called] = yield* Effect.all(
          [
            Effect.result(
              (yield* Specs).reopen({
                specId: spec.specId,
                expectedRevisionId: spec.revisionId,
                sessionId: spec.writerId,
              }),
            ),
            builds.admitted(sessionId, 'build_read', Effect.succeed('ran'), (reason) =>
              Effect.succeed(reason),
            ),
          ],
          { concurrency: 'unbounded' },
        )
        return {
          reworked: Result.isSuccess(reworked),
          called,
          view: yield* buildOf(sessionId),
          status: (yield* (yield* Specs).read(spec.specId)).spec.status,
        }
      }),
    )
    // Whichever was first, the other one was refused on what it found.
    if (seen.reworked) {
      expect(seen.called).toBe(OBSOLETE)
      expect(seen.status).toBe('draft')
      expect(seen.view.phase).toBe('stopped')
    } else {
      expect(seen.called).toBe('ran')
      expect(seen.status).toBe('in_progress')
      expect(statesOf(seen.view)).toMatchObject({ T1: 'in_progress', T2: 'in_progress' })
    }
  })
})

/** The file an agent writes for a task, relative to the Workspace root. */
const written = (name: string): FakeStep => ({
  does: 'uses',
  call: 'fs_write',
  arguments: { path: `sources/api/${name}`, content: 'export {}\n', key: name },
})

describe('A restart resumes the build where it stood', () => {
  test('two tasks done and one in progress: the same states, and a resume brief of each', async () => {
    // T1 and T2 are written and finished; T3 is started, and the engine closes on it.
    const first = buildAgent({
      execute: (labels) =>
        labels.includes('T3')
          ? [{ does: 'uses', call: 'build_read' }]
          : [written('export.ts'), finished('T1'), written('reader.ts'), finished('T2')],
    })
    opened = await openWindow(dataFolder, first.agent)
    const left = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        const view = yield* eventually(
          buildOf(sessionId),
          (one) => one.tasks.find((task) => task.label === 'T3')?.state === 'in_progress',
        )
        return { sessionId, view }
      }),
    )
    await opened.close()

    const second = buildAgent()
    opened = await openWindow(dataFolder, second.agent)
    const back = await opened.running(
      Effect.gen(function* () {
        // What the engine does at its start: the launches, then the builds (L9).
        yield* recovered
        yield* recoveredBuilds
        yield* eventually(Effect.succeed(second.handed), (handed) => handed.length > 0)
        return yield* buildOf(left.sessionId)
      }),
    )
    expect(statesOf(left.view)).toEqual({ T1: 'done', T2: 'done', T3: 'in_progress' })
    expect(statesOf(back)).toEqual(statesOf(left.view))
    expect(back.tasks).toEqual(left.view.tasks)
    // The agent starting over is handed where the build stands, never the `prepare` brief again.
    const [resume] = second.handed
    expect(resume).toContain('# Before you continue')
    expect(resume).toContain('## Done')
    expect(resume).toContain('- T1 · Write the exporter: done, not verified, attempt 1')
    expect(resume).toContain('sources/api: export.ts (A +1 -0)')
    expect(resume).toContain('## In progress')
    expect(resume).toContain('- T3 · Wire them')
    expect(resume).toContain('  Attempt 1: running')
    expect(resume).not.toContain('# Phase: prepare')
  })
})

describe('A restart checks again what it left checking', () => {
  test('a task whose checks a stopped engine left running is checked again, and done', async () => {
    // The first engine holds the check of T1 for ever; the second one answers it.
    const never = held()
    const first = buildAgent({
      execute: (labels) => labels.filter((label) => label === 'T1').map(finished),
    })
    opened = await openWindowChecked(
      dataFolder,
      scriptedChecks(async (request) => {
        if (request.when === 'task') await never.promise
        return []
      }),
      first.agent,
    )
    const sessionId = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const launchedOn = yield* launched(spec.specId, spec.workspaceId)
        yield* eventually(buildOf(launchedOn), (view) => view.tasks[0]?.state === 'checking')
        return launchedOn
      }),
    )
    await opened.close()

    const second = buildAgent({ resume: () => [] })
    const checked: string[] = []
    opened = await openWindowChecked(
      dataFolder,
      scriptedChecks((request) => {
        checked.push(request.attemptId)
        return request.when === 'task' ? [{ name: 'lint', verdict: 'green' }] : []
      }),
      second.agent,
    )
    const back = await opened.running(
      Effect.gen(function* () {
        yield* recovered
        yield* recoveredBuilds
        return yield* eventually(buildOf(sessionId), (view) => view.tasks[0]?.state === 'done')
      }),
    )
    expect(back.tasks[0]?.attempts.map((attempt) => [attempt.number, attempt.result])).toEqual([
      [1, 'green'],
    ])
    expect(checked).toEqual([back.tasks[0]?.attempts[0]?.id])
  })
})

describe('Pause stops at the next safe point', () => {
  test('the write completes, no new call starts, and Resume goes on with the task in progress', async () => {
    // The write asks the user first — it goes outside the Workspace — which holds it open; the
    // agent is then held before its next call — its note was one step, the write the second — and
    // keeps going after a cancel, as some agents do.
    const gate = gated(2)
    const outside = join(dataFolder, 'outside.txt')
    const { agent, handed } = buildAgent(
      {
        execute: (labels) =>
          labels.includes('T1')
            ? [
                {
                  does: 'uses',
                  call: 'fs_write',
                  arguments: { path: '../outside.txt', content: 'x', key: 'outside' },
                },
                { does: 'uses', call: 'fs_read', arguments: { path: 'sources/api' } },
              ]
            : [],
      },
      { between: gate.between, ignoresCancel: true },
    )
    opened = await openWindow(dataFolder, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        const entries = yield* eventually(threadOf(sessionId), (thread) =>
          thread.some((entry) => entry.kind === 'permission_request' && entry.state === 'pending'),
        )
        const builds = yield* Builds
        const paused = yield* builds.pause(sessionId)
        // The write was admitted before the Pause: it is answered and completes.
        const question = entries.find(
          (entry) => entry.kind === 'permission_request' && entry.state === 'pending',
        )
        const toolCallId = JSON.parse(question?.payload ?? '{}').toolCallId
        yield* (yield* AgentRuntime).decide(sessionId, toolCallId, 'allowed')
        // Then the turn is stopped; the agent's next call comes after the Pause.
        yield* eventually(
          Effect.sync(() => agent.answers.cancels),
          (cancels) => cancels > 0,
        )
        gate.carryOn()
        yield* eventually(
          Effect.sync(() => agent.answers.used.length),
          (used) => used === 2,
        )
        const during = yield* buildOf(sessionId)
        const resumed = yield* builds.resume(sessionId)
        yield* eventually(
          Effect.sync(() => handed.length),
          (count) => count === 3,
        )
        return { paused, during, resumed, after: yield* buildOf(sessionId) }
      }),
    )
    const [write, read] = agent.answers.used
    expect(seen.paused.pausedAt).not.toBeNull()
    expect(write?.isError).toBe(false)
    expect(existsSync(outside)).toBe(true)
    expect(read?.isError).toBe(true)
    expect(read?.text).toContain(PAUSED)
    expect(statesOf(seen.during)).toMatchObject({ T1: 'in_progress', T2: 'in_progress' })
    expect(seen.resumed.pausedAt).toBeNull()
    expect(statesOf(seen.after)).toMatchObject({ T1: 'in_progress', T2: 'in_progress' })
    expect(handed[2]).toContain('# Before you continue')
    expect(handed[2]).toContain('- T1 · Write the exporter')
  })

  test('a Resume before the running call ended leaves the turn going', async () => {
    // The write is held on the user's answer while the build is paused and resumed.
    const { agent } = buildAgent({
      execute: (labels) =>
        labels.includes('T1')
          ? [
              {
                does: 'uses',
                call: 'fs_write',
                arguments: { path: '../outside.txt', content: 'x', key: 'outside' },
              },
              { does: 'uses', call: 'fs_list', arguments: { path: 'sources/api' } },
            ]
          : [],
    })
    opened = await openWindow(dataFolder, agent)
    await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        const entries = yield* eventually(threadOf(sessionId), (thread) =>
          thread.some((entry) => entry.kind === 'permission_request' && entry.state === 'pending'),
        )
        const builds = yield* Builds
        yield* builds.pause(sessionId)
        yield* builds.resume(sessionId)
        const question = entries.find(
          (entry) => entry.kind === 'permission_request' && entry.state === 'pending',
        )
        const toolCallId = JSON.parse(question?.payload ?? '{}').toolCallId
        yield* (yield* AgentRuntime).decide(sessionId, toolCallId, 'allowed')
        yield* eventually(
          Effect.sync(() => agent.answers.used.length),
          (used) => used === 2,
        )
        // Long enough for a stop the Pause left behind to reach the agent.
        yield* Effect.sleep('300 millis')
      }),
    )
    const [write, listed] = agent.answers.used
    expect(write?.isError).toBe(false)
    expect(listed?.isError).toBe(false)
    expect(agent.answers.cancels).toBe(0)
  })
})

describe('One build per Spec', () => {
  test('a second build of the same Spec is refused with its reason, also during a pause', async () => {
    const { agent } = buildAgent({ execute: () => [] })
    opened = await openWindow(dataFolder, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        const launches = yield* Launches
        const running = yield* Effect.flip(launches.request(spec.specId, spec.workspaceId))
        yield* (yield* Builds).pause(sessionId)
        const paused = yield* Effect.flip(launches.request(spec.specId, spec.workspaceId))
        return { key: spec.key, running, paused }
      }),
    )
    expect(seen.running.message).toMatch(new RegExp(`^“${seen.key}” already has a build: it is`))
    expect(seen.paused.message).toBe(`“${seen.key}” already has a build: it is paused.`)
  })

  test('the obsolete build — reworked before its first task — is stopped and stays readable', async () => {
    const { agent } = buildAgent({ execute: () => [] })
    opened = await openWindow(dataFolder, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        yield* eventually(buildOf(sessionId), (view) =>
          view.tasks.some((task) => task.handedAt !== null),
        )
        // The Spec is still `ready`: the Rework is accepted, and a new revision is its draft.
        yield* (yield* Specs).reopen({
          specId: spec.specId,
          expectedRevisionId: spec.revisionId,
          sessionId: spec.writerId,
        })
        const called = yield* (yield* Builds).admitted(
          sessionId,
          'fs_list',
          Effect.succeed('ran'),
          (reason) => Effect.succeed(reason),
        )
        return { called, view: yield* buildOf(sessionId), journal: yield* journalOf(sessionId) }
      }),
    )
    expect(seen.called).toBe(OBSOLETE)
    const stopped = seen.journal.find((line) => line.type === 'build.stopped')
    expect(JSON.parse(stopped?.payload ?? '{}')).toEqual({ reason: OBSOLETE })
    expect(seen.view.phase).toBe('stopped')
    expect(seen.view.detail).toBe(OBSOLETE)
    expect(statesOf(seen.view)).toEqual({ T1: 'ready', T2: 'ready', T3: 'waiting' })
  })
})
