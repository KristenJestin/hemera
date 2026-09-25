/**
 * The build's part of the checks: when a story's checks run, and a task no check judges (design
 * D10-06, D10-07; L7).
 *
 * Every suite is named after the scenario of `Spec · build-checks` it covers — the part the loop
 * owns; running a check is the checks' own layer's, scripted here — and runs the whole engine on the
 * fake agent, driven by deliveries.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  THREE,
  aReadySpec,
  buildAgent,
  buildOf,
  eventually,
  launched,
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
    // The turn that carried them over, they ran again (L7).
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
