/**
 * The cold read of Planning (#91), on the engine as it starts, with the fake agent of #32 as the
 * cold read (never a real agent), a temporary data folder, and a temporary Git repository as the
 * Project's main checkout. Most tests drive the Planner's tools from the test through a Planner
 * session's grant; the whole loop runs once with the Planner scripted as a fake agent too.
 *
 * Every wait is on state (`until`, a held step of a turn), never on time.
 */

import { realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { SPEC_SECTIONS, START_AGAIN, type SessionState, toolsOf } from '@hemera/core/domain'
import { and, asc, eq, sql } from 'drizzle-orm'
import { AgentNotInstalled } from '@hemera/ipc'
import { Effect, Fiber, Layer, Result, type Schema, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { ADAPTERS } from '../src/engine/agents/adapters/index.ts'
import { Discovery } from '../src/engine/agents/discovery.ts'
import { HemeraEndpoint } from '../src/engine/agents/endpoint.ts'
import type { FakeScript, FakeStep } from '../src/engine/agents/fake.ts'
import { projectLimits, setProjectLimits } from '../src/engine/budget.ts'
import { Memory } from '../src/engine/memory/index.ts'
import { listNeeds } from '../src/engine/needs.ts'
import { HumanIntent, humanIntentLayer } from '../src/engine/permissions/hemera-auto.ts'
import { createMission, moveMission } from '../src/engine/missions.ts'
import { answerQuestion } from '../src/engine/planning/calls.ts'
import { COLD_READ_ROLE } from '../src/engine/planning/cold-read-role.ts'
import { PLANNER_TEMPLATE } from '../src/engine/planning/role.ts'
import {
  againColdRead,
  coldReadChanges,
  coldReadFreshness,
  coldReadSettled,
  dismissFinding,
  listColdReads,
} from '../src/engine/planning/cold-read-store.ts'
import { closeDiscussion, openDiscussion } from '../src/engine/planning/discussions.ts'
import { markDelivered } from '../src/engine/planning/inputs.ts'
import { inputsOf } from '../src/engine/planning/questions.ts'
import { declareComplete, writeSection } from '../src/engine/planning/store.ts'
import { createProject } from '../src/engine/projects.ts'
import { setRoleSetting } from '../src/engine/sessions/cascade.ts'
import { ROLES_REGISTERED, memoryContractBroken } from '../src/engine/sessions/roles.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { openSession, sessionsIn } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  domainEvents,
  missionSpent,
  missions,
  planningInputs,
  questions,
  sessionDeliveries,
} from '../src/engine/storage/schema.ts'
import { ToolAccess } from '../src/engine/tools/access.ts'
import { git, repository } from './repositories.ts'
import {
  BUILDER,
  HELPER,
  SILENCE,
  everyAgentFound,
  held,
  sessionsEngine,
  text,
  until,
  within,
} from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { callTool } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('cold-read'))
  work = realpathSync.native(temporaryFolder('cold-read-work'))
})
afterEach(removeFolders)

const uses = (id: string, tool: string, args: Schema.JsonObject): FakeStep => ({
  does: 'uses',
  id,
  tool,
  arguments: args,
})

const says = (words: string): FakeStep => ({ does: 'says', text: words })

const report = (id: string, findings: ReadonlyArray<Schema.JsonObject>) =>
  uses(id, 'cold_read_report', { findings: [...findings] })

/** A blocking finding on a scenario, one on the tasks only, and a warning. */
const FINDINGS: ReadonlyArray<Schema.JsonObject> = [
  {
    severity: 'blocking',
    where: ['R1.S1'],
    text: 'The separator of the CSV is not said.',
    question: 'Which separator does the CSV use?',
  },
  { severity: 'blocking', where: ['T1'], text: 'T1 names no file it changes.' },
  { severity: 'warning', where: ['risks'], text: 'No risk is named.' },
]

/** A cold read that reads the Spec, then reports these findings. */
const reading = (findings: ReadonlyArray<Schema.JsonObject> = []): FakeScript => ({
  turns: [[uses('toolu_read', 'spec_read', {}), report('toolu_report', findings)]],
  steps: [says('Done.')],
})

/** The engine, its agents scripted in their start order; the Planner starts only when asked. */
const coldReading = (
  scriptOf: (index: number) => FakeScript,
  options: Parameters<typeof sessionsEngine>[2] = {},
) =>
  sessionsEngine(data, scriptOf, {
    roles: [BUILDER, HELPER],
    ...options,
    tools: { home: work, ...options.tools },
  })

/** Acme, its main checkout holding `api` with one committed file. */
const acme = Effect.suspend(() =>
  Effect.gen(function* () {
    const main = join(work, 'acme')
    const api = repository(join(main, 'api'))
    writeFileSync(join(api, 'invoices.ts'), 'export const invoices = []\n')
    git(api, 'add', '.')
    git(api, 'commit', '-q', '-m', 'invoices')
    const project = yield* createProject({
      name: 'Acme',
      mainCheckout: main,
      repositories: ['api'],
    })
    return { project, main }
  }),
)

/** The grant of a session, its token minted: the test calls its tools. */
const grantOf = (sessionId: string) =>
  Effect.gen(function* () {
    const token = yield* HemeraEndpoint.use((endpoint) => endpoint.mint(sessionId))
    const grant = yield* ToolAccess.use((access) => access.byToken(token))
    if (grant === null) return yield* Effect.die(new Error('the token named no grant'))
    return grant.id
  })

/** A Planner session of a mission, its token minted: the test calls its tools. */
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

/** A mission of Acme in Planning, and its Planner's grant. */
const planned = Effect.gen(function* () {
  const { project, main } = yield* acme
  const mission = yield* createMission({
    projectId: project.id,
    idea: { sentence: 'Export the invoices as CSV', ticket: null },
  })
  const grantId = yield* plannerGrant(mission.id, main)
  return { project, main, mission, grantId }
})

const call = (grantId: string, tool: string, args: Schema.JsonObject) =>
  Effect.map(callTool(grantId, tool, args), (answer) => answer.text)

/** The Planner writes a whole Spec that passes Hemera's check (#85, #90). */
const writeComplete = (grantId: string) =>
  Effect.gen(function* () {
    for (const section of SPEC_SECTIONS) {
      yield* call(grantId, 'spec_write_section', {
        section,
        content: `The ${section}.`,
        base_version: 0,
      })
    }
    yield* call(grantId, 'requirement_write', {
      domain: 'invoices',
      delta: 'added',
      text: 'Invoices export as CSV.',
      scenarios: [{ when: 'the user exports the invoices', then: 'a CSV file is saved' }],
    })
    yield* call(grantId, 'mission_describe', { title: 'Invoices as CSV', type: 'feature' })
    yield* call(grantId, 'proof_write', {
      scenario: 'R1.S1',
      proof: {
        mode: 'by_hand',
        actions: ['Export the invoices'],
        starting_data: 'None.',
        expected: 'A CSV file is saved.',
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
          targets: [],
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

const declare = (grantId: string) =>
  call(grantId, 'declare_complete', { why: 'A Builder can build it.' })

/** The version a declaration's answer names. */
const versionOf = (declared: string): number =>
  Number(/^Declared complete at version (\d+)\./.exec(declared)?.[1] ?? Number.NaN)

/** The mission's Planner, as the Spec's writer, for the store's own functions. */
const plannerWriter = (missionId: string) =>
  Effect.gen(function* () {
    const live = yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], {
      kind: 'mission',
      missionId,
    })
    const planner = live.find((one) => one.role === 'planner')
    if (planner === undefined) return yield* Effect.die(new Error('no Planner'))
    return { sessionId: planner.id, role: 'planner', missionId }
  })

/** The Planner rewrites a section on its current version. */
const rewrite = (grantId: string, section: string, content: string, base: number) =>
  call(grantId, 'spec_write_section', { section, content, base_version: base })

/** Waits until the mission's pass numbered so is in one of the states, and answers it. */
const passIn = (missionId: string, number: number, states: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    yield* until(
      Effect.map(listColdReads(missionId), (passes) =>
        passes.some((one) => one.number === number && states.includes(one.state)),
      ),
    )
    const found = (yield* listColdReads(missionId)).find((one) => one.number === number)
    if (found === undefined) return yield* Effect.die(new Error(`no pass ${String(number)}`))
    return found
  })

/** The deliveries of a kind the mission's Planner was handed, the first first. */
const plannerDeliveries = (missionId: string, kind: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select({ body: sessionDeliveries.body, state: sessionDeliveries.state })
      .from(sessionDeliveries)
      .where(
        and(
          eq(sessionDeliveries.ownerId, missionId),
          eq(sessionDeliveries.targetRole, 'planner'),
          eq(sessionDeliveries.kind, kind),
        ),
      )
      .orderBy(asc(sessionDeliveries.createdAt))
  })

const eventsOf = (missionId: string, type: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select({ payload: domainEvents.payload })
      .from(domainEvents)
      .where(and(eq(domainEvents.entityId, missionId), eq(domainEvents.type, type)))
      .orderBy(asc(domainEvents.sequence))
  })

const EVERY_STATE: ReadonlyArray<SessionState> = [
  'starting',
  'working',
  'idle',
  'stuck',
  'ended',
  'failed',
]
const LIVE: ReadonlyArray<SessionState> = ['starting', 'working', 'idle', 'stuck']

/** The cold read sessions of a mission in these states. */
const coldSessions = (missionId: string, states: ReadonlyArray<SessionState> = EVERY_STATE) =>
  Effect.map(sessionsIn(states, { kind: 'mission', missionId }), (rows) =>
    rows.filter((row) => row.role === 'cold-read'),
  )

const answersOf = (
  world: {
    readonly agents: ReadonlyArray<{
      readonly answers: { readonly toolAnswers: ReadonlyArray<{ readonly text: string }> }
    }>
  },
  at: number,
) => world.agents[at]?.answers.toolAnswers.map((one) => one.text) ?? []

/**
 * Ends the Planner session the test opened without an agent: the start's rebuild would take it
 * over with an agent of the next run's own.
 */
const plannerEnded = (missionId: string) =>
  Effect.gen(function* () {
    const rows = yield* sessionsIn(LIVE, { kind: 'mission', missionId })
    for (const row of rows.filter((one) => one.role === 'planner')) {
      yield* Sessions.use((sessions) => sessions.end(row.lineage, 'the test ends it'))
    }
  })

const BRIEF = (version: number) =>
  [
    '[hemera:brief]',
    `## Cold read of ACME-1 · Spec version ${String(version)}`,
    '',
    'Read the Spec with spec_read and the code of: api',
    'Report with cold_read_report.',
  ].join('\n')

describe('Hemera launches one pass per Planning cycle (CT-29)', () => {
  test('the first declaration of a cycle launches one pass; a second in the same cycle none; after a return to Planning the next declaration launches one', async () => {
    const { run } = coldReading(() => reading())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, main, grantId } = yield* planned
          yield* writeComplete(grantId)
          const first = yield* declare(grantId)
          const one = yield* passIn(mission.id, 1, ['done'])
          yield* rewrite(grantId, 'risks', 'A large export may be slow.', 1)
          const second = yield* declare(grantId)
          yield* moveMission(mission.id, 'freeze', 'user')
          yield* moveMission(mission.id, 'backToPlanning', 'user')
          const again = yield* plannerGrant(mission.id, main)
          yield* rewrite(again, 'risks', 'A large export may be slow; it is paged.', 2)
          const third = yield* declare(again)
          const two = yield* passIn(mission.id, 2, ['done'])
          return { first, second, third, one, two, passes: yield* listColdReads(mission.id) }
        }),
      ),
    )
    expect(seen.first).toMatch(/^Declared complete at version \d+\./)
    expect(seen.second).toMatch(/^Declared complete at version \d+\./)
    expect(seen.third).toMatch(/^Declared complete at version \d+\./)
    expect(seen.passes.map((one) => [one.label, one.cycle, one.requestedBy])).toEqual([
      ['C1', 1, 'hemera'],
      ['C2', 2, 'hemera'],
    ])
    expect(seen.two.specVersion).toBeGreaterThan(seen.one.specVersion)
  })

  test('a new Planning cycle that declares the Spec complete again without a change launches its pass', async () => {
    const { run } = coldReading(() => reading())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, main, grantId } = yield* planned
          yield* writeComplete(grantId)
          const first = yield* declare(grantId)
          yield* passIn(mission.id, 1, ['done'])
          yield* moveMission(mission.id, 'freeze', 'user')
          yield* moveMission(mission.id, 'backToPlanning', 'user')
          const again = yield* plannerGrant(mission.id, main)
          const second = yield* declare(again)
          yield* passIn(mission.id, 2, ['done'])
          return { first, second, passes: yield* listColdReads(mission.id) }
        }),
      ),
    )
    expect(seen.second).toBe(seen.first)
    expect(seen.passes.map((one) => [one.label, one.cycle, one.specVersion])).toEqual([
      ['C1', 1, versionOf(seen.first)],
      ['C2', 2, versionOf(seen.first)],
    ])
  })

  test('two declarations at once, and a declaration racing the user’s another pass, launch one pass', async () => {
    const { run } = coldReading(() => reading())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          yield* writeComplete(grantId)
          const outcomes = yield* Effect.all(
            [declare(grantId), declare(grantId), Effect.result(againColdRead(mission.id))],
            { concurrency: 'unbounded' },
          )
          yield* passIn(mission.id, 1, ['done'])
          // A declaration after it, in the same cycle: still none.
          yield* rewrite(grantId, 'risks', 'A large export may be slow.', 1)
          yield* declare(grantId)
          const asked = yield* againColdRead(mission.id)
          yield* passIn(mission.id, 2, ['done'])
          return { outcomes, asked, passes: yield* listColdReads(mission.id) }
        }),
      ),
    )
    expect(seen.passes.map((one) => [one.label, one.requestedBy])).toEqual([
      ['C1', 'hemera'],
      ['C2', 'user'],
    ])
    expect(seen.asked.label).toBe('C2')
  })

  test('the pass is recorded with the declaration: at once it is not settled, C1 is bound to the version declared, and a write right after changes nothing', async () => {
    const { run } = coldReading(() => reading())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          yield* writeComplete(grantId)
          const writer = yield* plannerWriter(mission.id)
          const declared = yield* declareComplete(writer, 'A Builder can build it.')
          const settled = yield* coldReadSettled(mission.id)
          const listed = yield* listColdReads(mission.id)
          yield* writeSection(writer, 'why', 'Invoices are exported by hand.', 1)
          const done = yield* passIn(mission.id, 1, ['done'])
          return { declared, settled, listed, done }
        }),
      ),
    )
    const version =
      'done' in seen.declared && 'declared' in seen.declared.done
        ? seen.declared.done.declared
        : null
    expect(version).not.toBeNull()
    expect(seen.settled.settled).toBe(false)
    expect(seen.settled.reasons).toHaveLength(1)
    expect(seen.settled.reasons[0]).toMatch(/^Cold read C1 (waits for a free slot|is running)\.$/)
    expect(seen.listed.map((one) => [one.label, one.specVersion])).toEqual([['C1', version]])
    expect(seen.done.specVersion).toBe(version)
  })

  test('a pass that cannot be recorded leaves the Spec not declared: declared again, C1 is recorded', async () => {
    const { run } = coldReading(() => reading())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          yield* writeComplete(grantId)
          const database = yield* Database
          yield* database.run(sql`CREATE TRIGGER refuse_cold_reads BEFORE INSERT ON cold_reads
            BEGIN SELECT RAISE(ABORT, 'the disk is full'); END`)
          const refused = yield* declare(grantId)
          const none = yield* listColdReads(mission.id)
          yield* database.run(sql`DROP TRIGGER refuse_cold_reads`)
          const declared = yield* declare(grantId)
          const done = yield* passIn(mission.id, 1, ['done'])
          return { refused, none, declared, done }
        }),
      ),
    )
    expect(seen.refused).toMatch(/^the call failed: /)
    expect(seen.none).toEqual([])
    expect(seen.declared).toMatch(/^Declared complete at version \d+\./)
    expect(seen.done.specVersion).toBe(versionOf(seen.declared))
  })

  test('a stop right after the declaration loses no pass: after the restart C1 runs, on the version declared', async () => {
    const hold = held()
    const first = coldReading(() => ({ steps: [says('Reading.')], between: () => hold.promise }))
    const before = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          yield* writeComplete(grantId)
          const declared = yield* declare(grantId)
          yield* plannerEnded(mission.id)
          return { mission, version: versionOf(declared) }
        }),
      ),
    )
    hold.release()
    const second = coldReading(() => reading())
    const after = await second.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* passIn(before.mission.id, 1, ['done'])
          return yield* listColdReads(before.mission.id)
        }),
      ),
    )
    expect(after.map((one) => [one.label, one.state, one.specVersion])).toEqual([
      ['C1', 'done', before.version],
    ])
  })
})

describe('The brief, the role and its tools (CT-06)', () => {
  test('the role registry says the cold read reads no Memory; it has no Memory, command or write tool', () => {
    expect(COLD_READ_ROLE.readsMemory).toBe(false)
    expect(COLD_READ_ROLE.writes).toBe(false)
    expect(COLD_READ_ROLE.countsInCap).toBe(true)
    expect(ROLES_REGISTERED).toContain(COLD_READ_ROLE)
    expect(memoryContractBroken([COLD_READ_ROLE])).toEqual([])
    // Beside the Tester's report tools (#45), which every role has.
    expect(
      toolsOf('cold-read')
        .filter((name) => !name.startsWith('hemera_'))
        .sort(),
    ).toEqual(['cold_read_report', 'fs_list', 'fs_read', 'search', 'spec_read'])
  })

  test('the brief is exactly its three lines; a replaced session gets the same brief, the restart sentence and no Journal', async () => {
    const hold = held()
    const { world, run } = coldReading((index) =>
      index === 0 ? { steps: [says('Reading.')], between: () => hold.promise } : reading(),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          yield* writeComplete(grantId)
          yield* declare(grantId)
          const pass = yield* passIn(mission.id, 1, ['running'])
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) > 0))
          const [session] = yield* coldSessions(mission.id, LIVE)
          if (session === undefined) return yield* Effect.die(new Error('no cold read session'))
          const next = yield* Sessions.use((sessions) =>
            sessions.replace(session.id, 'its agent stopped'),
          )
          yield* passIn(mission.id, 1, ['done'])
          return { pass, replaced: next !== null }
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => hold.release()))),
    )
    expect(seen.replaced).toBe(true)
    const brief = text(world.agents[0]?.answers.prompts[0] ?? [])
    expect(brief).toBe(BRIEF(seen.pass.specVersion))
    const again = text(world.agents[1]?.answers.prompts[0] ?? [])
    expect(again).toBe(`${BRIEF(seen.pass.specVersion)}\n\n[hemera:resume]\n${START_AGAIN}`)
    expect(again).not.toContain('## Now')
    expect(again).not.toContain('Journal')
  })
})

describe('The pass reads the version it was launched on', () => {
  test('spec_read in the pass returns that version while the Planner writes', async () => {
    const hold = held()
    let step = 0
    const { world, run } = coldReading(() => ({
      ...reading(),
      between: () => {
        step += 1
        return step === 1 ? hold.promise : Promise.resolve()
      },
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          yield* writeComplete(grantId)
          yield* declare(grantId)
          const pass = yield* passIn(mission.id, 1, ['running'])
          const written = yield* rewrite(grantId, 'why', 'Invoices are exported by hand today.', 1)
          hold.release()
          yield* passIn(mission.id, 1, ['done'])
          return { pass, written }
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => hold.release()))),
    )
    expect(seen.written).toMatch(/^Written: Why is at version 2/)
    const [read] = answersOf(world, 0)
    expect(read).toContain(
      `Cold read C1 reads the Spec of ACME-1 at version ${String(seen.pass.specVersion)}.`,
    )
    expect(read).toContain('The why.')
    expect(read).not.toContain('Invoices are exported by hand today.')
    expect(read).toContain('## Tasks')
  })
})

describe('The report', () => {
  test('is stored, bound to the version read, and delivered to the Planner; a blocker on the Spec without a question is refused', async () => {
    const { world, run } = coldReading(() => ({
      turns: [
        [
          report('toolu_bad', [{ severity: 'blocking', where: ['R1'], text: 'R1 is vague.' }]),
          report('toolu_good', FINDINGS),
        ],
      ],
      steps: [says('Done.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          yield* writeComplete(grantId)
          yield* declare(grantId)
          const pass = yield* passIn(mission.id, 1, ['done'])
          yield* until(
            Effect.map(plannerDeliveries(mission.id, 'cold-read'), (all) => all.length > 0),
          )
          yield* until(Effect.map(coldSessions(mission.id, LIVE), (live) => live.length === 0))
          return {
            pass,
            delivered: yield* plannerDeliveries(mission.id, 'cold-read'),
            ended: yield* eventsOf(mission.id, 'planning.cold_read_ended'),
            settled: yield* coldReadSettled(mission.id),
          }
        }),
      ),
    )
    expect(answersOf(world, 0)[0]).toBe(
      'refused: nothing was kept. Finding 1 is blocking on R1: write in `question` the question a developer would ask.',
    )
    expect(
      seen.pass.findings.map((one) => [one.id, one.severity, one.tasksOnly, one.fate]),
    ).toEqual([
      ['C1.F1', 'blocking', false, 'open'],
      ['C1.F2', 'blocking', true, 'open'],
      ['C1.F3', 'warning', false, 'open'],
    ])
    expect(seen.delivered).toHaveLength(1)
    expect(seen.delivered[0]?.body).toBe(
      [
        '[hemera:cold-read]',
        `Cold read C1 read version ${String(seen.pass.specVersion)} of the Spec: 2 blocking, 1 warning, 0 suggestions.`,
        '',
        '- C1.F1 · blocking · R1.S1: The separator of the CSV is not said.',
        '  Question: Which separator does the CSV use?',
        '  Ask it in your next wave (ask_wave with from_finding "C1.F1").',
        '- C1.F2 · blocking · T1 (the tasks only): T1 names no file it changes.',
        '  Fix the task graph yourself, then cold_read_fixed. Never ask it to the user.',
        '- C1.F3 · warning · risks: No risk is named.',
        '  Fix it if you agree, then cold_read_fixed; otherwise leave it: the user sees it in the report.',
      ]
        .slice(1)
        .join('\n'),
    )
    expect(seen.ended.map((one) => JSON.parse(one.payload))).toEqual([
      expect.objectContaining({ blocking: 2, warning: 1, suggestion: 0 }),
    ])
    expect(seen.settled).toEqual({
      settled: false,
      reasons: [
        'C1.F1 is blocking and not asked yet.',
        'C1.F2 is blocking on the tasks: the Planner has not fixed it, and you have not dismissed it.',
      ],
    })
  })

  test('an empty report wakes no Planner', async () => {
    const { run } = coldReading(() => ({
      turns: [[report('toolu_one', [])]],
      steps: [says('Done.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          yield* writeComplete(grantId)
          yield* declare(grantId)
          const pass = yield* passIn(mission.id, 1, ['done'])
          yield* until(Effect.map(coldSessions(mission.id, LIVE), (live) => live.length === 0))
          return { pass, delivered: yield* plannerDeliveries(mission.id, 'cold-read') }
        }),
      ),
    )
    expect(seen.pass.findings).toEqual([])
    expect(seen.delivered).toEqual([])
  })

  test('two reports at once keep one', async () => {
    const hold = held()
    const { run } = coldReading(() => ({ steps: [says('Reading.')], between: () => hold.promise }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          yield* writeComplete(grantId)
          yield* declare(grantId)
          yield* passIn(mission.id, 1, ['running'])
          yield* until(Effect.map(coldSessions(mission.id, LIVE), (live) => live.length > 0))
          const [session] = yield* coldSessions(mission.id, LIVE)
          if (session === undefined) return yield* Effect.die(new Error('no cold read session'))
          const cold = yield* grantOf(session.id)
          const answers = yield* Effect.all(
            [
              call(cold, 'cold_read_report', { findings: [] }),
              call(cold, 'cold_read_report', { findings: [...FINDINGS] }),
            ],
            { concurrency: 'unbounded' },
          )
          return { answers, pass: yield* passIn(mission.id, 1, ['done']) }
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => hold.release()))),
    )
    const kept = seen.answers.filter((one) => one.startsWith('Kept: cold read C1 ended'))
    expect(kept).toHaveLength(1)
    expect(
      seen.answers.filter((one) => one === 'refused: cold read C1 already ended (done)'),
    ).toHaveLength(1)
    const many = seen.answers[1]?.startsWith('Kept') === true ? FINDINGS.length : 0
    expect(seen.pass.findings).toHaveLength(many)
  })
})

/** A pass done with the three findings, and the Planner's grant. */
const reported = Effect.gen(function* () {
  const made = yield* planned
  yield* writeComplete(made.grantId)
  yield* declare(made.grantId)
  yield* passIn(made.mission.id, 1, ['done'])
  return made
})

const waveFrom = (finding: string) => ({
  questions: [
    {
      text: 'Which separator does the CSV use?',
      why: 'The export depends on it.',
      options: [
        { label: 'Comma', detail: 'Choosing Comma.' },
        { label: 'Semicolon', detail: 'Choosing Semicolon.' },
      ],
      recommended: 0,
      recommended_reason: 'The api repository already writes it so.',
      from_finding: finding,
    },
  ],
})

describe('What the Planner does with the findings', () => {
  test('a tasks-only blocker and a warning are never turned into a wave question; cold_read_fixed settles them; a blocker on the Spec is asked', async () => {
    const { run } = coldReading(() => reading(FINDINGS))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* reported
          const tasksOnly = yield* call(grantId, 'ask_wave', waveFrom('C1.F2'))
          const warning = yield* call(grantId, 'ask_wave', waveFrom('C1.F3'))
          const unknown = yield* call(grantId, 'ask_wave', waveFrom('C9.F1'))
          const mustAsk = yield* call(grantId, 'cold_read_fixed', {
            finding: 'C1.F1',
            what: 'R1.S1 names the separator.',
          })
          const fixed = yield* call(grantId, 'cold_read_fixed', {
            finding: 'C1.F2',
            what: 'T1 now targets api/invoices.ts.',
          })
          const fixedAgain = yield* call(grantId, 'cold_read_fixed', {
            finding: 'C1.F2',
            what: 'T1 now targets api/invoices.ts.',
          })
          const asked = yield* call(grantId, 'ask_wave', waveFrom('C1.F1'))
          const askedAgain = yield* call(grantId, 'ask_wave', waveFrom('C1.F1'))
          const database = yield* Database
          return {
            tasksOnly,
            warning,
            unknown,
            mustAsk,
            fixed,
            fixedAgain,
            asked,
            askedAgain,
            questions: yield* database
              .select({ id: questions.id, fromFinding: questions.fromFinding })
              .from(questions)
              .where(eq(questions.missionId, mission.id)),
            pass: (yield* listColdReads(mission.id))[0],
            settled: yield* coldReadSettled(mission.id),
            fixedEvents: yield* eventsOf(mission.id, 'planning.cold_read_fixed'),
          }
        }),
      ),
    )
    expect(seen.tasksOnly).toBe(
      'refused: C1.F2 concerns the tasks only: fix the task graph and call cold_read_fixed; it is never asked to the user.',
    )
    expect(seen.warning).toBe(
      'refused: C1.F3 is a warning: fix it and call cold_read_fixed, or leave it; only a blocking finding becomes a question.',
    )
    expect(seen.unknown).toBe('refused: this mission has no finding C9.F1.')
    expect(seen.mustAsk).toBe(
      'refused: C1.F1 is blocking on the Spec: ask it in your next wave with from_finding "C1.F1".',
    )
    expect(seen.fixed).toBe('C1.F2 is fixed (T1 now targets api/invoices.ts.).')
    expect(seen.fixedAgain).toBe(
      'C1.F2 is already fixed (T1 now targets api/invoices.ts.): nothing changed.',
    )
    expect(seen.asked).toMatch(/^Wave 1 asked: Q1\./)
    expect(seen.askedAgain).toBe('refused: C1.F1 is asked already, as Q1.')
    expect(seen.questions).toEqual([{ id: 'Q1', fromFinding: 'C1.F1' }])
    expect(
      seen.pass?.findings.map((one) => [one.id, one.fate, one.questionId, one.fixedWhat]),
    ).toEqual([
      ['C1.F1', 'asked', 'Q1', null],
      ['C1.F2', 'fixed', null, 'T1 now targets api/invoices.ts.'],
      ['C1.F3', 'open', null, null],
    ])
    expect(seen.settled).toEqual({
      settled: false,
      reasons: ['C1.F1 is asked as Q1, and not answered and integrated yet.'],
    })
    expect(seen.fixedEvents).toHaveLength(1)
  })

  test('dismissing an asked finding withdraws its question and registers a human input, once however often it is asked', async () => {
    const { run } = coldReading(() => reading(FINDINGS))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* reported
          yield* call(grantId, 'ask_wave', waveFrom('C1.F1'))
          yield* Effect.all(
            [
              dismissFinding(mission.id, 'C1.F1'),
              dismissFinding(mission.id, 'C1.F1'),
              dismissFinding(mission.id, 'C1.F2'),
            ],
            { concurrency: 'unbounded' },
          )
          const unknown = yield* Effect.result(dismissFinding(mission.id, 'C1.F9'))
          const database = yield* Database
          return {
            unknown,
            question: yield* database
              .select({ state: questions.state, reason: questions.retiredReason })
              .from(questions)
              .where(and(eq(questions.missionId, mission.id), eq(questions.id, 'Q1'))),
            inputs: yield* inputsOf(mission.id),
            delivered: yield* plannerDeliveries(mission.id, 'findings'),
            dismissed: yield* eventsOf(mission.id, 'planning.cold_read_dismissed'),
            pass: (yield* listColdReads(mission.id))[0],
            settled: yield* coldReadSettled(mission.id),
          }
        }),
      ),
    )
    expect(seen.question).toEqual([{ state: 'withdrawn', reason: 'finding dismissed by you' }])
    expect(seen.inputs.map((one) => [one.kind, one.item]).sort()).toEqual([
      ['dismissed_finding', 'C1.F1'],
      ['dismissed_finding', 'C1.F2'],
    ])
    expect(seen.delivered.at(-1)?.body).toContain('The user dismissed C1.F1.')
    expect(seen.delivered.at(-1)?.body).toContain('Its question Q1 is withdrawn.')
    expect(seen.dismissed).toHaveLength(2)
    expect(JSON.parse(seen.dismissed[0]?.payload ?? '{}')).toEqual(
      expect.objectContaining({ author: 'user' }),
    )
    expect(seen.pass?.findings.map((one) => one.fate)).toEqual(['dismissed', 'dismissed', 'open'])
    expect(seen.settled).toEqual({ settled: true, reasons: [] })
    expect(Result.isFailure(seen.unknown)).toBe(true)
  })
})

describe('What a dismissal tells the Planner', () => {
  test('only that the user dismissed it; the cold read’s words are quoted as its own, not to apply, and never read as the user’s intent', async () => {
    const { run } = coldReading(() => reading(FINDINGS))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission, grantId } = yield* reported
          yield* call(grantId, 'ask_wave', waveFrom('C1.F1'))
          yield* dismissFinding(mission.id, 'C1.F1')
          const writer = yield* plannerWriter(mission.id)
          const planner = {
            sessionId: writer.sessionId,
            role: 'planner' as const,
            projectId: project.id,
            missionId: mission.id,
            place: { kind: 'main-checkout' as const, readOnly: true, root: work },
          }
          return {
            delivered: yield* plannerDeliveries(mission.id, 'findings'),
            intent: yield* HumanIntent.use((human) => human.of(planner)).pipe(
              Effect.provide(humanIntentLayer),
            ),
          }
        }),
      ),
    )
    const body = seen.delivered.at(-1)?.body ?? ''
    expect(body).toContain(
      [
        'The user dismissed C1.F1. Its question Q1 is withdrawn.',
        'What the cold read said in C1.F1 (blocking · R1.S1), its words and not the user’s: “The separator of the CSV is not said.”',
        'Do not apply it: mark this input integrated with no change, unless something else requires one.',
      ].join(' '),
    )
    expect(body).not.toContain('integrate what it changes')
    expect(JSON.stringify(seen.intent.items)).not.toContain('separator')
  })
})

describe('A finding whose question was replaced', () => {
  const replacing = (replaces: string, fromFinding?: string) => {
    const asked = {
      text: 'Which separator, comma or semicolon, does the CSV use?',
      why: 'The export depends on it.',
      options: [
        { label: 'Comma', detail: 'Choosing Comma.' },
        { label: 'Semicolon', detail: 'Choosing Semicolon.' },
      ],
      recommended: 0,
      recommended_reason: 'The api repository already writes it so.',
      replaces,
    }
    return {
      questions: [fromFinding === undefined ? asked : { ...asked, from_finding: fromFinding }],
    }
  }

  test('dismissing the finding withdraws the question that replaced its question', async () => {
    const { run } = coldReading(() => reading(FINDINGS))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* reported
          yield* call(grantId, 'ask_wave', waveFrom('C1.F1'))
          const replaced = yield* call(grantId, 'ask_wave', replacing('Q1'))
          yield* dismissFinding(mission.id, 'C1.F1')
          const database = yield* Database
          return {
            replaced,
            questions: yield* database
              .select({ id: questions.id, state: questions.state, reason: questions.retiredReason })
              .from(questions)
              .where(eq(questions.missionId, mission.id))
              .orderBy(asc(questions.number)),
            delivered: yield* plannerDeliveries(mission.id, 'findings'),
          }
        }),
      ),
    )
    expect(seen.replaced).toMatch(/^Wave 2 asked: Q2 \(it replaces Q1\)\./)
    expect(seen.questions).toEqual([
      { id: 'Q1', state: 'replaced', reason: null },
      { id: 'Q2', state: 'withdrawn', reason: 'finding dismissed by you' },
    ])
    expect(seen.delivered.at(-1)?.body).toContain('Its question Q2 is withdrawn.')
  })

  test('the finding is asked again by replacing the question that replaced its question', async () => {
    const { run } = coldReading(() => reading(FINDINGS))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* reported
          yield* call(grantId, 'ask_wave', waveFrom('C1.F1'))
          yield* call(grantId, 'ask_wave', replacing('Q1'))
          const again = yield* call(grantId, 'ask_wave', replacing('Q2', 'C1.F1'))
          return { again, pass: (yield* listColdReads(mission.id))[0] }
        }),
      ),
    )
    expect(seen.again).toMatch(/^Wave 3 asked: Q3 \(it replaces Q2\)\./)
    expect(seen.pass?.findings[0]).toEqual(
      expect.objectContaining({ id: 'C1.F1', fate: 'asked', questionId: 'Q3' }),
    )
  })
})

describe('A finding whose question was retired', () => {
  test('a question made moot by a decision of Discuss settles its finding once the decision is integrated', async () => {
    const { run } = coldReading(() => reading(FINDINGS))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* reported
          yield* call(grantId, 'ask_wave', waveFrom('C1.F1'))
          yield* call(grantId, 'cold_read_fixed', { finding: 'C1.F2', what: 'T1 targets api.' })
          const opened = yield* openDiscussion(
            mission.id,
            { kind: 'question', id: 'Q1' },
            'Can we settle the separator here?',
          )
          yield* closeDiscussion(opened.id, { decision: 'The CSV uses a semicolon.' })
          const decision = (yield* inputsOf(mission.id)).find(
            (one) => one.kind === 'discuss_decision',
          )
          if (decision === undefined) return yield* Effect.die(new Error('no decision'))
          const moot = yield* call(grantId, 'question_retire', {
            question: 'Q1',
            how: 'moot',
            reason: 'Discussion #1 decided it.',
            decision: '#1: the CSV uses a semicolon',
          })
          const before = yield* coldReadSettled(mission.id)
          // The Planner's next turn takes the decision.
          const database = yield* Database
          const [carried] = yield* database
            .select({ deliveryId: planningInputs.deliveryId })
            .from(planningInputs)
            .where(
              and(eq(planningInputs.missionId, mission.id), eq(planningInputs.id, decision.id)),
            )
          yield* database
            .update(sessionDeliveries)
            .set({ state: 'sent', sentAt: new Date().toISOString() })
            .where(eq(sessionDeliveries.id, carried?.deliveryId ?? ''))
          yield* markDelivered(mission.id)
          const integrated = yield* call(grantId, 'input_integrated', {
            id: decision.id,
            where: 'decisions',
          })
          return { moot, before, integrated, after: yield* coldReadSettled(mission.id) }
        }),
      ),
    )
    expect(seen.moot).toBe('Q1 is moot. It stays readable with your reason.')
    expect(seen.before).toEqual({
      settled: false,
      reasons: ['C1.F1 is asked as Q1, and not answered and integrated yet.'],
    })
    expect(seen.integrated).toMatch(/integrated/)
    expect(seen.after).toEqual({ settled: true, reasons: [] })
  })

  test('a question the Planner withdraws puts its finding back to open, to ask again', async () => {
    const { run } = coldReading(() => reading(FINDINGS))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* reported
          yield* call(grantId, 'ask_wave', waveFrom('C1.F1'))
          yield* call(grantId, 'question_retire', {
            question: 'Q1',
            how: 'withdrawn',
            reason: 'It was badly put.',
          })
          const pass = (yield* listColdReads(mission.id))[0]
          const settled = yield* coldReadSettled(mission.id)
          const again = yield* call(grantId, 'ask_wave', waveFrom('C1.F1'))
          return { pass, settled, again }
        }),
      ),
    )
    expect(seen.pass?.findings[0]).toEqual(
      expect.objectContaining({ id: 'C1.F1', fate: 'open', questionId: null }),
    )
    expect(seen.settled.reasons).toContain('C1.F1 is blocking and not asked yet.')
    expect(seen.again).toMatch(/^Wave 2 asked: Q2\./)
  })
})

describe('Settled or not, with the Planner and the cold read as fake agents', () => {
  test('false while the pass runs and while the asked question is not integrated; true once answered and integrated, the tasks-only blocker fixed, the warning left', async () => {
    const hold = held()
    let coldSteps = 0
    const sections = SPEC_SECTIONS.map((section, at) =>
      uses(`toolu_section_${String(at)}`, 'spec_write_section', {
        section,
        content: `The ${section}.`,
        base_version: 0,
      }),
    )
    const planner: FakeScript = {
      turns: [
        [
          ...sections,
          uses('toolu_r1', 'requirement_write', {
            domain: 'invoices',
            delta: 'added',
            text: 'Invoices export as CSV.',
            scenarios: [{ when: 'the user exports the invoices', then: 'a CSV file is saved' }],
          }),
          uses('toolu_describe', 'mission_describe', { title: 'Invoices as CSV', type: 'feature' }),
          uses('toolu_proof', 'proof_write', {
            scenario: 'R1.S1',
            proof: {
              mode: 'by_hand',
              actions: ['Export the invoices'],
              starting_data: 'None.',
              expected: 'A CSV file is saved.',
              seen_today: false,
            },
            base_version: 0,
          }),
          uses('toolu_tasks', 'tasks_write', {
            tasks: [
              {
                title: 'Export as CSV',
                result: 'The invoices export as CSV.',
                requirements: ['R1'],
                scenarios: ['R1.S1'],
                targets: [],
                depends_on: [],
              },
            ],
            base_version: 0,
          }),
          uses('toolu_model', 'model_recommend', {
            agent: 'codex',
            model: 'gpt-large',
            reason: 'A small change.',
          }),
          uses('toolu_declare', 'declare_complete', { why: 'A Builder can build it.' }),
        ],
        [
          uses('toolu_wave', 'ask_wave', waveFrom('C1.F1')),
          uses('toolu_fixed', 'cold_read_fixed', {
            finding: 'C1.F2',
            what: 'T1 targets api/invoices.ts.',
          }),
        ],
        [uses('toolu_integrated', 'input_integrated', { id: 'I1', where: 'decisions' })],
      ],
      steps: [says('Done.')],
    }
    const cold: FakeScript = {
      ...reading(FINDINGS),
      between: () => {
        coldSteps += 1
        return coldSteps === 1 ? hold.promise : Promise.resolve()
      },
    }
    const { run } = coldReading((index) => (index === 0 ? planner : cold), {
      sessions: { plannerStarts: true },
    })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices as CSV', ticket: null },
          })
          yield* passIn(mission.id, 1, ['running'])
          const running = yield* coldReadSettled(mission.id)
          hold.release()
          yield* until(
            Effect.map(
              listColdReads(mission.id),
              (passes) =>
                passes[0]?.findings.some((one) => one.id === 'C1.F2' && one.fate === 'fixed') ===
                  true &&
                passes[0].findings.some((one) => one.id === 'C1.F1' && one.fate === 'asked'),
            ),
          )
          const asked = yield* coldReadSettled(mission.id)
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'B' })
          yield* until(
            Effect.map(inputsOf(mission.id), (inputs) =>
              inputs.some((one) => one.id === 'I1' && one.state === 'integrated'),
            ),
          )
          return { running, asked, after: yield* coldReadSettled(mission.id) }
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => hold.release()))),
    )
    expect(seen.running).toEqual({ settled: false, reasons: ['Cold read C1 is running.'] })
    expect(seen.asked).toEqual({
      settled: false,
      reasons: ['C1.F1 is asked as Q1, and not answered and integrated yet.'],
    })
    expect(seen.after).toEqual({ settled: true, reasons: [] })
  })
})

describe('Settled or not, after a pass that failed', () => {
  test('the only pass of the cycle failed: not settled, another is to be launched', async () => {
    const { run } = coldReading(() => ({ steps: [says('I read it.')] }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          yield* writeComplete(grantId)
          yield* declare(grantId)
          yield* passIn(mission.id, 1, ['failed'])
          return yield* coldReadSettled(mission.id)
        }),
      ),
    )
    expect(seen).toEqual({ settled: false, reasons: ['Cold read C1 failed: launch another.'] })
  })

  test('C1 left a blocker open and C2 failed: the blocker of C1 still holds the Freeze', async () => {
    const { run } = coldReading((index) =>
      index === 0 ? reading(FINDINGS) : { steps: [says('I read it.')] },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* reported
          yield* againColdRead(mission.id)
          yield* passIn(mission.id, 2, ['failed'])
          return yield* coldReadSettled(mission.id)
        }),
      ),
    )
    expect(seen).toEqual({
      settled: false,
      reasons: [
        'C1.F1 is blocking and not asked yet.',
        'C1.F2 is blocking on the tasks: the Planner has not fixed it, and you have not dismissed it.',
      ],
    })
  })
})

describe('Freshness', () => {
  test('says the version the last pass read, the version the Spec is at, and what changed between', async () => {
    const { run } = coldReading(() => reading())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const before = yield* Effect.gen(function* () {
            const { mission, grantId } = yield* planned
            const none = yield* coldReadFreshness(mission.id)
            yield* writeComplete(grantId)
            yield* declare(grantId)
            const pass = yield* passIn(mission.id, 1, ['done'])
            yield* rewrite(grantId, 'goals', 'Export every invoice.', 1)
            return { mission, none, pass }
          })
          return { ...before, fresh: yield* coldReadFreshness(before.mission.id) }
        }),
      ),
    )
    expect(seen.none.readVersion).toBeNull()
    expect(seen.fresh.readVersion).toBe(seen.pass.specVersion)
    expect(seen.fresh.specVersion).toBe(seen.pass.specVersion + 1)
    expect(seen.fresh.changes.map((one) => [one.version, one.item, one.after])).toEqual([
      [seen.pass.specVersion + 1, 'goals', 'Export every invoice.'],
    ])
  })
})

describe('The cap: a fixed phase waits for a slot (CT-13)', () => {
  test('with three sub-agents running the pass waits, Now says so, and it starts when a slot frees; never refused, never a launch', async () => {
    const hold = held()
    const { world, run } = coldReading((index) =>
      index < 3 ? { steps: [says('Helping.')], between: () => hold.promise } : reading(),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, main, grantId } = yield* planned
          const owner = { kind: 'mission' as const, missionId: mission.id }
          const helpers = yield* Effect.forEach([1, 2, 3], () =>
            Sessions.use((sessions) =>
              sessions.open({ owner, role: 'helper', folder: main, requestedBy: 'agent' }),
            ),
          )
          yield* until(Effect.sync(() => world.agents.length === 3))
          const database = yield* Database
          const spent = database
            .select()
            .from(missionSpent)
            .where(eq(missionSpent.missionId, mission.id))
          const spentBefore = yield* spent
          yield* writeComplete(grantId)
          yield* declare(grantId)
          const waiting = yield* passIn(mission.id, 1, ['waiting_for_slot'])
          const now = Memory.use((memory) => memory.now(mission.id))
          yield* until(Effect.map(now, (state) => state.slotWait !== null))
          const nowWaiting = yield* now
          const [first] = helpers
          if (first === undefined) return yield* Effect.die(new Error('no helper'))
          yield* Sessions.use((sessions) => sessions.end(first.lineage, 'the test frees a slot'))
          const done = yield* passIn(mission.id, 1, ['done'])
          return {
            waiting,
            nowWaiting,
            done,
            spentBefore,
            spentAfter: yield* spent,
            refused: yield* eventsOf(mission.id, 'session.refused'),
            nowAfter: yield* now,
          }
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => hold.release()))),
    )
    expect(seen.waiting.state).toBe('waiting_for_slot')
    expect(seen.nowWaiting.slotWait).toBe('waiting for a free slot (3 of 3 in use)')
    expect(seen.nowWaiting.next?.text).toBe('Cold read waits for a free slot')
    expect(seen.done.state).toBe('done')
    expect(seen.spentAfter).toEqual(seen.spentBefore)
    expect(seen.refused).toEqual([])
    expect(seen.nowAfter.slotWait).toBeNull()
  })
})

describe('Another pass, by the user only', () => {
  test('refused before the first declaration of the cycle and while a pass waits or runs; two at once start one; outside Planning refused', async () => {
    const holdFirst = held()
    const hold = held()
    const { run } = coldReading((index) => ({
      ...reading(),
      between: () => (index === 0 ? holdFirst.promise : hold.promise),
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          const early = yield* Effect.result(againColdRead(mission.id))
          yield* writeComplete(grantId)
          yield* declare(grantId)
          yield* passIn(mission.id, 1, ['running'])
          const whileFirst = yield* Effect.result(againColdRead(mission.id))
          holdFirst.release()
          yield* passIn(mission.id, 1, ['done'])
          const both = yield* Effect.all(
            [Effect.result(againColdRead(mission.id)), Effect.result(againColdRead(mission.id))],
            { concurrency: 'unbounded' },
          )
          yield* passIn(mission.id, 2, ['running'])
          const whileSecond = yield* Effect.result(againColdRead(mission.id))
          hold.release()
          yield* passIn(mission.id, 2, ['done'])
          yield* moveMission(mission.id, 'freeze', 'user')
          const frozen = yield* Effect.result(againColdRead(mission.id))
          return {
            early,
            whileFirst,
            both,
            whileSecond,
            frozen,
            passes: yield* listColdReads(mission.id),
          }
        }),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            holdFirst.release()
            hold.release()
          }),
        ),
      ),
    )
    const reason = (outcome: Result.Result<unknown, { readonly message: string }>) =>
      Result.isFailure(outcome) ? outcome.failure.message : 'started'
    expect(reason(seen.early)).toBe(
      'ACME-1 has had no cold read in this Planning: the Spec is not declared complete yet.',
    )
    expect(reason(seen.whileFirst)).toContain('Cold read C1 is running')
    expect(seen.both.filter(Result.isSuccess)).toHaveLength(1)
    expect(reason(seen.whileSecond)).toContain('Cold read C2 is running')
    expect(reason(seen.frozen)).toContain('ACME-1 is not in Planning')
    expect(seen.passes.map((one) => [one.label, one.requestedBy, one.state])).toEqual([
      ['C1', 'hemera', 'done'],
      ['C2', 'user', 'done'],
    ])
  })
})

describe('A pass and the mission’s life', () => {
  test('a Cancel while a pass waits for its slot fails it, and no cold read session ever opens', async () => {
    const { run } = coldReading(() => reading())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission, grantId } = yield* planned
          const limits = yield* projectLimits(project.id)
          yield* setProjectLimits(project.id, { cap: 0, budget: limits.budget })
          yield* writeComplete(grantId)
          yield* declare(grantId)
          yield* passIn(mission.id, 1, ['waiting_for_slot'])
          yield* moveMission(mission.id, 'cancel', 'user')
          const failed = yield* passIn(mission.id, 1, ['failed'])
          yield* setProjectLimits(project.id, limits)
          return { failed, sessions: yield* coldSessions(mission.id) }
        }),
      ),
    )
    expect(seen.failed.failure).toBe('the mission left Planning')
    expect(seen.sessions).toEqual([])
  })

  test('a turn that ends without the report is told once; a second silent end fails the pass', async () => {
    const { world, run } = coldReading(() => ({ steps: [says('I read it.')] }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          yield* writeComplete(grantId)
          yield* declare(grantId)
          return yield* passIn(mission.id, 1, ['failed'])
        }),
      ),
    )
    expect(seen.failure).toBe('ended without a report')
    const prompts = (world.agents[0]?.answers.prompts ?? []).map((blocks) => text(blocks))
    expect(prompts[1]).toContain('End with cold_read_report')
  })
})

/** A cold read whose agent offers two models, and reads then reports nothing. */
const OFFERING: FakeScript = {
  ...reading(),
  configOptions: [
    {
      id: 'model',
      name: 'model',
      category: 'model',
      type: 'select',
      currentValue: 'large',
      options: [
        { value: 'large', name: 'large' },
        { value: 'small', name: 'small' },
      ],
    },
  ],
}

/** OpenCode is not installed; every other agent is found. */
const withoutOpenCode = Layer.effect(
  Discovery,
  Effect.map(Discovery, (found) => ({
    ...found,
    resolve: (id: 'claude' | 'codex' | 'opencode') =>
      id === 'opencode'
        ? Effect.fail(new AgentNotInstalled({ agent: id, label: ADAPTERS[id].label }))
        : found.resolve(id),
  })),
).pipe(Layer.provide(everyAgentFound))

/** A Project's cap set to one sub-agent: a slot a pass kept would hold the next pass back. */
const capOfOne = (projectId: string) =>
  Effect.gen(function* () {
    const limits = yield* projectLimits(projectId)
    yield* setProjectLimits(projectId, { cap: 1, budget: limits.budget })
  })

const pendingNeeds = Effect.map(listNeeds, (groups) => groups.flatMap((group) => group.needs))

describe('A pass whose session stops without its report', () => {
  test('a model the agent does not offer fails the pass, frees its slot and its need; another pass is accepted and runs', async () => {
    const { run } = coldReading(() => OFFERING)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission, grantId } = yield* planned
          yield* capOfOne(project.id)
          const huge = { agent: 'claude' as const, model: 'huge', effort: null }
          yield* setRoleSetting('app', null, 'cold-read', huge)
          yield* writeComplete(grantId)
          yield* declare(grantId)
          const failed = yield* passIn(mission.id, 1, ['failed'])
          const needs = yield* pendingNeeds
          yield* setRoleSetting('app', null, 'cold-read', { ...huge, model: 'large' })
          yield* againColdRead(mission.id)
          const done = yield* passIn(mission.id, 2, ['done'])
          return { failed, needs, done }
        }),
      ),
    )
    expect(seen.failed.failure).toMatch(/^its session stopped: /)
    expect(seen.needs).toEqual([])
    expect(seen.done.state).toBe('done')
  })

  test('an agent that is not installed fails the pass and frees its slot; another pass is accepted and runs', async () => {
    const { run } = coldReading(() => reading(), { sessions: { discovery: withoutOpenCode } })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission, grantId } = yield* planned
          yield* capOfOne(project.id)
          const missing = { agent: 'opencode' as const, model: null, effort: null }
          yield* setRoleSetting('app', null, 'cold-read', missing)
          yield* writeComplete(grantId)
          yield* declare(grantId)
          const failed = yield* passIn(mission.id, 1, ['failed'])
          yield* setRoleSetting('app', null, 'cold-read', { ...missing, agent: 'claude' })
          yield* againColdRead(mission.id)
          return { failed, done: yield* passIn(mission.id, 2, ['done']) }
        }),
      ),
    )
    expect(seen.failed.failure).toMatch(/^its session stopped: /)
    expect(seen.done.state).toBe('done')
  })

  test('a session that cannot be opened fails the pass and frees its slot; another pass is accepted and runs', async () => {
    const { run } = coldReading(() => reading())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission, grantId } = yield* planned
          yield* capOfOne(project.id)
          const database = yield* Database
          yield* database.run(sql`CREATE TRIGGER refuse_cold_read_sessions
            BEFORE INSERT ON agent_sessions WHEN NEW.role = 'cold-read'
            BEGIN SELECT RAISE(ABORT, 'the disk is full'); END`)
          yield* writeComplete(grantId)
          yield* declare(grantId)
          const failed = yield* passIn(mission.id, 1, ['failed'])
          yield* database.run(sql`DROP TRIGGER refuse_cold_read_sessions`)
          yield* againColdRead(mission.id)
          return { failed, done: yield* passIn(mission.id, 2, ['done']) }
        }),
      ),
    )
    expect(seen.failed.failure).toMatch(/^its session did not open: /)
    expect(seen.done.state).toBe('done')
  })
})

describe('A pass, its replaced session and its mission', () => {
  test('a replaced session is told once again before a silent end fails the pass', async () => {
    const hold = held()
    let steps = 0
    const { world, run } = coldReading((index) =>
      index === 0
        ? {
            steps: [says('I read it.')],
            between: () => {
              steps += 1
              return steps === 2 ? hold.promise : Promise.resolve()
            },
          }
        : {
            turns: [[says('Reading again.')], [report('toolu_report', [])]],
            steps: [says('Done.')],
          },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          yield* writeComplete(grantId)
          yield* declare(grantId)
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) > 1))
          const [session] = yield* coldSessions(mission.id, LIVE)
          if (session === undefined) return yield* Effect.die(new Error('no cold read session'))
          yield* Sessions.use((sessions) => sessions.replace(session.id, 'its agent stopped'))
          return yield* passIn(mission.id, 1, ['done', 'failed'])
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => hold.release()))),
    )
    expect(seen.state).toBe('done')
    const prompts = (world.agents[1]?.answers.prompts ?? []).map((blocks) => text(blocks))
    expect(prompts[1]).toContain('End with cold_read_report')
  })

  test('a report once the mission left Planning is refused, and keeps nothing', async () => {
    const hold = held()
    const { world, run } = coldReading(() => ({
      ...reading(FINDINGS),
      between: () => hold.promise,
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          yield* writeComplete(grantId)
          yield* declare(grantId)
          yield* passIn(mission.id, 1, ['running'])
          // The Cancel's commit, before its event is followed.
          const database = yield* Database
          yield* database
            .update(missions)
            .set({ stage: 'cancelled' })
            .where(eq(missions.id, mission.id))
          hold.release()
          yield* until(Effect.sync(() => answersOf(world, 0).length > 1))
          return (yield* listColdReads(mission.id))[0]
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => hold.release()))),
    )
    expect(answersOf(world, 0)[1]).toBe(
      'refused: ACME-1 is not in Planning any more: this cold read ends without its report.',
    )
    // The silent end that follows may already have failed the pass: either way it never ends done.
    expect(seen?.state).not.toBe('done')
    expect(seen?.findings).toEqual([])
  })
})

describe('A restart mid-read', () => {
  test('the pass running at the stop is taken over by a session with the same brief and the restart sentence; it ends once', async () => {
    const hold = held()
    const first = coldReading(() => ({ steps: [says('Reading.')], between: () => hold.promise }))
    const before = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          yield* writeComplete(grantId)
          yield* declare(grantId)
          const pass = yield* passIn(mission.id, 1, ['running'])
          yield* until(Effect.sync(() => (first.world.agents[0]?.answers.prompts.length ?? 0) > 0))
          yield* plannerEnded(mission.id)
          return { mission, pass }
        }),
      ),
    )
    hold.release()
    const second = coldReading(() => reading())
    const after = await second.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const done = yield* passIn(before.mission.id, 1, ['done'])
          return {
            done,
            started: yield* eventsOf(before.mission.id, 'planning.cold_read_started'),
            ended: yield* eventsOf(before.mission.id, 'planning.cold_read_ended'),
            passes: yield* listColdReads(before.mission.id),
          }
        }),
      ),
    )
    const brief = text(second.world.agents[0]?.answers.prompts[0] ?? [])
    expect(brief).toBe(`${BRIEF(before.pass.specVersion)}\n\n[hemera:resume]\n${START_AGAIN}`)
    expect(after.passes).toHaveLength(1)
    expect(after.started).toHaveLength(1)
    expect(after.ended).toHaveLength(1)
  })

  test('a stop after the report is kept still hands the Planner [hemera:cold-read] after the restart', async () => {
    const first = coldReading(() => reading(FINDINGS))
    const before = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          yield* writeComplete(grantId)
          yield* declare(grantId)
          yield* passIn(mission.id, 1, ['done'])
          yield* plannerEnded(mission.id)
          return { mission, delivered: yield* plannerDeliveries(mission.id, 'cold-read') }
        }),
      ),
    )
    const second = coldReading(() => ({ steps: [says('Done.')] }), {
      sessions: { plannerStarts: true },
    })
    const prompts = await second.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const told = () =>
            second.world.agents.flatMap((agent) =>
              agent.answers.prompts.map((blocks) => text(blocks)),
            )
          yield* until(Effect.sync(() => told().some((one) => one.includes('[hemera:cold-read]'))))
          return told()
        }),
      ),
    )
    expect(before.delivered.map((one) => one.state)).toEqual(['queued'])
    expect(prompts.filter((one) => one.includes('[hemera:cold-read]'))).toHaveLength(1)
    expect(prompts.join('\n')).toContain('C1.F1 · blocking · R1.S1')
  })

  test('a pass waiting for its slot at the stop waits again after it, and runs once a slot is free', async () => {
    const first = coldReading(() => reading())
    const before = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission, grantId } = yield* planned
          const limits = yield* projectLimits(project.id)
          yield* setProjectLimits(project.id, { cap: 0, budget: limits.budget })
          yield* writeComplete(grantId)
          yield* declare(grantId)
          yield* passIn(mission.id, 1, ['waiting_for_slot'])
          yield* plannerEnded(mission.id)
          return { project, mission, limits }
        }),
      ),
    )
    const second = coldReading(() => reading())
    const after = await second.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* setProjectLimits(before.project.id, before.limits)
          return yield* passIn(before.mission.id, 1, ['done'])
        }),
      ),
    )
    expect(after.state).toBe('done')
    expect(first.world.agents).toHaveLength(0)
    expect(text(second.world.agents[0]?.answers.prompts[0] ?? [])).toBe(BRIEF(after.specVersion))
  })
})

describe('The Planner’s paragraph', () => {
  test('its layer holds "The cold read", before what it returns', () => {
    const paragraph = [
      '## The cold read',
      '`[hemera:cold-read]` brings the findings of a fresh reader. Blocking findings on sections,',
      'requirements, scenarios or proofs: ask them in your next wave (`from_finding`). Blocking findings',
      'on the tasks only: fix the graph yourself and mark them with `cold_read_fixed`. Fix the warnings',
      'and suggestions you agree with and mark them too. You never launch a cold read.',
    ].join('\n')
    expect(PLANNER_TEMPLATE).toContain(paragraph)
    expect(PLANNER_TEMPLATE.indexOf('## The cold read')).toBeLessThan(
      PLANNER_TEMPLATE.indexOf('## Returns / when you stop'),
    )
  })
})

describe('The pass as its LiveChip follows it', () => {
  test('changed sends the passes, then follows them until the pass is done', async () => {
    const { run } = coldReading(() => reading())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          const followed = yield* coldReadChanges(mission.id).pipe(
            Stream.takeUntil((passes) => passes.some((one) => one.state === 'done')),
            Stream.runCollect,
            Effect.forkChild,
          )
          yield* writeComplete(grantId)
          yield* declare(grantId)
          return Array.from(yield* Fiber.join(followed))
        }),
      ),
    )
    expect(seen[0]).toEqual([])
    expect(seen.at(-1)?.map((one) => [one.label, one.state])).toEqual([['C1', 'done']])
  })

  test('a session silent in its turn makes the chip stuck; its replacement speaks, the chip is not, and it reports', async () => {
    const hold = held()
    const { run } = coldReading(
      (index) =>
        index === 0 ? { steps: [says('Reading.')], between: () => hold.promise } : reading(),
      { timings: SILENCE },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* planned
          yield* writeComplete(grantId)
          yield* declare(grantId)
          yield* until(
            Effect.map(eventsOf(mission.id, 'planning.cold_read_stuck'), (rows) => rows.length > 0),
          )
          yield* until(
            Effect.map(
              eventsOf(mission.id, 'planning.cold_read_unstuck'),
              (rows) => rows.length > 0,
            ),
          )
          return yield* passIn(mission.id, 1, ['done'])
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => hold.release()))),
    )
    expect(seen.stuck).toBe(false)
  })
})
