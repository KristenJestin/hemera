/**
 * A red refused when its patch changes how the runner judges (#479): a `conftest.py`, pytest's or
 * vitest's configuration, a setup file one of them names, a file the proof's command names, each
 * changed in the proof's repository since the Building began. The runner itself could then list
 * and report the added test as failed, so its run and its report agree and only the patch tells.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent; Acme's real repositories
 * in temporary folders as the Workspace, and real `node --test` files as the proofs: the rule reads
 * the patch, whatever runner the proof names. The Builder's writes before the red are planted in
 * the Workspace while Hemera reads the proof's test file, right before the run takes its trees.
 */

import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { and, eq } from 'drizzle-orm'
import { Deferred, Effect, type Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { BuilderHold } from '../src/engine/building/builder.ts'
import { SnapshotFailed, type SnapshotsService } from '../src/engine/building/snapshots.ts'
import { proofsRead } from '../src/engine/building/proofs.ts'
import { Database } from '../src/engine/storage/database.ts'
import { sessionDeliveries } from '../src/engine/storage/schema.ts'
import { call, eventsOf } from './building-world.ts'
import { builderAgents, builderOf, buildingNow, launched } from './builder-world.ts'
import { git } from './repositories.ts'
import { HELPER, sessionsEngine, until, within } from './sessions-world.ts'
import { ALLOW, verdictsSaying } from './tools-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('proof-red-runner-files'))
  work = realpathSync.native(temporaryFolder('proof-red-runner-files-work'))
})
afterEach(removeFolders)

/** R1.S2's test: red until `api/export.ts` exists, which T2 creates. */
const EXPORT_PATH = 'tests/export.test.mjs'
const EXPORT_TEST = [
  "import { test } from 'node:test'",
  "import assert from 'node:assert/strict'",
  "import { existsSync } from 'node:fs'",
  '',
  "test('the scenario holds', () => {",
  "  assert.equal(existsSync(new URL('../export.ts', import.meta.url)), true, 'export.ts exports nothing yet')",
  '})',
  '',
].join('\n')

/** R1.S2's proof, its command run as written after `node`. */
const exportProof = (flags = ''): Schema.JsonObject => {
  const command = `"${process.execPath}"${flags === '' ? '' : ` ${flags}`} --test --test-reporter=tap ${EXPORT_PATH}`
  return {
    mode: 'automated',
    actions: ['Run the test'],
    starting_data: 'None.',
    expected: 'The assertion of the test holds.',
    test: {
      repository: 'api',
      path: EXPORT_PATH,
      code: EXPORT_TEST,
      insertion: 'new_file',
      command,
    },
    seen_today: false,
  }
}

/** Writes files into a checkout, folders made. */
const written = (folder: string, files: Readonly<Record<string, string>>) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true })
    writeFileSync(join(folder, path), content)
  }
}

/** `api` with these files committed and pushed: the base the Building starts from. */
const based = (
  api: string,
  files: Readonly<Record<string, string>>,
  links: Readonly<Record<string, string>> = {},
) => {
  written(api, files)
  for (const [path, target] of Object.entries(links)) {
    mkdirSync(dirname(join(api, path)), { recursive: true })
    symlinkSync(target, join(api, path))
  }
  git(api, 'add', '.')
  git(api, 'commit', '-q', '-m', 'the runner’s files')
  git(api, 'push', '-q', 'origin', 'main')
  git(api, 'fetch', '-q', 'origin')
}

/** The Workspace's `api` folder. */
const apiOf = (missionId: string) =>
  Effect.map(
    buildingNow(missionId),
    (view) => view.repositories.find((one) => one.name === 'api')?.folder ?? '',
  )

/** R1.S2's proof as the page reads it. */
const proofOf = (missionId: string) =>
  Effect.gen(function* () {
    yield* buildingNow(missionId)
    const found = (yield* proofsRead(missionId))?.scenarios.find((one) => one.scenario === 'R1.S2')
    if (found === undefined) return yield* Effect.die(new Error('no proof of R1.S2'))
    return found
  })

const payloadsOf = (missionId: string, type: string) =>
  Effect.map(eventsOf(missionId, type), (rows) => rows.map((row) => JSON.parse(row.payload)))

/** Everything delivered to the mission's sessions (the Builder), once something says `start`. */
const deliveredTo = (missionId: string, start: string) =>
  Effect.gen(function* () {
    const bodies = Effect.gen(function* () {
      const rows = yield* (yield* Database)
        .select({ body: sessionDeliveries.body })
        .from(sessionDeliveries)
        .where(
          and(eq(sessionDeliveries.ownerKind, 'mission'), eq(sessionDeliveries.ownerId, missionId)),
        )
      return rows.map((row) => row.body).join('\n')
    })
    yield* until(Effect.map(bodies, (all) => all.includes(start)))
    return yield* bodies
  })

const REFUSED = 'changed since the Building began'

/**
 * The mission launched with R1.S2's proof (`flags` given to node) on `api` as `base` makes it, and
 * `plant` run in the Workspace's `api` once, while Hemera reads the test for the first red: the
 * Builder's writes before it. Once the red is judged, `moveOut` (a path of `api`) is removed, as the
 * Builder would, and the Builder calls proof_run: `after` is the state that run leads to.
 */
const redAfter = (
  plant: (api: string) => void,
  more: {
    readonly base?: (api: string) => void
    readonly flags?: string
    readonly moveOut?: string
    /** The snapshot service as the suite sees it, wrapped around the real one. */
    readonly snapshots?: (real: SnapshotsService) => SnapshotsService
  } = {},
) => {
  const reading = Deferred.makeUnsafe<void>()
  const planted = Deferred.makeUnsafe<void>()
  let first = true
  const hold: BuilderHold = (point) => {
    if (point !== 'test-reading' || !first) return Effect.void
    first = false
    return Effect.andThen(Deferred.succeed(reading, undefined), Deferred.await(planted))
  }
  return sessionsEngine(data, builderAgents, {
    roles: [HELPER],
    tools: { home: work, verdicts: verdictsSaying(() => ALLOW).layer },
    snapshots: more.snapshots ?? ((real) => real),
    building: { hold },
  }).run(({ profile }) =>
    within(
      profile,
      Effect.gen(function* () {
        const { mission } = yield* launched(
          work,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          (api) => {
            more.base?.(api)
            return { 'R1.S2': exportProof(more.flags) }
          },
        )
        yield* Deferred.await(reading)
        const api = yield* apiOf(mission.id)
        plant(api)
        yield* Deferred.succeed(planted, undefined)
        yield* until(
          Effect.map(
            Effect.all([payloadsOf(mission.id, 'building.red_invalid'), proofOf(mission.id)]),
            ([invalid, proof]) => invalid.length > 0 || proof.state !== 'waiting_red',
          ),
          20_000,
        )
        const proof = yield* proofOf(mission.id)
        const invalid = yield* payloadsOf(mission.id, 'building.red_invalid')
        const delivered = invalid.length === 0 ? '' : yield* deliveredTo(mission.id, REFUSED)
        if (more.moveOut === undefined)
          return { state: proof.state, invalid, delivered, after: null }
        rmSync(join(api, more.moveOut))
        const { grantId } = yield* builderOf(mission.id)
        yield* call(grantId, 'proof_run', { scenario: 'R1.S2' })
        yield* until(
          Effect.map(proofOf(mission.id), (one) => one.state === 'red_recorded'),
          20_000,
        )
        return { state: proof.state, invalid, delivered, after: (yield* proofOf(mission.id)).state }
      }),
    ),
  )
}

const HOOK = [
  'import pytest',
  '',
  '',
  '@pytest.hookimpl(wrapper=True)',
  'def pytest_runtest_makereport(item, call):',
  '    report = yield',
  '    report.outcome = "failed"',
  '    return report',
  '',
].join('\n')

const PYPROJECT =
  '[project]\nname = "api"\nversion = "1.0"\n\n[tool.pytest.ini_options]\naddopts = "-q"\n'

describe('A red whose patch changes how the runner judges (#479)', () => {
  test('a conftest.py written beside the test before the red: the red is refused, and the Builder is told which file', async () => {
    const seen = await redAfter((api) => written(api, { 'tests/conftest.py': HOOK }))
    expect(seen.state).toBe('waiting_red')
    expect(seen.invalid).toEqual([{ scenario: 'R1.S2', classification: 'assertion_failed' }])
    expect(seen.delivered).toContain(
      'this red is not one: api/tests/conftest.py changed since the Building began (a conftest.py)',
    )
    expect(seen.delivered).toContain('Move that change out until the red is recorded')
  })

  test('a red whose patch touches none of these files is judged as today: recorded', async () => {
    const seen = await redAfter(
      (api) => written(api, { 'invoices.ts': 'export const total = 0\n', 'notes.md': 'Later.\n' }),
      {
        base: (api) =>
          based(api, {
            'tests/helpers.mjs': 'export const one = 1\n',
            'conftest.py': 'import pytest\n',
          }),
      },
    )
    expect(seen.invalid).toEqual([])
    expect(seen.state).toBe('red_recorded')
  })

  test('a conftest.py in a folder above the test, named in another case: refused', async () => {
    const seen = await redAfter((api) => written(api, { 'Conftest.py': HOOK }))
    expect(seen.state).toBe('waiting_red')
    expect(seen.delivered).toContain(
      'api/Conftest.py changed since the Building began (a conftest.py)',
    )
  })

  test('a vitest setup file named by a configuration the patch did not change, changed by the patch: refused', async () => {
    const seen = await redAfter(
      (api) => written(api, { 'tests/setup.mjs': "afterEach(() => { throw new Error('no') })\n" }),
      {
        base: (api) =>
          based(api, {
            'vitest.config.mjs': "export default { test: { setupFiles: ['./tests/setup.mjs'] } }\n",
            'tests/setup.mjs': '',
          }),
      },
    )
    expect(seen.state).toBe('waiting_red')
    expect(seen.delivered).toContain(
      'api/tests/setup.mjs changed since the Building began (named by vitest.config.mjs)',
    )
  })

  test('pytest’s configuration renamed away: refused on the name it left', async () => {
    const seen = await redAfter(
      (api) => {
        rmSync(join(api, 'pytest.ini'))
        written(api, { 'pytest.ini.bak': '[pytest]\naddopts = -q\n' })
      },
      { base: (api) => based(api, { 'pytest.ini': '[pytest]\naddopts = -q\n' }) },
    )
    expect(seen.state).toBe('waiting_red')
    expect(seen.delivered).toContain(
      'api/pytest.ini changed since the Building began (pytest’s configuration)',
    )
  })

  test('pyproject.toml changed outside its [tool.pytest] table, its line endings with it: recorded', async () => {
    const seen = await redAfter(
      (api) =>
        written(api, {
          'pyproject.toml': PYPROJECT.replace('1.0', '1.1').replaceAll('\n', '\r\n'),
        }),
      { base: (api) => based(api, { 'pyproject.toml': PYPROJECT }) },
    )
    expect(seen.invalid).toEqual([])
    expect(seen.state).toBe('red_recorded')
  })

  test('pyproject.toml changed inside its [tool.pytest] table: refused', async () => {
    const seen = await redAfter(
      (api) =>
        written(api, { 'pyproject.toml': PYPROJECT.replace('"-q"', '"-q -p tests.plugin"') }),
      { base: (api) => based(api, { 'pyproject.toml': PYPROJECT }) },
    )
    expect(seen.state).toBe('waiting_red')
    expect(seen.delivered).toContain(
      'api/pyproject.toml changed since the Building began (its [tool.pytest] table)',
    )
  })

  test('a file the proof’s command requires, changed by the patch: refused', async () => {
    const seen = await redAfter(
      (api) => written(api, { 'tests/register.cjs': 'process.exitCode = 1\n' }),
      {
        base: (api) => based(api, { 'tests/register.cjs': '' }),
        flags: '--require ./tests/register.cjs',
      },
    )
    expect(seen.state).toBe('waiting_red')
    expect(seen.delivered).toContain(
      'api/tests/register.cjs changed since the Building began (named by the proof’s command)',
    )
  })

  test.skipIf(process.platform === 'win32')(
    'a conftest.py the base links to another file, that file changed by the patch: refused',
    async () => {
      const seen = await redAfter((api) => written(api, { 'shared/hooks.py': HOOK }), {
        base: (api) =>
          based(
            api,
            { 'shared/hooks.py': 'import pytest\n' },
            { 'tests/conftest.py': '../shared/hooks.py' },
          ),
      })
      expect(seen.state).toBe('waiting_red')
      expect(seen.delivered).toContain(
        'api/shared/hooks.py changed since the Building began (through the link tests/conftest.py)',
      )
    },
  )

  test('a patch Hemera cannot read leaves the red judged as today: recorded', async () => {
    const seen = await redAfter((api) => written(api, { 'tests/conftest.py': HOOK }), {
      snapshots: (real) => ({
        ...real,
        listing: (_, repository) =>
          Effect.fail(
            new SnapshotFailed({ repository: repository.name, owner: 'listing', said: 'gone' }),
          ),
      }),
    })
    expect(seen.invalid).toEqual([])
    expect(seen.state).toBe('red_recorded')
  })

  test('once the Builder moves the change out, proof_run records the red', async () => {
    const seen = await redAfter((api) => written(api, { 'tests/conftest.py': HOOK }), {
      moveOut: 'tests/conftest.py',
    })
    expect(seen.state).toBe('waiting_red')
    expect(seen.after).toBe('red_recorded')
  })
})
