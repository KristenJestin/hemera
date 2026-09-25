/**
 * The engine's part of the build view: Accept and Stop, and the Journal a build writes (design
 * D10-11, D10-12, D10-14).
 *
 * Named after the scenario of `Spec · build-view` it covers, over the whole engine on the fake
 * agent, with the Project's checks scripted green.
 */

import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeStep } from '#engine/agents/fake.ts'
import { Builds } from '#engine/build/build.ts'
import { Specs } from '#engine/specs/specs.ts'

import {
  THREE,
  aReadySpec,
  buildAgent,
  buildOf,
  eventually,
  finished,
  journalOf,
  launched,
  scriptedChecks,
} from './build-harness.ts'
import { git } from './repositories.ts'
import { type OpenWindow, openWindowChecked } from './window.ts'

let dataFolder: string
let opened: OpenWindow | undefined

beforeEach(() => {
  dataFolder = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-build-view-')))
})

afterEach(async () => {
  await opened?.close()
  opened = undefined
  rmSync(dataFolder, { recursive: true, force: true })
})

/** Every check green, at every moment. */
const green = scriptedChecks((request) => [{ name: `${request.when} check`, verdict: 'green' }])

/** The agent writes a file for T1 before finishing it, and finishes every other task handed. */
const writing = () =>
  buildAgent({
    execute: (labels): readonly FakeStep[] =>
      labels.flatMap((label) =>
        label === 'T1'
          ? [
              {
                does: 'uses' as const,
                call: 'fs_write',
                arguments: { path: 'sources/api/export.ts', content: 'export {}\n', key: 'export' },
              },
              finished(label),
            ]
          : [finished(label)],
      ),
  })

describe('Accept ends the build', () => {
  test('only once verify is green; the Spec stays in progress and the branch and files stay', async () => {
    const { agent } = writing()
    opened = await openWindowChecked(dataFolder, green, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        const builds = yield* Builds
        const early = yield* eventually(buildOf(sessionId), (view) => view.phase === 'execute')
        const refused = yield* Effect.flip(builds.accept(sessionId))
        const ready = yield* eventually(buildOf(sessionId), (view) => view.canAccept)
        const before = {
          status: git(spec.repository, 'status', '--porcelain'),
          log: git(spec.repository, 'log', '--oneline', '--all'),
          branch: git(spec.repository, 'branch', '--show-current'),
        }
        const accepted = yield* builds.accept(sessionId)
        const after = {
          status: git(spec.repository, 'status', '--porcelain'),
          log: git(spec.repository, 'log', '--oneline', '--all'),
          branch: git(spec.repository, 'branch', '--show-current'),
        }
        return {
          early,
          refused,
          ready,
          before,
          accepted,
          after,
          file: readFileSync(join(spec.repository, 'export.ts'), 'utf8'),
          status: (yield* (yield* Specs).read(spec.specId)).spec.status,
        }
      }),
    )
    expect(seen.early.canAccept).toBe(false)
    expect(seen.refused.message).toBe('The build has not reached its final checks.')
    expect(seen.ready.phase).toBe('verify')
    expect(seen.ready.endAttempts.map((attempt) => attempt.result)).toEqual(['green'])
    expect(seen.accepted.phase).toBe('accepted')
    expect(seen.accepted.canAccept).toBe(false)
    expect(seen.status).toBe('in_progress')
    // Nothing of the user's moved: the file is where the agent wrote it, uncommitted.
    expect(seen.after).toEqual(seen.before)
    expect(seen.before.status).toBe('?? export.ts')
    expect(seen.file).toBe('export {}\n')
    // The evidence of T1 is its diff, copied from its two snapshots (L11).
    expect(seen.accepted.tasks[0]?.attempts[0]?.files).toEqual([
      { repository: 'sources/api', path: 'export.ts', status: 'A', added: 1, removed: 0 },
    ])
  })
})

describe('A build writes its Journal lines', () => {
  test('each phase, each task move and each of the user’s actions, correlated (D10-14)', async () => {
    const { agent } = buildAgent()
    opened = await openWindowChecked(dataFolder, green, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        const builds = yield* Builds
        yield* eventually(buildOf(sessionId), (view) => view.canAccept)
        yield* builds.pause(sessionId)
        yield* builds.resume(sessionId)
        const view = yield* builds.accept(sessionId)
        return { spec, view, lines: yield* journalOf(sessionId) }
      }),
    )
    const build = seen.lines.filter(
      (line) => line.type.startsWith('build.') || line.type.startsWith('task.'),
    )
    const byType = (type: string) => build.filter((line) => line.type === type)
    expect(byType('build.phase_started').map((line) => JSON.parse(line.payload).phase)).toEqual([
      'prepare',
      'execute',
      'verify',
    ])
    for (const type of [
      'task.ready',
      'task.started',
      'task.finished',
      'task.checked',
      'task.done',
    ]) {
      expect(
        byType(type)
          .map((line) => JSON.parse(line.payload).label)
          .toSorted(),
      ).toEqual(['T1', 'T2', 'T3'])
    }
    expect(byType('build.paused')).toHaveLength(1)
    expect(byType('build.resumed')).toHaveLength(1)
    expect(byType('build.accepted')).toHaveLength(1)
    // Every line names the Session, the Spec and the revision; a task's names its row.
    for (const line of build) {
      expect(line.spec_id).toBe(seen.spec.specId)
      expect(line.revision_id).toBe(seen.spec.revisionId)
      expect(line.session_id).toBe(seen.view.sessionId)
    }
    const ids = new Set(seen.view.tasks.map((task) => task.id))
    for (const line of build.filter((one) => one.type.startsWith('task.'))) {
      expect(line.entity_kind).toBe('task')
      expect(ids.has(line.entity_id)).toBe(true)
    }
    expect(JSON.parse(byType('task.checked')[0]?.payload ?? '{}')).toMatchObject({
      attempt: 1,
      result: 'green',
    })
    // The Spec's own line when its first task started (D10-10).
    expect(seen.lines.filter((line) => line.type === 'spec.in_progress')).toHaveLength(1)
  })
})

describe('Stop closes the build', () => {
  test('a stopped build stays readable, and frees the Spec for another build', async () => {
    // The second build is a second agent: a fake that was stopped does not speak again.
    const { agent } = buildAgent({ execute: () => [] })
    opened = await openWindowChecked(dataFolder, green, agent, buildAgent().agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(dataFolder, THREE)
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        yield* eventually(buildOf(sessionId), (view) => view.phase === 'execute')
        const builds = yield* Builds
        const stopped = yield* builds.stop(sessionId)
        const again = yield* Effect.flip(builds.pause(sessionId))
        const next = yield* launched(spec.specId, spec.workspaceId)
        return { sessionId, stopped, again, next, read: yield* buildOf(sessionId) }
      }),
    )
    expect(seen.stopped.phase).toBe('stopped')
    expect(seen.stopped.detail).toBe('Stopped by the user.')
    expect(seen.read.tasks.map((task) => task.label)).toEqual(['T1', 'T2', 'T3'])
    expect(seen.again.message).toBe('This build is stopped.')
    expect(seen.next).not.toBe(seen.sessionId)
  })
})
