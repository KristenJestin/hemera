/**
 * The ACP client, against the fake agent: a real agent side of the protocol over in-memory
 * streams, handed over as an agents' process. Nothing here starts a process.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { Diagnostic } from '@hemera/ipc'
import { Effect, Exit, Fiber, Layer, Predicate, Stream } from 'effect'
import type { Scope } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  type AgentEvent,
  AgentGone,
  AgentPermissionAnswer,
  AgentProtocolError,
  type AgentConnection,
  CallContent,
  ImageNotAccepted,
  ModelUnavailable,
  ImageBlock,
  ResourceBlock,
  TEXT_LIMIT,
  TextBlock,
  connect,
  defaultPermissionAnswerLayer,
  isHemeraTool,
  processTransport,
} from '../src/engine/agents/client.ts'
import { type FakeAgent, type FakeScript, fakeAgent } from '../src/engine/agents/fake.ts'

/** Runs a test program with its scope and the default permission port. */
const run = <A, E>(
  program: Effect.Effect<A, E, Scope.Scope | AgentPermissionAnswer>,
  port: Layer.Layer<AgentPermissionAnswer> = defaultPermissionAnswerLayer,
): Promise<A> => Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(port)))

/** A connection to a scripted agent, with its session opened. */
const opened = (script: FakeScript) =>
  Effect.gen(function* () {
    const fake = fakeAgent(script)
    const connection = yield* connect({ transport: processTransport(fake.process, () => {}) })
    const session = yield* connection.newSession({ cwd: '/tmp/atlas', mcpServers: [] })
    return { fake, connection, session }
  })

const TAGS = [
  'MessageChunk',
  'ThoughtChunk',
  'ToolCall',
  'Plan',
  'Usage',
  'ModeChanged',
  'OptionsChanged',
  'Compacted',
  'ProviderWait',
  'ProviderLimit',
] as const

/** The kind of an event, by its tag. */
const tagOf = (event: AgentEvent) => TAGS.find((tag) => Predicate.isTagged(event, tag))

/** The next `count` events of a connection. */
const next = (connection: AgentConnection, count: number) =>
  Effect.map(Stream.runCollect(Stream.take(connection.events, count)), (events) => [...events])

const ASK_OPTIONS = [
  { id: 'allow', name: 'Allow once', kind: 'allow_once' },
  { id: 'always', name: 'Always allow', kind: 'allow_always' },
  { id: 'reject', name: 'Reject', kind: 'reject_once' },
] as const

const MODEL: SessionConfigOption = {
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select',
  currentValue: 'opus',
  options: [
    { value: 'opus', name: 'Opus' },
    { value: 'sonnet', name: 'Sonnet' },
    { value: 'haiku', name: 'Haiku' },
  ],
}

describe('A permission request is answered by the client itself', () => {
  test('a permission request about a Hemera tool is answered allow_once by the default port, any other is rejected', async () => {
    const asker = await run(
      Effect.gen(function* () {
        const { fake, session } = yield* opened({
          steps: [
            {
              does: 'asks',
              call: {
                id: 'c1',
                title: 'Read src/main.ts',
                toolName: 'mcp__hemera__fs_read',
                options: ASK_OPTIONS,
              },
            },
            { does: 'asks', call: { id: 'c2', title: 'hemera_fs_write', options: ASK_OPTIONS } },
            {
              does: 'asks',
              call: { id: 'c3', title: 'Bash', toolName: 'Bash', options: ASK_OPTIONS },
            },
            { does: 'asks', call: { id: 'c4', title: 'rm -rf build', options: ASK_OPTIONS } },
          ],
        })
        yield* session.prompt([TextBlock.make({ text: 'go' })])
        return fake
      }),
    )
    expect(asker.answers.optionIds).toEqual(['allow', 'allow', 'reject', 'reject'])
  })

  test('a Hemera tool is named mcp__hemera__ by Claude Code and hemera_ by the others', () => {
    expect(
      ['mcp__hemera__fs_read', 'hemera_commands_run', 'Bash', 'mcp__other__x'].map(isHemeraTool),
    ).toEqual([true, true, false, false])
  })

  test('another port replaces the default, and a cancelled turn answers its question cancelled', async () => {
    let reached: () => void = () => undefined
    const asked = new Promise<void>((resolve) => {
      reached = resolve
    })
    // A port that never answers: the question stands until the turn is cancelled.
    const silent = Layer.succeed(AgentPermissionAnswer, {
      answer: () => Effect.andThen(Effect.sync(reached), Effect.never),
    })
    const [asker, waitedWhileAsked, turnEnd] = await run(
      Effect.gen(function* () {
        const { fake, session, connection } = yield* opened({
          steps: [
            { does: 'asks', call: { id: 'c1', title: 'hemera_fs_read', options: ASK_OPTIONS } },
          ],
        })
        const turn = yield* Effect.forkScoped(session.prompt([TextBlock.make({ text: 'go' })]))
        yield* Effect.promise(() => asked)
        const waiting = connection.waiting()
        yield* session.cancel
        const ended = yield* Fiber.await(turn)
        return [fake, waiting, ended] as const
      }),
      silent,
    )
    expect(waitedWhileAsked).toBe(true)
    expect(asker.answers.cancelled).toBe(1)
    expect(Exit.isSuccess(turnEnd) && turnEnd.value.stopReason).toBe('cancelled')
  })
})

describe('Options and the model', () => {
  test('options and their defaults are read', async () => {
    const options = await run(
      Effect.gen(function* () {
        const { session } = yield* opened({
          configOptions: [
            MODEL,
            {
              id: 'effort',
              name: 'Effort',
              category: 'thought_level',
              type: 'select',
              currentValue: 'medium',
              options: [
                { value: 'low', name: 'Low' },
                { value: 'medium', name: 'Medium', description: 'Balanced' },
              ],
              _meta: { jetbrains: { air: { version: 1, recommendedValue: 'medium' } } },
            },
            { id: 'fast', name: 'Fast', type: 'boolean', currentValue: false },
          ],
        })
        yield* session.setOption('model', 'sonnet')
        return session.options()
      }),
    )
    expect(options).toEqual([
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        kind: 'select',
        value: 'sonnet',
        defaultValue: 'opus',
        values: [
          { id: 'opus', name: 'Opus', description: null, recommended: false },
          { id: 'sonnet', name: 'Sonnet', description: null, recommended: false },
          { id: 'haiku', name: 'Haiku', description: null, recommended: false },
        ],
      },
      {
        id: 'effort',
        name: 'Effort',
        category: 'thought_level',
        kind: 'select',
        value: 'medium',
        defaultValue: 'medium',
        values: [
          { id: 'low', name: 'Low', description: null, recommended: false },
          { id: 'medium', name: 'Medium', description: 'Balanced', recommended: true },
        ],
      },
      {
        id: 'fast',
        name: 'Fast',
        category: null,
        kind: 'boolean',
        value: 'false',
        defaultValue: 'false',
        values: [],
      },
    ])
  })

  test('a Default the agent names is replaced by the value it stands for; one it does not name stays', async () => {
    const [named, unnamed] = await run(
      Effect.gen(function* () {
        const withDefault = (description: string | null): SessionConfigOption => ({
          ...MODEL,
          currentValue: 'default',
          options: [
            { value: 'default', name: 'Default', description },
            { value: 'opus-4-5', name: 'Opus 4.5' },
            { value: 'opus-4', name: 'Opus 4' },
          ],
        })
        const first = yield* opened({ configOptions: [withDefault('Opus 4.5 · 1M context')] })
        const second = yield* opened({ configOptions: [withDefault(null)] })
        return [first.session.options()[0], second.session.options()[0]] as const
      }),
    )
    expect(named?.values.map((value) => value.id)).toEqual(['opus-4-5', 'opus-4'])
    expect(named?.value).toBe('opus-4-5')
    expect(named?.values[0]?.recommended).toBe(true)
    expect(unnamed?.values.map((value) => value.id)).toEqual(['default', 'opus-4-5', 'opus-4'])
    expect(unnamed?.value).toBe('default')
  })

  test('the client asks the agent to name its recommended values', async () => {
    const advertiser = await run(Effect.map(opened({}), (opening) => opening.fake))
    expect(advertiser.answers.advertised[0]).toContain('"recommendedValue"')
  })

  test('a model refused by the agent surfaces as a typed refusal naming the model, never another model', async () => {
    const [onRefusal, onSubstitution, onUnknown, choices] = await run(
      Effect.gen(function* () {
        const refusing = yield* opened({ configOptions: [MODEL], refusesModels: ['haiku'] })
        const refused = yield* Effect.flip(refusing.session.setOption('model', 'haiku'))
        // An agent that answers with another model than the one chosen refused it too.
        const swapping = yield* opened({ configOptions: [MODEL], substitutesModel: 'opus' })
        const substituted = yield* Effect.flip(swapping.session.setOption('model', 'sonnet'))
        // A model the agent does not offer is never sent.
        const unknown = yield* Effect.flip(refusing.session.setOption('model', 'gone-model'))
        return [refused, substituted, unknown, refusing.fake.answers.choices] as const
      }),
    )
    for (const [error, model] of [
      [onRefusal, 'haiku'],
      [onSubstitution, 'sonnet'],
      [onUnknown, 'gone-model'],
    ] as const) {
      expect(error).toBeInstanceOf(ModelUnavailable)
      expect(Predicate.isTagged(error, 'ModelUnavailable') && error.model).toBe(model)
    }
    expect(onSubstitution.message).not.toContain('opus')
    expect(choices).toEqual(['model=haiku'])
  })

  test('a mode or an option the agent moves by itself is an event, and the options follow', async () => {
    const [events, options, modes] = await run(
      Effect.gen(function* () {
        const { connection, session } = yield* opened({
          configOptions: [
            MODEL,
            {
              id: 'mode',
              name: 'Mode',
              category: 'mode',
              type: 'select',
              currentValue: 'default',
              options: [
                { value: 'default', name: 'Ask' },
                { value: 'plan', name: 'Plan' },
              ],
            },
          ],
          modes: {
            currentModeId: 'default',
            availableModes: [
              { id: 'default', name: 'Ask' },
              { id: 'plan', name: 'Plan' },
            ],
          },
          steps: [
            { does: 'switches', option: 'mode', value: 'plan', as: 'mode' },
            { does: 'switches', option: 'model', value: 'haiku' },
          ],
        })
        yield* session.prompt([TextBlock.make({ text: 'go' })])
        return [yield* next(connection, 2), session.options(), session.modes] as const
      }),
    )
    expect(events.map(tagOf)).toEqual(['ModeChanged', 'OptionsChanged'])
    expect(options.map((option) => option.value)).toEqual(['haiku', 'plan'])
    expect(modes).toEqual({
      currentModeId: 'default',
      available: [
        { id: 'default', name: 'Ask' },
        { id: 'plan', name: 'Plan' },
      ],
    })
  })
})

describe('A turn', () => {
  test('message chunks, thoughts, tool calls, plans and usage arrive as typed events', async () => {
    const [events, ended] = await run(
      Effect.gen(function* () {
        const { connection, session } = yield* opened({
          steps: [
            { does: 'thinks', text: 'the parser drops a line' },
            { does: 'says', text: 'Reading', messageId: 'm1' },
            {
              does: 'calls',
              call: { id: 'c1', title: 'hemera_fs_read', kind: 'read', path: '/tmp/atlas/a.ts' },
            },
            {
              does: 'updates',
              call: {
                id: 'c1',
                status: 'completed',
                content: [{ type: 'content', content: { type: 'text', text: 'export {}' } }],
              },
            },
            { does: 'plans', lines: [{ content: 'fix it', status: 'pending' }] },
            { does: 'spends', used: 1200, size: 200_000 },
          ],
          usage: { totalTokens: 120, inputTokens: 100, outputTokens: 20 },
        })
        const outcome = yield* session.prompt([TextBlock.make({ text: 'fix the parser' })])
        return [yield* next(connection, 6), outcome] as const
      }),
    )
    expect(events.map(tagOf)).toEqual([
      'ThoughtChunk',
      'MessageChunk',
      'ToolCall',
      'ToolCall',
      'Plan',
      'Usage',
    ])
    expect(events[1]).toMatchObject({ text: 'Reading', messageId: 'm1', replay: false })
    expect(events[2]).toMatchObject({
      call: { id: 'c1', title: 'hemera_fs_read', kind: 'read', status: 'pending' },
    })
    expect(events[3]).toMatchObject({
      call: {
        id: 'c1',
        title: null,
        status: 'completed',
        content: [CallContent.make({ text: 'export {}', mime: null })],
      },
    })
    expect(events[5]).toMatchObject({ used: 1200, size: 200_000, cost: null })
    expect(ended).toEqual({
      stopReason: 'end_turn',
      usage: { totalTokens: 120, inputTokens: 100, outputTokens: 20, thoughtTokens: null },
    })
  })

  test('a compaction and a wait on the provider arrive as their own events', async () => {
    const events = await run(
      Effect.gen(function* () {
        const { connection, session } = yield* opened({
          steps: [
            { does: 'compacts', id: 'compact-1' },
            { does: 'waits', title: 'Retrying Claude, attempt 1 of 10.' },
          ],
        })
        yield* session.prompt([TextBlock.make({ text: 'go on' })])
        return yield* next(connection, 2)
      }),
    )
    expect(events.map(tagOf)).toEqual(['Compacted', 'ProviderWait'])
    expect(events[1]).toMatchObject({ title: 'Retrying Claude, attempt 1 of 10.' })
  })

  test('a limit the provider holds after the agent’s own retries arrives as its own event', async () => {
    const events = await run(
      Effect.gen(function* () {
        const { connection, session } = yield* opened({
          steps: [
            { does: 'waits', title: 'Claude is temporarily rate limited.' },
            { does: 'limits', title: 'The Claude account has no available quota.' },
          ],
        })
        yield* session.prompt([TextBlock.make({ text: 'go on' })])
        return yield* next(connection, 2)
      }),
    )
    expect(events.map(tagOf)).toEqual(['ProviderWait', 'ProviderLimit'])
    expect(events[1]).toMatchObject({ title: 'The Claude account has no available quota.' })
  })

  test('the client announces it reads the agent’s notices of a failing provider', async () => {
    const advertised = await run(
      Effect.gen(function* () {
        const { fake } = yield* opened({})
        return fake.answers.advertised
      }),
    )
    expect(JSON.parse(advertised[0] ?? '{}')).toMatchObject({
      _meta: { jetbrains: { air: { capabilities: ['recommendedValue', 'sessionFailure'] } } },
    })
  })

  test('the text an event carries is bounded', async () => {
    const [event] = await run(
      Effect.gen(function* () {
        const { connection, session } = yield* opened({
          steps: [{ does: 'says', text: 'x'.repeat(TEXT_LIMIT * 2) }],
        })
        yield* session.prompt([TextBlock.make({ text: 'go' })])
        return yield* next(connection, 1)
      }),
    )
    expect(Predicate.isTagged(event, 'MessageChunk') && event.text.length).toBeLessThan(
      TEXT_LIMIT + 50,
    )
  })

  test('an agent that dies mid-turn closes the turn as interrupted', async () => {
    const [dying, afterDeath] = await run(
      Effect.gen(function* () {
        const { session } = yield* opened({
          steps: [{ does: 'says', text: 'starting' }, { does: 'dies' }],
        })
        const outcome = yield* session.prompt([TextBlock.make({ text: 'go' })])
        const again = yield* Effect.flip(session.prompt([TextBlock.make({ text: 'again' })]))
        return [outcome, again] as const
      }),
    )
    expect(dying).toEqual({ stopReason: 'interrupted', usage: null })
    expect(afterDeath).toBeInstanceOf(AgentGone)
  })

  test('the events stream ends when the agent dies', async () => {
    const events = await run(
      Effect.gen(function* () {
        const { connection, session } = yield* opened({
          steps: [{ does: 'says', text: 'starting' }, { does: 'dies' }],
        })
        yield* session.prompt([TextBlock.make({ text: 'go' })])
        yield* connection.gone
        return yield* Stream.runCollect(connection.events)
      }),
    )
    expect([...events].map(tagOf)).toEqual(['MessageChunk'])
  })

  test('a stopped turn is cancelled, and the agent answers that it was', async () => {
    let reached: () => void = () => undefined
    const atSecondStep = new Promise<void>((resolve) => {
      reached = resolve
    })
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let steps = 0
    const outcome = await run(
      Effect.gen(function* () {
        const { session } = yield* opened({
          between: async () => {
            steps += 1
            if (steps !== 2) return
            reached()
            await held
          },
          steps: [
            { does: 'says', text: 'starting' },
            { does: 'says', text: 'never said' },
          ],
        })
        const turn = yield* Effect.forkScoped(session.prompt([TextBlock.make({ text: 'go' })]))
        yield* Effect.promise(() => atSecondStep)
        yield* session.cancel
        release()
        return yield* Fiber.await(turn)
      }),
    )
    expect(Exit.isSuccess(outcome) && outcome.value.stopReason).toBe('cancelled')
  })

  test('text and embedded resources are sent as they are', async () => {
    const sent = await run(
      Effect.gen(function* () {
        const { fake, session } = yield* opened({})
        yield* session.prompt([
          ResourceBlock.make({
            uri: 'hemera://system',
            mimeType: 'text/markdown',
            text: '# Rules',
          }),
          TextBlock.make({ text: 'hello' }),
        ])
        return fake
      }),
    )
    expect(sent.answers.prompts[0]).toEqual([
      {
        type: 'resource',
        resource: { uri: 'hemera://system', mimeType: 'text/markdown', text: '# Rules' },
      },
      { type: 'text', text: 'hello' },
    ])
  })

  test('images are sent only when the agent accepts them', async () => {
    const image = ImageBlock.make({ mimeType: 'image/png', data: 'iVBORw0KGgo=' })
    const [onRefusal, onAcceptance, refusingFake, acceptingFake] = await run(
      Effect.gen(function* () {
        const refusing = yield* opened({ images: false })
        const refused = yield* Effect.flip(
          refusing.session.prompt([TextBlock.make({ text: 'look' }), image]),
        )
        const accepting = yield* opened({ images: true })
        const accepted = yield* accepting.session.prompt([TextBlock.make({ text: 'look' }), image])
        return [refused, accepted, refusing.fake, accepting.fake] as const
      }),
    )
    expect(onRefusal).toBeInstanceOf(ImageNotAccepted)
    expect(refusingFake.answers.prompts).toEqual([])
    expect(onAcceptance.stopReason).toBe('end_turn')
    expect(acceptingFake.answers.prompts[0]?.[1]).toEqual({
      type: 'image',
      mimeType: 'image/png',
      data: 'iVBORw0KGgo=',
    })
  })
})

describe('Opening a session', () => {
  test('the handshake says what the agent can do', async () => {
    const handshake = await run(
      Effect.gen(function* () {
        const fake = fakeAgent({
          loads: true,
          resumes: false,
          images: true,
          authMethods: [{ id: 'api-key', name: 'API key' }],
        })
        const connection = yield* connect({ transport: processTransport(fake.process, () => {}) })
        return connection.handshake
      }),
    )
    expect(handshake).toMatchObject({
      authMethods: [{ id: 'api-key', name: 'API key' }],
      loads: true,
      resumes: false,
      images: true,
      embeddedContext: true,
      agentName: 'Fake agent',
    })
  })

  test('the servers and the opaque _meta are handed over as they are, on every way in', async () => {
    const meta = { claudeCode: { options: { tools: [] } } }
    const server = {
      type: 'http' as const,
      name: 'hemera',
      url: 'http://127.0.0.1:1/mcp',
      headers: [{ name: 'Authorization', value: 'Bearer t' }],
    }
    const handed = await run(
      Effect.gen(function* () {
        const fake = fakeAgent({ loads: true })
        const connection = yield* connect({ transport: processTransport(fake.process, () => {}) })
        const opening = { cwd: '/tmp/atlas', mcpServers: [server], meta }
        yield* connection.newSession(opening)
        yield* connection.resumeSession('native-session', opening)
        yield* connection.loadSession('native-session', opening)
        return fake
      }),
    )
    expect(handed.answers.mcpServers).toEqual([[server], [server], [server]])
    expect(handed.answers.metas).toEqual(Array.from({ length: 3 }, () => JSON.stringify(meta)))
  })

  test('a resumed session sends nothing back; a loaded one is replayed and says so', async () => {
    const [resumedEvents, loadedEvents, onRefusal] = await run(
      Effect.gen(function* () {
        const script: FakeScript = {
          loads: true,
          history: [{ does: 'says', text: 'the turn you already have' }],
          steps: [{ does: 'says', text: 'new' }],
        }
        const resuming = fakeAgent(script)
        const first = yield* connect({ transport: processTransport(resuming.process, () => {}) })
        const resumed = yield* first.resumeSession('native-session', {
          cwd: '/tmp',
          mcpServers: [],
        })
        yield* resumed.prompt([TextBlock.make({ text: 'go' })])
        const afterResume = yield* next(first, 1)

        const loading = fakeAgent(script)
        const second = yield* connect({ transport: processTransport(loading.process, () => {}) })
        const loaded = yield* second.loadSession('native-session', { cwd: '/tmp', mcpServers: [] })
        yield* loaded.prompt([TextBlock.make({ text: 'go' })])
        const afterLoad = yield* next(second, 2)

        const refusing = fakeAgent({ refusesResume: true })
        const third = yield* connect({ transport: processTransport(refusing.process, () => {}) })
        const refused = yield* Effect.flip(
          third.resumeSession('native-session', { cwd: '/tmp', mcpServers: [] }),
        )
        return [afterResume, afterLoad, refused] as const
      }),
    )
    expect(
      resumedEvents.map((event) => Predicate.isTagged(event, 'MessageChunk') && event.replay),
    ).toEqual([false])
    expect(
      loadedEvents.map((event) => Predicate.isTagged(event, 'MessageChunk') && event.replay),
    ).toEqual([true, false])
    expect(onRefusal).toBeInstanceOf(AgentProtocolError)
    expect(Predicate.isTagged(onRefusal, 'AgentProtocolError') && onRefusal.method).toBe(
      'session/resume',
    )
  })

  test('what the agent writes on its error output goes to the diagnostic, not to the protocol', async () => {
    const lines: string[] = []
    const fake: FakeAgent = fakeAgent({})
    const transport = processTransport(
      {
        ...fake.process,
        output: Stream.concat(
          Stream.make(Diagnostic.make({ line: 'warming up' })),
          fake.process.output,
        ),
      },
      (line) => lines.push(line),
    )
    await run(Effect.asVoid(connect({ transport })))
    expect(lines).toEqual(['warming up'])
  })
})

describe('The fake agent stays out of the application', () => {
  test('no file of the application imports the fake agent', () => {
    const source = join(import.meta.dirname, '..', 'src')
    const files = (folder: string): string[] =>
      readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? files(join(folder, entry.name))
          : /\.tsx?$/.test(entry.name)
            ? [join(folder, entry.name)]
            : [],
      )
    const importers = files(source).filter((file) =>
      /from '[^']*\/fake(?:\.ts)?'/.test(readFileSync(file, 'utf8')),
    )
    expect(importers.map((file) => relative(source, file))).toEqual([])
  })
})
