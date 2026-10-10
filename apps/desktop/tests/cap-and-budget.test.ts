/**
 * The Project's cap of sub-agents and the mission's budget (#41, CT-13): what the cap counts, an
 * agent's launch refused above it, a Hemera phase waiting for a slot with Now saying so, two
 * Projects that share nothing; a spent budget refusing the call with one decision need, a raise
 * that lets the next call through, applied once; the business attempts counted per task. On the
 * engine as it starts, with the fake agent of #32.
 */

import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import { ChosenAnswer, capRefusal } from '@hemera/core/domain'
import { eq, sql } from 'drizzle-orm'
import { Duration, Effect, Predicate, Result } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  budgetOf,
  projectLimits,
  recordAttempt,
  setProjectLimits,
  spendBudget,
} from '../src/engine/budget.ts'
import { Memory } from '../src/engine/memory/index.ts'
import { createMission, moveMission } from '../src/engine/missions.ts'
import { answerNeed, listNeeds } from '../src/engine/needs.ts'
import { createProject } from '../src/engine/projects.ts'
import type { RoleEntry } from '../src/engine/sessions/roles.ts'
import { TEST_ROLE } from './test-role.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { type RoleSession, getSession, sessionsIn } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import { memoryJournal, sessionDeliveries } from '../src/engine/storage/schema.ts'
import { repository } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { BUILDER, HELPER, acmeIn, held, sessionsEngine, until, within } from './sessions-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('cap-and-budget'))
  work = realpathSync.native(temporaryFolder('cap-and-budget-work'))
})
afterEach(removeFolders)

const acme = Effect.suspend(() => acmeIn(work))

/** A fixed phase of Hemera's that counts in the cap: the documenter, as its ticket will register it. */
const DOCUMENTER: RoleEntry = { ...TEST_ROLE, id: 'documenter', displayName: 'the documenter' }
/** A role registered as not counting, as the Chat is (#43, which tests the Chat itself). */
const UNCOUNTED: RoleEntry = {
  ...TEST_ROLE,
  id: 'uncounted',
  displayName: 'a role outside the cap',
  countsInCap: false,
}

const ROLES = [BUILDER, HELPER, DOCUMENTER, UNCOUNTED]

const SAYS_DONE = { steps: [{ does: 'says' as const, text: 'done' }] }

type Owner = { readonly kind: 'mission'; readonly missionId: string }

const launched = (owner: Owner, folder: string, role: string, requestedBy: 'agent' | 'hemera') =>
  Sessions.use((sessions) => sessions.open({ owner, role, folder, requestedBy })).pipe(
    Effect.result,
  )

const live = Effect.map(sessionsIn(['starting', 'working', 'idle']), (sessions) => sessions)

/** A second Project, Hemera itself, with a mission in Building. */
const hemera = Effect.gen(function* () {
  const main = join(work, 'hemera')
  mkdirSync(main, { recursive: true })
  repository(join(main, 'shared'))
  const project = yield* createProject({
    name: 'Hemera',
    mainCheckout: main,
    repositories: ['shared'],
  })
  const mission = yield* createMission({
    projectId: project.id,
    idea: { sentence: 'Show the budget on the mission page', ticket: null },
  })
  yield* moveMission(mission.id, 'freeze', 'user')
  yield* moveMission(mission.id, 'launch', 'user')
  return { main, owner: { kind: 'mission' as const, missionId: mission.id } }
})

describe('The cap of sub-agents (CT-13)', () => {
  test('at cap 3 a fourth agent launch is refused with its sentence and a Journal line; the main session and a Chat do not count', async () => {
    const hold = held()
    const { run } = sessionsEngine(data, () => ({ ...SAYS_DONE, between: () => hold.promise }), {
      roles: ROLES,
    })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main, mission } = yield* acme
          const builder = yield* launched(owner, main, 'builder', 'hemera')
          const chat = yield* launched(owner, main, 'uncounted', 'hemera')
          const helpers = yield* Effect.forEach([1, 2, 3], () =>
            launched(owner, main, 'helper', 'agent'),
          )
          const fourth = yield* launched(owner, main, 'helper', 'agent')
          yield* until(
            Effect.map(
              Effect.flatMap(Database, (database) =>
                database
                  .select()
                  .from(memoryJournal)
                  .where(eq(memoryJournal.missionId, mission.id)),
              ),
              (lines) => lines.some((line) => line.text.includes('sub-agents already run')),
            ),
          )
          hold.release()
          return { builder, chat, helpers, fourth }
        }),
      ),
    )
    expect(Result.isSuccess(seen.builder)).toBe(true)
    expect(Result.isSuccess(seen.chat)).toBe(true)
    expect(seen.helpers.every(Result.isSuccess)).toBe(true)
    expect(Result.isFailure(seen.fourth)).toBe(true)
    const refusal = Result.isFailure(seen.fourth) ? seen.fourth.failure : null
    expect(refusal?.message).toContain(capRefusal(3, 3))
  })

  test('a fixed phase waits for a slot, Now says so, and it starts when one frees; another Project is not affected', async () => {
    const hold = held()
    const { world, run } = sessionsEngine(
      data,
      (index) =>
        index === 0
          ? {
              steps: [
                { does: 'says', text: 'half' },
                { does: 'limits', title: 'Claude is temporarily rate limited.' },
              ],
              between: () => hold.promise,
            }
          : { ...SAYS_DONE, between: () => hold.promise },
      // The helpers are held on purpose: never stuck while the suite runs under load.
      { roles: ROLES, timings: { stuckAfter: Duration.minutes(5) } },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          yield* Effect.forEach([1, 2, 3], () => launched(owner, main, 'helper', 'agent'))
          yield* until(Effect.sync(() => world.agents.length === 3))
          const phase = yield* launched(owner, main, 'documenter', 'hemera')
          const now = Memory.use((memory) => memory.now(owner.missionId))
          yield* until(Effect.map(now, (state) => state.slotWait !== null))
          const waiting = yield* now
          const startedBefore = world.agents.length
          const other = yield* hemera
          const elsewhere = yield* launched(other.owner, other.main, 'helper', 'agent')
          hold.release()
          yield* until(
            Effect.map(live, (sessions) =>
              sessions.some((one) => one.role === 'documenter' && one.state !== 'starting'),
            ),
          )
          const after = yield* Memory.use((memory) => memory.now(owner.missionId))
          return { phase, waiting, startedBefore, elsewhere, after }
        }),
      ),
    )
    expect(Result.isSuccess(seen.phase)).toBe(true)
    expect(seen.waiting.slotWait).toBe('waiting for a free slot (3 of 3 in use)')
    expect(seen.startedBefore).toBe(3)
    expect(Result.isSuccess(seen.elsewhere)).toBe(true)
    expect(seen.after.slotWait).toBeNull()
  })
})

describe('A slot goes back once nothing uses it', () => {
  test('an idle helper gives its slot to a phase waiting for one, and its parent is told', async () => {
    const { run } = sessionsEngine(data, () => SAYS_DONE, {
      roles: ROLES,
      timings: { stuckAfter: Duration.millis(400) },
    })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main, project } = yield* acme
          const limits = yield* projectLimits(project.id)
          yield* setProjectLimits(project.id, { cap: 1, budget: limits.budget })
          const builder = yield* Sessions.use((sessions) =>
            sessions.open({ owner, role: 'builder', folder: main }),
          )
          const helper = yield* Sessions.use((sessions) =>
            sessions.open({
              owner,
              role: 'helper',
              folder: main,
              parent: builder,
              requestedBy: 'agent',
            }),
          )
          yield* Sessions.use((sessions) => sessions.settled(helper.id))
          yield* launched(owner, main, 'documenter', 'hemera')
          yield* until(
            Effect.map(live, (sessions) =>
              sessions.some((one) => one.role === 'documenter' && one.state !== 'starting'),
            ),
          )
          const told = yield* Effect.flatMap(Database, (database) =>
            database
              .select()
              .from(sessionDeliveries)
              .where(eq(sessionDeliveries.targetLineage, builder.lineage)),
          )
          return { helper: yield* getSession(helper.id), told }
        }),
      ),
    )
    expect(seen.helper.state).toBe('ended')
    expect(seen.helper.stateReason).toBe('idle while a phase waited for its slot')
    expect(seen.told.map((one) => [one.kind, one.body])).toEqual([
      ['child', 'Your a helper session ended: idle while a phase waited for its slot.'],
    ])
  })

  test('an agent’s launch that fails after its slot was taken gives the slot back', async () => {
    const { run } = sessionsEngine(data, () => SAYS_DONE, { roles: ROLES })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main, project } = yield* acme
          const limits = yield* projectLimits(project.id)
          yield* setProjectLimits(project.id, { cap: 1, budget: limits.budget })
          const database = yield* Database
          // The budget cannot be spent, then the session cannot be written.
          yield* database.run(sql`CREATE TRIGGER refuse_spending BEFORE INSERT ON mission_spent
            BEGIN SELECT RAISE(ABORT, 'refused'); END`)
          const unspent = yield* launched(owner, main, 'helper', 'agent')
          yield* database.run(sql`DROP TRIGGER refuse_spending`)
          yield* database.run(sql`CREATE TRIGGER refuse_helpers BEFORE INSERT ON agent_sessions
            WHEN NEW.role = 'helper' BEGIN SELECT RAISE(ABORT, 'refused'); END`)
          const unwritten = yield* launched(owner, main, 'helper', 'agent')
          yield* database.run(sql`DROP TRIGGER refuse_helpers`)
          const through = yield* launched(owner, main, 'helper', 'agent')
          return { unspent, unwritten, through }
        }),
      ),
    )
    expect(Result.isFailure(seen.unspent)).toBe(true)
    expect(Result.isFailure(seen.unwritten)).toBe(true)
    expect(Result.isSuccess(seen.through)).toBe(true)
  })
})

describe('The budget of a mission', () => {
  test('a spent budget refuses the call and makes one decision need; raising it lets the next call through, once', async () => {
    const { run } = sessionsEngine(data, () => SAYS_DONE, { roles: ROLES })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main, mission } = yield* acme
          for (let spent = 0; spent < 8; spent += 1) yield* spendBudget(mission.id, 'launches')
          const refused = yield* launched(owner, main, 'helper', 'agent')
          const again = yield* spendBudget(mission.id, 'launches')
          const needs = (yield* listNeeds).flatMap((group) => group.needs)
          const [need] = needs
          if (need === undefined) return yield* Effect.die(new Error('no need'))
          const fields = Predicate.isTagged(need.fields, 'Decision') ? need.fields : null
          const raise = fields?.options[0] ?? ''
          yield* answerNeed({ id: need.id, key: 'a', answer: ChosenAnswer.make({ option: raise }) })
          yield* answerNeed({ id: need.id, key: 'b', answer: ChosenAnswer.make({ option: raise }) })
          const through = yield* launched(owner, main, 'helper', 'agent')
          return { refused, again, needs, fields, through, budget: yield* budgetOf(mission.id) }
        }),
      ),
    )
    const refusal = Result.isFailure(seen.refused) ? seen.refused.failure : null
    expect(refusal?.message).toContain('the launches of this mission are spent (8 of 8)')
    expect(seen.again).toEqual({
      spent: false,
      sentence: 'the launches of this mission are spent (8 of 8)',
    })
    expect(seen.needs).toHaveLength(1)
    expect(seen.fields?.question).toBe('The launches budget of ACME-1 is spent')
    expect(seen.fields?.options).toEqual(['Raise it by 8 for this mission', 'Keep the limit'])
    expect(seen.fields?.recommended?.option).toBe('Raise it by 8 for this mission')
    expect(Result.isSuccess(seen.through)).toBe(true)
    expect(seen.budget.find((one) => one.counter === 'launches')).toEqual({
      counter: 'launches',
      spent: 9,
      limit: 16,
    })
  })

  test('the business attempts are counted per task, whoever ran them, and spend the mission’s attempts', async () => {
    const { run } = sessionsEngine(data, () => SAYS_DONE, { roles: ROLES })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* acme
          yield* recordAttempt('task-1', mission.id)
          yield* recordAttempt('task-1', mission.id)
          const third = yield* recordAttempt('task-1', mission.id)
          const other = yield* recordAttempt('task-2', mission.id)
          return { third, other, budget: yield* budgetOf(mission.id) }
        }),
      ),
    )
    expect(seen.third).toEqual({ count: 3, spent: true })
    expect(seen.other).toEqual({ count: 1, spent: true })
    expect(seen.budget.find((one) => one.counter === 'attempts')).toEqual({
      counter: 'attempts',
      spent: 4,
      limit: 30,
    })
  })
})

describe('A restart with the cap full', () => {
  test('rebuilds every lineage: one waiting for its slot holds back none of the others', async () => {
    /** A child that does not count in the cap, opened after the helpers. */
    const SCRIBE: RoleEntry = {
      ...HELPER,
      id: 'scribe',
      displayName: 'the scribe',
      countsInCap: false,
    }
    const roles = [...ROLES, SCRIBE]
    const before = await sessionsEngine(data, () => SAYS_DONE, { roles }).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main, project } = yield* acme
          const opened = (role: string, parent?: RoleSession) =>
            Sessions.use((sessions) => sessions.open({ owner, role, folder: main, parent }))
          const builder = yield* opened('builder')
          const helpers = [yield* opened('helper', builder), yield* opened('helper', builder)]
          const scribe = yield* opened('scribe', builder)
          for (const one of [builder, ...helpers, scribe]) {
            yield* Sessions.use((sessions) => sessions.settled(one.id))
          }
          const limits = yield* projectLimits(project.id)
          yield* setProjectLimits(project.id, { cap: 1, budget: limits.budget })
          return { owner, scribe }
        }),
      ),
    )
    const rebuilt = await sessionsEngine(data, () => SAYS_DONE, { roles }).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(
            Effect.map(sessionsIn(['idle'], before.owner), (idle) =>
              idle.some(
                (one) => one.lineage === before.scribe.lineage && one.id !== before.scribe.id,
              ),
            ),
          )
          return yield* sessionsIn(['starting', 'idle'], before.owner)
        }),
      ),
    )
    expect(rebuilt.map((one) => one.role).toSorted()).toEqual([
      'builder',
      'helper',
      'helper',
      'scribe',
    ])
  })
})
