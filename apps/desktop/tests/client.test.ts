/**
 * The engine's side of ACP, proved against a peer that really speaks it (D5-03).
 *
 * Each suite is named after the scenario of the issue's `Spec · agent-runtime` section that it
 * covers, and every one of them talks to `fakeAgent`: a real agent side of the protocol, over a
 * pair of in-memory streams. Nothing here starts a process or needs an agent installed, and
 * nothing here replaces the protocol with a stub of it — what is asserted is what a client of
 * this protocol must do with what it is sent.
 */

import { describe, expect, test } from 'vite-plus/test'
import { Effect } from 'effect'

import { type AgentAdapter } from '#engine/agents/adapter.ts'
import { claude } from '#engine/agents/adapters/claude.ts'
import { codex } from '#engine/agents/adapters/codex.ts'
import {
  type AgentEvent,
  type PermissionAnswer,
  type PermissionQuestion,
  connect,
} from '#engine/agents/client.ts'
import { type FakeBehaviour, fakeAgent } from './fake-agent.ts'

/** The answer given to every question, unless a suite asks for another one. */
const ALLOWED: PermissionAnswer = { optionId: 'allow-once' }

/** A connection to a scripted agent, and everything that was said to it or by it. */
async function opened(
  behaviour: FakeBehaviour,
  adapter: AgentAdapter = codex,
  answer: PermissionAnswer = ALLOWED,
) {
  const fake = fakeAgent(behaviour)
  const events: AgentEvent[] = []
  const questions: PermissionQuestion[] = []
  const connection = await Effect.runPromise(
    connect({
      // The agent's own pipes: what it writes is what this side reads.
      input: fake.output,
      output: fake.input,
      adapter,
      onEvent: (event) => events.push(event),
      onPermission: async (question) => {
        questions.push(question)
        return answer
      },
    }),
  )
  return { connection, events, questions, fake }
}

describe('Ce que l’agent annonce de lui-même', () => {
  test('the agent is read from what it announces, by its own adapter', async () => {
    const signedIn = await opened({ authMethods: [{ id: 'api-key', name: 'API key' }] }, codex)
    expect(signedIn.connection.handshake.authenticated).toBe(true)
    expect(signedIn.connection.handshake.authMethods).toEqual([
      { id: 'api-key', name: 'API key' },
    ])
    // Codex cannot be asked to continue a session, and its adapter knows that: this is what
    // makes the Agents page say so before a turn is ever sent.
    expect(signedIn.connection.handshake.continues).toBe(false)

    const signedOut = await opened(
      { authMethods: [{ id: 'claude-ai-login', name: 'Sign in with Claude' }] },
      claude,
    )
    expect(signedOut.connection.handshake.authenticated).toBe(false)

    const continues = await opened({ continues: true }, codex)
    expect(continues.connection.handshake.continues).toBe(true)
  })
})

describe('Un tour en cours', () => {
  test('text and thoughts arrive while the turn runs', async () => {
    const { connection, events } = await opened({
      steps: [
        { does: 'thinks', text: 'the parser drops the last line' },
        { does: 'says', text: 'Reading the file' },
        { does: 'says', text: ' and fixing it.' },
      ],
      usage: { totalTokens: 120, inputTokens: 100, outputTokens: 20 },
    })

    const openedNative = await Effect.runPromise(connection.open('/tmp/atlas'))
    expect(openedNative).toBe('native-session')

    const outcome = await Effect.runPromise(connection.prompt('fix the parser'))

    expect(outcome.stopReason).toBe('end_turn')
    expect(outcome.usage).toEqual({
      totalTokens: 120,
      inputTokens: 100,
      outputTokens: 20,
      thoughtTokens: null,
    })
    // In the order the agent sent them, with what arrived while it worked and nothing else.
    expect(events.map((event) => [event.type, 'text' in event ? event.text : ''])).toEqual([
      ['thought', 'the parser drops the last line'],
      ['message', 'Reading the file'],
      ['message', ' and fixing it.'],
    ])
    expect(events.every((event) => !event.replay)).toBe(true)
  })

  test('a tool call is reported with what it is about, and its update is the same call', async () => {
    const { connection, events } = await opened({
      steps: [
        {
          does: 'calls',
          call: { id: 'call-1', title: 'Read parser.ts', kind: 'read', status: 'pending', path: '/tmp/atlas/parser.ts' },
        },
        { does: 'updates', call: { id: 'call-1', status: 'completed' } },
      ],
    })
    await Effect.runPromise(connection.open('/tmp/atlas'))
    await Effect.runPromise(connection.prompt('look at it'))

    const calls = events.filter((event) => event.type === 'tool_call')
    expect(calls.map((event) => event.call.id)).toEqual(['call-1', 'call-1'])
    expect(calls[0]?.call).toMatchObject({
      title: 'Read parser.ts',
      kind: 'read',
      status: 'pending',
      locations: ['/tmp/atlas/parser.ts'],
    })
    // An update carries only what changed: what it does not repeat is read as unchanged.
    expect(calls[1]?.call).toMatchObject({ title: '', status: 'completed' })
  })

  test('the plan the agent keeps is reported as its lines', async () => {
    const { connection, events } = await opened({
      steps: [
        {
          does: 'plans',
          lines: [
            { content: 'read the parser', status: 'in_progress' },
            { content: 'fix the last line', status: 'pending' },
          ],
        },
      ],
    })
    await Effect.runPromise(connection.open('/tmp/atlas'))
    await Effect.runPromise(connection.prompt('plan it'))

    expect(events).toEqual([
      {
        type: 'plan',
        replay: false,
        entries: [
          { content: 'read the parser', status: 'in_progress' },
          { content: 'fix the last line', status: 'pending' },
        ],
      },
    ])
  })
})

describe('Une permission demandée en cours de tour', () => {
  test('a permission request is the user’s to answer, and the answer is what the agent gets', async () => {
    const { connection, questions, fake } = await opened(
      {
        steps: [
          {
            does: 'asks',
            call: {
              id: 'call-2',
              title: 'Run the tests',
              options: [
                { id: 'allow-once', name: 'Allow once', kind: 'allow_once' },
                { id: 'allow-always', name: 'Always allow', kind: 'allow_always' },
                { id: 'reject-once', name: 'Refuse', kind: 'reject_once' },
              ],
            },
          },
          { does: 'says', text: 'done' },
        ],
      },
      codex,
      { optionId: 'reject-once' },
    )
    await Effect.runPromise(connection.open('/tmp/atlas'))
    const outcome = await Effect.runPromise(connection.prompt('run them'))

    // The question reached the user with the options the agent offered...
    expect(questions).toEqual([
      {
        toolCallId: 'call-2',
        title: 'Run the tests',
        options: [
          { id: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { id: 'allow-always', name: 'Always allow', kind: 'allow_always' },
          { id: 'reject-once', name: 'Refuse', kind: 'reject_once' },
        ],
      },
    ])
    // ...and what the user chose is what the agent was told, not an interpretation of it.
    expect(fake.answers.optionIds).toEqual(['reject-once'])
    expect(outcome.stopReason).toBe('end_turn')
  })
})

describe('Un tour arrêté et une session reprise', () => {
  test('a stopped turn is cancelled, and the agent answers that it was', async () => {
    // The turn is held open between two of its steps: Stop can only be tested while the agent
    // is really working, and this is what makes that a fact rather than a hope.
    let atFirstStep: () => void = () => undefined
    const reached = new Promise<void>((resolve) => {
      atFirstStep = resolve
    })
    let carryOn: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      carryOn = resolve
    })
    let before: number = 0
    const between = async (): Promise<void> => {
      before += 1
      // Held before its second step, which is the one it never reaches: what the test is
      // watching is a turn that was already saying something when Stop was pressed.
      if (before !== 2) return
      atFirstStep()
      await held
    }

    const fake = fakeAgent({
      between,
      steps: [
        { does: 'says', text: 'starting' },
        { does: 'says', text: 'and carrying on for a while' },
      ],
    })
    const events: AgentEvent[] = []
    const connection = await Effect.runPromise(
      connect({
        input: fake.output,
        output: fake.input,
        adapter: codex,
        onEvent: (event) => events.push(event),
        onPermission: async () => ALLOWED,
      }),
    )
    await Effect.runPromise(connection.open('/tmp/atlas'))

    const running = Effect.runPromise(connection.prompt('go'))
    await reached
    await Effect.runPromise(connection.cancel())
    carryOn()

    expect((await running).stopReason).toBe('cancelled')
    // What it had already said is what arrived, and the step it never reached did not.
    expect(events.map((event) => ('text' in event ? event.text : ''))).toEqual(['starting'])
  })

  test('a continued session is replayed, and what arrives says so', async () => {
    const { connection, events } = await opened({
      continues: true,
      history: [
        { does: 'says', text: 'the turn you already have' },
        { does: 'thinks', text: 'and the thought behind it' },
      ],
      steps: [{ does: 'says', text: 'and this one is new' }],
    })

    await Effect.runPromise(connection.continueSession('native-session', '/tmp/atlas'))
    expect(events.map((event) => event.replay)).toEqual([true, true])
    const outcome = await Effect.runPromise(connection.prompt('carry on'))

    expect(outcome.stopReason).toBe('end_turn')
    expect(events.map((event) => event.replay)).toEqual([true, true, false])
  })
})
