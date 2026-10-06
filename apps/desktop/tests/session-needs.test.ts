/**
 * Never a silent substitution, and a provider limit that preserves the work (#41): a model the
 * agent refuses, or an agent missing, stops the session before it works and gives its owner an
 * environment need that opens the right settings section; a quota reached ends the session
 * cleanly, its task left where it was. Retry starts the lineage again once what was missing is
 * there. On the engine as it starts, with the fake agent of #32.
 */

import { realpathSync } from 'node:fs'

import { MissionOwner, ProjectOwner } from '@hemera/core/domain'
import { AgentNotInstalled, type Need } from '@hemera/ipc'
import { Effect, Layer, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { ADAPTERS } from '../src/engine/agents/adapters/index.ts'
import { Discovery } from '../src/engine/agents/discovery.ts'
import type { FakeScript } from '../src/engine/agents/fake.ts'
import { getNeed, listNeeds, recheckNeeds, retryNeed } from '../src/engine/needs.ts'
import { setRoleSetting } from '../src/engine/sessions/cascade.ts'
import { assignWork, leaseOf } from '../src/engine/sessions/leases.ts'
import type { RoleEntry } from '../src/engine/sessions/roles.ts'
import { TEST_ROLE } from './test-role.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { getSession, sessionsIn } from '../src/engine/sessions/store.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import {
  BUILDER,
  acmeIn,
  everyAgentFound,
  sessionsEngine,
  text,
  until,
  within,
} from './sessions-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('session-needs'))
  work = realpathSync.native(temporaryFolder('session-needs-work'))
})
afterEach(removeFolders)

const acme = Effect.suspend(() => acmeIn(work))

/** An agent offering two models, and saying done to every turn. */
const OFFERING: FakeScript = {
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
  steps: [{ does: 'says', text: 'done' }],
}

/** The setup agent, shaped as #44 will register it: a Project's own session. */
const SETUP: RoleEntry = {
  ...TEST_ROLE,
  id: 'setup',
  displayName: 'the setup agent',
  ownerKind: 'project',
  placeKind: 'project-folder',
  readsMemory: false,
}

/** Codex is not installed; every other agent is found. */
const withoutCodex = Layer.effect(
  Discovery,
  Effect.map(Discovery, (found) => ({
    ...found,
    resolve: (id: 'claude' | 'codex' | 'opencode') =>
      id === 'codex'
        ? Effect.fail(new AgentNotInstalled({ agent: id, label: ADAPTERS[id].label }))
        : found.resolve(id),
  })),
).pipe(Layer.provide(everyAgentFound))

const pendingNeeds = Effect.map(listNeeds, (groups) => groups.flatMap((group) => group.needs))

/** A need's fields when it is an environment need; null otherwise. */
const environment = (need: Need | undefined) =>
  need !== undefined && Predicate.isTagged(need.fields, 'Environment') ? need.fields : null

describe('Never a silent substitution', () => {
  test('a model the agent does not offer gives an environment need on Models by role, and no other model starts', async () => {
    const { world, run } = sessionsEngine(data, () => OFFERING)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main, mission } = yield* acme
          yield* setRoleSetting('app', null, 'builder', {
            agent: 'claude',
            model: 'huge',
            effort: null,
          })
          const session = yield* Sessions.use((sessions) =>
            sessions.open({ owner, role: 'builder', folder: main }),
          )
          yield* until(Effect.map(pendingNeeds, (needs) => needs.length === 1))
          const [need] = yield* pendingNeeds
          return { mission, need, session: yield* getSession(session.id) }
        }),
      ),
    )
    expect(seen.need?.owner).toEqual(
      MissionOwner.make({
        projectId: seen.mission.projectId,
        missionId: seen.mission.id,
        taskId: null,
      }),
    )
    expect(environment(seen.need)?.settingsSection).toBe('models')
    expect(environment(seen.need)?.missing).toContain('The Builder')
    expect(environment(seen.need)?.missing).toContain('huge')
    expect(seen.session.state).toBe('failed')
    expect(world.agents.flatMap((agent) => agent.answers.prompts)).toEqual([])
    expect(world.agents.flatMap((agent) => agent.answers.choices)).not.toContain('model=large')
  })

  test('Retry once the model changed starts the lineage again, on the new model', async () => {
    const { world, run } = sessionsEngine(data, () => OFFERING)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          yield* setRoleSetting('app', null, 'builder', {
            agent: 'claude',
            model: 'huge',
            effort: null,
          })
          const first = yield* Sessions.use((sessions) =>
            sessions.open({ owner, role: 'builder', folder: main }),
          )
          yield* until(Effect.map(pendingNeeds, (needs) => needs.length === 1))
          const [need] = yield* pendingNeeds
          if (need === undefined) return yield* Effect.die(new Error('no need'))
          yield* setRoleSetting('app', null, 'builder', {
            agent: 'claude',
            model: 'small',
            effort: null,
          })
          const retried = yield* retryNeed(need.id)
          yield* until(
            Effect.sync(() => world.agents.some((agent) => agent.answers.prompts.length > 0)),
          )
          const [next] = (yield* sessionsIn(['starting', 'working', 'idle'])).filter(
            (one) => one.lineage === first.lineage,
          )
          return { retried: retried.state, next }
        }),
      ),
    )
    expect(seen.retried).toBe('withdrawn')
    expect(seen.next).toMatchObject({ epoch: 1, chosen: { model: 'small' } })
    const prompted = world.agents.find((agent) => agent.answers.prompts.length > 0)
    expect(prompted?.answers.choices).toEqual(['model=small'])
  })

  test('Retry by the user tries again at once, even with nothing changed', async () => {
    const { run } = sessionsEngine(data, () => OFFERING)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          yield* setRoleSetting('app', null, 'builder', {
            agent: 'claude',
            model: 'huge',
            effort: null,
          })
          const first = yield* Sessions.use((sessions) =>
            sessions.open({ owner, role: 'builder', folder: main }),
          )
          yield* until(Effect.map(pendingNeeds, (needs) => needs.length === 1))
          const [need] = yield* pendingNeeds
          if (need === undefined) return yield* Effect.die(new Error('no need'))
          const retried = yield* retryNeed(need.id)
          yield* until(Effect.map(pendingNeeds, (needs) => needs.some((one) => one.id !== need.id)))
          const lineage = (yield* sessionsIn(['failed'])).filter(
            (one) => one.lineage === first.lineage,
          )
          return { retried: retried.state, epochs: lineage.map((one) => one.epoch) }
        }),
      ),
    )
    expect(seen.retried).toBe('withdrawn')
    expect(seen.epochs.toSorted()).toEqual([0, 1])
  })

  test('an agent that is not installed points to Agents; a Project’s role gives the Project the need', async () => {
    const { world, run } = sessionsEngine(data, () => OFFERING, {
      roles: [BUILDER, SETUP],
      sessions: { discovery: withoutCodex },
    })
    const need = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          yield* setRoleSetting('app', null, 'setup', { agent: 'codex', model: null, effort: null })
          yield* Sessions.use((sessions) =>
            sessions.open({
              owner: { kind: 'project', projectId: project.id },
              role: 'setup',
              folder: main,
            }),
          )
          yield* until(Effect.map(pendingNeeds, (needs) => needs.length === 1))
          const [only] = yield* pendingNeeds
          return { only, projectId: project.id }
        }),
      ),
    )
    expect(need.only?.owner).toEqual(ProjectOwner.make({ projectId: need.projectId }))
    expect(environment(need.only)?.settingsSection).toBe('agents')
    expect(world.agents).toEqual([])
  })
})

describe('A provider limit preserves the work', () => {
  test('a quota reached ends the session cleanly, keeps its task, and gives an environment need; Retry goes on', async () => {
    const { world, run } = sessionsEngine(data, (index) =>
      index === 0
        ? {
            steps: [
              { does: 'says', text: 'Half of the export is written.' },
              { does: 'limits', title: 'The Claude account has no available quota.' },
            ],
          }
        : { steps: [{ does: 'says', text: 'done' }] },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* Sessions.use((sessions) =>
            sessions.open({ owner, role: 'builder', folder: main }),
          )
          yield* assignWork('task-1', session)
          yield* until(Effect.map(pendingNeeds, (needs) => needs.length === 1))
          const ended = yield* getSession(session.id)
          const leaseAfter = yield* leaseOf('task-1')
          const [need] = yield* pendingNeeds
          if (need === undefined) return yield* Effect.die(new Error('no need'))
          const retried = yield* retryNeed(need.id)
          yield* until(Effect.sync(() => world.agents.length === 2))
          yield* until(Effect.sync(() => (world.agents[1]?.answers.prompts.length ?? 0) === 1))
          const leaseThen = yield* leaseOf('task-1')
          return { ended, leaseAfter, need: yield* getNeed(need.id), retried, leaseThen }
        }),
      ),
    )
    expect(seen.ended.state).toBe('ended')
    expect(seen.leaseAfter).toMatchObject({ sessionId: seen.ended.id, epoch: 0 })
    expect(environment(seen.need)?.settingsSection).toBe('models')
    expect(environment(seen.need)?.missing).toContain('The Claude account has no available quota.')
    expect(seen.retried.state).toBe('withdrawn')
    expect(seen.leaseThen?.sessionId).not.toBe(seen.ended.id)
    expect(text(world.agents[1]?.answers.prompts[0] ?? [])).toContain('[hemera:resume]')
  })
})

describe('A provider limit is tried again by the user only', () => {
  test('Hemera’s own looks at the needs leave a quota need pending and start nothing', async () => {
    const { world, run } = sessionsEngine(data, (index) =>
      index === 0
        ? { steps: [{ does: 'limits', title: 'The Claude account has no available quota.' }] }
        : { steps: [{ does: 'says', text: 'done' }] },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          yield* Sessions.use((sessions) => sessions.open({ owner, role: 'builder', folder: main }))
          yield* until(Effect.map(pendingNeeds, (needs) => needs.length === 1))
          yield* recheckNeeds
          yield* recheckNeeds
          const live = yield* sessionsIn(['starting', 'working', 'idle'])
          return { needs: yield* pendingNeeds, live: live.length }
        }),
      ),
    )
    expect(seen.needs).toHaveLength(1)
    expect(seen.live).toBe(0)
    expect(world.agents).toHaveLength(1)
  })
})
