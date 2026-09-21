/**
 * The fake agent as the engine's runtime will meet it: through the supervisor's port (D5-16).
 *
 * Nothing here is mocked and nothing is `vi.mock`ed — the lint refuses it — and no child process
 * is ever spawned: the layer under test answers the `ProcessSupervisor` port with the same two
 * pipes the client's suite talks to, so what is proved is that a runtime wired through this port
 * really can start an agent, write to it, read what it writes, and see it die.
 *
 * The first suites drive the process by hand, with no client of Hemera's in between, because
 * that is the only way to say which of the two directions failed when one does. The last two put
 * a real `connect` on top of the same pipes, which is the wiring the runtime itself will use.
 *
 * Every process is started and ended inside one `opened` call: the scope that started it is what
 * stops it, and a process returned from one scope to be driven in another would be a process its
 * own harness had already stopped.
 */

import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { describe, expect, test } from 'vite-plus/test'
import { Effect } from 'effect'
import type { Scope } from 'effect'

import { codex } from '#engine/agents/adapters/codex.ts'
import { type AgentEvent, type PermissionQuestion, connect } from '#engine/agents/client.ts'
import { type FakeAgent, fakeAgent, fakeSupervisor } from '#engine/agents/fake.ts'
import { ProcessSupervisor, type SupervisedProcess } from '#engine/agents/supervisor.ts'

/** The first message of any ACP conversation, written by hand rather than by a client. */
const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: PROTOCOL_VERSION },
})

/**
 * The supervisor over one fake agent, and the scope that ends the process it hands out.
 *
 * `fakeSupervisor` is the injection point the design asks for: the runtime is written against
 * the port, and a test replaces the machine with a peer that is already in this process.
 */
const opened =
  (agent: FakeAgent) =>
  <A, E>(program: Effect.Effect<A, E, ProcessSupervisor | Scope.Scope>): Promise<A> =>
    Effect.runPromise(Effect.scoped(Effect.provide(program, fakeSupervisor(agent))))

/**
 * The lines the process hands over, awaited one at a time.
 *
 * The supervisor hands over whole lines and never chunks, so a test that reads one line is
 * reading one message: what is proved is the port's two directions, with nothing between them.
 */
const feedOf = (process: SupervisedProcess) => {
  const lines: string[] = []
  let wake: (() => void) | null = null
  process.onStdout((line) => {
    lines.push(line)
    wake?.()
    wake = null
  })
  return async (): Promise<string> => {
    while (lines.length === 0) {
      // oxlint-disable-next-line no-await-in-loop -- one line at a time is the whole helper: there is no second line to collect in parallel, only the next one to wait for
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
    return lines.shift() ?? ''
  }
}

/**
 * The two pipes a client is handed for a supervised process.
 *
 * `connect` wants streams and the port speaks lines, so this is the seam between the two — the
 * same one the runtime has to build — and it is deliberately the only adaptation here.
 */
const pipesOf = (process: SupervisedProcess) => {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const input = new ReadableStream<Uint8Array>({
    start: (held) => {
      process.onStdout((line) => {
        // A line is framed again as it arrived: the SDK's framing is one JSON message per line,
        // and a reader that was handed the line without its terminator would never see an end.
        held.enqueue(encoder.encode(`${line}\n`))
      })
    },
  })
  const output = new WritableStream<Uint8Array>({
    write: async (chunk) => {
      await Effect.runPromise(process.write(decoder.decode(chunk)))
    },
  })
  return { input, output }
}

/** Starts one process through the port, which is the only way a runtime ever gets one. */
const started = Effect.gen(function* () {
  const supervisor = yield* ProcessSupervisor
  return yield* supervisor.start('fake-agent', [], {})
})

describe('Le port du superviseur, tenu par un agent scripté', () => {
  test('a line written to the process reaches the agent, and its answer comes back on stdout', async () => {
    const agent = fakeAgent()
    const answer = await opened(agent)(
      Effect.gen(function* () {
        const process = yield* started
        const next = feedOf(process)
        yield* process.write(INITIALIZE)
        return yield* Effect.promise(() => next())
      }),
    )

    // The agent's own answer to the client's first message, framed by the SDK and by nothing
    // else: this is the handshake a runtime performs, without the runtime.
    expect(JSON.parse(answer)).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: PROTOCOL_VERSION, agentInfo: { name: 'Fake agent' } },
    })
  })

  test('the configuration options of the script are what session/new announces', async () => {
    const agent = fakeAgent({
      configOptions: [
        {
          type: 'select',
          id: 'model',
          name: 'Model',
          currentValue: 'gpt-5',
          options: [{ value: 'gpt-5', name: 'GPT-5' }],
        },
      ],
    })
    const answer = await opened(agent)(
      Effect.gen(function* () {
        const process = yield* started
        const next = feedOf(process)
        yield* process.write(INITIALIZE)
        yield* Effect.promise(() => next())
        yield* process.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'session/new',
            params: { cwd: '/tmp/atlas', mcpServers: [] },
          }),
        )
        return yield* Effect.promise(() => next())
      }),
    )

    // What the agent announces is the script's own shape, untouched: a runtime reads the
    // options it was sent, and an agent that renamed them would be testing a translation.
    expect(JSON.parse(answer)).toMatchObject({
      id: 2,
      result: {
        sessionId: 'native-session',
        configOptions: [
          {
            type: 'select',
            id: 'model',
            name: 'Model',
            currentValue: 'gpt-5',
            options: [{ value: 'gpt-5', name: 'GPT-5' }],
          },
        ],
      },
    })
  })

  test('a script that refuses to load answers an error rather than a session', async () => {
    const agent = fakeAgent({ refusesLoad: true })
    const answer = await opened(agent)(
      Effect.gen(function* () {
        const process = yield* started
        const next = feedOf(process)
        yield* process.write(INITIALIZE)
        yield* Effect.promise(() => next())
        yield* process.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 3,
            method: 'session/load',
            params: { sessionId: 'native-session', cwd: '/tmp/atlas', mcpServers: [] },
          }),
        )
        return yield* Effect.promise(() => next())
      }),
    )

    const refused = JSON.parse(answer)
    // A refusal is a failed call and not a session that silently went missing: a runtime has to
    // be able to tell an agent that will not continue a conversation from one that cannot.
    expect(refused.error).toBeDefined()
    expect(refused.result).toBeUndefined()
    expect(agent.answers.loads).toBe(1)
  })

  test('a stop ends the process, and exited reports the death', async () => {
    const agent = fakeAgent()
    const death = await opened(agent)(
      Effect.gen(function* () {
        const process = yield* started
        yield* process.stop
        return yield* process.exited
      }),
    )

    expect(death).toMatchObject({ code: 0, signal: null })
    // The fake's own promise is settled by the same death the port reported, so a suite that
    // waits on it after a stop is not left hanging on a process that has already ended.
    await agent.exited
  })
})

describe('Un tour de l’agent, conduit par le client', () => {
  test('a permission request scripted in the turn reaches the client through the pipes', async () => {
    const agent = fakeAgent({
      steps: [
        {
          does: 'asks',
          call: {
            id: 'call-2',
            title: 'Run the tests',
            options: [{ id: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
          },
        },
        { does: 'says', text: 'done' },
      ],
    })
    const questions: PermissionQuestion[] = []
    const events: AgentEvent[] = []

    const outcome = await opened(agent)(
      Effect.gen(function* () {
        const process = yield* started
        const pipes = pipesOf(process)
        const connection = yield* connect({
          input: pipes.input,
          output: pipes.output,
          adapter: codex,
          onEvent: (event) => events.push(event),
          onPermission: async (question) => {
            questions.push(question)
            return { optionId: 'allow-once' }
          },
        })
        yield* connection.open('/tmp/atlas')
        return yield* connection.prompt('run them')
      }),
    )

    // The question crossed the port in both directions: the agent asked through its own pipe,
    // and the answer the user gave went back the same way.
    expect(questions).toEqual([
      {
        toolCallId: 'call-2',
        title: 'Run the tests',
        options: [{ id: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
      },
    ])
    expect(agent.answers.optionIds).toEqual(['allow-once'])
    expect(agent.answers.prompts).toEqual(['run them'])
    expect(outcome.stopReason).toBe('end_turn')
    expect(events.map((event) => ('text' in event ? event.text : ''))).toContain('done')
  })

  test('an agent that ignores cancel keeps the turn open and answers it anyway', async () => {
    let stopTheTurn: () => Promise<void> = async () => undefined
    let before: number = 0
    const between = async (): Promise<void> => {
      before += 1
      // The turn is stopped from inside itself, between two of its steps: a Stop can only be
      // tested while the agent is really working, and this is what makes that a fact.
      if (before !== 2) return
      await stopTheTurn()
    }
    const agent = fakeAgent({
      ignoresCancel: true,
      between,
      steps: [
        { does: 'says', text: 'starting' },
        { does: 'says', text: 'and still here' },
      ],
    })
    const events: AgentEvent[] = []

    const outcome = await opened(agent)(
      Effect.gen(function* () {
        const process = yield* started
        const pipes = pipesOf(process)
        const connection = yield* connect({
          input: pipes.input,
          output: pipes.output,
          adapter: codex,
          onEvent: (event) => events.push(event),
          onPermission: async () => ({ optionId: 'allow-once' }),
        })
        yield* connection.open('/tmp/atlas')
        stopTheTurn = () => Effect.runPromise(connection.cancel())
        return yield* connection.prompt('go')
      }),
    )

    // The turn ran to its own end rather than to the Stop: the scripted answer is what the
    // client is given, and the step the agent reached after the cancel is on the wire. A Stop
    // that waited for this agent would be the hang the design has to survive.
    expect(outcome.stopReason).toBe('end_turn')
    expect(events.map((event) => ('text' in event ? event.text : ''))).toEqual([
      'starting',
      'and still here',
    ])
    expect(agent.answers.cancelled).toBe(0)
  })
})
