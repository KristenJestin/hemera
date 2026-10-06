/**
 * The model cascade (#41): which agent, model and effort a role's next session gets, from the
 * app, the Project and the mission, the most precise level set winning; the level recorded on the
 * session; a change for the next session only; and an app setting for every role from the first
 * start. On the engine as it starts, with the fake agent of #32.
 */

import { realpathSync } from 'node:fs'

import { Qualified } from '@hemera/ipc'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { ADAPTERS } from '../src/engine/agents/adapters/index.ts'
import { type DiscoveredAgent, Discovery } from '../src/engine/agents/discovery.ts'
import type { FakeScript } from '../src/engine/agents/fake.ts'
import { roleSettingAt, setRoleSetting } from '../src/engine/sessions/cascade.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { getSession } from '../src/engine/sessions/store.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { acmeIn, everyAgentFound, sessionsEngine, within } from './sessions-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('model-cascade'))
  work = realpathSync.native(temporaryFolder('model-cascade-work'))
})
afterEach(removeFolders)

const select = (id: string, category: string, current: string, values: ReadonlyArray<string>) => ({
  id,
  name: id,
  category,
  type: 'select' as const,
  currentValue: current,
  options: values.map((value) => ({ value, name: value })),
})

/** An agent offering three models and two efforts, and saying done to every turn. */
const OFFERING: FakeScript = {
  configOptions: [
    select('model', 'model', 'large', ['large', 'medium', 'small']),
    select('effort', 'thought_level', 'low', ['low', 'high']),
  ],
  steps: [{ does: 'says', text: 'done' }],
}

const acme = Effect.suspend(() => acmeIn(work))

const openBuilder = (
  owner: { readonly kind: 'mission'; readonly missionId: string },
  folder: string,
) => Sessions.use((sessions) => sessions.open({ owner, role: 'builder', folder }))

describe('The cascade: the most precise level set wins', () => {
  test('on every combination of set and unset levels, the level it came from recorded on the session', async () => {
    const { run } = sessionsEngine(data, () => OFFERING)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main, project, mission } = yield* acme
          const app = { agent: 'claude' as const, model: 'large', effort: null }
          const atProject = { agent: 'codex' as const, model: 'medium', effort: 'high' }
          const atMission = { agent: 'opencode' as const, model: 'small', effort: null }
          yield* setRoleSetting('app', null, 'builder', app)
          const combinations = [
            { project: null, mission: null },
            { project: atProject, mission: null },
            { project: null, mission: atMission },
            { project: atProject, mission: atMission },
          ]
          const sessions = []
          for (const combination of combinations) {
            yield* setRoleSetting('project', project.id, 'builder', combination.project)
            yield* setRoleSetting('mission', mission.id, 'builder', combination.mission)
            const session = yield* openBuilder(owner, main)
            sessions.push(yield* getSession(session.id))
          }
          return sessions.map((session) => ({
            agent: session.provider,
            model: session.chosen.model,
            effort: session.chosen.effort,
            level: session.modelLevel,
          }))
        }),
      ),
    )
    expect(seen).toEqual([
      { agent: 'claude', model: 'large', effort: null, level: 'app' },
      { agent: 'codex', model: 'medium', effort: 'high', level: 'project' },
      { agent: 'opencode', model: 'small', effort: null, level: 'mission' },
      { agent: 'opencode', model: 'small', effort: null, level: 'mission' },
    ])
  })

  test('an unset level is no row at all, never a copy of the level above', async () => {
    const { run } = sessionsEngine(data, () => OFFERING)
    const [set, unset] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const value = { agent: 'codex' as const, model: 'medium', effort: null }
          yield* setRoleSetting('project', project.id, 'builder', value)
          const before = yield* roleSettingAt('project', project.id, 'builder')
          yield* setRoleSetting('project', project.id, 'builder', null)
          return [before, yield* roleSettingAt('project', project.id, 'builder')]
        }),
      ),
    )
    expect(set).toEqual({ agent: 'codex', model: 'medium', effort: null })
    expect(unset).toBeNull()
  })
})

describe('A change applies to the next session', () => {
  test('a running session keeps its own agent and model; the next one takes the new setting', async () => {
    const { world, run } = sessionsEngine(data, () => OFFERING)
    const [first, second] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          yield* setRoleSetting('app', null, 'builder', {
            agent: 'codex',
            model: 'small',
            effort: null,
          })
          const running = yield* openBuilder(owner, main)
          yield* Sessions.use((sessions) => sessions.settled(running.id))
          yield* setRoleSetting('app', null, 'builder', {
            agent: 'claude',
            model: 'medium',
            effort: 'high',
          })
          yield* Sessions.use((sessions) =>
            sessions.deliver({
              owner,
              target: { lineage: running.lineage },
              kind: 'answers',
              body: 'Go on.',
            }),
          )
          yield* Sessions.use((sessions) => sessions.settled(running.id))
          const next = yield* openBuilder(owner, main)
          yield* Sessions.use((sessions) => sessions.settled(next.id))
          return [yield* getSession(running.id), yield* getSession(next.id)]
        }),
      ),
    )
    expect(first).toMatchObject({ provider: 'codex', chosen: { model: 'small' } })
    expect(world.agents[0]?.answers.prompts).toHaveLength(2)
    expect(world.agents[0]?.answers.choices).toEqual(['model=small'])
    expect(second).toMatchObject({
      provider: 'claude',
      chosen: { model: 'medium', effort: 'high' },
    })
    expect(world.agents[1]?.answers.choices).toEqual(['model=medium', 'effort=high'])
  })
})

const installed = (id: DiscoveredAgent['id'], present: boolean): DiscoveredAgent => ({
  id,
  label: ADAPTERS[id].label,
  installed: present,
  path: present ? `/usr/local/bin/${id}` : null,
  version: present ? '1.0.0' : null,
  signedIn: present,
  installer: 'unknown',
  qualification: Qualified.make({}),
  installHint: ADAPTERS[id].installHint,
  loginHint: ADAPTERS[id].loginHint,
})

describe('The app level holds a setting for every role from the first start', () => {
  test('the first agent installed in the order Claude Code, Codex, OpenCode, on its own default model and effort', async () => {
    const discovery = Layer.effect(
      Discovery,
      Effect.map(Discovery, (found) => ({
        ...found,
        list: Effect.succeed([
          installed('claude', false),
          installed('codex', true),
          installed('opencode', true),
        ]),
      })),
    ).pipe(Layer.provide(everyAgentFound))
    const { run } = sessionsEngine(data, () => OFFERING, { sessions: { discovery } })
    const settings = await run(({ profile }) =>
      within(
        profile,
        Effect.forEach(['builder', 'helper', 'code-reviewer'], (role) =>
          roleSettingAt('app', null, role),
        ),
      ),
    )
    expect(settings).toEqual(
      Array.from({ length: 3 }, () => ({ agent: 'codex', model: null, effort: null })),
    )
  })
})
