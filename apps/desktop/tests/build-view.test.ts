/**
 * The engine's part of the build view: Accept and Stop (design D10-11, D10-12).
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
