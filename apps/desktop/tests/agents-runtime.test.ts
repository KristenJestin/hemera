/**
 * The runtime of an agent's session, against the scripted fake agent: started bare with only
 * Hemera's server, its choices applied again on every new process, its death closing the turn as
 * interrupted and revoking its token, and its idle release not ending the session.
 */

import { setTimeout as sleep } from 'node:timers/promises'

import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { Effect, Fiber, Layer, Predicate, Stream } from 'effect'
import type { Scope } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { ADAPTERS } from '../src/engine/agents/adapters/index.ts'
import { TextBlock, defaultPermissionAnswerLayer } from '../src/engine/agents/client.ts'
import { Discovery } from '../src/engine/agents/discovery.ts'
import { HemeraEndpoint } from '../src/engine/agents/endpoint.ts'
import { type FakeAgent, type FakeScript, fakeAgent } from '../src/engine/agents/fake.ts'
import { IdleAgents } from '../src/engine/agents/idle.ts'
import {
  AgentRuntime,
  AgentStarter,
  SessionInstructions,
  agentRuntimeLayer,
} from '../src/engine/agents/runtime.ts'
import { getAgentSession, openAgentSession } from '../src/engine/agents/sessions.ts'
import { acpTracesLayer } from '../src/engine/agents/trace.ts'
import { openProfile } from '../src/engine/migrate.ts'
import { sessionTurnsLayer } from '../src/engine/permissions/ports.ts'
import { Secrets, secretsRegistry } from '../src/engine/secrets.ts'
import { SHIPPED, type Storage, on, removeFolders, temporaryFolder } from './storage.ts'

let data: string

beforeEach(async () => {
  data = temporaryFolder('agents-runtime')
  await on(data, openProfile(data, SHIPPED, '1.0.0'))
})
afterEach(removeFolders)

const select = (id: string, category: string, current: string, values: string[]) =>
  ({
    id,
    name: id,
    category,
    type: 'select',
    currentValue: current,
    options: values.map((value) => ({ value, name: value })),
  }) satisfies SessionConfigOption

const OFFERED: FakeScript = {
  configOptions: [
    select('model', 'model', 'opus', ['opus', 'sonnet']),
    select('effort', 'thought_level', 'medium', ['low', 'medium']),
    select('mode', 'mode', 'default', ['default', 'plan']),
  ],
  steps: [{ does: 'says', text: 'done' }],
}

/**
 * The world the runtime runs in: one fake agent per process started, and the endpoint's log. Each
 * start goes through `starting` first: what holds an agent's process before it is up.
 */
const world = (scripts: ReadonlyArray<FakeScript>, starting: Effect.Effect<void> = Effect.void) => {
  const agents: FakeAgent[] = []
  const tokens: string[] = []
  /** What a start asks of the session, in the order it asks. */
  const asked: string[] = []
  const layers = Layer.mergeAll(
    Layer.succeed(AgentStarter, {
      start: () =>
        Effect.andThen(
          starting,
          Effect.sync(() => {
            const agent = fakeAgent(scripts[agents.length] ?? scripts.at(-1) ?? {})
            agents.push(agent)
            return agent.process
          }),
        ),
    }),
    Layer.succeed(Discovery, {
      list: Effect.succeed([]),
      probe: () => Effect.succeed(null),
      resolve: (id) =>
        Effect.succeed({
          adapter: ADAPTERS[id],
          from: 'bundled' as const,
          program: '/adapters/fake.mjs',
          args: [],
          env: {},
          own: {},
        }),
    }),
    Layer.succeed(HemeraEndpoint, {
      url: Effect.succeed('http://127.0.0.1:4711/mcp'),
      mint: (session) =>
        Effect.sync(() => {
          tokens.push(`mint ${session}`)
          asked.push('token')
          return `token-${String(tokens.length)}`
        }),
      revoke: (session) => Effect.sync(() => void tokens.push(`revoke ${session}`)),
    }),
    Layer.succeed(IdleAgents, {
      hold: () => Effect.void,
      touch: () => Effect.void,
      drop: () => Effect.void,
    }),
    defaultPermissionAnswerLayer,
    Layer.succeed(SessionInstructions, {
      of: (session) =>
        Effect.sync(() => {
          asked.push('instructions')
          return `# Instructions of ${session}`
        }),
      renewed: (session) => Effect.succeed(`# Instructions of ${session}`),
    }),
  )
  return { agents, tokens, asked, layers }
}

const run = <A, E>(
  built: ReturnType<typeof world>,
  program: Effect.Effect<A, E, AgentRuntime | Storage | Scope.Scope>,
): Promise<A> =>
  on(
    data,
    program.pipe(
      Effect.provide(agentRuntimeLayer({ dataFolder: data, log: () => {} })),
      Effect.provide(acpTracesLayer(data)),
      Effect.provide(sessionTurnsLayer),
      Effect.provide(Layer.succeed(Secrets, secretsRegistry())),
      Effect.provide(built.layers),
    ),
  )

const session = (provider: 'claude' | 'codex' = 'claude') =>
  openAgentSession({
    provider,
    ownerKind: 'mission',
    ownerId: 'mission-1',
    role: 'builder',
    folder: '/tmp/acme',
  })

const say = (text: string) => [TextBlock.make({ text })]

describe('An agent is started bare, with Hemera’s server and nothing else', () => {
  test('the agent receives only the hemera MCP server, with its token, and no built-in tool', async () => {
    const built = world([OFFERED])
    await run(
      built,
      Effect.gen(function* () {
        const { id } = yield* session()
        yield* AgentRuntime.use((runtime) => runtime.prompt(id, say('hello')))
      }),
    )
    const [servers] = built.agents[0]?.answers.mcpServers ?? []
    expect(servers?.map((server) => server.name)).toEqual(['hemera'])
    expect(JSON.stringify(servers)).toContain('Bearer token-1')
    const meta = built.agents[0]?.answers.metas[0] ?? ''
    expect(meta).toContain('"tools":[]')
    expect(meta).not.toContain('mcp__hemera__*')
  })
})

describe('A session’s instructions are set once, at its start', () => {
  test('Claude Code takes them as its custom system prompt, and the first message is the caller’s', async () => {
    const built = world([{ steps: [{ does: 'says', text: 'done' }] }])
    const id = await run(
      built,
      Effect.gen(function* () {
        const opened = yield* session('claude')
        yield* AgentRuntime.use((runtime) => runtime.prompt(opened.id, say('[hemera:brief]')))
        yield* AgentRuntime.use((runtime) => runtime.prompt(opened.id, say('next')))
        return opened.id
      }),
    )
    const meta = JSON.parse(built.agents[0]?.answers.metas[0] ?? '{}')
    expect(meta.claudeCode.options.systemPrompt).toMatchObject({
      type: 'custom',
      prompt: `# Instructions of ${id}`,
    })
    expect(built.agents[0]?.answers.prompts).toEqual([
      [{ type: 'text', text: '[hemera:brief]' }],
      [{ type: 'text', text: 'next' }],
    ])
  })

  test('they are read before the token is minted: the tools a token grants follow them', async () => {
    const built = world([{ steps: [{ does: 'says', text: 'done' }] }])
    await run(
      built,
      Effect.gen(function* () {
        const opened = yield* session('claude')
        yield* AgentRuntime.use((runtime) => runtime.prompt(opened.id, say('[hemera:brief]')))
      }),
    )
    expect(built.asked).toEqual(['instructions', 'token'])
  })

  test('Codex takes them as an embedded resource before its first message, and never again', async () => {
    const built = world([{ steps: [{ does: 'says', text: 'done' }] }])
    const id = await run(
      built,
      Effect.gen(function* () {
        const opened = yield* session('codex')
        yield* AgentRuntime.use((runtime) => runtime.prompt(opened.id, say('[hemera:brief]')))
        yield* AgentRuntime.use((runtime) => runtime.prompt(opened.id, say('next')))
        return opened.id
      }),
    )
    const [first, second] = built.agents[0]?.answers.prompts ?? []
    expect(first).toEqual([
      {
        type: 'resource',
        resource: {
          uri: 'hemera://instructions',
          mimeType: 'text/markdown',
          text: `# Instructions of ${id}`,
        },
      },
      { type: 'text', text: '[hemera:brief]' },
    ])
    expect(second).toEqual([{ type: 'text', text: 'next' }])
  })
})

/** A step that lasts: what a turn does while its cancel is on its way. */
const LONG_WORK = { does: 'says', text: 'long work' } as const

/** Holds the first agent's turn until that agent has heard a cancel, however late it comes. */
const cancelHeard = async (built: ReturnType<typeof world>) => {
  while ((built.agents[0]?.answers.cancels ?? 0) === 0) {
    // oxlint-disable-next-line no-await-in-loop -- the agent's side is looked at again until it heard
    await sleep(5)
  }
}

/** Waits until the first agent has received a prompt. */
const prompted = async (built: ReturnType<typeof world>) => {
  while ((built.agents[0]?.answers.prompts.length ?? 0) === 0) {
    // oxlint-disable-next-line no-await-in-loop -- the agent's side is looked at again until it has it
    await sleep(5)
  }
}

describe('What an agent does is told as it happens', () => {
  test('each event of a session’s agent reaches the activity stream with the session’s id', async () => {
    const built = world([
      {
        steps: [
          { does: 'says', text: 'reading' },
          { does: 'spends', used: 10, size: 100 },
        ],
      },
    ])
    const seen = await run(
      built,
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const { id } = yield* session()
        const watching = yield* runtime.activity.pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.forkScoped,
        )
        yield* Effect.yieldNow
        yield* runtime.prompt(id, say('go'))
        const events = yield* Fiber.join(watching)
        return [...events].map((one) => [
          one.sessionId === id,
          Predicate.isTagged(one.event, 'MessageChunk') ? 'MessageChunk' : 'other',
        ])
      }),
    )
    expect(seen).toEqual([
      [true, 'MessageChunk'],
      [true, 'other'],
    ])
  })

  test('a turn is cancelled on the session’s agent', async () => {
    const built = world([{ between: () => cancelHeard(built), steps: [LONG_WORK] }])
    const outcome = await run(
      built,
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const { id } = yield* session()
        const turn = yield* runtime.prompt(id, say('go')).pipe(Effect.forkScoped)
        // Once the agent has the turn: before, there is no turn to cancel yet.
        yield* Effect.promise(() => prompted(built))
        yield* runtime.cancel(id)
        return yield* Fiber.join(turn)
      }),
    )
    expect(outcome.stopReason).toBe('cancelled')
    expect(built.agents[0]?.answers.cancels).toBe(1)
  })

  test('a turn cancelled while its agent starts ends cancelled, the cancel reaching the agent after the prompt', async () => {
    const asked = Promise.withResolvers<void>()
    const up = Promise.withResolvers<void>()
    const built = world(
      [{ between: () => cancelHeard(built), steps: [LONG_WORK] }],
      Effect.andThen(
        Effect.sync(() => asked.resolve()),
        Effect.promise(() => up.promise),
      ),
    )
    const outcome = await run(
      built,
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const { id } = yield* session()
        const turn = yield* runtime.prompt(id, say('go')).pipe(Effect.forkScoped)
        yield* Effect.promise(() => asked.promise)
        yield* runtime.cancel(id)
        up.resolve()
        return yield* Fiber.join(turn)
      }),
    )
    expect(outcome.stopReason).toBe('cancelled')
    expect(built.agents[0]?.answers.prompts).toHaveLength(1)
    expect(built.agents[0]?.answers.cancels).toBe(1)
  })

  test('a cancel between turns stops nothing: the next turn ends as the agent ends it', async () => {
    const built = world([{ steps: [{ does: 'says', text: 'done' }] }])
    const outcomes = await run(
      built,
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const { id } = yield* session()
        yield* runtime.cancel(id)
        const first = yield* runtime.prompt(id, say('go'))
        yield* runtime.cancel(id)
        const second = yield* runtime.prompt(id, say('again'))
        return [first.stopReason, second.stopReason]
      }),
    )
    expect(outcomes).toEqual(['end_turn', 'end_turn'])
    expect(built.agents[0]?.answers.cancels).toBe(0)
  })
})

describe('The options a session offers', () => {
  test('are read from its agent with their values now, the model picker’s list', async () => {
    const built = world([OFFERED])
    const options = await run(
      built,
      Effect.gen(function* () {
        const { id } = yield* session()
        return yield* AgentRuntime.use((runtime) => runtime.options(id))
      }),
    )
    expect(options.map((option) => [option.category, option.value])).toEqual([
      ['model', 'opus'],
      ['thought_level', 'medium'],
      ['mode', 'default'],
    ])
  })
})

describe('An agent that dies', () => {
  test('closes its turn as interrupted and revokes its token', async () => {
    const dying: FakeScript = { ...OFFERED, steps: [{ does: 'dies' }] }
    const built = world([dying])
    const [outcome, sessionId] = await run(
      built,
      Effect.gen(function* () {
        const { id } = yield* session()
        const turn = yield* AgentRuntime.use((runtime) => runtime.prompt(id, say('work')))
        return [turn, id] as const
      }),
    )
    expect(outcome.stopReason).toBe('interrupted')
    expect(built.tokens).toEqual([`mint ${sessionId}`, `revoke ${sessionId}`])
  })

  test('its death is told as a typed event, and no new process starts on its own', async () => {
    const built = world([{ ...OFFERED, steps: [{ does: 'dies' }] }])
    const deaths = await run(
      built,
      Effect.gen(function* () {
        const { id } = yield* session()
        const runtime = yield* AgentRuntime
        const heard = yield* Effect.forkChild(Stream.runCollect(Stream.take(runtime.deaths, 1)))
        yield* runtime.prompt(id, say('work'))
        const collected = yield* Fiber.join(heard)
        return [...collected]
      }),
    )
    expect(deaths).toHaveLength(1)
    expect(built.agents).toHaveLength(1)
  })
})

describe('The chosen model survives a restart of the agent', () => {
  test('after a death, the next prompt starts a process that resumes and gets model, effort, mode again', async () => {
    const built = world([{ ...OFFERED, turns: [[{ does: 'dies' }]] }, OFFERED])
    const stored = await run(
      built,
      Effect.gen(function* () {
        const { id } = yield* session()
        const runtime = yield* AgentRuntime
        yield* runtime.choose(id, 'model', 'sonnet')
        yield* runtime.choose(id, 'effort', 'low')
        yield* runtime.choose(id, 'mode', 'plan')
        yield* runtime.prompt(id, say('first'))
        yield* runtime.prompt(id, say('second'))
        return yield* getAgentSession(id)
      }),
    )
    expect(built.agents).toHaveLength(2)
    expect(built.agents[1]?.answers.resumes).toBe(1)
    expect(built.agents[1]?.answers.choices).toEqual(['model=sonnet', 'effort=low', 'mode=plan'])
    expect(stored.taken).toEqual({ model: 'sonnet', effort: 'low', mode: 'plan' })
  })

  test('a process let go for being idle is not the end of the session: the next prompt resumes it', async () => {
    const built = world([OFFERED, OFFERED])
    await run(
      built,
      Effect.gen(function* () {
        const { id } = yield* session()
        const runtime = yield* AgentRuntime
        yield* runtime.prompt(id, say('first'))
        yield* runtime.release(id)
        yield* runtime.prompt(id, say('second'))
      }),
    )
    expect(built.agents).toHaveLength(2)
    expect(built.agents[1]?.answers.resumes).toBe(1)
  })
})
