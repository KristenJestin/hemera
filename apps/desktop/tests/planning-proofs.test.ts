/**
 * The proofs and the tasks of Planning (#90), on the engine as it starts, with the fake agent of
 * #32 (never a real agent), a temporary data folder, and real Git repositories: the Project Acme's
 * `api`, with a bare repository on the same disk as its remote.
 *
 * Most calls are the Planner's, made through the gate with a Planner session's token as its agent
 * would; the Probe, the model the agent offers and the restart run the fake agent's scripts. Every
 * wait is on state (`until`, a held turn, an event row), never on time.
 *
 * Rewritten from `hemera-legacy` (`apps/desktop/tests/specs.test.ts`, "A cyclic dependency is
 * refused") against the task graph of requirements and scenarios, written whole by `tasks_write`.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_BASE_BRANCH, Proof, SPEC_SECTIONS } from '@hemera/core/domain'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Layer, Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript, FakeStep } from '../src/engine/agents/fake.ts'
import { HemeraEndpoint } from '../src/engine/agents/endpoint.ts'
import { missionFolder } from '../src/engine/memory/files.ts'
import { createMission, getMission, moveMission } from '../src/engine/missions.ts'
import { Judge } from '../src/engine/permissions/ports.ts'
import { taskGraphOf } from '../src/engine/planning/plan.ts'
import { PLANNER_TEMPLATE } from '../src/engine/planning/role.ts'
import { probeRowsOf, readProbe } from '../src/engine/planning/probe-store.ts'
import { SPEC_FILE, readSpec } from '../src/engine/planning/store.ts'
import { createProject, getProject } from '../src/engine/projects.ts'
import { saveRecipe } from '../src/engine/recipe.ts'
import { Secrets } from '../src/engine/secrets.ts'
import { openSession } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  domainEvents,
  memoryJournal,
  probeContents,
  specProofs,
} from '../src/engine/storage/schema.ts'
import { ToolAccess } from '../src/engine/tools/access.ts'
import { PermissionRequests } from '../src/engine/tools/ports.ts'
import { git, remote, repository } from './repositories.ts'
import { held, sessionsEngine, until, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { callTool } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('proofs'))
  work = realpathSync.native(temporaryFolder('proofs-work'))
})
afterEach(removeFolders)

const uses = (id: string, tool: string, args: Schema.JsonObject): FakeStep => ({
  does: 'uses',
  id,
  tool,
  arguments: args,
})

const says = (words: string): FakeStep => ({ does: 'says', text: words })

const QUIET: FakeScript = { steps: [says('Nothing to do.')] }

const allows = Layer.succeed(Judge, {
  judge: () => Effect.succeed({ verdict: 'allow', reason: 'risk 0.1' }),
})

const refusesAsking = Layer.succeed(PermissionRequests, {
  request: () => Effect.succeed({ answer: 'refused: nobody approves in this suite' }),
})

/** The engine, its agents scripted in their start order; the judge allows, nothing is approved. */
const engine = (
  scriptOf: (index: number) => FakeScript = () => QUIET,
  options: Parameters<typeof sessionsEngine>[2] = {},
) =>
  sessionsEngine(data, scriptOf, {
    ...options,
    tools: { home: work, judge: allows, permissionRequests: refusesAsking, ...options.tools },
  })

const IMPORTER = 'export const importName = (name: string) => name.normalize("NFD")\n'

/** A patch that adds a line to `importer.ts` as it is at the base. */
const ADDS_A_LINE = [
  'diff --git a/importer.ts b/importer.ts',
  '--- a/importer.ts',
  '+++ b/importer.ts',
  '@@ -1 +1,2 @@',
  ' export const importName = (name: string) => name.normalize("NFD")',
  '+export const keepsAccents = true',
  '',
].join('\n')

/** The same, written against an `importer.ts` that is not the base's. */
const DOES_NOT_FIT = ADDS_A_LINE.replace('name.normalize("NFD")', 'name.trim()')

/** A patch that creates `other.ts`, nothing of `importer.ts`. */
const CREATES_OTHER = [
  'diff --git a/other.ts b/other.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/other.ts',
  '@@ -0,0 +1 @@',
  '+export const other = true',
  '',
].join('\n')

/** A patch that deletes `importer.ts` as it is at the base. */
const DELETES_IMPORTER = [
  'diff --git a/importer.ts b/importer.ts',
  'deleted file mode 100644',
  '--- a/importer.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-export const importName = (name: string) => name.normalize("NFD")',
  '',
].join('\n')

/**
 * Acme: its main checkout holding `api` on the default base branch, with its importer, a `.env`
 * that is not committed, and a bare repository as its remote. The recipe copies the `.env`.
 */
const acme = Effect.suspend(() =>
  Effect.gen(function* () {
    const main = join(work, 'acme')
    const api = repository(join(main, 'api'), DEFAULT_BASE_BRANCH)
    writeFileSync(join(api, 'importer.ts'), IMPORTER)
    git(api, 'add', '.')
    git(api, 'commit', '-q', '-m', 'importer')
    const bare = remote(api, join(work, 'remotes', 'api.git'))
    writeFileSync(join(api, '.env'), 'DATABASE_PASSWORD=hunter2-acme\n')
    const created = yield* createProject({
      name: 'Acme',
      mainCheckout: main,
      repositories: ['api'],
    })
    const apiId = created.repositories[0]?.id ?? null
    yield* saveRecipe({
      projectId: created.id,
      version: created.version,
      steps: [{ kind: 'copy', repositoryId: apiId, path: '.env', commandId: null, line: null }],
    })
    const project = yield* getProject(created.id)
    return { project, main, api, bare, base: git(api, 'rev-parse', 'HEAD') }
  }),
)

/** A commit on the remote's base branch by someone else: `exporter.ts` added, the importer changed. */
const baseMoves = (bare: string) => {
  const clone = join(work, 'theirs')
  git(work, 'clone', '-q', '-b', DEFAULT_BASE_BRANCH, bare, clone)
  writeFileSync(join(clone, 'importer.ts'), 'export const importName = (name: string) => name\n')
  writeFileSync(join(clone, 'exporter.ts'), 'export const exportName = () => null\n')
  git(clone, 'add', '.')
  git(clone, 'commit', '-q', '-m', 'theirs')
  git(clone, 'push', '-q', 'origin', DEFAULT_BASE_BRANCH)
  return git(clone, 'rev-parse', 'HEAD')
}

/** A Planner session of a mission, its token minted: what its agent would be handed. */
const plannerGrant = (missionId: string, main: string) =>
  Effect.gen(function* () {
    const session = yield* openSession({
      provider: 'claude',
      owner: { kind: 'mission', missionId },
      role: 'planner',
      folder: main,
      parent: null,
      chosen: { model: null, effort: null, mode: null },
      modelLevel: null,
    })
    const token = yield* HemeraEndpoint.use((endpoint) => endpoint.mint(session.id))
    const grant = yield* ToolAccess.use((access) => access.byToken(token))
    if (grant === null) return yield* Effect.die(new Error('the token named no grant'))
    return grant.id
  })

/** A mission of Acme in Planning, its Planner's grant, and R1 with the scenarios asked. */
const planned = (projectId: string, main: string, scenarios = 1) =>
  Effect.gen(function* () {
    const mission = yield* createMission({
      projectId,
      idea: { sentence: 'Import names as written', ticket: null },
    })
    const grantId = yield* plannerGrant(mission.id, main)
    const written = yield* callTool(grantId, 'requirement_write', {
      domain: 'imports',
      delta: 'added',
      text: 'Names import as written.',
      scenarios: Array.from({ length: scenarios }, (_, at) => ({
        when: `the user imports names-${String(at + 1)}.csv`,
        then: 'every name keeps its accents',
      })),
    })
    expect(written.ok).toBe(true)
    return { mission, grantId }
  })

const BY_HAND: Proof = {
  mode: 'by_hand',
  actions: ['Open the imported list', 'Read the name of the first row'],
  starting_data: 'names.csv with the name "Éloïse".',
  expected: 'The name reads "Éloïse".',
  seen_today: false,
}

/** An automated proof whose test is a new file, run by a command line. */
const automated = (asked: Partial<NonNullable<Proof['test']>> = {}): Proof => ({
  mode: 'automated',
  actions: ['Import tests/fixtures/names.csv', 'Read the imported name'],
  starting_data: 'tests/fixtures/names.csv holds the name "Éloïse".',
  expected: 'The imported name reads "Éloïse".',
  test: {
    repository: 'api',
    path: 'tests/import-accents.test.ts',
    code: 'test("keeps accents", () => expect(importName("Éloïse")).toBe("Éloïse"))\n',
    insertion: 'new_file',
    command: 'node --test tests/import-accents.test.ts',
    ...asked,
  },
  seen_today: false,
})

const SEEN: Proof = {
  ...automated(),
  seen_today: true,
  observed: 'not ok 1 - keeps accents\n  Expected "Éloïse", received "Eloise"',
  key_line: 'Expected "Éloïse", received "Eloise"',
  base_commit: [{ repository: 'api', commit: 'abc1234' }],
}

/** A proof as the tool takes it. */
const json = (proof: Proof): Schema.JsonObject => ({ ...proof })

const writeProof = (grantId: string, scenario: string, proof: Proof, base = 0) =>
  callTool(grantId, 'proof_write', { scenario, proof: json(proof), base_version: base })

const readPayload = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
)

/** A mission's events of one type, in order, their payloads read. */
const eventsOf = (missionId: string, type: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(domainEvents)
      .where(and(eq(domainEvents.entityId, missionId), eq(domainEvents.type, type)))
      .orderBy(asc(domainEvents.sequence))
    return rows.map((row) => ({ type: row.type, payload: readPayload(row.payload) }))
  })

const journalOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select({ text: memoryJournal.text })
      .from(memoryJournal)
      .where(eq(memoryJournal.missionId, missionId))
    return rows.map((row) => row.text)
  })

const journalHas = (missionId: string, start: string) =>
  until(Effect.map(journalOf(missionId), (lines) => lines.some((line) => line.startsWith(start))))

const readBlock = Schema.decodeUnknownSync(Schema.fromJsonString(Proof))

/** The proof as it is kept, its support files' contents within. */
const keptProof = (missionId: string, scenario: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(specProofs)
      .where(and(eq(specProofs.missionId, missionId), eq(specProofs.scenarioId, scenario)))
    return row === undefined ? null : { ...row, block: readBlock(row.block) }
  })

const scenarioOf = (missionId: string, id: string) =>
  Effect.map(readSpec(missionId), (spec) =>
    spec.requirements.flatMap((one) => one.scenarios).find((one) => one.id === id),
  )

describe('proof_write with a Probe', () => {
  test('copies its report, links it, and turns its captured files into support files', async () => {
    const TEST_CODE = 'import { importName } from "../importer.ts"\nassert(importName("Éloïse"))\n'
    const { run } = engine(
      () => ({
        turns: [
          [
            uses('toolu_test', 'fs_write', {
              repository: 'api',
              path: 'tests/import-accents.test.ts',
              content: TEST_CODE,
            }),
            uses('toolu_fixture', 'fs_write', {
              repository: 'api',
              path: 'tests/fixtures/names.csv',
              content: 'name\nÉloïse\n',
            }),
            uses('toolu_read', 'fs_read', { repository: 'api', path: 'importer.ts' }),
            uses('toolu_edit', 'fs_write', {
              repository: 'api',
              path: 'importer.ts',
              content: `${IMPORTER}export const probed = true\n`,
            }),
            uses('toolu_report', 'probe_report', {
              outcome: 'reproduced',
              answer: 'The importer drops the accents of a name.',
              actions: ['Write api/tests/import-accents.test.ts', 'Run it'],
              starting_data: 'tests/fixtures/names.csv',
              command: 'node --test tests/import-accents.test.ts',
              expected: 'The name reads "Éloïse".',
              observed: 'not ok 1\n  Expected "Éloïse", received "Eloise"',
              key_line: 'Expected "Éloïse", received "Eloise"',
              test: { repository: 'api', path: 'tests/import-accents.test.ts', code: TEST_CODE },
              base_commit: 'abc1234',
              neighbours: [],
              evidence: [],
            }),
          ],
        ],
        steps: [says('Done.')],
      }),
      {
        // The Probe changes the `.env` its preparation copied: the capture keeps it, withheld.
        starting: () =>
          Effect.sync(() => {
            const probes = join(data, 'probes')
            for (const key of existsSync(probes) ? readdirSync(probes) : []) {
              for (const number of readdirSync(join(probes, key))) {
                writeFileSync(
                  join(probes, key, number, 'api', '.env'),
                  'DATABASE_PASSWORD=probed\n',
                )
              }
            }
          }),
      },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main)
          yield* callTool(grantId, 'probe_launch', {
            question: 'does the importer keep accents?',
            brief: 'Look at api/importer.ts.',
          })
          yield* until(
            Effect.map(probeRowsOf(mission.id), (rows) => rows.some((row) => row.state === 'done')),
          )
          const [probe] = yield* probeRowsOf(mission.id)
          const answer = yield* callTool(grantId, 'proof_write', {
            scenario: 'R1.S1',
            probe: '#1',
            base_version: 0,
          })
          yield* journalHas(mission.id, 'The Planner wrote the proof of R1.S1')
          return {
            answer,
            probe: yield* readProbe(probe?.id ?? ''),
            scenario: yield* scenarioOf(mission.id, 'R1.S1'),
            kept: yield* keptProof(mission.id, 'R1.S1'),
            events: yield* eventsOf(mission.id, 'planning.proof_written'),
            journal: yield* journalOf(mission.id),
          }
        }),
      ),
    )
    const base = seen.probe.bases[0]?.commit ?? ''
    expect(seen.answer.ok).toBe(true)
    expect(seen.answer.text).toContain('R1.S1’s proof is at version 1, from Probe #1')
    expect(seen.answer.text).toContain('Left out: api/.env (content withheld: a sensitive place).')
    expect(seen.scenario?.proofVersion).toBe(1)
    expect(seen.scenario?.proof).toEqual({
      mode: 'automated',
      actions: ['Write api/tests/import-accents.test.ts', 'Run it'],
      starting_data: 'tests/fixtures/names.csv',
      expected: 'The name reads "Éloïse".',
      test: {
        repository: 'api',
        path: 'tests/import-accents.test.ts',
        code: TEST_CODE,
        insertion: 'new_file',
        command: 'node --test tests/import-accents.test.ts',
      },
      support_files: [
        {
          repository: 'api',
          path: 'importer.ts',
          insertion: 'addition',
          against: base,
          from_probe: '#1',
        },
        {
          repository: 'api',
          path: 'tests/fixtures/names.csv',
          insertion: 'new_file',
          from_probe: '#1',
        },
      ],
      seen_today: true,
      observed: 'not ok 1\n  Expected "Éloïse", received "Eloise"',
      key_line: 'Expected "Éloïse", received "Eloise"',
      base_commit: [{ repository: 'api', commit: base }],
      from_probe: '#1',
      evidence: [],
    })
    const files = seen.kept?.block.support_files ?? []
    expect(files.find((file) => file.path === 'tests/fixtures/names.csv')?.content).toBe(
      'name\nÉloïse\n',
    )
    expect(files.find((file) => file.path === 'importer.ts')?.patch).toContain(
      '+export const probed = true',
    )
    expect(seen.kept?.fromProbe).toBe('#1')
    expect(seen.events.map((one) => one.payload)).toEqual([
      expect.objectContaining({ scenario: 'R1.S1', fromProbe: '#1', version: 1 }),
    ])
    expect(seen.journal).toContain('The Planner wrote the proof of R1.S1, from Probe #1')
  })

  test('a deletion is said left out; a capture without its content, or a file given twice, is refused', async () => {
    const TEST_CODE = 'assert(importName("Éloïse") === "Éloïse")\n'
    const { run } = engine(
      () => ({
        turns: [
          [
            uses('toolu_test', 'fs_write', {
              repository: 'api',
              path: 'tests/import-accents.test.ts',
              content: TEST_CODE,
            }),
            uses('toolu_report', 'probe_report', {
              outcome: 'answered',
              answer: 'The importer can go.',
              actions: ['Remove api/importer.ts', 'Run the test'],
              starting_data: 'tests/fixtures/names.csv',
              command: 'node --test tests/import-accents.test.ts',
              expected: 'The name reads "Éloïse".',
              test: { repository: 'api', path: 'tests/import-accents.test.ts', code: TEST_CODE },
              base_commit: 'abc1234',
              neighbours: [],
              evidence: [],
            }),
          ],
        ],
        steps: [says('Done.')],
      }),
      {
        // The Probe removes the importer and leaves a fixture, before its turn.
        starting: () =>
          Effect.sync(() => {
            const probes = join(data, 'probes')
            for (const key of existsSync(probes) ? readdirSync(probes) : []) {
              for (const number of readdirSync(join(probes, key))) {
                const tree = join(probes, key, number, 'api')
                rmSync(join(tree, 'importer.ts'))
                mkdirSync(join(tree, 'tests', 'fixtures'), { recursive: true })
                writeFileSync(join(tree, 'tests', 'fixtures', 'names.csv'), 'name\nÉloïse\n')
              }
            }
          }),
      },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main, 3)
          yield* callTool(grantId, 'probe_launch', {
            question: 'can the importer go?',
            brief: 'Look at api/importer.ts.',
          })
          yield* until(
            Effect.map(probeRowsOf(mission.id), (rows) => rows.some((row) => row.state === 'done')),
          )
          const fromProbe = (scenario: string, more: Schema.JsonObject = {}) =>
            callTool(grantId, 'proof_write', { scenario, probe: '#1', base_version: 0, ...more })
          const twice = yield* fromProbe('R1.S1', {
            support_files: [
              {
                repository: 'api',
                path: 'tests/import-accents.test.ts',
                insertion: 'new_file',
                content: 'x\n',
              },
            ],
          })
          const written = yield* fromProbe('R1.S2')
          const database = yield* Database
          yield* database.delete(probeContents)
          const emptied = yield* fromProbe('R1.S3')
          return { twice, written, emptied }
        }),
      ),
    )
    expect(seen.twice.text).toBe(
      'refused: nothing was written:\n- `support_files[1]`: api/tests/import-accents.test.ts is the path of the test: a proof gives each file once.',
    )
    expect(seen.written.ok).toBe(true)
    expect(seen.written.text).toContain('Left out: api/importer.ts (deleted by the Probe).')
    expect(seen.emptied.text).toBe(
      'refused: Probe #1 kept no content of api/tests/fixtures/names.csv: write the proof whole with `proof` and `from_probe`.',
    )
  })

  test('a Probe that has not reported, or that does not exist, gives no proof', async () => {
    const hold = held()
    const { run } = engine(() => ({ steps: [says('Looking.')], between: () => hold.promise }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main)
          yield* callTool(grantId, 'probe_launch', {
            question: 'does the importer keep accents?',
            brief: 'Look at api/importer.ts.',
          })
          yield* until(
            Effect.map(probeRowsOf(mission.id), (rows) =>
              rows.some((row) => row.state === 'running'),
            ),
          )
          const running = yield* callTool(grantId, 'proof_write', {
            scenario: 'R1.S1',
            probe: '#1',
            base_version: 0,
          })
          const missing = yield* callTool(grantId, 'proof_write', {
            scenario: 'R1.S1',
            probe: '#7',
            base_version: 0,
          })
          hold.release()
          return { running, missing, scenario: yield* scenarioOf(mission.id, 'R1.S1') }
        }),
      ),
    )
    expect(seen.running.text).toBe(
      'refused: Probe #1 has not reported yet: write the proof once its report arrives.',
    )
    expect(seen.missing.text).toBe('refused: ACME-1 has no Probe #7.')
    expect(seen.scenario?.proof).toBeNull()
  })
})

describe('proof_write with a proof', () => {
  test('seen today without observed, or with a key line absent from observed, is refused; nothing is written', async () => {
    const { observed: _observed, ...withoutOutput } = SEEN
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main)
          const before = yield* readSpec(mission.id)
          const answers = [
            yield* writeProof(grantId, 'R1.S1', withoutOutput),
            yield* writeProof(grantId, 'R1.S1', { ...SEEN, key_line: 'received Eloise' }),
          ]
          return { before, answers, after: yield* readSpec(mission.id) }
        }),
      ),
    )
    expect(seen.answers.map((one) => one.text)).toEqual([
      'refused: nothing was written:\n- `observed` is required when `seen_today` is true: quote what a real run printed today, verbatim.',
      'refused: nothing was written:\n- `key_line` is not in a line of `observed`: copy one line exactly from there.',
    ])
    expect(seen.after.version).toBe(seen.before.version)
    expect(seen.after.requirements[0]?.scenarios[0]?.proof).toBeNull()
  })

  test('a new file on a path that exists at the base is refused; a patch that does not apply there is refused; one that applies is kept', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, base } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main)
          const exists = yield* writeProof(grantId, 'R1.S1', automated({ path: 'importer.ts' }))
          const misfit = yield* writeProof(
            grantId,
            'R1.S1',
            automated({
              path: 'importer.ts',
              insertion: 'addition',
              patch: DOES_NOT_FIT,
              against: base,
            }),
          )
          const fits = yield* writeProof(grantId, 'R1.S1', {
            ...automated(),
            support_files: [
              {
                repository: 'api',
                path: 'importer.ts',
                insertion: 'new_file',
                content: 'overwrites\n',
              },
            ],
          })
          const kept = yield* writeProof(
            grantId,
            'R1.S1',
            automated({
              path: 'importer.ts',
              insertion: 'addition',
              patch: ADDS_A_LINE,
              against: base,
            }),
          )
          return {
            base,
            answers: [exists, misfit, fits, kept],
            scenario: yield* scenarioOf(mission.id, 'R1.S1'),
          }
        }),
      ),
    )
    const [exists, misfit, overwrites, kept] = seen.answers
    const at = seen.base.slice(0, 12)
    expect(exists?.text).toBe(
      `refused: nothing was written:\n- \`test\`: api/importer.ts already exists at the base commit ${at}: add to it with a patch (\`addition\`), never overwrite it.`,
    )
    expect(misfit?.text).toMatch(
      new RegExp(
        `^refused: nothing was written:\\n- \`test\`: the patch does not apply to api/importer.ts at the base commit ${at}: .*patch does not apply`,
        's',
      ),
    )
    expect(overwrites?.text).toBe(
      `refused: nothing was written:\n- \`support_files[0]\`: api/importer.ts already exists at the base commit ${at}: add to it with a patch (\`addition\`), never overwrite it.`,
    )
    expect(kept?.ok).toBe(true)
    expect(seen.scenario?.proof?.test).toMatchObject({ insertion: 'addition', against: seen.base })
  })

  test('an addition whose patch touches another file than its own, or deletes it, is refused', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, base } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main, 2)
          const addition = (scenario: string, patch: string) =>
            writeProof(
              grantId,
              scenario,
              automated({ path: 'importer.ts', insertion: 'addition', patch, against: base }),
            )
          return {
            answers: [
              yield* addition('R1.S1', CREATES_OTHER),
              yield* addition('R1.S2', DELETES_IMPORTER),
            ],
            scenarios: [
              yield* scenarioOf(mission.id, 'R1.S1'),
              yield* scenarioOf(mission.id, 'R1.S2'),
            ],
          }
        }),
      ),
    )
    expect(seen.answers.map((one) => one.text)).toEqual([
      'refused: nothing was written:\n- `test`: the patch touches other.ts, not api/importer.ts: an addition changes its own file only.',
      'refused: nothing was written:\n- `test`: the patch deletes api/importer.ts: an addition adds to its file, never creates, deletes or renames one.',
    ])
    expect(seen.scenarios.map((one) => one?.proof ?? null)).toEqual([null, null])
  })

  test('a proof is checked as it is kept, masked: a patch a secret’s mask breaks is refused, and said so', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acme
          writeFileSync(join(api, 'config.ts'), 'export const token = "hunter2-acme-token"\n')
          git(api, 'add', 'config.ts')
          git(api, 'commit', '-q', '-m', 'config')
          git(api, 'push', '-q', 'origin', DEFAULT_BASE_BRANCH)
          const base = git(api, 'rev-parse', 'HEAD')
          ;(yield* Secrets).register('project-variables:acme', ['hunter2-acme-token'])
          const { mission, grantId } = yield* planned(project.id, main)
          const answer = yield* writeProof(
            grantId,
            'R1.S1',
            automated({
              path: 'config.ts',
              insertion: 'addition',
              patch: [
                'diff --git a/config.ts b/config.ts',
                '--- a/config.ts',
                '+++ b/config.ts',
                '@@ -1 +1,2 @@',
                ' export const token = "hunter2-acme-token"',
                '+export const region = "eu"',
                '',
              ].join('\n'),
              against: base,
            }),
          )
          return { answer, base, scenario: yield* scenarioOf(mission.id, 'R1.S1') }
        }),
      ),
    )
    expect(seen.answer.text).toMatch(
      new RegExp(
        `^refused: nothing was written:\\n- \`test\`: the patch does not apply to api/config.ts at the base commit ${seen.base.slice(0, 12)}: `,
      ),
    )
    expect(seen.answer.text).toContain(
      '- `test`: Hemera masked a secret in its patch before checking it: the check ran on the text it keeps.',
    )
    expect(seen.scenario?.proof).toBeNull()
  })

  test('a path out of the repository is refused as such; a patch Git cannot read is named beside the other problems', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, base } = yield* acme
          const { grantId } = yield* planned(project.id, main)
          const escapes = yield* writeProof(grantId, 'R1.S1', automated({ path: '../escape.ts' }))
          const unreadable = yield* writeProof(grantId, 'R1.S1', {
            ...automated({
              path: 'importer.ts',
              insertion: 'addition',
              patch: 'not a patch at all\n',
              against: base,
            }),
            support_files: [
              {
                repository: 'api',
                path: 'tests/helper.ts',
                insertion: 'addition',
                patch: ADDS_A_LINE,
                against: base,
              },
            ],
          })
          return { escapes, unreadable, base }
        }),
      ),
    )
    expect(seen.escapes.ok).toBe(false)
    expect(seen.escapes.text).not.toMatch(/the call failed/)
    expect(seen.escapes.text).toContain(
      '`proof.test.path` must be a path relative to the repository',
    )
    const at = seen.base.slice(0, 12)
    expect(seen.unreadable.text).toMatch(
      new RegExp(
        `^refused: nothing was written:\\n- \`test\`: Git could not read the patch of api/importer.ts: .+\\n- \`support_files\\[0\\]\`: api/tests/helper.ts does not exist at the base commit ${at}`,
      ),
    )
  })

  test('seen today on a commit its repository does not have is refused; observed is kept trimmed', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, base } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main)
          const nowhere = yield* writeProof(grantId, 'R1.S1', SEEN)
          const kept = yield* writeProof(grantId, 'R1.S1', {
            ...SEEN,
            observed: `\n\n${SEEN.observed ?? ''}\n\n`,
            base_commit: [{ repository: 'api', commit: base }],
          })
          return { nowhere, kept, scenario: yield* scenarioOf(mission.id, 'R1.S1') }
        }),
      ),
    )
    expect(seen.nowhere.text).toBe(
      'refused: nothing was written:\n- `base_commit[0]`: abc1234 is no commit of api.',
    )
    expect(seen.kept.ok).toBe(true)
    expect(seen.scenario?.proof?.observed).toBe(SEEN.observed)
  })

  test('a scenario that is not a live one of the Spec has no proof written', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          const { grantId } = yield* planned(project.id, main)
          return yield* writeProof(grantId, 'R9.S1', BY_HAND)
        }),
      ),
    )
    expect(seen.text).toBe(
      'refused: R9.S1 is not a live scenario of the Spec: name one as spec_read gives it.',
    )
  })

  test('two writes of one scenario’s proof on one version at once: one is written, the other is stale', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main)
          const answers = yield* Effect.all(
            [
              writeProof(grantId, 'R1.S1', BY_HAND),
              writeProof(grantId, 'R1.S1', { ...BY_HAND, expected: 'The name keeps its accents.' }),
            ],
            { concurrency: 'unbounded' },
          )
          return {
            answers,
            scenario: yield* scenarioOf(mission.id, 'R1.S1'),
            events: yield* eventsOf(mission.id, 'planning.proof_written'),
          }
        }),
      ),
    )
    expect(seen.answers.filter((one) => one.ok)).toHaveLength(1)
    expect(seen.answers.find((one) => !one.ok)?.text).toMatch(
      /^refused: the proof of R1\.S1 changed since version 0: it is at version 1\. Nothing was written\./,
    )
    expect(seen.scenario?.proofVersion).toBe(1)
    expect(seen.events).toHaveLength(1)
  })

  test('a write racing the mission’s cancel is written before it or refused after it, never on a cancelled mission', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main)
          const [answer] = yield* Effect.all(
            [writeProof(grantId, 'R1.S1', BY_HAND), moveMission(mission.id, 'cancel', 'user')],
            { concurrency: 'unbounded' },
          )
          const database = yield* Database
          const order = yield* database
            .select({ type: domainEvents.type })
            .from(domainEvents)
            .where(eq(domainEvents.entityId, mission.id))
            .orderBy(asc(domainEvents.sequence))
          return {
            answer,
            mission: yield* getMission(mission.id),
            kept: yield* keptProof(mission.id, 'R1.S1'),
            types: order.map((one) => one.type),
          }
        }),
      ),
    )
    expect(seen.mission.stage).toBe('cancelled')
    if (seen.answer.ok) {
      expect(seen.kept).not.toBeNull()
      expect(seen.types.indexOf('planning.proof_written')).toBeLessThan(
        seen.types.indexOf('mission.cancelled'),
      )
    } else {
      expect(seen.answer.text).toBe('refused: ACME-1 is Cancelled: nothing writes its Spec.')
      expect(seen.kept).toBeNull()
      expect(seen.types).not.toContain('planning.proof_written')
    }
  })
})

/** A task as the tool takes it. */
const task = (
  title: string,
  more: {
    readonly id?: string
    readonly scenarios?: ReadonlyArray<string>
    readonly targets?: ReadonlyArray<{ repository: string; path: string; intent: string }>
    readonly depends_on?: ReadonlyArray<string>
  } = {},
): Schema.JsonObject => {
  const asked = {
    title,
    result: `${title} is done.`,
    requirements: ['R1'],
    scenarios: [...(more.scenarios ?? ['R1.S1'])],
    targets: [...(more.targets ?? [{ repository: 'api', path: 'importer.ts', intent: 'change' }])],
    depends_on: [...(more.depends_on ?? [])],
  }
  return more.id === undefined ? asked : { id: more.id, ...asked }
}

/** A graph write on the version of the graph the Planner reads now, or on the one given. */
const writeTasks = (grantId: string, tasks: ReadonlyArray<Schema.JsonObject>, base?: number) =>
  Effect.gen(function* () {
    const grant = yield* ToolAccess.use((access) => access.byId(grantId))
    const version = base ?? (yield* readSpec(grant?.missionId ?? '')).tasksVersion
    return yield* callTool(grantId, 'tasks_write', { tasks: [...tasks], base_version: version })
  })

describe('tasks_write replaces the whole graph', () => {
  test('ids are given at write, kept, and never reused; the event says what changed', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main, 2)
          const first = yield* writeTasks(grantId, [
            task('Keep accents', { depends_on: ['Read the file'] }),
            task('Read the file', { scenarios: ['R1.S2'] }),
          ])
          const second = yield* writeTasks(grantId, [
            task('Read the file whole', { id: 'T2', scenarios: ['R1.S2'] }),
            task('Keep every accent', { depends_on: ['T2'] }),
          ])
          const reused = yield* writeTasks(grantId, [task('Back again', { id: 'T1' })])
          yield* journalHas(mission.id, 'The Planner wrote the task graph: 2 tasks (added T3')
          return {
            answers: [first, second, reused],
            graph: yield* taskGraphOf(mission.id),
            events: yield* eventsOf(mission.id, 'planning.tasks_written'),
            journal: yield* journalOf(mission.id),
            spec: yield* readSpec(mission.id),
          }
        }),
      ),
    )
    const [first, second, reused] = seen.answers
    expect(first?.text).toBe('Written: 2 tasks, T1 and T2 (added T1, T2).')
    expect(second?.text).toBe('Written: 2 tasks, T2 and T3 (added T3; changed T2; removed T1).')
    expect(reused?.text).toBe(
      'refused: nothing was written:\n- T1 is not a task of the graph: leave the id out for a new task; ids are never reused.',
    )
    expect(seen.graph).toEqual({
      tasks: [
        {
          id: 'T2',
          title: 'Read the file whole',
          result: 'Read the file whole is done.',
          requirements: ['R1'],
          scenarios: ['R1.S2'],
          targets: [{ repository: 'api', path: 'importer.ts', intent: 'change' }],
          dependsOn: [],
        },
        expect.objectContaining({ id: 'T3', title: 'Keep every accent', dependsOn: ['T2'] }),
      ],
      coverage: [
        { scenario: 'R1.S1', tasks: ['T3'] },
        { scenario: 'R1.S2', tasks: ['T2'] },
      ],
    })
    expect(seen.spec.tasks.map((one) => one.id)).toEqual(['T2', 'T3'])
    expect(seen.events.map((one) => one.payload)).toEqual([
      expect.objectContaining({ count: 2, added: ['T1', 'T2'], changed: [], removed: [] }),
      expect.objectContaining({ count: 2, added: ['T3'], changed: ['T2'], removed: ['T1'] }),
    ])
    expect(seen.journal).toContain(
      'The Planner wrote the task graph: 2 tasks (added T3; changed T2; removed T1)',
    )
  })

  test('T1 → T2 → T3 → T1 is refused naming the cycle by title; a dependency on T9 is refused; nothing is written', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main)
          yield* writeTasks(grantId, [
            task('Parse', { depends_on: ['Read'] }),
            task('Read', { depends_on: ['Store'] }),
            task('Store'),
          ])
          const before = yield* readSpec(mission.id)
          const cycle = yield* writeTasks(grantId, [
            task('Parse', { id: 'T1', depends_on: ['T2'] }),
            task('Read', { id: 'T2', depends_on: ['T3'] }),
            task('Store', { id: 'T3', depends_on: ['T1'] }),
          ])
          const dangling = yield* writeTasks(grantId, [task('Parse', { depends_on: ['T9'] })])
          return { cycle, dangling, before, after: yield* readSpec(mission.id) }
        }),
      ),
    )
    expect(seen.cycle.text).toBe(
      'refused: nothing was written:\n- The tasks depend on each other in a cycle: Parse → Read → Store → Parse.',
    )
    expect(seen.dangling.text).toBe(
      'refused: nothing was written:\n- T4 depends on T9, which is no task of the graph.',
    )
    expect(seen.after.version).toBe(seen.before.version)
    expect(seen.after.tasks).toEqual(seen.before.tasks)
  })

  test('a write on a version of the graph that is no longer the current one is refused; nothing is written', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main)
          const first = yield* writeTasks(grantId, [task('Parse')], 0)
          const before = yield* readSpec(mission.id)
          const stale = yield* writeTasks(grantId, [task('Read')], 0)
          const current = yield* writeTasks(grantId, [task('Parse', { id: 'T1' }), task('Read')], 1)
          return { first, before, stale, current, after: yield* readSpec(mission.id) }
        }),
      ),
    )
    expect(seen.first.ok).toBe(true)
    expect(seen.before.tasksVersion).toBe(1)
    expect(seen.stale.text).toMatch(
      /^refused: the task graph changed since version 0: it is at version 1\. Nothing was written\./,
    )
    expect(seen.current.ok).toBe(true)
    expect(seen.after.tasksVersion).toBe(2)
    expect(seen.after.tasks.map((one) => one.title)).toEqual(['Parse', 'Read'])
  })

  test('an id given twice, or a dependency on a title two new tasks share, is refused; nothing is written', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main)
          yield* writeTasks(grantId, [task('Parse'), task('Read')])
          const before = yield* readSpec(mission.id)
          const twice = yield* writeTasks(grantId, [
            task('Parse', { id: 'T1' }),
            task('Read', { id: 'T1' }),
          ])
          const ambiguous = yield* writeTasks(grantId, [
            task('Store'),
            task('Store'),
            task('Export', { depends_on: ['Store'] }),
          ])
          return { twice, ambiguous, before, after: yield* readSpec(mission.id) }
        }),
      ),
    )
    expect(seen.twice.text).toBe(
      'refused: nothing was written:\n- T1 is the id of more than one task: each task has its own.',
    )
    expect(seen.ambiguous.text).toBe(
      'refused: nothing was written:\n- T5 depends on "Store", the title of more than one new task: give each its own title, or name the task by its id.',
    )
    expect(seen.after.version).toBe(seen.before.version)
    expect(seen.after.tasks).toEqual(seen.before.tasks)
  })

  test('a change target missing at the base, a create target present there, and a repository the Project lacks are each refused', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, base } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main)
          const answer = yield* writeTasks(grantId, [
            task('Import', {
              targets: [
                { repository: 'api', path: 'missing.ts', intent: 'change' },
                { repository: 'api', path: 'importer.ts', intent: 'create' },
                { repository: 'web', path: 'page.ts', intent: 'create' },
              ],
            }),
          ])
          return { base, answer, spec: yield* readSpec(mission.id) }
        }),
      ),
    )
    const at = seen.base.slice(0, 12)
    expect(seen.answer.text).toBe(
      [
        'refused: nothing was written:',
        `- T1 changes api/missing.ts, which does not exist at the base commit ${at}.`,
        `- T1 creates api/importer.ts, which already exists at the base commit ${at}.`,
        '- T1 targets web/page.ts, but the Project has no repository web.',
      ].join('\n'),
    )
    expect(seen.spec.tasks).toEqual([])
  })

  test('two writes of the graph at once on one version: one is kept whole, the other is stale', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main)
          const answers = yield* Effect.all(
            [
              writeTasks(grantId, [task('First A'), task('First B')], 0),
              writeTasks(grantId, [task('Second A'), task('Second B')], 0),
            ],
            { concurrency: 'unbounded' },
          )
          return {
            answers,
            graph: yield* taskGraphOf(mission.id),
            events: yield* eventsOf(mission.id, 'planning.tasks_written'),
          }
        }),
      ),
    )
    expect(seen.answers.filter((one) => one.ok)).toHaveLength(1)
    expect(seen.answers.find((one) => !one.ok)?.text).toMatch(
      /^refused: the task graph changed since version 0: it is at version 1\./,
    )
    expect(seen.graph.tasks.map((one) => one.id)).toEqual(['T1', 'T2'])
    const titles = seen.graph.tasks.map((one) => one.title)
    expect([
      ['First A', 'First B'],
      ['Second A', 'Second B'],
    ]).toContainEqual(titles)
    expect(seen.events.map((one) => one.payload)).toEqual([
      expect.objectContaining({ added: ['T1', 'T2'] }),
    ])
  })
})

/** The agent's options as a select of the SDK. */
const select = (id: string, category: string, value: string, values: ReadonlyArray<string>) => ({
  type: 'select' as const,
  id,
  name: id,
  category,
  currentValue: value,
  options: values.map((one) => ({ value: one, name: one })),
})

const OFFERING: FakeScript = {
  configOptions: [
    select('model', 'model', 'large', ['large', 'medium']),
    select('effort', 'thought_level', 'low', ['low', 'high']),
  ],
  steps: [says('done')],
}

describe('model_recommend', () => {
  test('a model or an effort the agent does not offer is refused; one it offers is kept with its reason', async () => {
    const reason = 'One file and its test: a small change.'
    const { world, run } = engine(
      (index) =>
        index === 0
          ? {
              ...OFFERING,
              turns: [
                [
                  uses('toolu_small', 'model_recommend', {
                    agent: 'claude',
                    model: 'small',
                    reason,
                  }),
                  uses('toolu_max', 'model_recommend', {
                    agent: 'claude',
                    model: 'large',
                    effort: 'max',
                    reason,
                  }),
                  uses('toolu_kept', 'model_recommend', {
                    agent: 'claude',
                    model: 'large',
                    effort: 'high',
                    reason,
                  }),
                ],
              ],
            }
          : QUIET,
      { sessions: { plannerStarts: true } },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Import names as written', ticket: null },
          })
          // The third answer is the agent's own, after the write and its Journal line.
          yield* until(Effect.sync(() => (world.agents[0]?.answers.toolAnswers.length ?? 0) === 3))
          yield* journalHas(mission.id, 'The Planner recommends')
          return {
            spec: yield* readSpec(mission.id),
            events: yield* eventsOf(mission.id, 'planning.model_recommended'),
            journal: yield* journalOf(mission.id),
          }
        }),
      ),
    )
    expect(world.agents[0]?.answers.toolAnswers.map((one) => one.text)).toEqual([
      'refused: claude does not offer the model small: it offers large, medium.',
      'refused: claude does not offer the effort max with large: it offers low, high.',
      'Kept: Building is recommended to run on claude · large · effort high. The user sees it before Building starts and may change it.',
    ])
    expect(seen.spec.recommendation).toMatchObject({
      agent: 'claude',
      model: 'large',
      effort: 'high',
      reason: 'One file and its test: a small change.',
      checked: true,
    })
    expect(seen.events.map((one) => one.payload)).toEqual([
      expect.objectContaining({ agent: 'claude', model: 'large', effort: 'high' }),
    ])
    expect(seen.journal).toContain(
      'The Planner recommends claude · large · effort high for Building: One file and its test: a small change.',
    )
  })

  test('an agent that lists no model is kept unchecked, for the pre-launch check', async () => {
    const { world, run } = engine(
      (index) =>
        index === 0
          ? {
              configOptions: [select('effort', 'thought_level', 'low', ['low', 'high'])],
              turns: [
                [
                  uses('toolu_kept', 'model_recommend', {
                    agent: 'claude',
                    model: 'large',
                    reason: 'A small change.',
                  }),
                ],
              ],
              steps: [says('done')],
            }
          : QUIET,
      { sessions: { plannerStarts: true } },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Import names as written', ticket: null },
          })
          yield* until(Effect.sync(() => (world.agents[0]?.answers.toolAnswers.length ?? 0) === 1))
          return { spec: yield* readSpec(mission.id) }
        }),
      ),
    )
    expect(world.agents[0]?.answers.toolAnswers.map((one) => one.text)).toEqual([
      'Kept: Building is recommended to run on claude · large. claude lists no model here to check it against: the pre-launch check checks it. The user sees it before Building starts and may change it.',
    ])
    expect(seen.spec.recommendation).toMatchObject({ model: 'large', checked: false })
  })

  test('another agent than the Planner’s is kept unchecked, for the pre-launch check', async () => {
    const { run } = engine(() => OFFERING)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main)
          const answer = yield* callTool(grantId, 'model_recommend', {
            agent: 'codex',
            model: 'gpt-large',
            reason: 'A wide refactoring.',
          })
          return { answer, spec: yield* readSpec(mission.id) }
        }),
      ),
    )
    expect(seen.answer.text).toBe(
      'Kept: Building is recommended to run on codex · gpt-large. No codex session runs to list its models: the pre-launch check checks it. The user sees it before Building starts and may change it.',
    )
    expect(seen.spec.recommendation).toMatchObject({ agent: 'codex', checked: false })
  })
})

/** Every prose section written, and the mission named: what #85's completeness asks. */
const prose = (grantId: string) =>
  Effect.gen(function* () {
    for (const section of SPEC_SECTIONS) {
      yield* callTool(grantId, 'spec_write_section', {
        section,
        content: `The ${section}.`,
        base_version: 0,
      })
    }
    yield* callTool(grantId, 'mission_describe', { title: 'Import names as written', type: 'bug' })
  })

describe('Completeness, with the proofs, the tasks and the model', () => {
  test('refuses a scenario without a proof, one no task covers, a task covering nothing, no model; passes once complete', async () => {
    const { run } = engine(() => OFFERING)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main, 2)
          yield* prose(grantId)
          yield* writeProof(grantId, 'R1.S1', BY_HAND)
          yield* writeTasks(grantId, [task('Keep accents'), task('Tidy up', { scenarios: [] })])
          const refused = yield* callTool(grantId, 'declare_complete', { why: 'Done.' })
          yield* writeProof(grantId, 'R1.S2', BY_HAND)
          yield* writeTasks(grantId, [
            task('Keep accents', { id: 'T1', scenarios: ['R1.S1', 'R1.S2'] }),
          ])
          yield* callTool(grantId, 'model_recommend', {
            agent: 'codex',
            model: 'gpt-large',
            reason: 'Small.',
          })
          const declared = yield* callTool(grantId, 'declare_complete', { why: 'Done.' })
          return { refused, declared, spec: yield* readSpec(mission.id) }
        }),
      ),
    )
    expect(seen.refused.text.split('\n')).toEqual([
      'refused: the Spec is not complete, and nothing was recorded. Fix each of these, then declare again:',
      '- R1.S2: R1.S2 has no proof: write it with proof_write.',
      '- R1.S2: R1.S2 is covered by no task.',
      '- T2: T2 (Tidy up) covers no scenario.',
      '- model: No model is recommended for Building: give one with model_recommend.',
    ])
    expect(seen.declared.text).toBe(
      `Declared complete at version ${String(seen.spec.version)}. The user is told, with your reason.`,
    )
    expect(seen.spec.declaredCompleteVersion).toBe(seen.spec.version)
  })

  test('the base moves on the remote, and the next declaration checks targets and patches against the new base', async () => {
    const { run } = engine(() => OFFERING)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, bare, base } = yield* acme
          const { mission, grantId } = yield* planned(project.id, main)
          yield* prose(grantId)
          const proof = yield* writeProof(
            grantId,
            'R1.S1',
            automated({
              path: 'importer.ts',
              insertion: 'addition',
              patch: ADDS_A_LINE,
              against: base,
            }),
          )
          const tasks = yield* writeTasks(grantId, [
            task('Export', {
              targets: [{ repository: 'api', path: 'exporter.ts', intent: 'create' }],
            }),
          ])
          yield* callTool(grantId, 'model_recommend', {
            agent: 'codex',
            model: 'gpt-large',
            reason: 'Small.',
          })
          const moved = baseMoves(bare)
          const refused = yield* callTool(grantId, 'declare_complete', { why: 'Done.' })
          return { proof, tasks, moved, refused, spec: yield* readSpec(mission.id) }
        }),
      ),
    )
    expect(seen.proof.ok).toBe(true)
    expect(seen.tasks.ok).toBe(true)
    const at = seen.moved.slice(0, 12)
    const lines = seen.refused.text.split('\n')
    expect(lines[0]).toBe(
      'refused: the Spec is not complete, and nothing was recorded. Fix each of these, then declare again:',
    )
    expect(lines.slice(1)).toEqual([
      expect.stringMatching(
        new RegExp(
          `^- R1\\.S1: R1\\.S1’s proof: \`test\`: the patch does not apply to api/importer\\.ts at the base commit ${at}: `,
        ),
      ),
      `- T1: T1 creates api/exporter.ts, which already exists at the base commit ${at}.`,
    ])
    expect(seen.spec.declaredCompleteVersion).toBeNull()
  })
})

describe('A restart in the middle of a Planner’s turn', () => {
  test('keeps the proof it wrote once, at its version, and nothing is written twice', async () => {
    const hold = held()
    let steps = 0
    const first = engine(
      (index) =>
        index === 0
          ? {
              turns: [
                [
                  uses('toolu_r1', 'requirement_write', {
                    domain: 'imports',
                    delta: 'added',
                    text: 'Names import as written.',
                    scenarios: [{ when: 'the user imports names.csv', then: 'accents are kept' }],
                  }),
                  uses('toolu_proof', 'proof_write', {
                    scenario: 'R1.S1',
                    proof: json(BY_HAND),
                    base_version: 0,
                  }),
                  says('More to come.'),
                ],
              ],
              // The third step waits for ever: the engine is stopped in the middle of the turn.
              between: () => {
                steps += 1
                return steps <= 2 ? Promise.resolve() : hold.promise
              },
            }
          : QUIET,
      { sessions: { plannerStarts: true } },
    )
    const before = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Import names as written', ticket: null },
          })
          yield* until(Effect.map(keptProof(mission.id, 'R1.S1'), (row) => row !== null))
          yield* until(Effect.sync(() => steps >= 3))
          return { mission, spec: yield* readSpec(mission.id) }
        }),
      ),
    )
    const second = engine(() => QUIET, { sessions: { plannerStarts: true } })
    const after = await second.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* profile.gate
          const grantId = yield* plannerGrant(before.mission.id, join(work, 'acme'))
          const again = yield* writeProof(grantId, 'R1.S1', BY_HAND, 0)
          return {
            again,
            spec: yield* readSpec(before.mission.id),
            events: yield* eventsOf(before.mission.id, 'planning.proof_written'),
          }
        }),
      ),
    )
    hold.release()
    expect(before.spec.requirements[0]?.scenarios[0]?.proofVersion).toBe(1)
    expect(after.spec.version).toBe(before.spec.version)
    expect(after.spec.requirements[0]?.scenarios[0]).toMatchObject({
      proofVersion: 1,
      proof: expect.objectContaining({ mode: 'by_hand' }),
    })
    expect(after.events).toHaveLength(1)
    expect(after.again.text).toMatch(/^refused: the proof of R1\.S1 changed since version 0/)
    const file = readFileSync(join(missionFolder(data, 'ACME-1'), SPEC_FILE), 'utf8')
    expect(file).toContain('  - Proof: verified by hand')
  })
})

describe('A Planner turn that writes proofs, tasks and the model is one Journal line', () => {
  test('spec.drafted sums them up', async () => {
    const { run } = engine(
      (index) =>
        index === 0
          ? {
              ...OFFERING,
              turns: [
                [
                  uses('toolu_r1', 'requirement_write', {
                    domain: 'imports',
                    delta: 'added',
                    text: 'Names import as written.',
                    scenarios: [{ when: 'the user imports names.csv', then: 'accents are kept' }],
                  }),
                  uses('toolu_proof', 'proof_write', {
                    scenario: 'R1.S1',
                    proof: json(BY_HAND),
                    base_version: 0,
                  }),
                  uses('toolu_tasks', 'tasks_write', {
                    tasks: [task('Keep accents')],
                    base_version: 0,
                  }),
                  uses('toolu_model', 'model_recommend', {
                    agent: 'claude',
                    model: 'large',
                    reason: 'Small.',
                  }),
                ],
              ],
            }
          : QUIET,
      { sessions: { plannerStarts: true } },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Import names as written', ticket: null },
          })
          yield* journalHas(mission.id, 'Spec: ')
          return (yield* journalOf(mission.id)).filter((line) => line.startsWith('Spec: '))
        }),
      ),
    )
    expect(seen).toEqual([
      'Spec: Added R1; wrote the proof of R1.S1; wrote the tasks; recommended a model',
    ])
  })
})

describe('The Planner is told how to prove and how to cut the work', () => {
  test('its layer holds the paragraph "Proofs and tasks", naming the three tools', () => {
    expect(PLANNER_TEMPLATE).toContain('## Proofs and tasks')
    const paragraph = PLANNER_TEMPLATE.slice(PLANNER_TEMPLATE.indexOf('## Proofs and tasks'))
    expect(paragraph).toContain('"Run the tests" is\n  not a proof.')
    expect(paragraph).toContain("`proof_write` with the Probe's id")
    expect(paragraph).toContain('Write the\n  whole graph with `tasks_write`.')
    expect(paragraph).toContain('Recommend a model for Building with `model_recommend`')
    expect(PLANNER_TEMPLATE.indexOf('## Proofs and tasks')).toBeLessThan(
      PLANNER_TEMPLATE.indexOf('## Returns / when you stop'),
    )
  })
})
