/**
 * The chosen model survives every restart of an agent: what Hemera chose for a session (model,
 * effort, mode) is stored with the agent's own session id, applied again in that order on the
 * next process, and what the agent then reports it took is stored beside it. A model the agent
 * refuses or no longer offers is said by name, never replaced by another.
 */

import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { Effect, Layer } from 'effect'
import type { Scope } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  type AgentPermissionAnswer,
  ModelUnavailable,
  connect,
  defaultPermissionAnswerLayer,
  processTransport,
} from '../src/engine/agents/client.ts'
import { type FakeScript, fakeAgent } from '../src/engine/agents/fake.ts'
import {
  chooseOption,
  getAgentSession,
  openAgentSession,
  reapplyChoices,
  recordNativeSession,
} from '../src/engine/agents/sessions.ts'
import { openProfile } from '../src/engine/migrate.ts'
import { SHIPPED, type Storage, on, removeFolders, temporaryFolder } from './storage.ts'

let data: string

beforeEach(async () => {
  data = temporaryFolder('agent-choices')
  await on(data, openProfile(data, SHIPPED, '1.0.0'))
})
afterEach(removeFolders)

const select = (
  id: string,
  category: string,
  current: string,
  values: ReadonlyArray<string>,
): SessionConfigOption => ({
  id,
  name: id,
  category,
  type: 'select',
  currentValue: current,
  options: values.map((value) => ({ value, name: value })),
})

const OFFERED: FakeScript = {
  configOptions: [
    select('model', 'model', 'opus', ['opus', 'sonnet', 'haiku']),
    select('effort', 'thought_level', 'medium', ['low', 'medium', 'high']),
    select('mode', 'mode', 'default', ['default', 'plan']),
  ],
}

/** One opening of the engine's storage, with the default permission port. */
const engine = <A, E>(
  program: Effect.Effect<A, E, Storage | Scope.Scope | AgentPermissionAnswer>,
): Promise<A> => on(data, Effect.provide(program, Layer.mergeAll(defaultPermissionAnswerLayer)))

/** A process of the agent scripted, its session opened anew or resumed. */
const agentProcess = (script: FakeScript, resume: string | null) =>
  Effect.gen(function* () {
    const fake = fakeAgent(script)
    const connection = yield* connect({ transport: processTransport(fake.process, () => {}) })
    const opening = { cwd: '/tmp/acme', mcpServers: [] }
    const session =
      resume === null
        ? yield* connection.newSession(opening)
        : yield* connection.resumeSession(resume, opening)
    return { fake, session }
  })

describe('The chosen model survives every restart', () => {
  test('model, effort and mode chosen before a restart are applied again in that order after it', async () => {
    const id = await engine(
      Effect.gen(function* () {
        const record = yield* openAgentSession({
          provider: 'claude',
          ownerKind: 'mission',
          ownerId: 'mission-1',
          role: 'builder',
          folder: '/tmp/acme',
        })
        const { session } = yield* agentProcess(OFFERED, null)
        yield* recordNativeSession(record.id, session.nativeSessionId)
        // Chosen in another order than the one a restart applies them in.
        yield* chooseOption(record.id, session, 'mode', 'plan')
        yield* chooseOption(record.id, session, 'effort', 'low')
        yield* chooseOption(record.id, session, 'model', 'sonnet')
        return record.id
      }),
    )
    const [choices, stored] = await engine(
      Effect.gen(function* () {
        const record = yield* getAgentSession(id)
        const { fake, session } = yield* agentProcess(OFFERED, record.nativeId)
        yield* reapplyChoices(id, session)
        return [fake.answers.choices, yield* getAgentSession(id)] as const
      }),
    )
    expect(choices).toEqual(['model=sonnet', 'effort=low', 'mode=plan'])
    expect(stored).toMatchObject({
      chosen: { model: 'sonnet', effort: 'low', mode: 'plan' },
      taken: { model: 'sonnet', effort: 'low', mode: 'plan' },
    })
  })

  test('a refused model gives ModelUnavailable naming it, and no other model is chosen', async () => {
    const [refused, choices] = await engine(
      Effect.gen(function* () {
        const record = yield* openAgentSession({
          provider: 'codex',
          ownerKind: 'project',
          ownerId: 'acme',
          role: 'chat',
          folder: '/tmp/acme',
        })
        const first = yield* agentProcess(OFFERED, null)
        yield* chooseOption(record.id, first.session, 'model', 'sonnet')
        const restarted = yield* agentProcess({ ...OFFERED, refusesModels: ['sonnet'] }, null)
        const failure = yield* Effect.flip(reapplyChoices(record.id, restarted.session))
        return [failure, restarted.fake.answers.choices] as const
      }),
    )
    expect(refused).toBeInstanceOf(ModelUnavailable)
    expect(refused).toMatchObject({ model: 'sonnet' })
    expect(
      choices.filter((choice) => choice.startsWith('model=') && choice !== 'model=sonnet'),
    ).toEqual([])
  })

  test('a model the agent no longer offers gives ModelUnavailable naming it', async () => {
    const refused = await engine(
      Effect.gen(function* () {
        const record = yield* openAgentSession({
          provider: 'opencode',
          ownerKind: 'mission',
          ownerId: 'mission-2',
          role: 'builder',
          folder: '/tmp/acme',
        })
        const first = yield* agentProcess(OFFERED, null)
        yield* chooseOption(record.id, first.session, 'model', 'haiku')
        const later = yield* agentProcess(
          { configOptions: [select('model', 'model', 'opus', ['opus', 'sonnet'])] },
          null,
        )
        return yield* Effect.flip(reapplyChoices(record.id, later.session))
      }),
    )
    expect(refused).toBeInstanceOf(ModelUnavailable)
    expect(refused).toMatchObject({ model: 'haiku' })
  })

  test('a session nothing was chosen for has nothing applied again', async () => {
    const choices = await engine(
      Effect.gen(function* () {
        const record = yield* openAgentSession({
          provider: 'claude',
          ownerKind: 'mission',
          ownerId: 'mission-3',
          role: 'builder',
          folder: '/tmp/acme',
        })
        const { fake, session } = yield* agentProcess(OFFERED, null)
        yield* reapplyChoices(record.id, session)
        return fake.answers.choices
      }),
    )
    expect(choices).toEqual([])
  })
})
