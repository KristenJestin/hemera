/**
 * The proof run uses a repository's test runner and report written by hand in Project settings
 * (#421): its command runs as the Spec wrote it, Hemera adding no reporter of its own, and the
 * report is read at the path set, inside the repository. A report missing after the run, or one
 * the path reaches through a link leading outside the repository, is not read: without a key line,
 * the red is not one.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent; Acme's real repositories
 * in temporary folders as the Workspace, and real `node --test` files as the proofs.
 */

import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { TestReporting } from '@hemera/core/domain'
import { Deferred, Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { BuilderHold } from '../src/engine/building/builder.ts'
import { readEvidence } from '../src/engine/memory/evidence.ts'
import { getProject } from '../src/engine/projects.ts'
import { setTestReporting } from '../src/engine/repository-tests.ts'
import { PLAN, launched } from './builder-world.ts'
import { until, within } from './sessions-world.ts'
import { removeFolders } from './storage.ts'
import {
  EXPORT_PATH,
  EXPORT_TEST,
  apiOf,
  automated,
  data,
  newFolders,
  outsideFolder,
  payloadsOf,
  proofOf,
  proofsEngine,
  work,
} from './proofs-world.ts'

beforeEach(() => newFolders('building-test-reporting'))
afterEach(removeFolders)

/** A `node --test` line that writes its own JUnit report at `report`, and lists every test. */
const ownReportLine = (report: string) =>
  `"${process.execPath}" --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=${report} ${EXPORT_PATH}`

/** R1.S2's export proof run by `command`, with no key line: only its report can make it a red. */
const exportBy = (command: string) => () => ({
  'R1.S2': automated(EXPORT_PATH, EXPORT_TEST, {
    test: {
      repository: 'api',
      path: EXPORT_PATH,
      code: EXPORT_TEST,
      insertion: 'new_file',
      command,
    },
  }),
})

/**
 * The mission launched with `api`'s value set by hand to `reporting` and the export proof run by
 * `command`, `plant` run in the Workspace's `api` right before its red run: the proof once its red
 * is judged, and the evidence of that run.
 */
const ranWith = (
  reporting: TestReporting,
  command: string,
  plant: (api: string) => void = () => {},
) => {
  const reading = Deferred.makeUnsafe<void>()
  const planted = Deferred.makeUnsafe<void>()
  const hold: BuilderHold = (point) =>
    point === 'test-reading'
      ? Effect.andThen(Deferred.succeed(reading, undefined), Deferred.await(planted))
      : Effect.void
  return proofsEngine(data, hold).run(({ profile }) =>
    within(
      profile,
      Effect.gen(function* () {
        const { mission } = yield* launched(
          work,
          (projectId) =>
            Effect.gen(function* () {
              const project = yield* getProject(projectId)
              const api = project.repositories.find((one) => one.path === 'api')
              yield* setTestReporting({ id: api?.id ?? '', version: project.version, reporting })
            }).pipe(Effect.orDie),
          undefined,
          PLAN,
          undefined,
          undefined,
          exportBy(command),
        )
        yield* Deferred.await(reading)
        plant(yield* apiOf(mission.id))
        yield* Deferred.succeed(planted, undefined)
        const judged = Effect.gen(function* () {
          const recorded = yield* payloadsOf(mission.id, 'building.red_recorded')
          const invalid = yield* payloadsOf(mission.id, 'building.red_invalid')
          return recorded.length + invalid.length > 0
        })
        yield* until(judged, 20_000)
        const proof = yield* proofOf(mission.id, 'R1.S2')
        const evidence = yield* readEvidence(mission.id, proof.runs[0]?.evidenceId ?? '')
        return { proof, evidence: new TextDecoder().decode(evidence.bytes) }
      }),
    ),
  )
}

const JUNIT_AT_ROOT: TestReporting = {
  runner: 'node',
  report: { format: 'junit', path: 'junit.xml' },
}

describe('the proof run uses the custom value', () => {
  test('the report the command writes at the path set decides a red that has no key line', async () => {
    const seen = await ranWith(JUNIT_AT_ROOT, ownReportLine('junit.xml'))
    expect(seen.proof.state).toBe('red_recorded')
    expect(seen.proof.red?.classification).toBe('assertion_failed')
    // The command runs as the Spec wrote it: Hemera adds no reporter of its own.
    expect(seen.proof.red?.line).toBe(ownReportLine('junit.xml'))
    expect(seen.evidence).not.toContain('Hemera added:')
    expect(seen.evidence).toContain('api/junit.xml')
  })

  test('a report missing after the run gives the uncertain path, never an acceptance', async () => {
    // The command writes no report where the value says it is.
    const seen = await ranWith(JUNIT_AT_ROOT, ownReportLine('elsewhere.xml'))
    expect(seen.proof.state).toBe('waiting_red')
    expect(seen.proof.runs.map((one) => one.classification)).toEqual(['assertion_failed'])
  })

  test('a report the path reaches through a link planted outside the repository is not read', async () => {
    const outside = outsideFolder()
    const seen = await ranWith(
      { runner: 'node', report: { format: 'junit', path: 'reports/junit.xml' } },
      ownReportLine('reports/junit.xml'),
      // A junction on Windows, which needs no privilege; a directory link elsewhere.
      (api) => symlinkSync(outside, join(api, 'reports'), 'junction'),
    )
    expect(seen.proof.state).toBe('waiting_red')
    expect(seen.proof.runs.map((one) => one.classification)).toEqual(['assertion_failed'])
  })

  test('the same report inside the repository, reached through no link, is read', async () => {
    const seen = await ranWith(
      { runner: 'node', report: { format: 'junit', path: 'reports/junit.xml' } },
      ownReportLine('reports/junit.xml'),
      (api) => mkdirSync(join(api, 'reports')),
    )
    expect(seen.proof.state).toBe('red_recorded')
  })
})
