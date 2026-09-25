/**
 * A task's evidence: the files it changed in each repository, and its checks (design D10-05,
 * D10-06).
 *
 * Named after the scenario of `Spec · build-evidence` it covers — the snapshots' own scenario is
 * their suite's — over the whole engine on the fake agent, the Project's checks scripted.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeStep } from '#engine/agents/fake.ts'

import {
  aReadySpec,
  buildAgent,
  buildOf,
  eventually,
  finished,
  launched,
  scriptedChecks,
} from './build-harness.ts'
import { type OpenWindow, openWindowChecked } from './window.ts'

let dataFolder: string
let opened: OpenWindow | undefined

beforeEach(() => {
  dataFolder = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-build-evidence-')))
})

afterEach(async () => {
  await opened?.close()
  opened = undefined
  rmSync(dataFolder, { recursive: true, force: true })
})

/** A file the agent writes, relative to the Workspace root. */
const writes = (path: string, content: string): FakeStep => ({
  does: 'uses',
  call: 'fs_write',
  arguments: { path, content, key: path },
})

describe("A task's evidence is its diff and its checks", () => {
  test('a done task shows the files it changed per repository and each check with its output', async () => {
    const checks = scriptedChecks((request) =>
      request.when === 'task'
        ? [
            { name: 'types', verdict: 'green', output: 'Found 0 errors.' },
            { name: 'tests', verdict: 'green', output: '2 passed' },
          ]
        : [],
    )
    const { agent } = buildAgent({
      execute: (labels) =>
        labels.includes('T1')
          ? [
              writes('sources/api/export.ts', 'export const lines = 1\n'),
              writes('sources/front/export.tsx', 'export {}\nexport {}\n'),
              finished('T1'),
            ]
          : [],
    })
    opened = await openWindowChecked(dataFolder, checks, agent)
    const seen = await opened.running(
      Effect.gen(function* () {
        const spec = yield* aReadySpec(
          dataFolder,
          [{ title: 'Write the exporter' }],
          ['Export'],
          ['sources/api', 'sources/front'],
        )
        const sessionId = yield* launched(spec.specId, spec.workspaceId)
        return yield* eventually(buildOf(sessionId), (view) => view.tasks[0]?.state === 'done')
      }),
    )
    const [evidence] = seen.tasks[0]?.attempts ?? []
    expect(evidence?.result).toBe('green')
    expect(evidence?.files).toEqual([
      { repository: 'sources/api', path: 'export.ts', status: 'A', added: 1, removed: 0 },
      { repository: 'sources/front', path: 'export.tsx', status: 'A', added: 2, removed: 0 },
    ])
    expect(evidence?.checks.map((check) => [check.name, check.verdict, check.outputTail])).toEqual([
      ['types', 'green', 'Found 0 errors.'],
      ['tests', 'green', '2 passed'],
    ])
  })
})
