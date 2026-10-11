/**
 * The living spec (#93): its store and versioned writes, its bootstrap by a session of the
 * `living-spec` role, the user's validation, and the delta rules on the Planner's requirements,
 * on the engine as it starts, with the fake agent of #32 scripting every agent (never a real
 * one), a temporary data folder, and a temporary Git repository as the Project's main checkout.
 */

import { realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { SPEC_SECTIONS } from '@hemera/core/domain'
import { type LivingPending, livingSeen } from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Exit, Fiber, Predicate, type Schema, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript, FakeStep } from '../src/engine/agents/fake.ts'
import { projectLimits, setProjectLimits } from '../src/engine/budget.ts'
import { LivingSpec, NOT_DONE } from '../src/engine/living-spec/service.ts'
import {
  type LivingBy,
  domainsOf,
  dropRequirement,
  finishRun,
  modifyRequirement,
  proposeDomain,
  proposeRequirement,
  rejectDomain,
  removeRequirement,
  requirementDetail,
  requirementsOf,
  validateDomain,
} from '../src/engine/living-spec/store.ts'
import { createMission } from '../src/engine/missions.ts'
import { wholeJournal } from '../src/engine/memory/journal.ts'
import { getNeed, listNeeds, retryNeed } from '../src/engine/needs.ts'
import { readSpec } from '../src/engine/planning/store.ts'
import { createProject } from '../src/engine/projects.ts'
import { setRoleSetting } from '../src/engine/sessions/cascade.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { getSession, instructionsKept, sessionsIn } from '../src/engine/sessions/store.ts'
import { threadOf } from '../src/engine/sessions/thread.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  domainEvents,
  livingDomains,
  livingHistory,
  livingRuns,
} from '../src/engine/storage/schema.ts'
import { git, repository } from './repositories.ts'
import { held, sessionsEngine, text, until, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('living-spec'))
  work = realpathSync.native(temporaryFolder('living-spec-work'))
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

const SCENARIO = [{ when: 'the user exports the invoices', then: 'a CSV file is saved' }]

const domain = (name: string, extra: Schema.JsonObject = {}): FakeStep =>
  uses(`toolu_domain_${String((calls += 1))}`, 'living_domain_propose', {
    name,
    summary: `What ${name} covers.`,
    ...extra,
  })

/** Every call its own id: a call with the id of an earlier one is a retry, answered as it was. */
let calls = 0

const requirement = (name: string, words: string, extra: Schema.JsonObject = {}): FakeStep =>
  uses(`toolu_requirement_${String((calls += 1))}`, 'living_requirement_propose', {
    domain: name,
    text: words,
    scenarios: SCENARIO,
    ...extra,
  })

const DONE = uses('toolu_done', 'living_spec_done', { summary: 'Proposed what I read.' })

/** The engine, its agents scripted in their start order; adding a Project starts nothing unless said. */
const living = (
  scriptOf: (index: number) => FakeScript,
  sessions: { readonly livingSpecStarts?: boolean; readonly plannerStarts?: boolean } = {},
) => sessionsEngine(data, scriptOf, { roles: [], sessions })

/** Acme, its main checkout holding the repository `api` with one commit. */
const acme = Effect.suspend(() =>
  Effect.gen(function* () {
    const main = join(work, 'acme')
    const api = repository(join(main, 'api'))
    writeFileSync(join(api, 'invoices.ts'), 'export const invoices = []\n')
    git(api, 'add', '.')
    git(api, 'commit', '-q', '-m', 'invoices')
    const commit = git(api, 'rev-parse', 'HEAD').trim()
    const project = yield* createProject({
      name: 'Acme',
      mainCheckout: main,
      repositories: ['api'],
    })
    return { project, main, commit }
  }),
)

const LIVE = ['starting', 'working', 'idle', 'stuck'] as const

const livingSessions = (projectId: string) =>
  Effect.map(sessionsIn(LIVE, { kind: 'project', projectId }), (rows) =>
    rows.filter((row) => row.role === 'living-spec'),
  )

const runsOf = (projectId: string) => LivingSpec.use((spec) => spec.runs(projectId))

const bootstrap = (projectId: string, domainId: string | null = null) =>
  LivingSpec.use((spec) => spec.bootstrap(projectId, domainId))

/** Waits until the newest run of the Project is in this state. */
const runIs = (projectId: string, state: string) =>
  until(Effect.map(runsOf(projectId), (runs) => runs[0]?.state === state))

/** Waits until no session of the role lives for the Project any more. */
const noLivingSession = (projectId: string) =>
  until(Effect.map(livingSessions(projectId), (rows) => rows.length === 0))

const answersOf = (
  agent:
    | { readonly answers: { readonly toolAnswers: ReadonlyArray<{ readonly text: string }> } }
    | undefined,
) => agent?.answers.toolAnswers.map((one) => one.text) ?? []

/**
 * A living spec written without an agent: a run of its own (no session), its domains and their
 * requirements proposed in order (`LR1`, `LR2`… in that order on a fresh Profile), the run done.
 */
const seeded = (
  projectId: string,
  domains: ReadonlyArray<readonly [string, ReadonlyArray<string>]>,
) =>
  Effect.gen(function* () {
    const database = yield* Database
    const runId = crypto.randomUUID()
    yield* database.insert(livingRuns).values({
      id: runId,
      projectId,
      domainId: null,
      lineage: crypto.randomUUID(),
      state: 'running',
      commits: '[]',
      startedAt: new Date().toISOString(),
    })
    for (const [name, requirements] of domains) {
      yield* proposeDomain(runId, { name, summary: `What ${name} covers.` })
      for (const words of requirements) {
        yield* proposeRequirement(runId, { domain: name, text: words, scenarios: SCENARIO })
      }
    }
    yield* finishRun(runId, 'seeded')
    const written = yield* domainsOf(projectId)
    return new Map(written.map((one) => [one.name, one.id]))
  })

const domainIdOf = (ids: ReadonlyMap<string, string>, name: string) => {
  const id = ids.get(name)
  if (id === undefined) throw new Error(`no domain ${name}`)
  return id
}

/** A run on one domain of the Project, written without an agent, still running. */
const domainRun = (projectId: string, domainId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const runId = crypto.randomUUID()
    yield* database.insert(livingRuns).values({
      id: runId,
      projectId,
      domainId,
      lineage: crypto.randomUUID(),
      state: 'running',
      commits: '[]',
      startedAt: new Date().toISOString(),
    })
    return runId
  })

const historyOf = (id: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(livingHistory)
      .where(eq(livingHistory.requirementId, id))
      .orderBy(asc(livingHistory.sequence))
  })

const eventsOf = (projectId: string, type: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(domainEvents)
      .where(and(eq(domainEvents.entityId, projectId), eq(domainEvents.type, type)))
  })

/** What a re-run proposes on a requirement, by its kind. */
const tagOf = (pending: LivingPending | null) => {
  if (Predicate.isTagged(pending, 'Replace')) return 'Replace'
  return Predicate.isTagged(pending, 'Obsolete') ? 'Obsolete' : null
}

/** What the living spec page shows of a domain: its requirements waiting on the user. */
const shown = (domainId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database.select().from(livingDomains).where(eq(livingDomains.id, domainId))
    if (row === undefined) return []
    return livingSeen(yield* requirementsOf(row.projectId, domainId))
  })

/** The user validates a domain as the page shows it. */
const validate = (domainId: string) =>
  Effect.flatMap(shown(domainId), (seen) => validateDomain(domainId, seen))

/** The user rejects a domain as the page shows it. */
const reject = (domainId: string) =>
  Effect.flatMap(shown(domainId), (seen) => rejectDomain(domainId, seen))

const BY_MISSION: LivingBy = { kind: 'mission', missionId: 'mission-acme-12', round: null }

describe('Adding a Project starts exactly one reading of its living spec', () => {
  test('one run, one session of the living-spec role in the main checkout, read-only, with the commit it reads', async () => {
    const { world, run } = living(
      () => ({
        steps: [
          uses('toolu_write', 'fs_write', { path: 'api/notes.md', content: 'x' }),
          uses('toolu_memory', 'memory_read', {}),
          domain('Invoices'),
          requirement('Invoices', 'The user exports the invoices as CSV.'),
          DONE,
          says('Done.'),
        ],
      }),
      { livingSpecStarts: true },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, commit } = yield* acme
          yield* until(Effect.map(livingSessions(project.id), (rows) => rows.length === 1))
          const [session] = yield* livingSessions(project.id)
          if (session === undefined) return yield* Effect.die(new Error('no session'))
          yield* runIs(project.id, 'done')
          yield* noLivingSession(project.id)
          return {
            main,
            commit,
            session,
            runs: yield* runsOf(project.id),
            instructions: yield* instructionsKept(session.id),
            started: yield* eventsOf(project.id, 'livingSpec.bootstrap_started'),
            finished: yield* eventsOf(project.id, 'livingSpec.bootstrap_finished'),
            ended: yield* getSession(session.id),
          }
        }),
      ),
    )
    expect(seen.runs).toHaveLength(1)
    expect(seen.runs[0]).toMatchObject({
      state: 'done',
      domainId: null,
      summary: 'Proposed what I read.',
      commits: [{ repository: 'api', commit: seen.commit }],
    })
    expect(seen.session).toMatchObject({ role: 'living-spec', folder: seen.main })
    expect(seen.instructions).toContain('the role **the living spec agent**')
    expect(seen.instructions).toContain('# Role: Living spec')
    expect(seen.instructions).toContain("Write in the Project's Spec language, English.")
    const brief = text(world.agents[0]?.answers.prompts[0] ?? [])
    expect(brief).toContain('## Living spec · Acme')
    expect(brief).toContain(`- api at ${seen.commit}`)
    expect(brief).toContain('## Already proposed or validated\n\nNothing yet.')
    const answers = answersOf(world.agents[0])
    expect(answers[0]).toBe('refused: the living spec agent has no tool fs_write')
    expect(answers[1]).toBe('refused: the living spec agent has no tool memory_read')
    expect(seen.started).toHaveLength(1)
    expect(JSON.parse(seen.finished[0]?.payload ?? '{}')).toMatchObject({
      state: 'done',
      sentence: 'The living spec of Acme is ready to review',
    })
    // Its turn settled after living_spec_done: its session ended and freed its slot.
    expect(seen.ended).toMatchObject({ state: 'ended', stateReason: 'its reading is done' })
    expect(world.agents).toHaveLength(1)
  })

  test('a turn that ends without living_spec_done is reminded once, and the reading goes on to its end', async () => {
    const { world, run } = living(() => ({
      turns: [
        [domain('Invoices'), says('I read it all.')],
        [DONE, says('Done.')],
      ],
      steps: [says('Nothing more.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* bootstrap(project.id)
          yield* runIs(project.id, 'done')
          yield* noLivingSession(project.id)
          return { runs: yield* runsOf(project.id) }
        }),
      ),
    )
    expect(seen.runs[0]).toMatchObject({ state: 'done', summary: 'Proposed what I read.' })
    const reminder = text(world.agents[0]?.answers.prompts[1] ?? [])
    expect(reminder).toContain('[hemera:reminder]')
    expect(reminder).toContain('living_spec_done')
    expect(world.agents).toHaveLength(1)
  })

  test('a session that ends its turn without living_spec_done after its reminder ends its run, failed, its proposals kept', async () => {
    const { world, run } = living(() => ({ steps: [domain('Invoices'), says('I read it all.')] }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* bootstrap(project.id)
          yield* runIs(project.id, 'failed')
          yield* noLivingSession(project.id)
          return { runs: yield* runsOf(project.id), domains: yield* domainsOf(project.id) }
        }),
      ),
    )
    expect(seen.runs[0]).toMatchObject({ state: 'failed', sentence: NOT_DONE })
    expect(seen.domains.map((one) => [one.name, one.state])).toEqual([['Invoices', 'proposed']])
    // One reminder, then the end: never a second one.
    const prompts = (world.agents[0]?.answers.prompts ?? []).map((one) => text(one))
    expect(prompts.filter((one) => one.includes('[hemera:reminder]'))).toHaveLength(1)
  })
})

describe('One run at a time per Project', () => {
  test('two bootstraps at once start one run and one session; the other is refused in words', async () => {
    const hold = held()
    const { world, run } = living(() => ({ steps: [DONE], between: () => hold.promise }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const both = yield* Effect.all(
            [Effect.exit(bootstrap(project.id)), Effect.exit(bootstrap(project.id))],
            { concurrency: 'unbounded' },
          )
          const sessions = yield* livingSessions(project.id)
          const runs = yield* runsOf(project.id)
          hold.release()
          yield* runIs(project.id, 'done')
          return { both, sessions, runs }
        }),
      ),
    )
    const refusals = seen.both.filter(Exit.isFailure)
    expect(refusals).toHaveLength(1)
    expect(String(refusals[0]?.cause)).toContain('The living spec of Acme is already being read.')
    expect(seen.sessions).toHaveLength(1)
    expect(seen.runs).toHaveLength(1)
    expect(world.agents).toHaveLength(1)
  })

  test('with the cap full it waits for a slot, refuses a second run meanwhile, and starts once a slot frees', async () => {
    const hold = held()
    const { world, run } = living((index) =>
      index === 0
        ? { steps: [says('Reading.')], between: () => hold.promise }
        : { steps: [domain('Invoices'), DONE] },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const limits = yield* projectLimits(project.id)
          yield* setProjectLimits(project.id, { cap: 1, budget: limits.budget })
          // The Project's only slot is taken by its setup agent, working.
          const setup = yield* Sessions.use((sessions) =>
            sessions.open({
              owner: { kind: 'project', projectId: project.id },
              role: 'setup',
              folder: project.mainCheckout,
            }),
          )
          yield* until(
            Effect.map(sessionsIn(['working']), (rows) => rows.some((one) => one.id === setup.id)),
          )
          yield* bootstrap(project.id)
          yield* runIs(project.id, 'waiting_for_slot')
          const waiting = yield* runsOf(project.id)
          const second = yield* bootstrap(project.id).pipe(Effect.flip)
          const agentsWhileWaiting = world.agents.length
          yield* Sessions.use((sessions) => sessions.end(setup.lineage, 'the test frees the slot'))
          hold.release()
          yield* runIs(project.id, 'done')
          return { waiting, second, agentsWhileWaiting, domains: yield* domainsOf(project.id) }
        }),
      ),
    )
    expect(seen.waiting[0]).toMatchObject({
      state: 'waiting_for_slot',
      sentence: 'waiting for a free slot (1 of 1 in use)',
    })
    expect(seen.second.message).toBe('The living spec of Acme is already being read.')
    expect(seen.agentsWhileWaiting).toBe(1)
    expect(seen.domains.map((one) => one.name)).toEqual(['Invoices'])
  })
})

describe('No model for the living spec: the Project’s need, and nothing starts', () => {
  test('a model that cannot be had gives the Project an environment need; nothing is proposed', async () => {
    const { run } = living(() => ({
      configOptions: [
        {
          id: 'model',
          name: 'model',
          category: 'model',
          type: 'select',
          currentValue: 'large',
          options: [{ value: 'large', name: 'large' }],
        },
      ],
      steps: [domain('Invoices'), DONE],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setRoleSetting('app', null, 'living-spec', {
            agent: 'claude',
            model: 'huge',
            effort: null,
          })
          yield* bootstrap(project.id)
          yield* until(Effect.map(listNeeds, (groups) => groups.length === 1))
          yield* runIs(project.id, 'failed')
          const [group] = yield* listNeeds
          return {
            projectId: project.id,
            need: group?.needs[0],
            runs: yield* runsOf(project.id),
            domains: yield* domainsOf(project.id),
            live: yield* livingSessions(project.id),
          }
        }),
      ),
    )
    expect(seen.need?.owner).toMatchObject({ projectId: seen.projectId })
    expect(seen.need?.owner).not.toHaveProperty('missionId')
    expect(Predicate.isTagged(seen.need?.fields, 'Environment')).toBe(true)
    expect(seen.need?.fields).toMatchObject({ settingsSection: 'models' })
    expect(seen.runs[0]?.state).toBe('failed')
    expect(seen.domains).toEqual([])
    expect(seen.live).toEqual([])
  })
})

describe('A run read again for good leaves nothing behind', () => {
  test('a run superseded by a new one: the need of its session expires, so no Retry brings it back', async () => {
    const { run } = living(() => ({
      configOptions: [
        {
          id: 'model',
          name: 'model',
          category: 'model',
          type: 'select',
          currentValue: 'large',
          options: [{ value: 'large', name: 'large' }],
        },
      ],
      steps: [domain('Invoices'), DONE],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setRoleSetting('app', null, 'living-spec', {
            agent: 'claude',
            model: 'huge',
            effort: null,
          })
          yield* bootstrap(project.id)
          yield* until(Effect.map(listNeeds, (groups) => groups.length === 1))
          const [first] = (yield* listNeeds)[0]?.needs ?? []
          if (first === undefined) return yield* Effect.die(new Error('no need'))
          yield* runIs(project.id, 'failed')
          // The user reads it again from the start: the first run is over for good.
          yield* bootstrap(project.id)
          yield* until(
            Effect.map(listNeeds, (groups) =>
              (groups[0]?.needs ?? []).some((one) => one.id !== first.id),
            ),
          )
          const old = yield* getNeed(first.id)
          const retried = yield* retryNeed(first.id)
          return { old, retried, runs: yield* runsOf(project.id) }
        }),
      ),
    )
    expect(seen.old.state).toBe('expired')
    expect(seen.retried.state).toBe('expired')
    expect(seen.runs.map((one) => one.state)).toEqual(['failed', 'failed'])
  })

  test('a session of a run that is no longer running ends at once when its turn starts', async () => {
    const hold = held()
    const { run } = living(() => ({
      steps: [domain('Accounts'), DONE],
      between: () => hold.promise,
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* seeded(project.id, [['Invoices', []]])
          const database = yield* Database
          const [done] = yield* database.select().from(livingRuns)
          if (done === undefined) return yield* Effect.die(new Error('no run'))
          // Its lineage started again, as a Retry or a change of model would start it.
          const session = yield* Sessions.use((sessions) =>
            sessions.reopen(
              done.lineage,
              {
                owner: { kind: 'project', projectId: project.id },
                role: 'living-spec',
                folder: project.mainCheckout,
              },
              'a test',
            ),
          )
          yield* noLivingSession(project.id)
          hold.release()
          return { ended: yield* getSession(session.id), domains: yield* domainsOf(project.id) }
        }),
      ),
    )
    expect(seen.ended).toMatchObject({ state: 'ended', stateReason: 'its reading has ended' })
    expect(seen.domains.map((one) => one.name)).toEqual(['Invoices'])
  })
})

describe('Stopping a Project’s reading of its living spec', () => {
  test('its run says stopped, its session ends, and nothing it proposes afterwards is kept', async () => {
    const hold = held()
    const { run } = living(() => ({
      steps: [domain('Accounts'), domain('Billing'), DONE],
      between: () => hold.promise,
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* bootstrap(project.id)
          yield* until(Effect.map(livingSessions(project.id), (rows) => rows.length === 1))
          const [session] = yield* livingSessions(project.id)
          if (session === undefined) return yield* Effect.die(new Error('no session'))
          yield* LivingSpec.use((spec) => spec.stop(project.id, 'its Project was removed'))
          yield* noLivingSession(project.id)
          hold.release()
          return {
            runs: yield* runsOf(project.id),
            ended: yield* getSession(session.id),
            finished: yield* eventsOf(project.id, 'livingSpec.bootstrap_finished'),
            domains: yield* domainsOf(project.id),
            again: yield* LivingSpec.use((spec) => spec.stop(project.id, 'once more')),
          }
        }),
      ),
    )
    expect(seen.runs).toHaveLength(1)
    expect(seen.runs[0]).toMatchObject({ state: 'stopped', sentence: 'its Project was removed' })
    expect(seen.ended).toMatchObject({ state: 'ended', stateReason: 'its Project was removed' })
    expect(seen.finished.map((one) => JSON.parse(one.payload ?? '{}'))).toMatchObject([
      { state: 'stopped', reason: 'its Project was removed' },
    ])
    expect(seen.domains.map((one) => one.name)).not.toContain('Billing')
    // Nothing was running any more: a second stop changes nothing.
    expect(seen.again).toBe(false)
  })
})

describe('Proposals are proposals', () => {
  test('stored proposed, of origin bootstrap, with their uncertainty; living_spec_read labels them', async () => {
    const { world, run } = living(() => ({
      steps: [
        domain('Accounts', { uncertainty: 'The admin screens may belong here.' }),
        requirement('Accounts', 'A user signs in with an email and a password.', {
          uncertainty: 'A flag may turn it off.',
        }),
        domain('accounts'),
        requirement('Accounts', 'A user signs in with an email and a password.'),
        requirement('Exports', 'The user exports a report.'),
        uses('toolu_obsolete', 'living_requirement_obsolete', { requirement: 'LR1', reason: 'x' }),
        uses('toolu_read', 'living_spec_read', {}),
        DONE,
      ],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* bootstrap(project.id)
          yield* runIs(project.id, 'done')
          const [accounts] = yield* domainsOf(project.id)
          if (accounts === undefined) return yield* Effect.die(new Error('no domain'))
          return { accounts, requirements: yield* requirementsOf(project.id, accounts.id) }
        }),
      ),
    )
    expect(seen.accounts).toMatchObject({
      name: 'Accounts',
      state: 'proposed',
      uncertainty: 'The admin screens may belong here.',
      proposed: 1,
      validated: 0,
    })
    expect(seen.requirements).toEqual([
      {
        id: 'LR1',
        domainId: seen.accounts.id,
        text: 'A user signs in with an email and a password.',
        scenarios: SCENARIO,
        origin: null,
        state: 'proposed',
        uncertainty: 'A flag may turn it off.',
        version: 1,
        removed: false,
        pending: null,
      },
    ])
    const answers = answersOf(world.agents[0])
    expect(answers[2]).toContain('refused: the living spec already has a domain “Accounts”')
    expect(answers[3]).toBe(
      'refused: Accounts already has it as LR1: never propose a requirement twice.',
    )
    expect(answers[4]).toBe(
      'refused: the living spec has no domain “Exports”: propose it first with living_domain_propose.',
    )
    expect(answers[5]).toBe('refused: living_requirement_obsolete is for a run on one domain only.')
    expect(answers[6]).toContain('## Accounts [proposed]')
    expect(answers[6]).toContain('Uncertain:\n> The admin screens may belong here.')
    expect(answers[6]).toContain('### LR1 (version 1) [proposed] · from bootstrap')
    expect(answers[6]).toContain('Uncertain:\n> A flag may turn it off.')
    expect(answers[6]).toContain('End of LR1 [proposed].')
  })

  test('a domain the user rejected during the run is not proposed again by it; a later run may', async () => {
    const { run } = living(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const database = yield* Database
          const whole = () =>
            Effect.gen(function* () {
              const runId = crypto.randomUUID()
              yield* database.insert(livingRuns).values({
                id: runId,
                projectId: project.id,
                domainId: null,
                lineage: crypto.randomUUID(),
                state: 'running',
                commits: '[]',
                startedAt: new Date().toISOString(),
              })
              return runId
            })
          const first = yield* whole()
          yield* proposeDomain(first, { name: 'Accounts', summary: 'Signing in.' })
          const [accounts] = yield* domainsOf(project.id)
          if (accounts === undefined) return yield* Effect.die(new Error('no domain'))
          yield* reject(accounts.id)
          const again = yield* proposeDomain(first, { name: ' accounts ', summary: 'Signing in.' })
          yield* finishRun(first, 'done')
          const second = yield* whole()
          const later = yield* proposeDomain(second, { name: 'Accounts', summary: 'Signing in.' })
          return { again, later }
        }),
      ),
    )
    expect(seen.again).toEqual({
      refused:
        'refused: the user rejected the domain “Accounts” during this reading: do not propose it again.',
    })
    expect(seen.later).toEqual({ done: 'Accounts' })
  })

  test('a proposal after the run ended is refused, and nothing is written', async () => {
    const { run } = living(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* seeded(project.id, [['Invoices', []]])
          const database = yield* Database
          const [ended] = yield* database.select().from(livingRuns)
          if (ended === undefined) return yield* Effect.die(new Error('no run'))
          return {
            proposed: yield* proposeDomain(ended.id, { name: 'Accounts', summary: 'x' }),
            domains: yield* domainsOf(project.id),
          }
        }),
      ),
    )
    expect(seen.proposed).toEqual({
      refused: 'refused: this reading of the living spec has ended: nothing more is recorded.',
    })
    expect(seen.domains.map((one) => one.name)).toEqual(['Invoices'])
  })
})

describe('The user validates domain by domain', () => {
  test('validateDomain validates one domain and its proposals, and leaves the other proposed', async () => {
    const { run } = living(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const ids = yield* seeded(project.id, [
            ['Invoices', ['The user exports the invoices as CSV.']],
            ['Accounts', ['A user signs in.']],
          ])
          yield* validate(domainIdOf(ids, 'Invoices'))
          return {
            domains: yield* domainsOf(project.id),
            invoices: yield* requirementDetail('LR1'),
            accounts: yield* requirementDetail('LR2'),
            events: yield* eventsOf(project.id, 'livingSpec.domain_validated'),
          }
        }),
      ),
    )
    expect(seen.domains.map((one) => [one.name, one.state, one.proposed, one.validated])).toEqual([
      ['Invoices', 'validated', 0, 1],
      ['Accounts', 'proposed', 1, 0],
    ])
    expect(seen.invoices).toMatchObject({ state: 'validated', version: 1 })
    expect(seen.invoices.history.map((one) => [one.what, one.by, one.versionAfter])).toEqual([
      ['proposed', 'bootstrap', 1],
      ['validated', 'user', 1],
    ])
    expect(seen.accounts.state).toBe('proposed')
    expect(seen.events).toHaveLength(1)
  })

  test('rejectDomain removes its proposed requirements and keeps their history; a validated one stays', async () => {
    const { run } = living(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const ids = yield* seeded(project.id, [
            ['Invoices', ['The user exports the invoices as CSV.']],
            ['Accounts', ['A user signs in.', 'A user signs out.']],
          ])
          yield* validate(domainIdOf(ids, 'Invoices'))
          yield* reject(domainIdOf(ids, 'Accounts'))
          const refused = yield* reject(domainIdOf(ids, 'Invoices')).pipe(Effect.flip)
          return {
            domains: yield* domainsOf(project.id),
            signIn: yield* requirementDetail('LR2'),
            exports: yield* requirementDetail('LR1'),
            refused,
          }
        }),
      ),
    )
    expect(seen.domains.map((one) => one.name)).toEqual(['Invoices'])
    expect(seen.signIn).toMatchObject({ removed: true, version: 2, state: 'proposed' })
    expect(seen.signIn.history.map((one) => [one.what, one.by])).toEqual([
      ['proposed', 'bootstrap'],
      ['rejected', 'user'],
    ])
    expect(seen.exports).toMatchObject({ removed: false, state: 'validated' })
    expect(seen.refused.message).toBe('Invoices has nothing proposed to reject: it is validated.')
  })

  test('dropRequirement drops one proposed requirement and refuses a validated one', async () => {
    const { run } = living(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const ids = yield* seeded(project.id, [
            ['Invoices', ['The user exports the invoices as CSV.']],
            ['Accounts', ['A user signs in.', 'A user signs out.']],
          ])
          yield* validate(domainIdOf(ids, 'Invoices'))
          const refused = yield* dropRequirement('LR1').pipe(Effect.flip)
          yield* dropRequirement('LR3')
          return {
            refused,
            dropped: yield* requirementDetail('LR3'),
            accounts: yield* requirementsOf(project.id, domainIdOf(ids, 'Accounts')),
          }
        }),
      ),
    )
    expect(seen.refused.message).toBe('LR1 is validated: only a proposed requirement is dropped.')
    expect(seen.dropped).toMatchObject({ removed: true })
    expect(seen.dropped.history.at(-1)).toMatchObject({ what: 'dropped', by: 'user' })
    expect(seen.accounts.map((one) => [one.id, one.removed])).toEqual([
      ['LR2', false],
      ['LR3', true],
    ])
  })

  test('two validations at once validate once; a validation and a rejection at once: one wins, the other is refused', async () => {
    const { run } = living(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const ids = yield* seeded(project.id, [
            ['Invoices', ['The user exports the invoices as CSV.']],
            ['Accounts', ['A user signs in.']],
          ])
          const twice = yield* Effect.all(
            [validate(domainIdOf(ids, 'Invoices')), validate(domainIdOf(ids, 'Invoices'))],
            { concurrency: 'unbounded' },
          )
          const raced = yield* Effect.all(
            [
              Effect.exit(validate(domainIdOf(ids, 'Accounts'))),
              Effect.exit(reject(domainIdOf(ids, 'Accounts'))),
            ],
            { concurrency: 'unbounded' },
          )
          return {
            twice,
            raced,
            validated: yield* eventsOf(project.id, 'livingSpec.domain_validated'),
            rejected: yield* eventsOf(project.id, 'livingSpec.domain_rejected'),
            history: yield* historyOf('LR1'),
            accounts: yield* requirementDetail('LR2'),
          }
        }),
      ),
    )
    expect(seen.twice.toSorted()).toEqual([false, true])
    expect(seen.history.map((one) => one.what)).toEqual(['proposed', 'validated'])
    expect(seen.raced.filter(Exit.isSuccess)).toHaveLength(1)
    expect(seen.raced.filter(Exit.isFailure)).toHaveLength(1)
    // Whichever came first, the requirement stands as it left it, and once.
    if (Exit.isSuccess(seen.raced[0])) {
      expect(seen.accounts).toMatchObject({ state: 'validated', removed: false })
      expect(seen.rejected).toHaveLength(0)
    } else {
      expect(seen.accounts).toMatchObject({ state: 'proposed', removed: true })
      expect(seen.rejected).toHaveLength(1)
    }
    expect(seen.validated.length + seen.rejected.length).toBe(2)
  })
})

describe('The user validates or rejects what they saw, nothing more', () => {
  test('a requirement proposed between the read and the validation is not validated: refused in words', async () => {
    const { run } = living(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const ids = yield* seeded(project.id, [['Invoices', ['The user exports as CSV.']]])
          const invoices = domainIdOf(ids, 'Invoices')
          const read = yield* shown(invoices)
          // A reading of the domain proposes one more while the user looks at the first.
          const runId = yield* domainRun(project.id, invoices)
          yield* proposeRequirement(runId, {
            domain: 'Invoices',
            text: 'The user lists invoices by month.',
            scenarios: SCENARIO,
          })
          const validating = yield* validateDomain(invoices, read).pipe(Effect.flip)
          const rejecting = yield* rejectDomain(invoices, read).pipe(Effect.flip)
          return {
            validating,
            rejecting,
            requirements: yield* requirementsOf(project.id, invoices),
            domains: yield* domainsOf(project.id),
          }
        }),
      ),
    )
    const said =
      'Invoices changed since you read it (LR2 was proposed since): look at it again, then decide.'
    expect(seen.validating.message).toBe(said)
    expect(seen.rejecting.message).toBe(said)
    expect(seen.requirements.map((one) => [one.id, one.state, one.removed])).toEqual([
      ['LR1', 'proposed', false],
      ['LR2', 'proposed', false],
    ])
    expect(seen.domains[0]?.state).toBe('proposed')
  })

  test('a replacement proposed again on what the user read is not applied unseen', async () => {
    const { run } = living(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const ids = yield* seeded(project.id, [['Invoices', ['The user exports as CSV.']]])
          const invoices = domainIdOf(ids, 'Invoices')
          yield* validate(invoices)
          const runId = yield* domainRun(project.id, invoices)
          const replace = (words: string) =>
            proposeRequirement(runId, {
              domain: 'Invoices',
              text: words,
              scenarios: SCENARIO,
              replaces: 'LR1',
            })
          yield* replace('The user exports as XLSX.')
          const read = yield* shown(invoices)
          yield* replace('The user exports as JSON.')
          return {
            refused: yield* validateDomain(invoices, read).pipe(Effect.flip),
            detail: yield* requirementDetail('LR1'),
          }
        }),
      ),
    )
    expect(seen.refused.message).toBe(
      'Invoices changed since you read it (the change proposed on LR1 is another): look at it again, then decide.',
    )
    expect(seen.detail).toMatchObject({ version: 1, text: 'The user exports as CSV.' })
  })
})

describe('The living spec as its page follows it', () => {
  test('a normal bootstrap never shows its run failed, from its start to its end', async () => {
    const { run } = living(() => ({ steps: [domain('Invoices'), DONE] }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const states: Array<string | undefined> = []
          const following = yield* LivingSpec.use((spec) =>
            spec
              .changes(project.id)
              .pipe(
                Stream.runForEach((state) => Effect.sync(() => states.push(state.runs[0]?.state))),
              ),
          ).pipe(Effect.forkChild)
          yield* until(Effect.sync(() => states.length === 1))
          yield* bootstrap(project.id)
          yield* until(Effect.sync(() => states.includes('done')))
          yield* Fiber.interrupt(following)
          return states
        }),
      ),
    )
    expect(seen[0]).toBeUndefined()
    expect(seen).toContain('running')
    expect(seen).not.toContain('failed')
  })

  test('changed gives the state now, then again after a validation', async () => {
    const { run } = living(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const ids = yield* seeded(project.id, [['Invoices', ['The user exports as CSV.']]])
          const states: Array<{ readonly domains: ReadonlyArray<{ readonly state: string }> }> = []
          const following = yield* LivingSpec.use((spec) =>
            spec.changes(project.id).pipe(
              Stream.take(2),
              Stream.runForEach((state) => Effect.sync(() => states.push(state))),
            ),
          ).pipe(Effect.forkChild)
          // Subscribed once the first state came: the validation after it is followed.
          yield* until(Effect.sync(() => states.length === 1))
          yield* validate(domainIdOf(ids, 'Invoices'))
          yield* Fiber.join(following)
          return states
        }),
      ),
    )
    expect(seen.map((state) => state.domains.map((one) => one.state))).toEqual([
      ['proposed'],
      ['validated'],
    ])
  })
})

describe('The versioned writes (CT-57)', () => {
  test('a wrong expected version fails with both versions; a write bumps the version and leaves one history row', async () => {
    const { run } = living(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const ids = yield* seeded(project.id, [['Invoices', ['The user exports as CSV.']]])
          yield* validate(domainIdOf(ids, 'Invoices'))
          const stale = yield* modifyRequirement(
            'LR1',
            3,
            { text: 'The user exports as XLSX.', scenarios: SCENARIO },
            BY_MISSION,
          ).pipe(Effect.flip)
          const version = yield* modifyRequirement(
            'LR1',
            1,
            { text: 'The user exports as XLSX.', scenarios: SCENARIO },
            BY_MISSION,
          )
          const removed = yield* removeRequirement('LR1', 2, 'no export any more', BY_MISSION)
          return { stale, version, removed, detail: yield* requirementDetail('LR1') }
        }),
      ),
    )
    expect(Predicate.isTagged(seen.stale, 'LivingRequirementChanged')).toBe(true)
    expect(seen.stale).toMatchObject({ id: 'LR1', expected: 3, current: 1 })
    expect(seen.version).toBe(2)
    expect(seen.removed).toBe(3)
    expect(seen.detail).toMatchObject({
      version: 3,
      removed: true,
      text: 'The user exports as XLSX.',
    })
    expect(
      seen.detail.history.map((one) => [one.what, one.by, one.versionBefore, one.versionAfter]),
    ).toEqual([
      ['proposed', 'bootstrap', null, 1],
      ['validated', 'user', 1, 1],
      ['modified', 'mission', 1, 2],
      ['removed', 'mission', 2, 3],
    ])
    expect(seen.detail.history[2]).toMatchObject({
      textBefore: 'The user exports as CSV.',
      textAfter: 'The user exports as XLSX.',
    })
  })

  test('two writes on the same version at once: one is written, the other meets the new version', async () => {
    const { run } = living(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* seeded(project.id, [['Invoices', ['The user exports as CSV.']]])
          const both = yield* Effect.all(
            [
              Effect.exit(
                modifyRequirement('LR1', 1, { text: 'As XLSX.', scenarios: SCENARIO }, BY_MISSION),
              ),
              Effect.exit(
                modifyRequirement('LR1', 1, { text: 'As JSON.', scenarios: SCENARIO }, BY_MISSION),
              ),
            ],
            { concurrency: 'unbounded' },
          )
          return { both, history: yield* historyOf('LR1') }
        }),
      ),
    )
    expect(seen.both.filter(Exit.isSuccess)).toHaveLength(1)
    const [failed] = seen.both.filter(Exit.isFailure)
    expect(failed === undefined ? null : Exit.isFailure(failed) && String(failed.cause)).toContain(
      'LR1 changed: it is at version 2, not 1.',
    )
    expect(seen.history.filter((one) => one.what === 'modified')).toHaveLength(1)
  })
})

describe('A run on one domain changes nothing until the user validates it', () => {
  test('its replacement and its obsolescence wait, then apply as new versions of origin bootstrap', async () => {
    const { world, run } = living(() => ({
      steps: [
        domain('Exports'),
        requirement('Invoices', 'The user exports the invoices as XLSX.', { replaces: 'LR1' }),
        uses('toolu_obsolete', 'living_requirement_obsolete', {
          requirement: 'LR2',
          reason: 'The monthly list is gone from the code.',
        }),
        DONE,
      ],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const ids = yield* seeded(project.id, [
            [
              'Invoices',
              ['The user exports the invoices as CSV.', 'The user lists invoices by month.'],
            ],
          ])
          const invoices = domainIdOf(ids, 'Invoices')
          yield* validate(invoices)
          yield* bootstrap(project.id, invoices)
          yield* until(Effect.map(runsOf(project.id), (runs) => runs[0]?.state === 'done'))
          const before = yield* requirementsOf(project.id, invoices)
          const domainBefore = yield* domainsOf(project.id)
          yield* validate(invoices)
          return {
            before,
            domainBefore,
            after: yield* requirementsOf(project.id, invoices),
            replaced: yield* requirementDetail('LR1'),
            domains: yield* domainsOf(project.id),
          }
        }),
      ),
    )
    const brief = text(world.agents[0]?.answers.prompts[0] ?? [])
    expect(brief).toContain('Run: one domain.')
    expect(brief).toContain('#### LR1 (version 1) · from bootstrap')
    expect(brief).not.toContain('## Already proposed or validated')
    expect(answersOf(world.agents[0])[0]).toBe(
      'refused: this run reads one domain, Invoices: propose requirements for it, not a domain.',
    )
    expect(seen.domainBefore[0]).toMatchObject({ state: 'proposed', pending: 2 })
    expect(
      seen.before.map((one) => [one.id, one.version, one.removed, tagOf(one.pending)]),
    ).toEqual([
      ['LR1', 1, false, 'Replace'],
      ['LR2', 1, false, 'Obsolete'],
    ])
    expect(seen.before[0]?.text).toBe('The user exports the invoices as CSV.')
    expect(seen.after.map((one) => [one.id, one.version, one.removed, one.pending])).toEqual([
      ['LR1', 2, false, null],
      ['LR2', 2, true, null],
    ])
    expect(seen.after[0]?.text).toBe('The user exports the invoices as XLSX.')
    expect(seen.replaced.history.at(-1)).toMatchObject({
      what: 'modified',
      by: 'bootstrap',
      versionBefore: 1,
      versionAfter: 2,
    })
    expect(seen.domains[0]).toMatchObject({ state: 'validated', pending: 0, validated: 1 })
  })

  test('a change proposed on a version that moved since is cleared: the domain’s other proposals still validate', async () => {
    const { run } = living(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const ids = yield* seeded(project.id, [
            ['Invoices', ['The user exports as CSV.', 'The user lists invoices by month.']],
          ])
          const invoices = domainIdOf(ids, 'Invoices')
          yield* validate(invoices)
          const runId = yield* domainRun(project.id, invoices)
          yield* proposeRequirement(runId, {
            domain: 'Invoices',
            text: 'The user exports as XLSX.',
            scenarios: SCENARIO,
            replaces: 'LR1',
          })
          yield* proposeRequirement(runId, {
            domain: 'Invoices',
            text: 'The user prints an invoice.',
            scenarios: SCENARIO,
          })
          yield* finishRun(runId, 'one replacement, one more')
          // A mission's merge moves LR1 after the re-run proposed its replacement on version 1.
          yield* modifyRequirement(
            'LR1',
            1,
            { text: 'The user exports as JSON.', scenarios: SCENARIO },
            BY_MISSION,
          )
          const moved = yield* requirementDetail('LR1')
          const validated = yield* validate(invoices)
          return {
            moved,
            validated,
            requirements: yield* requirementsOf(project.id, invoices),
            domains: yield* domainsOf(project.id),
            changed: yield* eventsOf(project.id, 'livingSpec.requirement_changed'),
          }
        }),
      ),
    )
    expect(seen.moved).toMatchObject({
      version: 2,
      text: 'The user exports as JSON.',
      pending: null,
    })
    expect(seen.validated).toBe(true)
    expect(
      seen.requirements.map((one) => [one.id, one.version, one.state, one.text, one.pending]),
    ).toEqual([
      ['LR1', 2, 'validated', 'The user exports as JSON.', null],
      ['LR2', 1, 'validated', 'The user lists invoices by month.', null],
      ['LR3', 1, 'validated', 'The user prints an invoice.', null],
    ])
    expect(seen.domains[0]).toMatchObject({ state: 'validated', pending: 0, proposed: 0 })
    // The cleared proposal is said in the change that cleared it.
    expect(
      seen.changed
        .map((one) => JSON.parse(one.payload))
        .find((one) => one.requirement === 'LR1' && one.what === 'modified'),
    ).toMatchObject({ cleared: 'replace' })
  })

  test('a requirement changed by a mission says so; replaced by a re-run and validated, it is of the bootstrap again', async () => {
    const { run } = living(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const ids = yield* seeded(project.id, [['Invoices', ['The user exports as CSV.']]])
          const invoices = domainIdOf(ids, 'Invoices')
          yield* validate(invoices)
          yield* modifyRequirement(
            'LR1',
            1,
            { text: 'The user exports as JSON.', scenarios: SCENARIO },
            { kind: 'mission', missionId: 'mission-acme-12', round: 1 },
          )
          const byMission = yield* requirementDetail('LR1')
          const runId = yield* domainRun(project.id, invoices)
          yield* proposeRequirement(runId, {
            domain: 'Invoices',
            text: 'The user exports as XLSX.',
            scenarios: SCENARIO,
            replaces: 'LR1',
          })
          yield* finishRun(runId, 'one replacement')
          yield* validate(invoices)
          return { byMission, byBootstrap: yield* requirementDetail('LR1') }
        }),
      ),
    )
    expect(seen.byMission.origin).toEqual({ missionId: 'mission-acme-12', key: null, round: 1 })
    expect(seen.byBootstrap).toMatchObject({
      version: 3,
      text: 'The user exports as XLSX.',
      origin: null,
    })
  })

  test('a validation racing a new version: never applied silently on the newer version', async () => {
    const { run } = living(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const ids = yield* seeded(project.id, [['Invoices', ['The user exports as CSV.']]])
          const invoices = domainIdOf(ids, 'Invoices')
          yield* validate(invoices)
          const runId = yield* domainRun(project.id, invoices)
          yield* proposeRequirement(runId, {
            domain: 'Invoices',
            text: 'The user exports as XLSX.',
            scenarios: SCENARIO,
            replaces: 'LR1',
          })
          yield* finishRun(runId, 'one replacement')
          const read = yield* shown(invoices)
          const raced = yield* Effect.all(
            [
              Effect.exit(validateDomain(invoices, read)),
              Effect.exit(
                modifyRequirement(
                  'LR1',
                  1,
                  { text: 'The user exports as JSON.', scenarios: SCENARIO },
                  BY_MISSION,
                ),
              ),
            ],
            { concurrency: 'unbounded' },
          )
          return { raced, detail: yield* requirementDetail('LR1') }
        }),
      ),
    )
    const [validated, modified] = seen.raced
    expect(
      Number(validated !== undefined && Exit.isSuccess(validated)) +
        Number(modified !== undefined && Exit.isSuccess(modified)),
    ).toBe(1)
    expect(seen.detail.version).toBe(2)
    expect(seen.detail.history.filter((one) => one.what === 'modified')).toHaveLength(1)
    if (validated !== undefined && Exit.isSuccess(validated)) {
      // The replacement went first: the mission's write met version 2.
      expect(seen.detail.text).toBe('The user exports as XLSX.')
      expect(
        String(modified !== undefined && Exit.isFailure(modified) && modified.cause),
      ).toContain('LR1 changed: it is at version 2, not 1.')
    } else {
      // The mission's write went first: the replacement proposed on version 1 is cleared, and
      // the user, who saw it, is told the domain changed.
      expect(seen.detail.text).toBe('The user exports as JSON.')
      expect(seen.detail.pending).toBeNull()
      expect(
        String(validated !== undefined && Exit.isFailure(validated) && validated.cause),
      ).toContain('Invoices changed since you read it (LR1 no longer waits)')
    }
  })
})

describe('A bootstrap outlives its session', () => {
  test('a replaced session is briefed with what was proposed and never proposes the same domain twice', async () => {
    const { world, run } = living((index) =>
      index === 0
        ? { steps: [domain('Invoices'), { does: 'dies' }] }
        : { steps: [domain('Invoices'), domain('Accounts'), DONE] },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* bootstrap(project.id)
          yield* runIs(project.id, 'done')
          // Its session ends once its turn has settled, after the run is done: wait for that.
          yield* noLivingSession(project.id)
          return {
            domains: yield* domainsOf(project.id),
            runs: yield* runsOf(project.id),
            sessions: yield* sessionsIn(['ended', 'replaced', 'failed', ...LIVE], {
              kind: 'project',
              projectId: project.id,
            }),
          }
        }),
      ),
    )
    expect(seen.domains.map((one) => one.name)).toEqual(['Invoices', 'Accounts'])
    expect(seen.runs).toHaveLength(1)
    expect(seen.sessions.map((one) => one.state).toSorted()).toEqual(['ended', 'replaced'])
    const brief = text(world.agents[1]?.answers.prompts[0] ?? [])
    expect(brief).toContain('## Already proposed or validated\n\n### Invoices [proposed]')
    expect(brief).toContain('[hemera:resume]')
    expect(answersOf(world.agents[1])[0]).toContain(
      'refused: the living spec already has a domain “Invoices”',
    )
  })

  test('a restart mid-bootstrap resumes the running run: its new session goes on from what is there', async () => {
    const hold = held()
    let steps = 0
    const first = living(() => ({
      steps: [domain('Invoices'), DONE],
      between: () => (steps++ === 0 ? Promise.resolve() : hold.promise),
    }))
    const before = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* bootstrap(project.id)
          yield* until(Effect.map(domainsOf(project.id), (domains) => domains.length === 1))
          return { projectId: project.id, runs: yield* runsOf(project.id) }
        }),
      ),
    )
    hold.release()
    const second = living(() => ({ steps: [domain('Invoices'), domain('Accounts'), DONE] }))
    const after = await second.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* runIs(before.projectId, 'done')
          return {
            runs: yield* runsOf(before.projectId),
            domains: yield* domainsOf(before.projectId),
          }
        }),
      ),
    )
    expect(before.runs[0]?.state).toBe('running')
    expect(after.runs).toHaveLength(1)
    expect(after.runs[0]?.id).toBe(before.runs[0]?.id)
    expect(after.domains.map((one) => one.name)).toEqual(['Invoices', 'Accounts'])
    const brief = text(second.world.agents[0]?.answers.prompts[0] ?? [])
    expect(brief).toContain('### Invoices [proposed]')
    expect(brief).toContain('[hemera:resume]')
    expect(answersOf(second.world.agents[0])[0]).toContain('already has a domain “Invoices”')
  })
})

/** The Planner's turn: its tool calls on the living spec, then a word. */
const planner = (...steps: ReadonlyArray<FakeStep>): FakeScript => ({
  turns: [[...steps, says('Drafted.')]],
  steps: [says('Nothing more.')],
})

const write = (id: string, args: Schema.JsonObject): FakeStep =>
  uses(id, 'requirement_write', {
    domain: 'Invoices',
    text: 'The user exports the invoices as XLSX.',
    scenarios: SCENARIO,
    ...args,
  })

/** The mission's Planner, once its first turn is over. */
const plannerSettled = (missionId: string) =>
  Effect.gen(function* () {
    const owner = { kind: 'mission' as const, missionId }
    yield* until(
      Effect.gen(function* () {
        const [found] = (yield* sessionsIn(LIVE, owner)).filter((one) => one.role === 'planner')
        if (found === undefined) return false
        return (yield* threadOf(found.id)).some((line) => line.kind === 'said')
      }),
    )
    const [found] = (yield* sessionsIn(LIVE, owner)).filter((one) => one.role === 'planner')
    if (found === undefined) return yield* Effect.die(new Error('no Planner'))
    yield* Sessions.use((sessions) => sessions.settled(found.id))
    return found
  })

describe('The Spec is a delta against the living spec', () => {
  test('requirement_write refuses a delta without living_ref, with an unknown or removed one, or a stale version; records the version; flags a new domain and a proposed target', async () => {
    const { world, run } = living(
      () =>
        planner(
          write('toolu_no_ref', { delta: 'modified' }),
          write('toolu_unknown', { delta: 'modified', living_ref: 'LR99', living_version: 1 }),
          write('toolu_removed', { delta: 'removed', living_ref: 'LR2', living_version: 2 }),
          write('toolu_stale', { delta: 'modified', living_ref: 'LR1', living_version: 0 }),
          write('toolu_elsewhere', {
            delta: 'modified',
            domain: 'Accounts',
            living_ref: 'LR1',
            living_version: 1,
          }),
          write('toolu_ok', { delta: 'modified', living_ref: 'LR1', living_version: 1 }),
          write('toolu_new', {
            delta: 'added',
            domain: 'Reports',
            text: 'The user prints a report.',
          }),
          write('toolu_proposed', {
            delta: 'modified',
            domain: 'Accounts',
            living_ref: 'LR3',
            living_version: 1,
            text: 'A user signs in with a passkey.',
          }),
        ),
      { plannerStarts: true },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const ids = yield* seeded(project.id, [
            [
              'Invoices',
              ['The user exports the invoices as CSV.', 'The user lists invoices by month.'],
            ],
            ['Accounts', ['A user signs in.']],
          ])
          yield* validate(domainIdOf(ids, 'Invoices'))
          yield* removeRequirement('LR2', 1, 'gone', BY_MISSION)
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices as XLSX', ticket: null },
          })
          yield* plannerSettled(mission.id)
          return yield* readSpec(mission.id)
        }),
      ),
    )
    const answers = answersOf(world.agents[0])
    expect(answers.slice(0, 5)).toEqual([
      'refused: a modified requirement names the living requirement it changes (living_ref) and its version as you read it (living_version), from living_spec_read.',
      'refused: the living spec has no requirement LR99: read it with living_spec_read.',
      'refused: LR2 was removed from the living spec: nothing can change it any more.',
      'refused: LR1 changed since you read it (version 0): it is at version 1. Read it again with living_spec_read.',
      'refused: LR1 belongs to the domain “Invoices”, not “Accounts”: write this requirement in Invoices.',
    ])
    expect(
      seen.requirements.map((one) => [
        one.id,
        one.delta,
        one.livingRef,
        one.livingVersion,
        one.newDomain,
        one.againstProposed,
      ]),
    ).toEqual([
      ['R1', 'modified', 'LR1', 1, false, false],
      ['R2', 'added', null, null, true, false],
      ['R3', 'modified', 'LR3', 1, false, true],
    ])
  })

  test('completeness refuses a delta whose living requirement changed after it was written, naming it', async () => {
    const { world, run } = living(
      () => ({
        turns: [
          [
            ...SPEC_SECTIONS.map((section, at) =>
              uses(`toolu_section_${String(at)}`, 'spec_write_section', {
                section,
                content: `The ${section}.`,
                base_version: 0,
              }),
            ),
            uses('toolu_describe', 'mission_describe', {
              title: 'Invoices as XLSX',
              type: 'feature',
            }),
            write('toolu_r1', { delta: 'modified', living_ref: 'LR1', living_version: 1 }),
            says('Drafted.'),
          ],
          [uses('toolu_complete', 'declare_complete', { why: 'All is there.' }), says('Declared.')],
        ],
        steps: [says('Nothing more.')],
      }),
      { plannerStarts: true },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const ids = yield* seeded(project.id, [['Invoices', ['The user exports as CSV.']]])
          yield* validate(domainIdOf(ids, 'Invoices'))
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices as XLSX', ticket: null },
          })
          const found = yield* plannerSettled(mission.id)
          // Another mission's merge changes LR1 after R1 was written against version 1.
          yield* modifyRequirement(
            'LR1',
            1,
            { text: 'The user exports as JSON.', scenarios: SCENARIO },
            BY_MISSION,
          )
          yield* Sessions.use((sessions) =>
            sessions.deliver({
              owner: found.owner,
              target: { lineage: found.lineage },
              kind: 'update',
              body: 'Declare it complete.',
            }),
          )
          yield* until(Effect.sync(() => answersOf(world.agents[0]).length === 10))
          return { spec: yield* readSpec(mission.id) }
        }),
      ),
    )
    // Beside what #90 asks of a complete Spec (proofs, tasks, a model), the drift is named.
    const refused = answersOf(world.agents[0]).at(-1) ?? ''
    expect(refused).toMatch(
      /^refused: the Spec is not complete, and nothing was recorded\. Fix each of these, then declare again:\n/,
    )
    expect(refused.split('\n')).toContain(
      '- R1: R1 was written against LR1 at version 1, which is now at version 2: read it again with living_spec_read and write R1 on it.',
    )
    expect(seen.spec.declaredCompleteVersion).toBeNull()
  })

  test('the Planner reads the domains in its brief; “already delivered” on a proposed requirement is stored so', async () => {
    const { world, run } = living(
      () =>
        planner(
          uses('toolu_read', 'living_spec_read', { domain: 'accounts' }),
          uses('toolu_unknown', 'triage_answer', {
            kind: 'delivered',
            ref: 'LR9',
            text: 'Signing in already exists.',
          }),
          uses('toolu_elsewhere', 'triage_answer', {
            kind: 'delivered',
            ref: 'LR3',
            text: 'Signing in already exists.',
          }),
          uses('toolu_triage', 'triage_answer', {
            kind: 'delivered',
            ref: 'LR2',
            text: 'Signing in already exists, as a proposed requirement.',
          }),
        ),
      { plannerStarts: true },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const ids = yield* seeded(project.id, [
            ['Invoices', ['The user exports as CSV.']],
            ['Accounts', ['A user signs in.']],
          ])
          yield* validate(domainIdOf(ids, 'Invoices'))
          // Another Project's living spec: its LR3 is not Acme's.
          const web = join(work, 'acme-web')
          repository(join(web, 'web'))
          const other = yield* createProject({
            name: 'Acme Web',
            mainCheckout: web,
            repositories: ['web'],
          })
          yield* seeded(other.id, [['Accounts', ['A visitor signs in.']]])
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Let users sign in', ticket: null },
          })
          yield* plannerSettled(mission.id)
          const triaged = (lines: ReadonlyArray<{ readonly text: string }>) =>
            lines.find((line) => line.text.startsWith('The Planner answered'))
          yield* until(
            Effect.map(wholeJournal(mission.id), (lines) => triaged(lines) !== undefined),
          )
          return {
            spec: yield* readSpec(mission.id),
            journal: triaged(yield* wholeJournal(mission.id))?.text,
          }
        }),
      ),
    )
    expect(seen.journal).toBe(
      'The Planner answered that it is already delivered (LR2, a proposed requirement, not validated): Signing in already exists, as a proposed requirement.',
    )
    expect(answersOf(world.agents[0]).slice(1, 3)).toEqual([
      'refused: the living spec of this Project has no requirement LR9: read it with living_spec_read, and name the one that delivers it.',
      'refused: the living spec of this Project has no requirement LR3: read it with living_spec_read, and name the one that delivers it.',
    ])
    const brief = text(world.agents[0]?.answers.prompts[0] ?? [])
    expect(brief).toContain(
      '## Living spec, domains\n\n- "Invoices": validated · 1 validated, 0 proposed\n- "Accounts": proposed · 0 validated, 1 proposed',
    )
    expect(answersOf(world.agents[0])[0]).toContain('## Accounts [proposed]')
    expect(answersOf(world.agents[0])[0]).toContain(
      '### LR2 (version 1) [proposed] · from bootstrap',
    )
    expect(seen.spec.triage).toMatchObject({ kind: 'delivered', ref: 'LR2', basedOnProposed: true })
  })
})
