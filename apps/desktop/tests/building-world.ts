/**
 * The world of the pre-launch check and the launch (#139): Acme's real repositories in temporary
 * folders (`api` on the default base branch with a bare repository on the same disk as its remote,
 * `web` without a remote), a mission planned whole by a Planner the test drives through its grant,
 * frozen, and the engine with the fake agent of #32 as every agent: the cold read first, then the
 * agents of the checks in the order they start.
 */

import { writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { DEFAULT_BASE_BRANCH, SPEC_SECTIONS } from '@hemera/core/domain'
import { BuildingRefused, type CommandDraft, type Mission } from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Layer, Result, type Schema } from 'effect'

import { HemeraEndpoint } from '../src/engine/agents/endpoint.ts'
import type { FakeScript, FakeStep } from '../src/engine/agents/fake.ts'
import { latestCheckOf } from '../src/engine/building/check.ts'
import { BuildingStart } from '../src/engine/building/launch.ts'
import { createMission, getMission } from '../src/engine/missions.ts'
import { listColdReads } from '../src/engine/planning/cold-read-store.ts'
import { freezeMission } from '../src/engine/planning/freeze.ts'
import { markDelivered } from '../src/engine/planning/inputs.ts'
import { readSpec } from '../src/engine/planning/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import { domainEvents, sessionDeliveries } from '../src/engine/storage/schema.ts'
import { createProject } from '../src/engine/projects.ts'
import { openSession } from '../src/engine/sessions/store.ts'
import { ToolAccess } from '../src/engine/tools/access.ts'
import { git, remote, repository } from './repositories.ts'
import { BUILDER, HELPER, sessionsEngine, until } from './sessions-world.ts'
import { callTool } from './tools-world.ts'

export const uses = (id: string, tool: string, args: Schema.JsonObject): FakeStep => ({
  does: 'uses',
  id,
  tool,
  arguments: args,
})

export const says = (words: string): FakeStep => ({ does: 'says', text: words })

/** A cold read that reads the Spec and finds nothing. */
export const READING: FakeScript = {
  turns: [
    [
      uses('toolu_read', 'spec_read', {}),
      uses('toolu_report', 'cold_read_report', { findings: [] }),
    ],
  ],
  steps: [says('Done.')],
}

/** An agent that answers every prompt and does nothing else. */
export const QUIET: FakeScript = { steps: [says('Read.')] }

/** One file of a report: whether it matters, and why. */
export const answered = (path: string, matters = false, inRepository = 'api') => ({
  repository: inRepository,
  path,
  matters,
  why: matters ? 'The export reads it.' : 'Unrelated to the export.',
})

/** The agent of a check: its report, each list in its own call, the first first. */
export const reporting = (
  ...reports: ReadonlyArray<ReadonlyArray<Schema.JsonObject>>
): FakeScript => ({
  turns: [
    [
      ...reports.map((items, at) =>
        uses(`toolu_report_${String(at)}`, 'prelaunch_report', {
          summary: 'I read the files of my brief.',
          items: [...items],
        }),
      ),
      says('Reported.'),
    ],
  ],
  steps: [says('Done.')],
})

/** What `BuildingStart` was called with, in order. */
export const startsSeen = () => {
  const missions: string[] = []
  const layer = Layer.succeed(BuildingStart, {
    start: (missionId: string) =>
      Effect.sync(() => {
        missions.push(missionId)
      }),
  })
  return { missions, layer }
}

/**
 * The engine over `data`, its agents scripted in their start order (the cold read first unless
 * said), `BuildingStart` counting its calls.
 */
export const buildingEngine = (
  data: string,
  work: string,
  scriptOf: (index: number) => FakeScript,
  starts = startsSeen(),
  options: Parameters<typeof sessionsEngine>[2] = {},
) => {
  const engine = sessionsEngine(data, scriptOf, {
    roles: [BUILDER, HELPER],
    ...options,
    building: { start: starts.layer },
    tools: { home: work, ...options.tools },
  })
  return { ...engine, starts }
}

export const INVOICES = 'export const invoices = []\n'
export const PACKAGE = '{ "name": "api", "dependencies": {} }\n'

/**
 * Acme: its main checkout holding `api` on the default base branch, with `invoices.ts`,
 * `package.json` and a bare repository as its remote, and `web`, without a remote.
 */
export const acmeAt = (work: string, name = 'acme') =>
  Effect.gen(function* () {
    const main = join(work, name)
    const api = repository(join(main, 'api'), DEFAULT_BASE_BRANCH)
    writeFileSync(join(api, 'invoices.ts'), INVOICES)
    writeFileSync(join(api, 'package.json'), PACKAGE)
    writeFileSync(join(api, 'README.md'), 'Acme api\n')
    git(api, 'add', '.')
    git(api, 'commit', '-q', '-m', 'invoices')
    const bare = remote(api, join(work, 'remotes', `${basename(main)}-api.git`))
    const web = repository(join(main, 'web'), DEFAULT_BASE_BRANCH)
    const project = yield* createProject({
      name: basename(main),
      mainCheckout: main,
      repositories: ['api', 'web'],
    })
    return { project, main, api, web, bare }
  })

let clones = 0

/** A commit someone else pushed on the remote's base branch: `change` runs in their clone. */
export const pushedOnRemote = (work: string, bare: string, change: (clone: string) => void) => {
  clones += 1
  const clone = join(work, `theirs-${String(clones)}`)
  git(work, 'clone', '-q', '-b', DEFAULT_BASE_BRANCH, bare, clone)
  change(clone)
  git(clone, 'add', '-A')
  git(clone, 'commit', '-q', '-m', 'theirs')
  git(clone, 'push', '-q', 'origin', DEFAULT_BASE_BRANCH)
  return git(clone, 'rev-parse', 'HEAD')
}

/** The grant of a session, its token minted. */
const grantOf = (sessionId: string) =>
  Effect.gen(function* () {
    const token = yield* HemeraEndpoint.use((endpoint) => endpoint.mint(sessionId))
    const grant = yield* ToolAccess.use((access) => access.byToken(token))
    if (grant === null) return yield* Effect.die(new Error('the token named no grant'))
    return grant.id
  })

/** A mission of a Project in Planning, and the grant of a Planner the test drives. */
export const plannedIn = (
  projectId: string,
  main: string,
  sentence = 'Export the invoices as CSV',
) =>
  Effect.gen(function* () {
    const mission = yield* createMission({ projectId, idea: { sentence, ticket: null } })
    const session = yield* openSession({
      provider: 'claude',
      owner: { kind: 'mission', missionId: mission.id },
      role: 'planner',
      folder: main,
      parent: null,
      chosen: { model: null, effort: null, mode: null },
      modelLevel: null,
    })
    return { mission, grantId: yield* grantOf(session.id) }
  })

export const call = (grantId: string, tool: string, args: Schema.JsonObject) =>
  Effect.map(callTool(grantId, tool, args), (answer) => answer.text)

/** What a Spec is written with beyond the default. */
export interface SpecAsked {
  /** What runs the proof's test: a command line by default, or a catalogue command's id. */
  readonly command?: string
  /** The living requirement the Spec's requirement modifies, at the version read. */
  readonly living?: { readonly ref: string; readonly version: number; readonly domain: string }
}

/**
 * The Planner writes a whole Spec that passes Hemera's check (#85, #90): one requirement whose
 * scenario has an automated proof adding `api/tests/invoices.test.ts`, one task changing
 * `api/invoices.ts`, and a recommendation for Building.
 */
export const writeComplete = (grantId: string, asked: SpecAsked = {}) =>
  Effect.gen(function* () {
    for (const section of SPEC_SECTIONS) {
      yield* call(grantId, 'spec_write_section', {
        section,
        content: `The ${section}.`,
        base_version: 0,
      })
    }
    yield* call(grantId, 'requirement_write', {
      domain: asked.living?.domain ?? 'invoices',
      text: 'Invoices export as CSV.',
      scenarios: [{ when: 'the user exports the invoices', then: 'a CSV file is saved' }],
      ...(asked.living === undefined
        ? { delta: 'added' }
        : {
            delta: 'modified',
            living_ref: asked.living.ref,
            living_version: asked.living.version,
          }),
    })
    yield* call(grantId, 'mission_describe', { title: 'Invoices as CSV', type: 'feature' })
    yield* call(grantId, 'proof_write', {
      scenario: 'R1.S1',
      proof: {
        mode: 'automated',
        actions: ['Export the invoices', 'Read the file saved'],
        starting_data: 'None.',
        expected: 'A CSV file is saved.',
        test: {
          repository: 'api',
          path: 'tests/invoices.test.ts',
          code: 'test("exports", () => expect(exportCsv()).toBeTruthy())\n',
          insertion: 'new_file',
          command: asked.command ?? 'node --test tests/invoices.test.ts',
        },
        seen_today: false,
      },
      base_version: 0,
    })
    yield* call(grantId, 'tasks_write', {
      tasks: [
        {
          title: 'Export as CSV',
          result: 'The invoices export as CSV.',
          requirements: ['R1'],
          scenarios: ['R1.S1'],
          targets: [{ repository: 'api', path: 'invoices.ts', intent: 'change' }],
          depends_on: [],
        },
      ],
      base_version: 0,
    })
    yield* call(grantId, 'model_recommend', {
      agent: 'codex',
      model: 'gpt-large',
      reason: 'A small change.',
    })
  })

/** Waits until the mission's cold read numbered so is done. */
export const readCold = (missionId: string, number: number) =>
  until(
    Effect.map(listColdReads(missionId), (passes) =>
      passes.some((one) => one.number === number && one.state === 'done'),
    ),
  )

/**
 * The Planner's next turn takes what was handed to it: the test's Planner has no agent, so its
 * deliveries are marked taken here, then its inputs delivered as a turn's start does (#86).
 */
export const plannerTook = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    yield* database
      .update(sessionDeliveries)
      .set({ state: 'sent', sentAt: new Date().toISOString() })
      .where(
        and(
          eq(sessionDeliveries.ownerId, missionId),
          eq(sessionDeliveries.targetRole, 'planner'),
          eq(sessionDeliveries.state, 'queued'),
        ),
      )
    yield* markDelivered(missionId)
  })

/** A planned mission written whole, declared, read cold and frozen: Ready. */
export const settledAndFrozen = (
  missionId: string,
  grantId: string,
  asked: SpecAsked = {},
  pass = 1,
) =>
  Effect.gen(function* () {
    yield* writeComplete(grantId, asked)
    yield* call(grantId, 'declare_complete', { why: 'A Builder can build it.' })
    yield* readCold(missionId, pass)
    const version = (yield* readSpec(missionId)).version
    return yield* freezeMission(missionId, version)
  })

/** A mission planned whole, declared, read cold and frozen: Ready. */
export const frozenIn = (
  projectId: string,
  main: string,
  asked: SpecAsked & { readonly sentence?: string; readonly pass?: number } = {},
) =>
  Effect.gen(function* () {
    const planned = yield* plannedIn(projectId, main, asked.sentence)
    yield* writeComplete(planned.grantId, asked)
    yield* call(planned.grantId, 'declare_complete', { why: 'A Builder can build it.' })
    yield* readCold(planned.mission.id, asked.pass ?? 1)
    const version = (yield* readSpec(planned.mission.id)).version
    const mission = yield* freezeMission(planned.mission.id, version)
    return { ...planned, mission, version }
  })

/** A command of the catalogue, a script run on every system unless said. */
export const commandDraft = (
  name: string,
  line: string,
  more: Partial<CommandDraft> = {},
): CommandDraft => ({
  name,
  type: 'script',
  line,
  lineWindows: null,
  lineLinux: null,
  repositoryId: null,
  folder: null,
  scope: 'workspace',
  portless: false,
  portlessName: null,
  check: true,
  atOpen: false,
  askBeforeRunning: false,
  readOnly: true,
  writeGlobs: [],
  ...more,
})

/** The cold reads first (one per Freeze), then the agents of the checks, each as given. */
export const agents =
  (...checks: ReadonlyArray<typeof QUIET>) =>
  (index: number) =>
    index === 0 ? READING : (checks[index - 1] ?? READING)

/** Waits until the mission's last check has ended (done or failed), and answers it. */
export const checked = (missionId: string) =>
  Effect.gen(function* () {
    yield* until(
      Effect.map(latestCheckOf(missionId), (view) => view !== null && view.state !== 'running'),
    )
    const view = yield* latestCheckOf(missionId)
    if (view === null) return yield* Effect.die(new Error('no check'))
    return view
  })

/** Waits until the mission is in this stage. */
export const inStage = (missionId: string, stage: Mission['stage']) =>
  until(Effect.map(getMission(missionId), (mission) => mission.stage === stage))

export const eventsOf = (missionId: string, type: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select({ payload: domainEvents.payload })
      .from(domainEvents)
      .where(and(eq(domainEvents.entityId, missionId), eq(domainEvents.type, type)))
      .orderBy(asc(domainEvents.sequence))
  })

export const refusedWith = (outcome: Result.Result<unknown, unknown>) =>
  Result.isFailure(outcome) && outcome.failure instanceof BuildingRefused
    ? outcome.failure.reasons
    : null

/** A mission's marks, as their sentences. */
export const marksOf = (mission: Mission) => mission.marks.map((one) => one.sentence)
