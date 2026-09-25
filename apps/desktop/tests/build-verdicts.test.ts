/**
 * The build's part of the checks: when a story's checks run, and a task no check judges (design
 * D10-06, D10-07).
 *
 * Every suite is named after the scenario of `Spec · build-checks` it covers — the part the loop
 * owns; running a check is the checks' own layer's, scripted here — and runs the whole engine on the
 * fake agent, driven by deliveries.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { AgentRuntime } from '#engine/agents/runtime.ts'
import { Builds } from '#engine/build/build.ts'
import { BuildChecks, ProjectChecks } from '#engine/build/checks.ts'
import { Commands } from '#engine/commands/service.ts'
import { DatabaseError } from '#engine/storage/database.ts'

import {
  THREE,
  aReadySpec,
  buildAgent,
  buildOf,
  eventually,
  finished,
  journalOf,
  launched,
  projectChecks,
  scriptedChecks,
  statesOf,
} from './build-harness.ts'
import { type OpenWindow, openWindow, openWindowChecked } from './window.ts'

let dataFolder: string
let opened: OpenWindow | undefined

beforeEach(() => {
  dataFolder = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-build-checks-')))
})

afterEach(async () => {
  await opened?.close()
  opened = undefined
  rmSync(dataFolder, { recursive: true, force: true })
})

describe("A story's checks run once its tasks are done", () => {
  test('a red one hands the agent an attempt on the story, no task changing state', async () => {
    // `Export` is covered by T1 and T2, `Report` by T3; the first story check is red.
    const TASKS = [
      { title: 'Write the exporter', stories: ['Export'] },
      { title: 'Write the reader', stories: ['Export'] },
      {
        title: 'Wire them',
        dependsOn: ['Write the exporter', 'Write the reader'],
        stories: ['Report'],
      },
    ]
    let stories = 0
    const checks = scriptedChecks((request) => {
      if (request.when !== 'story') return []
      stories += 1
      return [
        stories === 1
          ? { name: 'e2e', verdict: 'red', output: 'export.e2e.ts: 1 failed' }
          : { name: 'e2e', verdict: 'green' },
      ]
    })
    const { agent, handed } = buildAgent()
    opened = await openWindowChecked(dataFolder, checks, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, TASKS, ['Export', 'Report'])
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        const red = yield* eventually(
          buildOf(sessionId),
          (view) => view.stories[0]?.attempts[0]?.result === 'red',
        )
        const after = yield* eventually(buildOf(sessionId), (view) =>
          view.stories.every((story) => story.state === 'green'),
        )
        return { red, after }
      }),
    )
    // Checked only once every task covering it was done, and no task moved for it.
    expect(statesOf(seen.red)).toMatchObject({ T1: 'done', T2: 'done' })
    expect(seen.red.stories[0]?.labels).toEqual(['T1', 'T2'])
    const first = seen.red.stories[0]?.attempts[0]?.startedAt ?? ''
    for (const task of seen.red.tasks.slice(0, 2)) expect(first >= (task.endedAt ?? '~')).toBe(true)
    const told = handed.find((text) => text.includes('The checks of the story "Export"'))
    expect(told).toContain('attempt 1 was red')
    expect(told).toContain('export.e2e.ts: 1 failed')
    // The turn that carried them over, they ran again (D10-07).
    const [exportStory, report] = seen.after.stories
    expect(exportStory?.attempts.map((attempt) => attempt.result)).toEqual(['red', 'green'])
    expect(report?.attempts.map((attempt) => attempt.result)).toEqual(['green'])
    expect(statesOf(seen.after)).toEqual({ T1: 'done', T2: 'done', T3: 'done' })
  })
})

describe('A task with no check is done unverified', () => {
  test('with no task check configured, task_finished makes the task done, not verified', async () => {
    const { agent } = buildAgent()
    opened = await openWindow(dataFolder, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        return yield* eventually(buildOf(sessionId), (view) => view.tasks[0]?.state === 'done')
      }),
    )
    const t1 = seen.tasks[0]
    expect(t1?.state).toBe('done')
    expect(t1?.attempts.map((attempt) => [attempt.result, attempt.checks.length])).toEqual([
      ['unverified', 0],
    ])
  })
})

/** A check of the Project's that takes its time: `node` waiting, then exiting 0. */
const slow = (projectId: string) =>
  Effect.gen(function* () {
    yield* (yield* ProjectChecks).save(
      projectId,
      {
        name: 'slow',
        commandId: null,
        line: `"${process.execPath}" -e "setTimeout(() => {}, 1500)"`,
        where: 'root',
        repository: null,
        when: 'task',
        expect: null,
        files: null,
      },
      null,
    )
  })

describe("A build's checks outlive its agent", () => {
  test('an agent let go of while a task is checked leaves its check running, and is kept', async () => {
    const { agent } = buildAgent({
      execute: (labels) => labels.filter((label) => label === 'T1').map(finished),
    })
    opened = await openWindowChecked(dataFolder, projectChecks, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        yield* slow(spec.projectId)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        yield* eventually(buildOf(sessionId), (view) => view.tasks[0]?.state === 'checking')
        // What the pool does to an agent it finds idle: its checks are running, so it is not.
        const runtime = yield* AgentRuntime
        yield* runtime.release(sessionId)
        const alive = yield* runtime.alive
        const done = yield* eventually(
          buildOf(sessionId),
          (view) => view.tasks[0]?.state !== 'checking',
        )
        return { alive: alive.includes(sessionId), done }
      }),
    )
    expect(seen.alive).toBe(true)
    expect(seen.done.tasks[0]?.state).toBe('done')
    expect(seen.done.tasks[0]?.attempts[0]?.checks.map((check) => check.verdict)).toEqual(['green'])
  })

  test('an agent that dies while a task is checked leaves its check running', async () => {
    const { agent } = buildAgent({
      execute: (labels) => labels.filter((label) => label === 'T1').map(finished),
    })
    opened = await openWindowChecked(dataFolder, projectChecks, agent, buildAgent().agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        yield* slow(spec.projectId)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        yield* eventually(buildOf(sessionId), (view) => view.tasks[0]?.state === 'checking')
        agent.die()
        return yield* eventually(buildOf(sessionId), (view) => view.tasks[0]?.state !== 'checking')
      }),
    )
    expect(seen.tasks[0]?.state).toBe('done')
    expect(seen.tasks[0]?.attempts[0]?.checks.map((check) => check.verdict)).toEqual(['green'])
  })
})

describe('Stop ends what the build was checking', () => {
  test('a Stop while a task is checked stops its check, and nothing moves after it', async () => {
    const { agent } = buildAgent({
      execute: (labels) => labels.filter((label) => label === 'T1').map(finished),
    })
    opened = await openWindowChecked(dataFolder, projectChecks, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        yield* slow(spec.projectId)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        const commands = yield* Commands
        yield* eventually(commands.running(sessionId), (runs) => runs.length === 1)
        yield* (yield* Builds).stop(sessionId)
        const runs = yield* eventually(commands.recent(sessionId), (all) =>
          all.every((run) => run.state !== 'running'),
        )
        // Longer than the check would have taken: had it gone on, its verdict would be in.
        yield* Effect.sleep('2 seconds')
        return { runs, view: yield* buildOf(sessionId), lines: yield* journalOf(sessionId) }
      }),
    )
    expect(seen.runs.map((run) => [run.name, run.state])).toEqual([['slow', 'stopped']])
    expect(seen.view.phase).toBe('stopped')
    expect(seen.view.tasks[0]?.attempts.map((attempt) => [attempt.number, attempt.result])).toEqual(
      [[1, null]],
    )
    expect(seen.lines.filter((line) => line.type === 'task.checked')).toEqual([])
  })
})

describe('An error is never masked in the evidence', () => {
  test('a repository whose snapshot fails is a red result on the try, naming it', async () => {
    const { agent } = buildAgent({
      execute: (labels, text) =>
        text.includes('was red') ? [] : labels.filter((label) => label === 'T1').map(finished),
    })
    opened = await openWindow(dataFolder, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        // The repository is no repository any more: nothing can snapshot it.
        rmSync(join(spec.repository, '.git'), { recursive: true, force: true })
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        return yield* eventually(buildOf(sessionId), (view) => view.tasks[0]?.attempts.length === 2)
      }),
    )
    const [first] = seen.tasks[0]?.attempts ?? []
    expect(first?.result).toBe('red')
    expect(first?.checks.map((check) => [check.name, check.place, check.verdict])).toContainEqual([
      'Snapshot of sources/api',
      'sources/api',
      'red',
    ])
    expect(first?.checks.every((check) => check.detail !== null)).toBe(true)
  })

  test('checks that cannot run are a red result on the try, and the task is not left checking', async () => {
    const broken = Layer.succeed(BuildChecks, {
      run: () =>
        Effect.fail(new DatabaseError({ doing: 'reading the checks', cause: 'disk I/O error' })),
    })
    const { agent } = buildAgent({
      execute: (labels, text) =>
        text.includes('was red') ? [] : labels.filter((label) => label === 'T1').map(finished),
    })
    opened = await openWindowChecked(dataFolder, broken, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        return yield* eventually(buildOf(sessionId), (view) => view.tasks[0]?.attempts.length === 2)
      }),
    )
    const [first] = seen.tasks[0]?.attempts ?? []
    expect(seen.tasks[0]?.state).toBe('in_progress')
    expect(first?.result).toBe('red')
    expect(first?.checks.map((check) => [check.name, check.verdict])).toEqual([['Checks', 'red']])
    expect(first?.checks[0]?.detail).toContain('disk I/O error')
  })
})
