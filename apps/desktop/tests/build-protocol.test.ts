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

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { fakeAgent } from '#engine/agents/fake.ts'
import { Launches } from '#engine/workspaces/launches.ts'

import { THREE, aReadySpec, launched } from './build-harness.ts'
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

describe('One build per Spec', () => {
  test('a second build of the same Spec is refused with its reason', async () => {
    const agent = fakeAgent()
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
})
