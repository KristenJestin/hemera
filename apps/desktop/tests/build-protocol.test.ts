/**
 * The `build` protocol: `prepare`, `execute` and `verify`, the Spec's status, a pause and a restart
 * (design D10-01, D10-02, D10-09, D10-10; L2, L3, L8, L9, L10).
 *
 * Every suite is named after the scenario of `Spec · build-protocol` it covers, and runs the whole
 * engine on the fake agent, which a build drives through deliveries alone: a `ready` Spec of three
 * tasks — T1 and T2 with no dependency, T3 depending on both — built in the Project's `main`.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect, Result } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { Builds } from '#engine/build/build.ts'
import { OBSOLETE } from '#engine/build/tasks.ts'
import { Specs } from '#engine/specs/specs.ts'
import { Launches } from '#engine/workspaces/launches.ts'

import { gated } from './application.ts'
import {
  THREE,
  aReadySpec,
  buildAgent,
  buildOf,
  eventually,
  journalOf,
  launched,
  NOTE,
  statesOf,
} from './build-harness.ts'
import { type OpenWindow, openWindow } from './window.ts'

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

describe('One build per Spec', () => {
  test('a second build of the same Spec is refused with its reason', async () => {
    const { agent } = buildAgent({ execute: () => [] })
    opened = await openWindow(dataFolder, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        yield* launched(spec.specId, spec.workspaceId)
        const launches = yield* Launches
        const running = yield* Effect.flip(launches.request(spec.specId, spec.workspaceId))
        return { key: spec.key, running }
      }),
    )
    expect(seen.running.message).toMatch(new RegExp(`^“${seen.key}” already has a build: it is`))
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
