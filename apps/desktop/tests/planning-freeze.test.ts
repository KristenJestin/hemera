/**
 * The Freeze (#92): when it is offered, the user's Freeze on the version read (its base commits,
 * the dirty files of the main checkout, the Planner tree stopped and the Probes wiped), the frozen
 * Spec, the return to Planning, the dependencies between missions and the outdated mark.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent (the cold reads, a Probe,
 * a fresh Planner), a temporary data folder, and Acme's real repositories: `api`, on the default
 * base branch with a bare repository on the same disk as its remote, and `web`, without a remote.
 * The Planner the user plans with is a session the test opened: the test calls its tools through
 * its grant. Every wait is on state, never on time.
 */

import { chmodSync, existsSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import {
  Blocked,
  DEFAULT_BASE_BRANCH,
  DecisionFields,
  Dependency,
  Idle,
  MissionOwner,
  OutdatedMark,
  SPEC_SECTIONS,
  type SessionState,
  maskText,
} from '@hemera/core/domain'
import { FreezeRefused, type Mission } from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Fiber, Layer, Predicate, Result, type Schema, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { HemeraEndpoint } from '../src/engine/agents/endpoint.ts'
import type { FakeScript, FakeStep } from '../src/engine/agents/fake.ts'
import { DomainEvents } from '../src/engine/domain-events.ts'
import type { DirtyFile } from '../src/engine/git.ts'
import { createMission, getMission, moveMission } from '../src/engine/missions.ts'
import { createNeed, getNeed, needService } from '../src/engine/needs.ts'
import { REGISTRY, noticesOf } from '../src/engine/notifications.ts'
import { answerQuestion, waitOnSomeone } from '../src/engine/planning/calls.ts'
import { againColdRead, listColdReads } from '../src/engine/planning/cold-read-store.ts'
import { decideDependency, dependenciesOf } from '../src/engine/planning/dependencies.ts'
import {
  closeDiscussion,
  missionLocksKept,
  openDiscussion,
} from '../src/engine/planning/discussions.ts'
import {
  freezeMission,
  freezeReadiness,
  freezeReadinessChanges,
  markOutdated,
  returnToPlanning,
} from '../src/engine/planning/freeze.ts'
import { markDelivered } from '../src/engine/planning/inputs.ts'
import { ProbeCleanup, ProbeWipeFailed } from '../src/engine/planning/probe-desk.ts'
import { probeRowsOf } from '../src/engine/planning/probe-store.ts'
import { PLANNER_TEMPLATE } from '../src/engine/planning/role.ts'
import {
  FileSnapshots,
  type SnapshotRepository,
  databaseSnapshots,
} from '../src/engine/planning/snapshots.ts'
import { readSpec } from '../src/engine/planning/store.ts'
import { createProject } from '../src/engine/projects.ts'
import { openSession, sessionsIn } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  domainEvents,
  freezeFiles,
  freezes,
  missionStops,
  missions,
  sessionDeliveries,
  snapshotContents,
  specs,
} from '../src/engine/storage/schema.ts'
import { ToolAccess } from '../src/engine/tools/access.ts'
import { git, remote, repository } from './repositories.ts'
import { BUILDER, HELPER, held, sessionsEngine, text, until, within } from './sessions-world.ts'
import { on, removeFolders, temporaryFolder } from './storage.ts'
import { callTool } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('freeze'))
  work = realpathSync.native(temporaryFolder('freeze-work'))
})
afterEach(removeFolders)

const uses = (id: string, tool: string, args: Schema.JsonObject): FakeStep => ({
  does: 'uses',
  id,
  tool,
  arguments: args,
})

const says = (words: string): FakeStep => ({ does: 'says', text: words })

/** A cold read that reads the Spec, then reports these findings (none unless said). */
const reading = (findings: ReadonlyArray<Schema.JsonObject> = []): FakeScript => ({
  turns: [
    [
      uses('toolu_read', 'spec_read', {}),
      uses('toolu_report', 'cold_read_report', { findings: [...findings] }),
    ],
  ],
  steps: [says('Done.')],
})

/** An agent that answers every prompt and does nothing else: a fresh Planner, here. */
const QUIET: FakeScript = { steps: [says('Read.')] }

/** The engine, its agents scripted in their start order: a cold read reporting nothing unless said. */
const freezing = (
  scriptOf: (index: number) => FakeScript = () => reading(),
  options: Parameters<typeof sessionsEngine>[2] = {},
) =>
  sessionsEngine(data, scriptOf, {
    roles: [BUILDER, HELPER],
    ...options,
    tools: { home: work, ...options.tools },
  })

const INVOICES = 'export const invoices = []\n'

/**
 * Acme: its main checkout holding `api` on the default base branch, with `invoices.ts` and a bare
 * repository as its remote, and `web`, without a remote. `away` makes `api`'s remote unreachable.
 */
const acmeAt = (main: string, options: { readonly away?: boolean } = {}) =>
  Effect.gen(function* () {
    const api = repository(join(main, 'api'), DEFAULT_BASE_BRANCH)
    writeFileSync(join(api, 'invoices.ts'), INVOICES)
    writeFileSync(join(api, 'README.md'), 'Acme api\n')
    git(api, 'add', '.')
    git(api, 'commit', '-q', '-m', 'invoices')
    const bare = remote(api, join(work, 'remotes', `${basename(main)}-api.git`))
    if (options.away === true) git(api, 'remote', 'set-url', 'origin', join(work, 'nowhere'))
    const web = repository(join(main, 'web'), DEFAULT_BASE_BRANCH)
    const project = yield* createProject({
      name: basename(main),
      mainCheckout: main,
      repositories: ['api', 'web'],
    })
    return { project, main, api, web, bare }
  })

const acme = (options: { readonly away?: boolean } = {}) =>
  Effect.suspend(() => acmeAt(join(work, 'acme'), options))

/** A commit on the remote's base branch by someone else: `invoices.ts` removed. */
const invoicesRemovedOnRemote = (bare: string) => {
  const clone = join(work, 'theirs')
  git(work, 'clone', '-q', '-b', DEFAULT_BASE_BRANCH, bare, clone)
  git(clone, 'rm', '-q', 'invoices.ts')
  git(clone, 'commit', '-q', '-m', 'theirs')
  git(clone, 'push', '-q', 'origin', DEFAULT_BASE_BRANCH)
  return git(clone, 'rev-parse', 'HEAD')
}

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
    return yield* grantOf(session.id)
  })

/** The grant of a session, its token minted. */
const grantOf = (sessionId: string) =>
  Effect.gen(function* () {
    const token = yield* HemeraEndpoint.use((endpoint) => endpoint.mint(sessionId))
    const grant = yield* ToolAccess.use((access) => access.byToken(token))
    if (grant === null) return yield* Effect.die(new Error('the token named no grant'))
    return grant.id
  })

/** A mission of a Project in Planning, and its Planner's grant. */
const plannedIn = (projectId: string, main: string, sentence = 'Export the invoices as CSV') =>
  Effect.gen(function* () {
    const mission = yield* createMission({ projectId, idea: { sentence, ticket: null } })
    const grantId = yield* plannerGrant(mission.id, main)
    return { mission, grantId }
  })

/**
 * The Planner's next turn takes what was handed to it: the test's Planner has no agent, so its
 * deliveries are marked taken here, then its inputs delivered as a turn's start does (#86).
 */
const plannerTook = (missionId: string) =>
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

const call = (grantId: string, tool: string, args: Schema.JsonObject) =>
  Effect.map(callTool(grantId, tool, args), (answer) => answer.text)

/** The task the Spec's graph holds: it changes `api/invoices.ts`. */
const EXPORT_TASK = {
  title: 'Export as CSV',
  result: 'The invoices export as CSV.',
  requirements: ['R1'],
  scenarios: ['R1.S1'],
  targets: [{ repository: 'api', path: 'invoices.ts', intent: 'change' }],
  depends_on: [],
}

/** The Planner writes a whole Spec that passes Hemera's check (#85, #90): version 11. */
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
    yield* call(grantId, 'tasks_write', { tasks: [EXPORT_TASK], base_version: 0 })
    yield* call(grantId, 'model_recommend', {
      agent: 'codex',
      model: 'gpt-large',
      reason: 'A small change.',
    })
  })

const declare = (grantId: string) =>
  call(grantId, 'declare_complete', { why: 'A Builder can build it.' })

/** Waits until the mission's cold read numbered so is in one of the states. */
const passIn = (missionId: string, number: number, states: ReadonlyArray<string>) =>
  until(
    Effect.map(listColdReads(missionId), (passes) =>
      passes.some((one) => one.number === number && states.includes(one.state)),
    ),
  )

/** The whole of Planning up to a Spec Freeze may take: written, declared, read cold. */
const settledSpec = (missionId: string, grantId: string, pass = 1) =>
  Effect.gen(function* () {
    yield* writeComplete(grantId)
    yield* declare(grantId)
    yield* passIn(missionId, pass, ['done'])
    return (yield* readSpec(missionId)).version
  })

/** A mission of Acme planned whole and frozen. */
const frozenIn = (projectId: string, main: string, sentence?: string) =>
  Effect.gen(function* () {
    const planned = yield* plannedIn(projectId, main, sentence)
    const version = yield* settledSpec(planned.mission.id, planned.grantId)
    const mission = yield* freezeMission(planned.mission.id, version)
    return { ...planned, mission, version }
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

const LIVE: ReadonlyArray<SessionState> = ['starting', 'working', 'idle', 'stuck']

/** The mission's sessions of a role in these states. */
const sessionsOf = (missionId: string, role: string, states: ReadonlyArray<SessionState> = LIVE) =>
  Effect.map(sessionsIn(states, { kind: 'mission', missionId }), (rows) =>
    rows.filter((row) => row.role === role),
  )

const marksOf = (mission: Mission) => mission.marks.map((one) => one.sentence)

/** The refusal a Freeze failed with: its reasons. */
const refusedWith = (outcome: Result.Result<Mission, unknown> | undefined) =>
  outcome !== undefined && Result.isFailure(outcome) && outcome.failure instanceof FreezeRefused
    ? outcome.failure.reasons
    : null

/** Moves a mission of the test along the stages to Done, every guard passing (a fixture). */
const delivered = (missionId: string) =>
  Effect.gen(function* () {
    yield* moveMission(missionId, 'launch', 'user')
    yield* moveMission(missionId, 'endBuilding', 'hemera')
    yield* moveMission(missionId, 'ship', 'user')
    return yield* moveMission(missionId, 'complete', 'hemera')
  })

describe('Freeze appears only when everything is settled for the agent', () => {
  test('no declaration, a cold read running, a blocking finding unsettled: each is named; ready once all clear', async () => {
    const hold = held()
    const { run } = freezing(() => ({
      ...reading([{ severity: 'blocking', where: ['T1'], text: 'T1 names no test it adds.' }]),
      between: () => hold.promise,
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* plannedIn(project.id, main)
          const fresh = yield* freezeReadiness(mission.id)
          yield* writeComplete(grantId)
          yield* declare(grantId)
          yield* passIn(mission.id, 1, ['running'])
          const running = yield* freezeReadiness(mission.id)
          hold.release()
          yield* passIn(mission.id, 1, ['done'])
          const found = yield* freezeReadiness(mission.id)
          const fixed = yield* call(grantId, 'cold_read_fixed', {
            finding: 'C1.F1',
            what: 'T1 adds api/invoices.test.ts.',
          })
          const ready = yield* freezeReadiness(mission.id)
          return { fresh, running, found, fixed, ready }
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => hold.release()))),
    )
    expect(seen.fresh.ready).toBe(false)
    expect(seen.fresh.unsettled).toContain(
      'The Planner has not declared the Spec of ACME-1 complete yet.',
    )
    expect(seen.fresh.unsettled).toContain('No cold read has read the Spec in this Planning yet.')
    expect(seen.running.unsettled).toEqual(['Cold read C1 is running.'])
    expect(seen.found.ready).toBe(false)
    expect(seen.found.unsettled).toHaveLength(1)
    expect(seen.found.unsettled[0]).toContain('C1.F1')
    expect(seen.fixed).toMatch(/C1\.F1/)
    expect(seen.ready).toMatchObject({ ready: true, unsettled: [], dependencies: [] })
    expect(seen.ready.freshness).toMatchObject({ readVersion: 11, specVersion: 11 })
  })

  test('an open question, one waiting on someone, an input not integrated and an open discussion are named; a write since the declaration too', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* plannedIn(project.id, main)
          yield* settledSpec(mission.id, grantId)
          const question = (textOf: string) => ({
            text: textOf,
            why: 'The export depends on it.',
            options: [
              { label: 'Comma', detail: 'Choosing Comma.' },
              { label: 'Semicolon', detail: 'Choosing Semicolon.' },
            ],
            recommended: 1,
            recommended_reason: 'The api repository already writes it so.',
          })
          yield* call(grantId, 'ask_wave', {
            questions: [
              question('Which separator does the CSV use?'),
              question('Which quote does it use?'),
            ],
          })
          yield* waitOnSomeone(mission.id, 'Q2', 'The accounting team decides.')
          const asked = yield* freezeReadiness(mission.id)
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'B' })
          yield* answerQuestion(mission.id, 'Q2', { optionId: 'A' })
          // The Planner's next turn takes them.
          yield* plannerTook(mission.id)
          const answered = yield* freezeReadiness(mission.id)
          yield* call(grantId, 'input_integrated', { id: 'I2', where: 'decisions' })
          yield* call(grantId, 'input_integrated', { id: 'I3', where: 'decisions' })
          const integrated = yield* freezeReadiness(mission.id)
          const opened = yield* openDiscussion(
            mission.id,
            { kind: 'requirement', id: 'R1' },
            'Why CSV and not a spreadsheet?',
          )
          const discussing = yield* freezeReadiness(mission.id)
          yield* closeDiscussion(opened.id, { noDecision: true })
          const closed = yield* freezeReadiness(mission.id)
          yield* call(grantId, 'spec_write_section', {
            section: 'risks',
            content: 'A large export may be slow.',
            base_version: 1,
          })
          const written = yield* freezeReadiness(mission.id)
          yield* declare(grantId)
          const declared = yield* freezeReadiness(mission.id)
          return { asked, answered, integrated, discussing, closed, written, declared }
        }),
      ),
    )
    expect(seen.asked.unsettled).toEqual([
      'Input I1 (Q2 waiting on someone) has not reached you yet: it comes with your next delivery.',
      "Q1 is open: it waits for the user's answer.",
      'Q2 waits on someone: a complete Spec has no open question.',
    ])
    expect(seen.answered.unsettled).toEqual([
      'Input I2 (the answer to Q1, version 1) is not integrated: integrate it, then call input_integrated.',
      'Input I3 (the answer to Q2, version 1) is not integrated: integrate it, then call input_integrated.',
    ])
    expect(seen.integrated).toMatchObject({ ready: true, unsettled: [] })
    expect(seen.discussing.unsettled).toEqual([
      '#1 on R1 is still open: the user closes it, with a decision or without.',
    ])
    expect(seen.closed.ready).toBe(true)
    expect(seen.written.unsettled).toEqual([
      'The Spec changed since the Planner declared it complete at version 11: it is at version 12, and the Planner declares it again.',
    ])
    expect(seen.declared.ready).toBe(true)
  })

  test('a Probe running is named; once it reported, it holds nothing', async () => {
    const hold = held()
    const { run } = freezing((index) =>
      index === 0
        ? {
            turns: [[uses('toolu_probe_report', 'probe_report', PROBE_REPORT)]],
            steps: [says('Done.')],
            between: () => hold.promise,
          }
        : reading(),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* plannedIn(project.id, main)
          yield* call(grantId, 'probe_launch', {
            question: 'does the export keep accents?',
            brief: 'Look at api/invoices.ts.',
          })
          yield* until(Effect.map(probeRowsOf(mission.id), (rows) => rows[0]?.state === 'running'))
          yield* settledSpec(mission.id, grantId)
          const running = yield* freezeReadiness(mission.id)
          hold.release()
          yield* until(Effect.map(probeRowsOf(mission.id), (rows) => rows[0]?.state === 'done'))
          return { running, done: yield* freezeReadiness(mission.id) }
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => hold.release()))),
    )
    expect(seen.running.unsettled).toEqual(['Probe #1 runs: does the export keep accents?'])
    expect(seen.done.ready).toBe(true)
  })

  test('the stream follows the mission to ready, then to not ready once frozen', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.scoped(
          Effect.gen(function* () {
            const { project, main } = yield* acme()
            const { mission, grantId } = yield* plannedIn(project.id, main)
            const followed = yield* freezeReadinessChanges(mission.id).pipe(
              Stream.takeUntil((readiness) => readiness.ready),
              Stream.runCollect,
              Effect.forkScoped,
            )
            yield* settledSpec(mission.id, grantId)
            const collected = yield* Fiber.join(followed)
            return { collected }
          }),
        ),
      ),
    )
    expect(seen.collected.at(0)?.ready).toBe(false)
    expect(seen.collected.at(-1)?.ready).toBe(true)
  })
})

/** A Probe's report, as `probe_report` takes it. */
const PROBE_REPORT: Schema.JsonObject = {
  outcome: 'reproduced',
  answer: 'The export drops the accents of a name.',
  actions: ['Write api/tests/export-accents.test.ts', 'Run it'],
  starting_data: 'tests/fixtures/names.csv',
  command: 'node tests/export-accents.test.ts',
  expected: 'The name reads "Éloïse".',
  observed: 'Expected "Éloïse", received "Eloise"',
  key_line: 'Expected "Éloïse", received "Eloise"',
  test: { repository: 'api', path: 'tests/export-accents.test.ts', code: 'assert(…)' },
  base_commit: 'abc1234',
  neighbours: [],
  evidence: [],
}

describe('Freeze, the user’s gesture', () => {
  test('on an older specVersion it is refused, nothing moves, and nothing of the dirty files is kept', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acme()
          const { mission, grantId } = yield* plannedIn(project.id, main)
          const version = yield* settledSpec(mission.id, grantId)
          writeFileSync(join(api, 'export.ts'), 'export const csv = () => ""\n')
          const older = yield* Effect.result(freezeMission(mission.id, version - 1))
          const database = yield* Database
          return {
            older,
            after: yield* getMission(mission.id),
            frozen: yield* eventsOf(mission.id, 'planning.frozen'),
            contents: yield* database.select().from(snapshotContents),
          }
        }),
      ),
    )
    expect(refusedWith(seen.older)).toEqual([
      'The Spec changed since you read it: read what changed, then freeze.',
    ])
    expect(seen.after.stage).toBe('planning')
    expect(seen.after.frozen).toBe(false)
    expect(seen.frozen).toEqual([])
    expect(seen.contents).toEqual([])
  })

  test('a target removed from the base since the declaration refuses it, names it, and hands the Planner [hemera:freeze-refused]', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, bare } = yield* acme()
          const { mission, grantId } = yield* plannedIn(project.id, main)
          const version = yield* settledSpec(mission.id, grantId)
          const moved = invoicesRemovedOnRemote(bare)
          const outcome = yield* Effect.result(freezeMission(mission.id, version))
          return {
            outcome,
            moved,
            after: yield* getMission(mission.id),
            told: yield* plannerDeliveries(mission.id, 'freeze-refused'),
            refused: yield* eventsOf(mission.id, 'planning.freeze_refused'),
          }
        }),
      ),
    )
    const reason = `T1 changes api/invoices.ts, which does not exist at the base commit ${seen.moved.slice(0, 12)}.`
    expect(refusedWith(seen.outcome)).toEqual([reason])
    expect(seen.after.stage).toBe('planning')
    expect(seen.told.map((one) => one.body)).toEqual([
      [
        'The user tried to freeze the Spec, and Hemera refused it at the base commit it would record:',
        `- ${reason}`,
        'Fix each, then declare complete again.',
      ].join('\n'),
    ])
    expect(seen.refused).toHaveLength(1)
  })

  test('refused twice on the same version for the same reasons: the Planner is handed [hemera:freeze-refused] once', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, bare } = yield* acme()
          const { mission, grantId } = yield* plannedIn(project.id, main)
          const version = yield* settledSpec(mission.id, grantId)
          invoicesRemovedOnRemote(bare)
          const first = yield* Effect.result(freezeMission(mission.id, version))
          const second = yield* Effect.result(freezeMission(mission.id, version))
          return {
            first,
            second,
            told: yield* plannerDeliveries(mission.id, 'freeze-refused'),
            refused: yield* eventsOf(mission.id, 'planning.freeze_refused'),
          }
        }),
      ),
    )
    expect(refusedWith(seen.first)).toHaveLength(1)
    expect(refusedWith(seen.second)).toEqual(refusedWith(seen.first))
    expect(seen.told).toHaveLength(1)
    expect(seen.refused).toHaveLength(2)
  })

  test('it records one base commit per repository after a fetch, the dirty files with their content (a .env as path and hash), moves to Ready, stops the Planner tree and wipes the Probes', async () => {
    const { world, run } = freezing((index) =>
      index === 0
        ? {
            turns: [[uses('toolu_probe_report', 'probe_report', PROBE_REPORT)]],
            steps: [says('Done.')],
          }
        : reading(),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api, web, bare } = yield* acme()
          const { mission, grantId } = yield* plannedIn(project.id, main)
          yield* call(grantId, 'probe_launch', {
            question: 'does the export keep accents?',
            brief: 'Look at api/invoices.ts.',
          })
          yield* until(Effect.map(probeRowsOf(mission.id), (rows) => rows[0]?.state === 'done'))
          const version = yield* settledSpec(mission.id, grantId)
          // Someone else adds a file on the remote: the Freeze fetches it.
          const clone = join(work, 'theirs')
          git(work, 'clone', '-q', '-b', DEFAULT_BASE_BRANCH, bare, clone)
          writeFileSync(join(clone, 'CHANGELOG.md'), 'Unreleased\n')
          git(clone, 'add', '.')
          git(clone, 'commit', '-q', '-m', 'changelog')
          git(clone, 'push', '-q', 'origin', DEFAULT_BASE_BRANCH)
          const fetched = git(clone, 'rev-parse', 'HEAD')
          // The main checkout is dirty: a change, a deletion, a new file and a `.env`.
          writeFileSync(join(api, 'invoices.ts'), 'export const invoices = [1]\n')
          rmSync(join(api, 'README.md'))
          writeFileSync(join(api, 'export.ts'), 'export const csv = () => ""\n')
          writeFileSync(join(api, '.env'), 'DATABASE_PASSWORD=acme-local\n')
          const frozen = yield* freezeMission(mission.id, version)
          const database = yield* Database
          const [row] = yield* database
            .select()
            .from(freezes)
            .where(eq(freezes.missionId, mission.id))
          const contents = yield* database.select().from(snapshotContents)
          return {
            frozen,
            fetched,
            web: git(web, 'rev-parse', 'HEAD'),
            row,
            contents,
            files: yield* database.select().from(freezeFiles),
            spec: yield* readSpec(mission.id),
            planners: yield* sessionsOf(mission.id, 'planner'),
            probes: yield* probeRowsOf(mission.id),
            event: yield* eventsOf(mission.id, 'planning.frozen'),
            stops: yield* database.select().from(missionStops),
          }
        }),
      ),
    )
    expect(seen.frozen.stage).toBe('ready')
    expect(seen.frozen.frozen).toBe(true)
    expect(seen.spec.frozen).toBe(true)
    expect(seen.frozen.freeze?.version).toBe(11)
    expect(seen.frozen.freeze?.bases.map((one) => [one.repository, one.commit])).toEqual([
      ['api', seen.fetched],
      ['web', seen.web],
    ])
    expect(Predicate.isTagged(seen.frozen.freeze?.bases[0]?.freshness, 'FetchedNow')).toBe(true)
    expect(Predicate.isTagged(seen.frozen.freeze?.bases[1]?.freshness, 'LocalBranch')).toBe(true)
    const files = [...(seen.frozen.freeze?.dirtyFiles ?? [])].toSorted((a, b) =>
      a.path < b.path ? -1 : 1,
    )
    expect(files.map((one) => [one.repository, one.path, one.status, one.withheld])).toEqual([
      ['api', '.env', 'untracked', 'content withheld: a sensitive place'],
      ['api', 'README.md', 'deleted', null],
      ['api', 'export.ts', 'untracked', null],
      ['api', 'invoices.ts', 'modified', null],
    ])
    const env = files.find((one) => one.path === '.env')
    expect(env?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(files.find((one) => one.path === 'README.md')?.sha256).toBeNull()
    // The content of the change is kept; the `.env`'s never.
    const kept = seen.contents.map((one) => one.content)
    expect(kept).toContain('export const invoices = [1]\n')
    expect(kept).toContain('export const csv = () => ""\n')
    expect(kept.some((one) => one.includes('DATABASE_PASSWORD'))).toBe(false)
    expect(seen.contents.some((one) => one.sha256 === env?.sha256)).toBe(false)
    expect(seen.row?.specVersion).toBe(11)
    expect(seen.event).toHaveLength(1)
    expect(seen.planners).toEqual([])
    expect(seen.probes.map((one) => one.state)).toEqual(['wiped'])
    expect(existsSync(seen.probes[0]?.folder ?? '')).toBe(false)
    expect(seen.stops).toEqual([])
    // Nothing reached Building, and no agent was started for the Freeze itself.
    expect(world.agents).toHaveLength(2)
  })

  test('a repository inside the checkout and a submodule changed inside are kept as their path, their content withheld', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acme()
          // `shared`, a submodule of `api`, then changed inside.
          const shared = repository(join(work, 'shared'), DEFAULT_BASE_BRANCH)
          writeFileSync(join(shared, 'index.ts'), 'export {}\n')
          git(shared, 'add', '.')
          git(shared, 'commit', '-q', '-m', 'shared')
          git(api, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', shared, 'shared')
          git(api, 'commit', '-q', '-m', 'shared')
          writeFileSync(join(api, 'shared', 'index.ts'), 'export const csv = 1\n')
          // A repository of its own inside `api`, untracked.
          const vendor = repository(join(api, 'vendor'), DEFAULT_BASE_BRANCH)
          writeFileSync(join(vendor, 'notes.md'), 'Vendor notes\n')
          const { mission, grantId } = yield* plannedIn(project.id, main)
          const version = yield* settledSpec(mission.id, grantId)
          return yield* Effect.result(freezeMission(mission.id, version))
        }),
      ),
    )
    expect(Result.isSuccess(seen)).toBe(true)
    if (Result.isSuccess(seen)) {
      const files = [...(seen.success.freeze?.dirtyFiles ?? [])].toSorted((a, b) =>
        a.path < b.path ? -1 : 1,
      )
      expect(files.map((one) => [one.repository, one.path, one.status, one.withheld])).toEqual([
        ['api', 'shared', 'modified', 'content withheld: a submodule'],
        ['api', 'vendor/', 'untracked', 'content withheld: a repository'],
      ])
    }
  })

  test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'a dirty file that cannot be read refuses the Freeze, named, and keeps nothing of it',
    async () => {
      const { run } = freezing()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { project, main, api } = yield* acme()
            const { mission, grantId } = yield* plannedIn(project.id, main)
            const version = yield* settledSpec(mission.id, grantId)
            writeFileSync(join(api, 'export.ts'), 'export const csv = () => ""\n')
            writeFileSync(join(api, 'locked.ts'), 'export const locked = true\n')
            chmodSync(join(api, 'locked.ts'), 0o000)
            const outcome = yield* Effect.result(freezeMission(mission.id, version))
            chmodSync(join(api, 'locked.ts'), 0o600)
            const database = yield* Database
            return {
              outcome,
              after: yield* getMission(mission.id),
              contents: yield* database.select().from(snapshotContents),
            }
          }),
        ),
      )
      const reasons = refusedWith(seen.outcome)
      expect(reasons).toHaveLength(1)
      expect(reasons?.[0]).toMatch(/^The dirty file api\/locked\.ts could not be read \(EACCES\)/)
      expect(seen.after.stage).toBe('planning')
      expect(seen.contents).toEqual([])
    },
  )

  test('what follows a committed Freeze failing: the Freeze answers the Ready mission, the stops still owed', async () => {
    const { run } = freezing(undefined, {
      missions: {
        stoppers: [
          { name: 'probes', stop: () => Effect.die(new Error('the Probes’ folder vanished')) },
        ],
      },
    })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* plannedIn(project.id, main)
          const version = yield* settledSpec(mission.id, grantId)
          return yield* freezeMission(mission.id, version)
        }),
      ),
    )
    expect(seen.stage).toBe('ready')
    expect(seen.unstopped).toContain('probes')
  })

  test('with the remote unreachable, the last tracking ref is recorded, "not fetched since"', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acme({ away: true })
          const { mission } = yield* frozenIn(project.id, main)
          return { mission, known: git(api, 'rev-parse', `origin/${DEFAULT_BASE_BRANCH}`) }
        }),
      ),
    )
    const [api] = seen.mission.freeze?.bases ?? []
    expect(api?.commit).toBe(seen.known)
    expect(Predicate.isTagged(api?.freshness, 'NotFetchedSince')).toBe(true)
  })

  test('after the Freeze every Spec, Proof and task tool is refused with the frozen sentence; spec_read reads the frozen version', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission } = yield* frozenIn(project.id, main)
          const grantId = yield* plannerGrant(mission.id, main)
          const answers = [
            yield* call(grantId, 'spec_write_section', {
              section: 'risks',
              content: 'Late.',
              base_version: 1,
            }),
            yield* call(grantId, 'requirement_write', {
              domain: 'invoices',
              delta: 'added',
              text: 'Late.',
              scenarios: [{ when: 'late', then: 'late' }],
            }),
            yield* call(grantId, 'requirement_remove', { id: 'R1', base_version: 1 }),
            yield* call(grantId, 'proof_write', {
              scenario: 'R1.S1',
              proof: {
                mode: 'by_hand',
                actions: ['Late'],
                starting_data: 'None.',
                expected: 'Late.',
                seen_today: false,
              },
              base_version: 1,
            }),
            yield* call(grantId, 'tasks_write', { tasks: [EXPORT_TASK], base_version: 1 }),
            yield* call(grantId, 'model_recommend', {
              agent: 'codex',
              model: 'gpt-large',
              reason: 'Late.',
            }),
          ]
          const read = yield* call(grantId, 'spec_read', {})
          return { answers, read, spec: yield* readSpec(mission.id) }
        }),
      ),
    )
    // Each refused, its sentence the write rule's; the proof and the tasks list it among their problems.
    for (const answer of seen.answers) {
      expect(answer).toMatch(/^refused: /)
      expect(answer).toContain('ACME-1 is Ready: the Spec is frozen and nothing writes it.')
    }
    expect(seen.spec.version).toBe(11)
    expect(seen.read).toContain('version 11')
  })

  test('a return to Planning unfreezes, opens a new cycle whose declaration launches a cold read, and hands a fresh Planner [hemera:update]; a new Freeze is needed', async () => {
    const { world, run } = freezing((index) => (index === 1 ? QUIET : reading()))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, version } = yield* frozenIn(project.id, main)
          const back = yield* returnToPlanning(
            mission.id,
            'The export must also cover credit notes.',
          )
          const [planner] = yield* (function* () {
            yield* until(Effect.map(sessionsOf(mission.id, 'planner'), (rows) => rows.length === 1))
            return yield* sessionsOf(mission.id, 'planner')
          })()
          yield* until(Effect.sync(() => (world.agents[1]?.answers.prompts.length ?? 0) > 0))
          const spec = yield* readSpec(mission.id)
          const again = yield* Effect.result(freezeMission(mission.id, spec.version))
          const grantId = yield* grantOf(planner?.id ?? '')
          yield* call(grantId, 'spec_write_section', {
            section: 'goals',
            content: 'Export the invoices and the credit notes.',
            base_version: 1,
          })
          yield* declare(grantId)
          yield* passIn(mission.id, 2, ['done'])
          const next = (yield* readSpec(mission.id)).version
          const refrozen = yield* freezeMission(mission.id, next)
          return {
            back,
            version,
            spec,
            again,
            refrozen,
            passes: yield* listColdReads(mission.id),
            returned: yield* eventsOf(mission.id, 'planning.returned'),
            told: yield* plannerDeliveries(mission.id, 'update'),
          }
        }),
      ),
    )
    expect(seen.back.stage).toBe('planning')
    expect(seen.back.frozen).toBe(false)
    expect(seen.back.freeze).toBeNull()
    expect(seen.spec.frozen).toBe(false)
    expect(seen.spec.declaredCompleteVersion).toBeNull()
    expect(seen.spec.version).toBe(seen.version + 1)
    expect(refusedWith(seen.again)).toContain(
      'The Planner has not declared the Spec of ACME-1 complete yet.',
    )
    expect(seen.passes.map((one) => [one.label, one.cycle])).toEqual([
      ['C1', 1],
      ['C2', 2],
    ])
    expect(seen.refrozen.stage).toBe('ready')
    expect(seen.returned).toHaveLength(1)
    expect(seen.told).toHaveLength(1)
    const prompts = (world.agents[1]?.answers.prompts ?? [])
      .map((blocks) => text(blocks))
      .join('\n')
    expect(prompts).toContain('[hemera:update]')
    expect(prompts).toContain('Their reason: The export must also cover credit notes.')
  })
})

describe('Dependencies between missions', () => {
  test('dependency_propose is refused for another Project’s mission, for the mission itself, and when it would close a cycle, named', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const other = yield* acmeAt(join(work, 'beta'))
          const one = yield* plannedIn(project.id, main)
          const two = yield* plannedIn(project.id, main, 'Import the invoices')
          const foreign = yield* plannedIn(other.project.id, other.main, 'Mail the invoices')
          const propose = (grantId: string, key: string) =>
            call(grantId, 'dependency_propose', { mission: key, reason: 'It needs the CSV.' })
          const answers = {
            foreign: yield* propose(one.grantId, foreign.mission.key),
            itself: yield* propose(one.grantId, 'ACME-1'),
            unknown: yield* propose(one.grantId, 'ACME-99'),
            proposed: yield* propose(one.grantId, 'ACME-2'),
            again: yield* propose(one.grantId, 'ACME-2'),
            cycle: yield* propose(two.grantId, 'ACME-1'),
          }
          return { answers, listed: yield* dependenciesOf(one.mission.id) }
        }),
      ),
    )
    expect(seen.answers).toEqual({
      foreign: 'refused: BETA-1 is a mission of another Project, and nothing crosses Projects.',
      itself: 'refused: a mission cannot depend on itself.',
      unknown: 'refused: no mission is ACME-99.',
      proposed:
        'Proposed: ACME-1 cannot be built before ACME-2 is delivered. The user accepts or rejects it.',
      again: 'ACME-1 already has this dependency on ACME-2 (proposed): nothing changed.',
      cycle: 'refused: it would close a cycle of dependencies: ACME-2 → ACME-1 → ACME-2.',
    })
    expect(seen.listed.dependsOn.map((one) => [one.dependsOnKey, one.state, one.reason])).toEqual([
      ['ACME-2', 'proposed', 'It needs the CSV.'],
    ])
  })

  test('accepted, it marks the Ready mission "blocked by ACME-2"; ACME-2 reaching Done lifts it, writes mission.unblocked, tells "can be built", creates no need, starts nothing, and writes dependency.done', async () => {
    const { world, run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.scoped(
          Effect.gen(function* () {
            const { project, main } = yield* acme()
            const two = yield* plannedIn(project.id, main, 'Import the invoices')
            const one = yield* plannedIn(project.id, main)
            yield* call(one.grantId, 'dependency_propose', {
              mission: 'ACME-1',
              reason: 'It exports what ACME-1 imports.',
            })
            const [dependency] = (yield* dependenciesOf(one.mission.id)).dependsOn
            const accepted = yield* decideDependency(dependency?.id ?? '', true)
            yield* plannerTook(one.mission.id)
            const integrated = yield* call(one.grantId, 'input_integrated', {
              id: 'I1',
              where: 'decisions',
            })
            const version = yield* settledSpec(one.mission.id, one.grantId)
            const frozen = yield* freezeMission(one.mission.id, version)
            const committed = yield* DomainEvents.use((events) => events.subscribe)
            const told = yield* Stream.take(noticesOf(REGISTRY, committed), 1).pipe(
              Stream.runCollect,
              Effect.forkScoped,
            )
            const agents = world.agents.length
            // ACME-1 (the dependency) is built and delivered.
            yield* moveMission(two.mission.id, 'freeze', 'user')
            yield* delivered(two.mission.id)
            yield* until(
              Effect.map(
                eventsOf(one.mission.id, 'mission.unblocked'),
                (rows) => rows.length === 1,
              ),
            )
            return {
              accepted,
              integrated,
              frozen,
              after: yield* getMission(one.mission.id),
              done: yield* eventsOf(one.mission.id, 'dependency.done'),
              moved: yield* eventsOf(one.mission.id, 'mission.moved'),
              notices: yield* Fiber.join(told),
              agents,
              agentsAfter: world.agents.length,
            }
          }),
        ),
      ),
    )
    expect(seen.accepted.state).toBe('accepted')
    expect(seen.integrated).toBe('I1 is integrated (decisions).')
    expect(seen.frozen.stage).toBe('ready')
    expect(marksOf(seen.frozen)).toEqual(['blocked by ACME-1'])
    expect(seen.frozen.ball).toEqual(
      Blocked.make({ causes: [Dependency.make({ missionKey: 'ACME-1' })] }),
    )
    expect(seen.after.stage).toBe('ready')
    expect(marksOf(seen.after)).toEqual([])
    expect(seen.after.needs).toEqual([])
    expect(seen.after.ball).toEqual(Idle.make({}))
    expect(seen.done).toHaveLength(1)
    // One move, the Freeze's: the lift started nothing.
    expect(seen.moved).toHaveLength(1)
    expect(seen.moved[0]?.payload).toContain('"to":"ready"')
    const [notice] = [...seen.notices]
    expect(Predicate.isTagged(notice, 'NoticeRaised')).toBe(true)
    if (notice !== undefined && Predicate.isTagged(notice, 'NoticeRaised')) {
      expect(notice.notice).toMatchObject({
        kind: 'can-be-built',
        missionKey: 'ACME-2',
        what: 'it can be built: ACME-1 is delivered',
      })
    }
    expect(seen.agentsAfter).toBe(seen.agents)
  })

  test('the mission it depends on cancelled: the block is lifted and the dependent marked outdated, dependency-cancelled', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const two = yield* plannedIn(project.id, main, 'Import the invoices')
          const one = yield* plannedIn(project.id, main)
          yield* call(one.grantId, 'dependency_propose', {
            mission: 'ACME-1',
            reason: 'It exports what ACME-1 imports.',
          })
          const [dependency] = (yield* dependenciesOf(one.mission.id)).dependsOn
          yield* decideDependency(dependency?.id ?? '', true)
          yield* plannerTook(one.mission.id)
          yield* call(one.grantId, 'input_integrated', { id: 'I1', where: 'decisions' })
          const version = yield* settledSpec(one.mission.id, one.grantId)
          const frozen = yield* freezeMission(one.mission.id, version)
          yield* moveMission(two.mission.id, 'cancel', 'user')
          yield* until(
            Effect.map(eventsOf(one.mission.id, 'mission.outdated'), (rows) => rows.length === 1),
          )
          return {
            frozen,
            after: yield* getMission(one.mission.id),
            done: yield* eventsOf(one.mission.id, 'dependency.done'),
            unblocked: yield* eventsOf(one.mission.id, 'mission.unblocked'),
          }
        }),
      ),
    )
    expect(marksOf(seen.frozen)).toEqual(['blocked by ACME-1'])
    expect(seen.after.stage).toBe('ready')
    expect(seen.after.marks.map((one) => one.mark)).toEqual([
      OutdatedMark.make({
        reason: 'dependency-cancelled',
        reference: 'ACME-1',
        difference: 'ACME-1 was cancelled: ACME-2 no longer waits on it.',
      }),
    ])
    // It was not delivered: nothing says it can be built on it.
    expect(seen.done).toEqual([])
    expect(seen.unblocked).toEqual([])
  })

  test('accepted once the mission it depends on is Done: dependency.done is written at once, and nothing blocks', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const two = yield* plannedIn(project.id, main, 'Import the invoices')
          const one = yield* plannedIn(project.id, main)
          const three = yield* plannedIn(project.id, main, 'Mail the invoices')
          const propose = (grantId: string) =>
            call(grantId, 'dependency_propose', {
              mission: 'ACME-1',
              reason: 'It exports what ACME-1 imports.',
            })
          yield* propose(one.grantId)
          // ACME-3's, accepted before: what ACME-1's Done lifted is seen on it.
          yield* propose(three.grantId)
          const [early] = (yield* dependenciesOf(three.mission.id)).dependsOn
          yield* decideDependency(early?.id ?? '', true)
          yield* moveMission(two.mission.id, 'freeze', 'user')
          yield* delivered(two.mission.id)
          yield* until(
            Effect.map(eventsOf(three.mission.id, 'dependency.done'), (rows) => rows.length === 1),
          )
          const [dependency] = (yield* dependenciesOf(one.mission.id)).dependsOn
          yield* decideDependency(dependency?.id ?? '', true)
          return {
            after: yield* getMission(one.mission.id),
            done: yield* eventsOf(one.mission.id, 'dependency.done'),
          }
        }),
      ),
    )
    expect(seen.done).toHaveLength(1)
    expect(marksOf(seen.after)).toEqual([])
  })

  test('proposed and not decided, it holds the Freeze back, named', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          yield* plannedIn(project.id, main, 'Import the invoices')
          const one = yield* plannedIn(project.id, main)
          yield* call(one.grantId, 'dependency_propose', {
            mission: 'ACME-1',
            reason: 'It needs it.',
          })
          const version = yield* settledSpec(one.mission.id, one.grantId)
          return {
            readiness: yield* freezeReadiness(one.mission.id),
            frozen: yield* Effect.result(freezeMission(one.mission.id, version)),
          }
        }),
      ),
    )
    const reason = 'ACME-2’s dependency on ACME-1 waits on your decision.'
    expect(seen.readiness.ready).toBe(false)
    expect(seen.readiness.unsettled).toEqual([reason])
    expect(refusedWith(seen.frozen)).toEqual([reason])
  })

  test('accepted in Ready, it blocks at once; two decisions at once decide once; a decided one is not decided again', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          yield* plannedIn(project.id, main, 'Import the invoices')
          const one = yield* plannedIn(project.id, main)
          yield* call(one.grantId, 'dependency_propose', {
            mission: 'ACME-1',
            reason: 'It needs it.',
          })
          // Moved to Ready by the stage machine alone: a Freeze waits on the user's decision.
          const frozen = yield* moveMission(one.mission.id, 'freeze', 'user')
          const [dependency] = (yield* dependenciesOf(one.mission.id)).dependsOn
          const both = yield* Effect.all(
            [
              Effect.result(decideDependency(dependency?.id ?? '', true)),
              Effect.result(decideDependency(dependency?.id ?? '', true)),
            ],
            { concurrency: 'unbounded' },
          )
          return {
            frozen,
            both,
            after: yield* getMission(one.mission.id),
            decided: yield* eventsOf(one.mission.id, 'dependency.decided'),
            inputs: yield* eventsOf(one.mission.id, 'planning.inputs_delivered'),
          }
        }),
      ),
    )
    expect(marksOf(seen.frozen)).toEqual([])
    expect(seen.both.filter(Result.isSuccess)).toHaveLength(1)
    const [refused] = seen.both.filter(Result.isFailure)
    expect(refused?.failure.message).toBe('The dependency on ACME-1 is already accepted.')
    expect(marksOf(seen.after)).toEqual(['blocked by ACME-1'])
    expect(seen.decided).toHaveLength(1)
  })

  test('rejected, it blocks nothing, reaches the Planner as no input, and is not proposed again', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          yield* plannedIn(project.id, main, 'Import the invoices')
          const one = yield* plannedIn(project.id, main)
          yield* call(one.grantId, 'dependency_propose', {
            mission: 'ACME-1',
            reason: 'It needs it.',
          })
          const [dependency] = (yield* dependenciesOf(one.mission.id)).dependsOn
          const rejected = yield* decideDependency(dependency?.id ?? '', false)
          const again = yield* call(one.grantId, 'dependency_propose', {
            mission: 'ACME-1',
            reason: 'It needs it after all.',
          })
          const version = yield* settledSpec(one.mission.id, one.grantId)
          const readiness = yield* freezeReadiness(one.mission.id)
          const frozen = yield* freezeMission(one.mission.id, version)
          return {
            rejected,
            again,
            readiness,
            frozen,
            inputs: yield* plannerDeliveries(one.mission.id, 'dependency'),
          }
        }),
      ),
    )
    expect(seen.rejected.state).toBe('rejected')
    expect(seen.again).toBe('refused: the user rejected the dependency on ACME-1.')
    expect(seen.readiness.dependencies.map((one) => [one.dependsOnKey, one.state])).toEqual([
      ['ACME-1', 'rejected'],
    ])
    expect(seen.inputs).toEqual([])
    expect(marksOf(seen.frozen)).toEqual([])
  })

  test('dependencies.list gives both directions', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const one = yield* plannedIn(project.id, main)
          yield* plannedIn(project.id, main, 'Import the invoices')
          yield* call(one.grantId, 'dependency_propose', {
            mission: 'ACME-2',
            reason: 'It needs it.',
          })
          const [two] = (yield* dependenciesOf(one.mission.id)).dependsOn
          return { two: yield* dependenciesOf(two?.dependsOnId ?? '') }
        }),
      ),
    )
    expect(seen.two.dependsOn).toEqual([])
    expect(seen.two.dependedOnBy.map((one) => [one.missionKey, one.dependsOnKey])).toEqual([
      ['ACME-1', 'ACME-2'],
    ])
  })

  test('relies_on_write is refused for a dependency not accepted or a requirement it does not have, and kept in the Spec otherwise', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          yield* plannedIn(project.id, main, 'Import the invoices')
          const one = yield* plannedIn(project.id, main)
          yield* writeComplete(one.grantId)
          yield* call(one.grantId, 'dependency_propose', {
            mission: 'ACME-1',
            reason: 'It needs it.',
          })
          const relies = (requirement: string, base: number) =>
            call(one.grantId, 'relies_on_write', {
              requirement,
              dependency: 'ACME-1',
              their_requirement: 'R2',
              their_version: 3,
              base_version: base,
            })
          const proposed = yield* relies('R1', 1)
          const [dependency] = (yield* dependenciesOf(one.mission.id)).dependsOn
          yield* decideDependency(dependency?.id ?? '', true)
          const missing = yield* relies('R9', 1)
          const kept = yield* relies('R1', 1)
          const stale = yield* relies('R1', 1)
          return { proposed, missing, kept, stale, spec: yield* readSpec(one.mission.id) }
        }),
      ),
    )
    expect(seen.proposed).toBe('refused: ACME-1 is not an accepted dependency of ACME-2.')
    expect(seen.missing).toBe('refused: the Spec has no requirement R9.')
    expect(seen.kept).toBe('Kept: R1 relies on ACME-1 R2 (version 3).')
    expect(seen.stale).toMatch(/^refused: .*R1/)
    expect(seen.spec.requirements[0]?.reliesOn).toEqual([
      { dependency: 'ACME-1', requirement: 'R2', version: 3 },
    ])
  })

  test('a dependent mission reads the Memory of a mission it depends on once the user accepted it', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          yield* plannedIn(project.id, main, 'Import the invoices')
          const one = yield* plannedIn(project.id, main)
          const read = () => call(one.grantId, 'memory_read', { part: 'now', mission: 'ACME-1' })
          const before = yield* read()
          yield* call(one.grantId, 'dependency_propose', {
            mission: 'ACME-1',
            reason: 'It needs it.',
          })
          const proposed = yield* read()
          const [dependency] = (yield* dependenciesOf(one.mission.id)).dependsOn
          yield* decideDependency(dependency?.id ?? '', true)
          return { before, proposed, accepted: yield* read() }
        }),
      ),
    )
    expect(seen.before).toBe('refused: this mission does not depend on ACME-1')
    expect(seen.proposed).toBe('refused: this mission does not depend on ACME-1')
    expect(seen.accepted).not.toMatch(/^refused/)
  })
})

describe('Outdated is information', () => {
  test('markOutdated sets the mark with what moved, never moves the stage, expires a pending need that no longer holds; the next Freeze clears it', async () => {
    const { run } = freezing((index) => (index === 1 ? QUIET : reading()))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission } = yield* frozenIn(project.id, main)
          const owner = MissionOwner.make({
            projectId: project.id,
            missionId: mission.id,
            taskId: null,
          })
          const decision = DecisionFields.make({
            question: 'Launch on the old base?',
            options: ['Launch', 'Wait'],
            recommended: null,
          })
          const stale = yield* createNeed(needService('prelaunch'), owner, decision)
          const kept = yield* createNeed(needService('prelaunch'), owner, decision)
          const outdated = yield* markOutdated(mission.id, {
            reason: 'target-moved',
            reference: 'api',
            difference: 'api/invoices.ts changed on main.',
            expiring: [stale.id],
          })
          const back = yield* returnToPlanning(mission.id, null)
          const [planner] = yield* (function* () {
            yield* until(Effect.map(sessionsOf(mission.id, 'planner'), (rows) => rows.length === 1))
            return yield* sessionsOf(mission.id, 'planner')
          })()
          const grantId = yield* grantOf(planner?.id ?? '')
          yield* call(grantId, 'spec_write_section', {
            section: 'risks',
            content: 'api/invoices.ts changed on main.',
            base_version: 1,
          })
          yield* declare(grantId)
          yield* passIn(mission.id, 2, ['done'])
          const refrozen = yield* freezeMission(mission.id, (yield* readSpec(mission.id)).version)
          return {
            outdated,
            back,
            refrozen,
            stale: yield* getNeed(stale.id),
            kept: yield* getNeed(kept.id),
            told: yield* plannerDeliveries(mission.id, 'update'),
            events: yield* eventsOf(mission.id, 'mission.outdated'),
          }
        }),
      ),
    )
    expect(seen.outdated.stage).toBe('ready')
    expect(seen.outdated.marks.map((one) => one.mark)).toEqual([
      OutdatedMark.make({
        reason: 'target-moved',
        reference: 'api',
        difference: 'api/invoices.ts changed on main.',
      }),
    ])
    expect(seen.stale.state).toBe('expired')
    expect(seen.kept.state).toBe('pending')
    expect(seen.events).toHaveLength(1)
    // Still information on the way back; the next Freeze clears it.
    expect(marksOf(seen.back)).toEqual(['outdated'])
    expect(seen.told[0]?.body).toContain('- the code moved: api/invoices.ts changed on main.')
    expect(marksOf(seen.refrozen)).toEqual([])
  })

  test('marked outdated twice on the same reference: the mark says the latest difference', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission } = yield* frozenIn(project.id, main)
          const outdated = (difference: string) =>
            markOutdated(mission.id, {
              reason: 'target-moved',
              reference: 'api',
              difference,
              expiring: [],
            })
          yield* outdated('api/invoices.ts changed on main.')
          return {
            after: yield* outdated('api/invoices.ts and api/export.ts changed on main.'),
            events: yield* eventsOf(mission.id, 'mission.outdated'),
          }
        }),
      ),
    )
    expect(seen.after.marks.map((one) => one.mark)).toEqual([
      OutdatedMark.make({
        reason: 'target-moved',
        reference: 'api',
        difference: 'api/invoices.ts and api/export.ts changed on main.',
      }),
    ])
    expect(seen.events).toHaveLength(2)
  })
})

describe('What runs at once', () => {
  test('two Freezes at once: one freezes, the other is refused; one Freeze kept, one planning.frozen', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* plannedIn(project.id, main)
          const version = yield* settledSpec(mission.id, grantId)
          const both = yield* Effect.all(
            [
              Effect.result(freezeMission(mission.id, version)),
              Effect.result(freezeMission(mission.id, version)),
            ],
            { concurrency: 'unbounded' },
          )
          const database = yield* Database
          return {
            both,
            rows: yield* database.select().from(freezes),
            events: yield* eventsOf(mission.id, 'planning.frozen'),
          }
        }),
      ),
    )
    expect(seen.both.filter(Result.isSuccess)).toHaveLength(1)
    const [refused] = seen.both.filter(Result.isFailure)
    expect(refusedWith(refused)).toEqual([
      'ACME-1 is Ready: the Freeze is for a mission in Planning.',
    ])
    expect(seen.rows).toHaveLength(1)
    expect(seen.events).toHaveLength(1)
  })

  /**
   * A Freeze held as it reads the dirty files, after its fetch and before its transaction: what the
   * test runs meanwhile lands first; what it runs after the release, after.
   */
  const heldFreeze = () => {
    const gate = { reached: false, ...held() }
    const snapshots = Layer.effect(
      FileSnapshots,
      Effect.gen(function* () {
        const real = yield* FileSnapshots
        return {
          ...real,
          capture: (read: SnapshotRepository, files: ReadonlyArray<DirtyFile>) =>
            Effect.andThen(
              Effect.promise(() => {
                gate.reached = true
                return gate.promise
              }),
              real.capture(read, files),
            ),
        }
      }),
    ).pipe(Layer.provide(databaseSnapshots))
    /** The Freeze forked and held; the checkout dirty, so its files are read. */
    const start = (api: string, missionId: string, version: number) =>
      Effect.gen(function* () {
        writeFileSync(join(api, 'export.ts'), 'export const csv = () => ""\n')
        const fiber = yield* Effect.forkChild(Effect.result(freezeMission(missionId, version)))
        yield* until(Effect.sync(() => gate.reached))
        return fiber
      })
    return { gate, snapshots, start }
  }

  test('a Freeze, then a new Spec version: the Freeze lands, the write is refused as frozen', async () => {
    const freeze = heldFreeze()
    const { run } = freezing(undefined, { snapshots: freeze.snapshots })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acme()
          const { mission, grantId } = yield* plannedIn(project.id, main)
          const version = yield* settledSpec(mission.id, grantId)
          const fiber = yield* freeze.start(api, mission.id, version)
          freeze.gate.release()
          const frozen = yield* Fiber.join(fiber)
          // The Freeze stopped the Planner's tree: a Planner opened after it writes.
          const late = yield* plannerGrant(mission.id, main)
          const written = yield* call(late, 'spec_write_section', {
            section: 'risks',
            content: 'A large export may be slow.',
            base_version: 1,
          })
          return { frozen, written, spec: yield* readSpec(mission.id) }
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => freeze.gate.release()))),
    )
    expect(Result.isSuccess(seen.frozen)).toBe(true)
    if (Result.isSuccess(seen.frozen)) expect(seen.frozen.success.freeze?.version).toBe(11)
    expect(seen.written).toBe('refused: ACME-1 is Ready: the Spec is frozen and nothing writes it.')
    expect(seen.spec.version).toBe(11)
  })

  test('a new Spec version while a Freeze reads the checkout: the write lands, the Freeze is refused', async () => {
    const freeze = heldFreeze()
    const { run } = freezing(undefined, { snapshots: freeze.snapshots })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acme()
          const { mission, grantId } = yield* plannedIn(project.id, main)
          const version = yield* settledSpec(mission.id, grantId)
          const fiber = yield* freeze.start(api, mission.id, version)
          const written = yield* call(grantId, 'spec_write_section', {
            section: 'risks',
            content: 'A large export may be slow.',
            base_version: 1,
          })
          freeze.gate.release()
          const frozen = yield* Fiber.join(fiber)
          return { frozen, written, spec: yield* readSpec(mission.id) }
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => freeze.gate.release()))),
    )
    expect(seen.written).not.toMatch(/^refused/)
    expect(refusedWith(seen.frozen)).toEqual([
      'The Spec changed since you read it: read what changed, then freeze.',
    ])
    expect(seen.spec.version).toBe(12)
    expect(seen.spec.frozen).toBe(false)
  })

  test('a Freeze, then another cold-read pass: the Freeze lands, the pass is refused', async () => {
    const freeze = heldFreeze()
    const { run } = freezing(undefined, { snapshots: freeze.snapshots })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acme()
          const { mission, grantId } = yield* plannedIn(project.id, main)
          const version = yield* settledSpec(mission.id, grantId)
          const fiber = yield* freeze.start(api, mission.id, version)
          freeze.gate.release()
          const frozen = yield* Fiber.join(fiber)
          const pass = yield* Effect.result(againColdRead(mission.id))
          return { frozen, pass, after: yield* getMission(mission.id) }
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => freeze.gate.release()))),
    )
    expect(Result.isSuccess(seen.frozen)).toBe(true)
    expect(Result.isFailure(seen.pass)).toBe(true)
    expect(seen.after.stage).toBe('ready')
  })

  test('another cold-read pass while a Freeze reads the checkout: the pass is recorded, the Freeze refused naming it', async () => {
    const freeze = heldFreeze()
    const reader = held()
    const { run } = freezing(
      (index) => (index === 0 ? reading() : { ...reading(), between: () => reader.promise }),
      { snapshots: freeze.snapshots },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acme()
          const { mission, grantId } = yield* plannedIn(project.id, main)
          const version = yield* settledSpec(mission.id, grantId)
          const fiber = yield* freeze.start(api, mission.id, version)
          const pass = yield* Effect.result(againColdRead(mission.id))
          freeze.gate.release()
          const frozen = yield* Fiber.join(fiber)
          return { frozen, pass, after: yield* getMission(mission.id) }
        }),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            freeze.gate.release()
            reader.release()
          }),
        ),
      ),
    )
    expect(Result.isSuccess(seen.pass)).toBe(true)
    expect(refusedWith(seen.frozen)?.[0]).toMatch(/^Cold read C2 /)
    expect(seen.after.stage).toBe('planning')
  })

  test('a discussion opened while a Freeze reads the checkout waits for it, then is refused on the Ready mission', async () => {
    const freeze = heldFreeze()
    const { run } = freezing(undefined, { snapshots: freeze.snapshots })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acme()
          const { mission, grantId } = yield* plannedIn(project.id, main)
          const version = yield* settledSpec(mission.id, grantId)
          const fiber = yield* freeze.start(api, mission.id, version)
          const locked = missionLocksKept()
          const opening = yield* Effect.forkChild(
            Effect.result(
              openDiscussion(
                mission.id,
                { kind: 'requirement', id: 'R1' },
                'Why CSV and not a spreadsheet?',
              ),
            ),
          )
          freeze.gate.release()
          const frozen = yield* Fiber.join(fiber)
          const opened = yield* Fiber.join(opening)
          return { locked, frozen, opened, kept: missionLocksKept() }
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => freeze.gate.release()))),
    )
    expect(seen.locked).toBe(1)
    expect(Result.isSuccess(seen.frozen)).toBe(true)
    expect(Result.isFailure(seen.opened)).toBe(true)
    expect(seen.kept).toBe(0)
  })

  test('a dependency reaching Done while its dependent is frozen: the dependent ends Ready and not blocked, dependency.done written once', async () => {
    const { run } = freezing()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const two = yield* plannedIn(project.id, main, 'Import the invoices')
          const one = yield* plannedIn(project.id, main)
          yield* call(one.grantId, 'dependency_propose', {
            mission: 'ACME-1',
            reason: 'It needs it.',
          })
          const version = yield* settledSpec(one.mission.id, one.grantId)
          const [dependency] = (yield* dependenciesOf(one.mission.id)).dependsOn
          yield* decideDependency(dependency?.id ?? '', true)
          yield* plannerTook(one.mission.id)
          yield* call(one.grantId, 'input_integrated', { id: 'I1', where: 'decisions' })
          yield* declare(one.grantId)
          yield* moveMission(two.mission.id, 'freeze', 'user')
          yield* moveMission(two.mission.id, 'launch', 'user')
          yield* moveMission(two.mission.id, 'endBuilding', 'hemera')
          yield* moveMission(two.mission.id, 'ship', 'user')
          yield* Effect.all(
            [
              freezeMission(one.mission.id, version),
              moveMission(two.mission.id, 'complete', 'hemera'),
            ],
            { concurrency: 'unbounded' },
          )
          yield* until(
            Effect.map(eventsOf(one.mission.id, 'dependency.done'), (rows) => rows.length === 1),
          )
          return {
            after: yield* getMission(one.mission.id),
            done: yield* eventsOf(one.mission.id, 'dependency.done'),
          }
        }),
      ),
    )
    expect(seen.after.stage).toBe('ready')
    expect(marksOf(seen.after)).toEqual([])
    expect(seen.done).toHaveLength(1)
  })

  test('two returns to Planning at once: one moves, the other is refused; one new cycle, one update', async () => {
    const { run } = freezing((index) => (index === 1 ? QUIET : reading()))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission } = yield* frozenIn(project.id, main)
          const both = yield* Effect.all(
            [
              Effect.result(returnToPlanning(mission.id, null)),
              Effect.result(returnToPlanning(mission.id, null)),
            ],
            { concurrency: 'unbounded' },
          )
          const database = yield* Database
          const [row] = yield* database
            .select({ cycle: missions.planningCycle })
            .from(missions)
            .where(eq(missions.id, mission.id))
          return {
            both,
            cycle: row?.cycle,
            returned: yield* eventsOf(mission.id, 'planning.returned'),
            told: yield* plannerDeliveries(mission.id, 'update'),
          }
        }),
      ),
    )
    expect(seen.both.filter(Result.isSuccess)).toHaveLength(1)
    const [refused] = seen.both.filter(Result.isFailure)
    expect(refused?.failure.message).toMatch(/^Update the Spec is refused: /)
    expect(seen.cycle).toBe(2)
    expect(seen.returned).toHaveLength(1)
    expect(seen.told).toHaveLength(1)
  })

  test('a restart mid-Freeze (after its commit, the Probes’ wipe held): after the start it is Ready and frozen, its Planner is not rebuilt, its Probe is wiped, one planning.frozen', async () => {
    const hold = held()
    const holding = { on: true }
    const cleanup = Layer.succeed(ProbeCleanup, {
      run: () => (holding.on ? Effect.promise(() => hold.promise) : Effect.void),
    })
    const { world, run } = freezing(
      (index) =>
        index === 0
          ? {
              turns: [[uses('toolu_probe_report', 'probe_report', PROBE_REPORT)]],
              steps: [says('Done.')],
            }
          : reading(),
      { probes: { cleanup } },
    )
    const before = await run(({ profile }) =>
      within(
        profile,
        Effect.scoped(
          Effect.gen(function* () {
            const { project, main } = yield* acme()
            const { mission, grantId } = yield* plannedIn(project.id, main)
            yield* call(grantId, 'probe_launch', {
              question: 'does the export keep accents?',
              brief: 'Look at api/invoices.ts.',
            })
            yield* until(Effect.map(probeRowsOf(mission.id), (rows) => rows[0]?.state === 'done'))
            const version = yield* settledSpec(mission.id, grantId)
            yield* Effect.forkScoped(freezeMission(mission.id, version))
            yield* until(Effect.map(getMission(mission.id), (one) => one.stage === 'ready'))
            yield* until(Effect.map(probeRowsOf(mission.id), (rows) => rows[0]?.state === 'wiping'))
            return { mission, planners: yield* sessionsOf(mission.id, 'planner') }
          }),
        ),
      ),
    )
    holding.on = false
    hold.release()
    const agents = world.agents.length
    const after = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(
            Effect.map(probeRowsOf(before.mission.id), (rows) => rows[0]?.state === 'wiped'),
          )
          yield* until(
            Effect.map(getMission(before.mission.id), (one) => one.unstopped.length === 0),
          )
          return {
            mission: yield* getMission(before.mission.id),
            planners: yield* sessionsOf(before.mission.id, 'planner'),
            frozen: yield* eventsOf(before.mission.id, 'planning.frozen'),
          }
        }),
      ),
    )
    expect(before.planners).toHaveLength(1)
    expect(after.mission.stage).toBe('ready')
    expect(after.mission.frozen).toBe(true)
    expect(after.mission.freeze?.version).toBe(11)
    expect(after.planners).toEqual([])
    expect(after.frozen).toHaveLength(1)
    expect(world.agents.length).toBe(agents)
  })

  test('a Freeze whose Probes’ wipe failed, then a return and a new Probe: the next start wipes the old Probe only, and the Planner lives', async () => {
    const failing = { probeId: '' }
    const cleanup = Layer.succeed(ProbeCleanup, {
      run: (probe) =>
        probe.probeId === failing.probeId
          ? Effect.fail(new ProbeWipeFailed({ reason: 'a file of the Probe is locked' }))
          : Effect.void,
    })
    const probing: FakeScript = {
      turns: [[uses('toolu_probe_report', 'probe_report', PROBE_REPORT)]],
      steps: [says('Done.')],
    }
    const { world, run } = freezing(
      (index) => (index === 0 || index === 3 ? probing : index === 1 ? reading() : QUIET),
      { probes: { cleanup } },
    )
    const before = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* plannedIn(project.id, main)
          yield* call(grantId, 'probe_launch', {
            question: 'does the export keep accents?',
            brief: 'Look at api/invoices.ts.',
          })
          yield* until(Effect.map(probeRowsOf(mission.id), (rows) => rows[0]?.state === 'done'))
          failing.probeId = (yield* probeRowsOf(mission.id))[0]?.id ?? ''
          const version = yield* settledSpec(mission.id, grantId)
          const frozen = yield* freezeMission(mission.id, version)
          const back = yield* returnToPlanning(mission.id, null)
          yield* until(Effect.map(sessionsOf(mission.id, 'planner'), (rows) => rows.length === 1))
          const [planner] = yield* sessionsOf(mission.id, 'planner')
          const fresh = yield* grantOf(planner?.id ?? '')
          yield* call(fresh, 'probe_launch', {
            question: 'does the export keep the credit notes?',
            brief: 'Look at api/invoices.ts.',
          })
          yield* until(Effect.map(probeRowsOf(mission.id), (rows) => rows[1]?.state === 'done'))
          return { mission, frozen, back, probes: yield* probeRowsOf(mission.id) }
        }),
      ),
    )
    const agents = world.agents.length
    const after = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          // The start tried the old Probe's wipe again, and rebuilt the Planner.
          yield* until(
            Effect.map(
              probeRowsOf(before.mission.id),
              (rows) => (rows[0]?.wipeAttempts ?? 0) > (before.probes[0]?.wipeAttempts ?? 0),
            ),
          )
          yield* until(Effect.sync(() => world.agents.length > agents))
          return {
            mission: yield* getMission(before.mission.id),
            probes: yield* probeRowsOf(before.mission.id),
            planners: yield* sessionsOf(before.mission.id, 'planner'),
          }
        }),
      ),
    )
    expect(before.frozen.unstopped).toEqual(['probes'])
    expect(before.back.unstopped).toEqual([])
    expect(after.probes.map((one) => one.state)).toEqual(['wiping', 'done'])
    expect(after.mission.stage).toBe('planning')
    expect(after.mission.unstopped).toEqual([])
    expect(after.planners).toHaveLength(1)
  })

  test('a stop between a return’s commit and its hand-over: the start hands [hemera:update] to one fresh Planner, once', async () => {
    const { run } = freezing()
    const before = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          return (yield* frozenIn(project.id, main)).mission
        }),
      ),
    )
    // The engine stopped as the return committed, before its hand-over: what its transaction wrote.
    await on(
      data,
      Effect.gen(function* () {
        const database = yield* Database
        yield* database
          .update(missions)
          .set({ stage: 'planning', planningCycle: 2 })
          .where(eq(missions.id, before.id))
        yield* database
          .update(specs)
          .set({ frozen: false, frozenAt: null, declaredCompleteVersion: null, version: 12 })
          .where(eq(specs.missionId, before.id))
        yield* database.insert(sessionDeliveries).values({
          id: 'update-left',
          ownerKind: 'mission',
          ownerId: before.id,
          targetLineage: null,
          targetRole: 'planner',
          kind: 'update',
          body: maskText('The user sent ACME-1 back to Planning.', []),
          urgency: 'between-turns',
          state: 'queued',
          createdAt: new Date().toISOString(),
        })
      }),
    )
    // The application's own start: the missions in Planning are picked up.
    const started = freezing(() => QUIET, { sessions: { plannerStarts: true } })
    const after = await started.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(
            Effect.map(plannerDeliveries(before.id, 'update'), (rows) =>
              rows.every((row) => row.state === 'sent'),
            ),
          )
          yield* until(
            Effect.sync(() => (started.world.agents[0]?.answers.prompts.length ?? 0) > 0),
          )
          return {
            planners: yield* sessionsOf(before.id, 'planner'),
            told: yield* plannerDeliveries(before.id, 'update'),
          }
        }),
      ),
    )
    expect(after.planners).toHaveLength(1)
    expect(started.world.agents).toHaveLength(1)
    expect(after.told.map((one) => one.state)).toEqual(['sent'])
    const prompts = (started.world.agents[0]?.answers.prompts ?? []).map((blocks) => text(blocks))
    expect(prompts.filter((one) => one.includes('back to Planning'))).toHaveLength(1)
  })

  test('freeze, return, freeze again, then cancel while a stop is owed: each moves once, and the stop stays owed', async () => {
    const cleanup = Layer.succeed(ProbeCleanup, {
      run: () => Effect.fail(new ProbeWipeFailed({ reason: 'a file of the Probe is locked' })),
    })
    // A Probe, the first cold read, the fresh Planner, then the second cold read.
    const scripts: ReadonlyArray<FakeScript> = [
      {
        turns: [[uses('toolu_probe_report', 'probe_report', PROBE_REPORT)]],
        steps: [says('Done.')],
      },
      reading(),
      QUIET,
    ]
    const { run } = freezing((index) => scripts[index] ?? reading(), { probes: { cleanup } })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* plannedIn(project.id, main)
          yield* call(grantId, 'probe_launch', {
            question: 'does the export keep accents?',
            brief: 'Look at api/invoices.ts.',
          })
          yield* until(Effect.map(probeRowsOf(mission.id), (rows) => rows[0]?.state === 'done'))
          const first = yield* freezeMission(mission.id, yield* settledSpec(mission.id, grantId))
          yield* returnToPlanning(mission.id, null)
          yield* until(Effect.map(sessionsOf(mission.id, 'planner'), (rows) => rows.length === 1))
          const [planner] = yield* sessionsOf(mission.id, 'planner')
          const fresh = yield* grantOf(planner?.id ?? '')
          yield* call(fresh, 'spec_write_section', {
            section: 'goals',
            content: 'Export the invoices and the credit notes.',
            base_version: 1,
          })
          yield* declare(fresh)
          yield* passIn(mission.id, 2, ['done'])
          const second = yield* freezeMission(mission.id, (yield* readSpec(mission.id)).version)
          const cancelled = yield* moveMission(mission.id, 'cancel', 'user')
          const database = yield* Database
          return {
            first,
            second,
            cancelled,
            freezes: yield* database
              .select({ cycle: freezes.cycle })
              .from(freezes)
              .where(eq(freezes.missionId, mission.id))
              .orderBy(asc(freezes.frozenAt)),
          }
        }),
      ),
    )
    expect(seen.first.unstopped).toEqual(['probes'])
    expect(seen.second.stage).toBe('ready')
    expect(seen.second.unstopped).toEqual(['probes'])
    expect(seen.freezes.map((one) => one.cycle)).toEqual([1, 2])
    expect(seen.cancelled.stage).toBe('cancelled')
    expect(seen.cancelled.unstopped).toContain('probes')
  })

  test('a stop between a dependency’s Done and its lift: the start lifts the mark once', async () => {
    const { run } = freezing()
    const before = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const two = yield* plannedIn(project.id, main, 'Import the invoices')
          const one = yield* plannedIn(project.id, main)
          yield* call(one.grantId, 'dependency_propose', {
            mission: 'ACME-1',
            reason: 'It needs it.',
          })
          const [dependency] = (yield* dependenciesOf(one.mission.id)).dependsOn
          yield* decideDependency(dependency?.id ?? '', true)
          yield* plannerTook(one.mission.id)
          yield* call(one.grantId, 'input_integrated', { id: 'I1', where: 'decisions' })
          const version = yield* settledSpec(one.mission.id, one.grantId)
          const frozen = yield* freezeMission(one.mission.id, version)
          return { one: one.mission, two: two.mission, frozen }
        }),
      ),
    )
    // The engine stopped as ACME-1 reached Done, before anything followed it.
    await on(
      data,
      Effect.gen(function* () {
        const database = yield* Database
        yield* database
          .update(missions)
          .set({ stage: 'done' })
          .where(eq(missions.id, before.two.id))
      }),
    )
    const after = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(
            Effect.map(eventsOf(before.one.id, 'mission.unblocked'), (rows) => rows.length === 1),
          )
          return {
            mission: yield* getMission(before.one.id),
            done: yield* eventsOf(before.one.id, 'dependency.done'),
          }
        }),
      ),
    )
    expect(marksOf(before.frozen)).toEqual(['blocked by ACME-1'])
    expect(marksOf(after.mission)).toEqual([])
    expect(after.done).toHaveLength(1)
    const again = await run(({ profile }) =>
      within(profile, eventsOf(before.one.id, 'mission.unblocked')),
    )
    expect(again).toHaveLength(1)
  })
})

describe('The Planner is told about the Freeze, the dependencies and updates', () => {
  test('its layer holds the ticket’s paragraph', () => {
    expect(PLANNER_TEMPLATE).toContain('## Freeze, dependencies and updates')
    expect(PLANNER_TEMPLATE).toContain(
      '`[hemera:freeze-refused]` lists what Hemera refused at Freeze: fix it, then declare complete\n  again.',
    )
  })
})
