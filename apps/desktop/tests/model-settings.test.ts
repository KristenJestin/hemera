/**
 * The settings behind the cascade, the cap and the budget, as their RPCs reach them (#41): every
 * registered role at each level with its resolution, the refusals of a setting the cascade does
 * not take, the marks of a model, a Project's limits, a raised cap that lets a waiting phase
 * start, and a mission's budget and usage. On the engine as it starts, with the fake agent.
 */

import { realpathSync } from 'node:fs'

import { Effect, Result } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { missionBudget, projectLimits, setProjectLimits } from '../src/engine/budget.ts'
import {
  markModel,
  modelMarksOf,
  roleModelsOf,
  setRoleModel,
} from '../src/engine/sessions/cascade.ts'
import type { RoleEntry } from '../src/engine/sessions/roles.ts'
import { TEST_ROLE } from './test-role.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { sessionsIn } from '../src/engine/sessions/store.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { BUILDER, HELPER, acmeIn, held, sessionsEngine, until, within } from './sessions-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('model-settings'))
  work = realpathSync.native(temporaryFolder('model-settings-work'))
})
afterEach(removeFolders)

const acme = Effect.suspend(() => acmeIn(work))
const SAYS_DONE = { steps: [{ does: 'says' as const, text: 'done' }] }
const DOCUMENTER: RoleEntry = { ...TEST_ROLE, id: 'documenter', displayName: 'the documenter' }

describe('Models by role', () => {
  test('every registered role at each level, unset ones null, with the setting its next session gets', async () => {
    const { run } = sessionsEngine(data, () => SAYS_DONE)
    const roles = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* acme
          yield* setRoleModel('project', project.id, 'builder', {
            agent: 'codex',
            model: 'medium',
            effort: null,
          })
          return yield* roleModelsOf(project.id, mission.id)
        }),
      ),
    )
    expect(roles.map((role) => role.role)).toEqual([
      'chat',
      'setup',
      'planner',
      'living-spec',
      'builder',
      'helper',
      'code-reviewer',
    ])
    expect(roles.find((role) => role.role === 'builder')).toEqual({
      role: 'builder',
      displayName: 'the Builder',
      app: { agent: 'claude', model: null, effort: null },
      project: { agent: 'codex', model: 'medium', effort: null },
      mission: null,
      resolved: { agent: 'codex', model: 'medium', effort: null, level: 'project' },
    })
  })

  test('the app level is never unset, an override names its scope, and only a registered role is set', async () => {
    const { run } = sessionsEngine(data, () => SAYS_DONE)
    const refusals = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const setting = { agent: 'claude' as const, model: null, effort: null }
          return yield* Effect.forEach(
            [
              setRoleModel('app', null, 'builder', null),
              setRoleModel('project', null, 'builder', setting),
              setRoleModel('app', project.id, 'builder', setting),
              setRoleModel('app', null, 'nobody', setting),
            ],
            (one) => Effect.map(Effect.flip(one), (refused) => refused.message),
          )
        }),
      ),
    )
    expect(refusals).toEqual([
      'This setting was not saved: every role keeps a setting at the app level.',
      'This setting was not saved: a project setting names its project.',
      'This setting was not saved: the app level has no scope.',
      'This setting was not saved: no role nobody is registered.',
    ])
  })

  test('a model is marked a favourite or hidden per agent, and forgotten when neither', async () => {
    const { run } = sessionsEngine(data, () => SAYS_DONE)
    const [marked, forgotten] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* markModel({ agent: 'claude', model: 'large', favourite: true, hidden: false })
          yield* markModel({ agent: 'codex', model: 'small', favourite: false, hidden: true })
          const first = yield* modelMarksOf
          yield* markModel({ agent: 'codex', model: 'small', favourite: false, hidden: false })
          return [first, yield* modelMarksOf] as const
        }),
      ),
    )
    expect(marked).toEqual([
      { agent: 'claude', model: 'large', favourite: true, hidden: false },
      { agent: 'codex', model: 'small', favourite: false, hidden: true },
    ])
    expect(forgotten).toEqual([{ agent: 'claude', model: 'large', favourite: true, hidden: false }])
  })
})

describe('A Project’s limits and a mission’s budget', () => {
  test('the cap and the budget read and set; a raised cap lets a waiting phase start', async () => {
    const hold = held()
    const { world, run } = sessionsEngine(
      data,
      () => ({ ...SAYS_DONE, between: () => hold.promise }),
      { roles: [BUILDER, HELPER, DOCUMENTER] },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, owner, main } = yield* acme
          const before = yield* projectLimits(project.id)
          yield* setProjectLimits(project.id, { cap: 1, budget: before.budget })
          yield* Sessions.use((sessions) =>
            sessions.open({ owner, role: 'helper', folder: main, requestedBy: 'agent' }),
          )
          const phase = yield* Sessions.use((sessions) =>
            sessions.open({ owner, role: 'documenter', folder: main }),
          ).pipe(Effect.result)
          yield* until(Effect.sync(() => world.agents.length === 1))
          const after = yield* setProjectLimits(project.id, {
            cap: 2,
            budget: { launches: 4, attempts: 10, rounds: 2 },
          })
          yield* until(Effect.sync(() => world.agents.length === 2))
          hold.release()
          const live = yield* sessionsIn(['starting', 'working', 'idle'])
          return { before, after, phase, live: live.map((one) => one.role).sort() }
        }),
      ),
    )
    expect(seen.before).toEqual({ cap: 3, budget: { launches: 8, attempts: 30, rounds: 3 } })
    expect(seen.after).toEqual({ cap: 2, budget: { launches: 4, attempts: 10, rounds: 2 } })
    expect(Result.isSuccess(seen.phase)).toBe(true)
    expect(seen.live).toEqual(['documenter', 'helper'])
  })

  test('a mission keeps the budget it started with, and shows no usage before a session ran', async () => {
    const { run } = sessionsEngine(data, () => SAYS_DONE)
    const budget = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* acme
          yield* setProjectLimits(project.id, {
            cap: 3,
            budget: { launches: 2, attempts: 2, rounds: 2 },
          })
          return yield* missionBudget(mission.id)
        }),
      ),
    )
    expect(budget).toEqual({
      counters: [
        { counter: 'launches', spent: 0, limit: 8 },
        { counter: 'attempts', spent: 0, limit: 30 },
        { counter: 'rounds', spent: 0, limit: 3 },
      ],
      usage: null,
    })
  })
})
