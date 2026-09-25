/**
 * The text side of the `build` protocol (design D10-01, D10-02, D10-03, D10-07, D10-09): the
 * protocol, the mission and phase briefs, and what each brief of a build carries.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  BUILD_MISSION_BRIEF,
  BUILD_PHASE_BRIEFS,
  BUILD_PROTOCOL,
  composeBuildBrief,
  offeredTools,
  renderSpecMarkdown,
} from '#index.ts'
import type { BriefAttempt, BriefTask } from '#index.ts'

import { passingSnapshot } from './spec-fixture.ts'

const LABELS = new Map([
  ['task-1', 'T1'],
  ['task-2', 'T2'],
])

function briefTask(label: string, more: Partial<BriefTask> = {}): BriefTask {
  return {
    label,
    title: `Title of ${label}`,
    result: `Result of ${label}`,
    criteria: `Criteria of ${label}`,
    type: 'feature',
    executor: 'agent',
    state: 'ready',
    dependsOn: [],
    covers: [],
    attempts: [],
    snapshots: [],
    reason: null,
    ...more,
  }
}

const RED: BriefAttempt = {
  number: 1,
  result: 'red',
  files: [{ repository: './api', path: 'src/a.ts', status: 'M', added: 3, removed: 1 }],
  checks: [
    {
      name: 'lint',
      place: './api',
      verdict: 'red',
      detail: 'exited with 1',
      outputTail: 'src/a.ts:3 no-unused-vars',
    },
    { name: 'types', place: '', verdict: 'green', detail: null, outputTail: 'ok' },
  ],
}

describe('The build protocol', () => {
  test('version 1: prepare, execute, verify, each after the one before', () => {
    expect(BUILD_PROTOCOL).toEqual({
      version: 1,
      phases: [
        { id: 'prepare', dependsOn: [], available: true },
        { id: 'execute', dependsOn: ['prepare'], available: true },
        { id: 'verify', dependsOn: ['execute'], available: true },
      ],
    })
  })

  test('the mission brief names only tools a build Session is offered', () => {
    const named = BUILD_MISSION_BRIEF.match(/\b[a-z]+_[a-z]+\b/g) ?? []
    expect(named.length).toBeGreaterThan(0)
    for (const tool of named) expect(offeredTools('build')).toContain(tool)
  })

  test('the mission brief keeps the agent off the Spec, the states and the history', () => {
    expect(BUILD_MISSION_BRIEF).toContain('task_finished({ task: "T2" })')
    expect(BUILD_MISSION_BRIEF).toContain('task_blocked({ task: "T3", reason })')
    expect(BUILD_MISSION_BRIEF).toContain('You never set a task')
    expect(BUILD_MISSION_BRIEF).toContain('Do not commit, push')
    expect(BUILD_MISSION_BRIEF).toContain('reproduction scenario before you fix')
  })
})

describe('A build prepares before it executes', () => {
  test('the prepare brief is the mission, the prepare phase and the Spec with its labels', () => {
    const snapshot = passingSnapshot()
    const brief = composeBuildBrief({ kind: 'prepare', snapshot, labels: LABELS })
    expect(brief).toBe(
      [
        BUILD_MISSION_BRIEF,
        BUILD_PHASE_BRIEFS.prepare,
        `# The Spec\n\n${renderSpecMarkdown(snapshot, LABELS)}`,
      ].join('\n\n'),
    )
    expect(brief).toContain('### T1 · Render')
    expect(brief).toContain('### T2 · Button')
    expect(brief).toContain('Depends on: T1')
    expect(BUILD_PHASE_BRIEFS.prepare).toContain('approach note, as your answer to this message')
  })

  test('without labels the Spec renders as the define Session reads it', () => {
    const rendered = renderSpecMarkdown(passingSnapshot())
    expect(rendered).toContain('### Button')
    expect(rendered).toContain('Depends on: Render')
  })
})

describe('Every ready task is handed at once', () => {
  test('the execute brief of three tasks lists T1 and T2, each whole, and not T3', () => {
    const brief = composeBuildBrief({
      kind: 'execute',
      ready: [briefTask('T1'), briefTask('T2', { covers: ['Export'] })],
      failures: [],
      dismissed: [],
    })
    expect(brief.startsWith(BUILD_PHASE_BRIEFS.execute)).toBe(true)
    expect(brief).toContain('Every task ready now, handed at once: T1, T2.')
    expect(brief).toContain(
      '## T2 · Title of T2\nType: feature · Covers: Export\nResult: Result of T2\nCriteria: Criteria of T2',
    )
    expect(brief).toContain('## T1 · Title of T1')
    expect(brief).not.toContain('T3')
    expect(brief).not.toContain('# Failures to address')
  })

  test('a task handed again carries its red checks, where they ran and their output', () => {
    const brief = composeBuildBrief({
      kind: 'execute',
      ready: [
        briefTask('T3', {
          state: 'in_progress',
          dependsOn: ['T1', 'T2'],
          attempts: [RED, { number: 2, result: null, files: [], checks: [] }],
        }),
      ],
      failures: [],
      dismissed: [],
    })
    expect(brief).toContain('Depends on: T1, T2')
    expect(brief).toContain('Attempt 1 was red.')
    expect(brief).toContain('- lint, in ./api: exited with 1\n```\nsrc/a.ts:3 no-unused-vars\n```')
    expect(brief).not.toContain('types')
  })

  test('failures of a story and of the build, and dismissed blockers, follow the tasks', () => {
    const brief = composeBuildBrief({
      kind: 'execute',
      ready: [],
      failures: [
        { story: 'Export', attempt: { ...RED, number: 2 } },
        { story: null, attempt: RED },
      ],
      dismissed: [{ label: 'T4', title: 'Title of T4', reason: 'the plan says CSV' }],
    })
    expect(brief).toContain('No task is ready for you now')
    expect(brief).toContain('## The checks of the story "Export": attempt 2 was red')
    expect(brief).toContain('## The end checks: attempt 1 was red')
    expect(brief).toContain(
      '- T4 · Title of T4: you said "the plan says CSV". The user dismissed it',
    )
  })

  test('an output holding a code fence stays inside its own', () => {
    const attempt: BriefAttempt = {
      ...RED,
      checks: [{ ...RED.checks[0]!, outputTail: 'before\n```\nafter' }],
    }
    const brief = composeBuildBrief({
      kind: 'execute',
      ready: [briefTask('T1', { state: 'in_progress', attempts: [attempt] })],
      failures: [],
      dismissed: [],
    })
    expect(brief).toContain('````\nbefore\n```\nafter\n````')
  })
})

describe('A restart resumes the build where it stood', () => {
  const done = briefTask('T1', {
    state: 'done',
    attempts: [RED, { ...RED, number: 2, result: 'green', checks: [RED.checks[1]!] }],
  })
  const unverified = briefTask('T2', {
    state: 'done',
    attempts: [{ number: 1, result: 'unverified', files: [], checks: [] }],
  })
  const working = briefTask('T3', {
    state: 'in_progress',
    attempts: [RED, { number: 2, result: null, files: [], checks: [] }],
    snapshots: [{ repository: './api', tree: 'abc123' }],
  })
  const brief = composeBuildBrief({
    kind: 'resume',
    phase: 'execute',
    snapshot: passingSnapshot(),
    labels: LABELS,
    tasks: [
      done,
      unverified,
      working,
      briefTask('T4', { state: 'yours', executor: 'human' }),
      briefTask('T5', { state: 'blocked', reason: 'contradicts the scope' }),
      briefTask('T6', { state: 'skipped', reason: 'not needed' }),
      briefTask('T7', { state: 'ready' }),
    ],
    ready: [working, briefTask('T7')],
    failures: [],
  })

  test('it carries the mission, the phase in focus and the Spec', () => {
    expect(brief.startsWith(`${BUILD_MISSION_BRIEF}\n\n${BUILD_PHASE_BRIEFS.execute}`)).toBe(true)
    expect(brief).toContain(renderSpecMarkdown(passingSnapshot(), LABELS))
  })

  test('the done tasks come with their evidence', () => {
    expect(brief).toContain(
      '- T1 · Title of T1: done, attempt 2\n  Files changed: ./api: src/a.ts (M +3 -1)\n  Checks: types green in the Workspace root',
    )
    expect(brief).toContain('- T2 · Title of T2: done, not verified, attempt 1')
  })

  test('the task in progress comes with its attempts and the last recorded state', () => {
    expect(brief).toContain('- T3 · Title of T3\n  Attempt 1: red')
    expect(brief).toContain('  Attempt 2: running')
    expect(brief).toContain('./api at the start of the attempt in progress: tree abc123')
  })

  test('the user’s, blocked and skipped tasks are said with why', () => {
    expect(brief).toContain('- T4 · Title of T4: carried out by a human')
    expect(brief).toContain('- T5 · Title of T5: contradicts the scope')
    expect(brief).toContain('- T6 · Title of T6: not needed')
  })

  test('it asks to inspect the real state before redoing anything, then hands the ready set', () => {
    const inspect = brief.indexOf('# Before you continue')
    const handed = brief.indexOf('# Tasks handed now')
    expect(inspect).toBeGreaterThan(brief.indexOf('# Where the build stands'))
    expect(handed).toBeGreaterThan(inspect)
    expect(brief).toContain('git status')
    expect(brief).toContain('Never assume a write happened, nor that it did not')
    expect(brief.slice(handed)).toContain('handed at once: T3, T7.')
  })
})

describe('The verify brief', () => {
  test('the verify phase, and the red end checks when there are', () => {
    expect(composeBuildBrief({ kind: 'verify', failures: [] })).toBe(BUILD_PHASE_BRIEFS.verify)
    const red = composeBuildBrief({ kind: 'verify', failures: [{ story: null, attempt: RED }] })
    expect(red).toContain('## The end checks: attempt 1 was red')
    expect(red).toContain('- lint, in ./api: exited with 1')
  })

  test('a resume in verify hands no task', () => {
    const brief = composeBuildBrief({
      kind: 'resume',
      phase: 'verify',
      snapshot: passingSnapshot(),
      labels: LABELS,
      tasks: [briefTask('T1', { state: 'done' })],
      ready: [],
      failures: [],
    })
    expect(brief).toContain(BUILD_PHASE_BRIEFS.verify)
    expect(brief).not.toContain('# Tasks handed now')
    expect(brief).toContain('- T1 · Title of T1: done by the user')
  })
})
