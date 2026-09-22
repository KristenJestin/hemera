/**
 * What the window holds about a Session's agent (design D5-12, D5-13, D5-17).
 *
 * The bridge is replaced by one that answers from a script and pushes what the engine would
 * push, because what is under test is the store: which use case it asks, what it keeps of an
 * answer, and what it does with an entry that arrives on its own. The channels themselves are
 * tested where they are declared.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { AgentOffer, ConfigOption, EngineEvent, Session, SessionEntry } from '@hemera/ipc'
import {
  agentOf,
  forgetAgentRefusal,
  listenToAgents,
  offerAgent,
  offeringOf,
  say,
  setOffered,
} from '#renderer/agent-store.ts'
import {
  archiveSession,
  openSessions,
  sessionsSnapshot,
  writeMessage,
} from '#renderer/sessions-store.ts'

/** One Session, as the engine answers with one. */
function session(id: string, version = 1): Session {
  return {
    id,
    projectId: 'atlas',
    title: 'CSV invoice export',
    titleSource: 'derived',
    provider: 'claude',
    model: null,
    nativeState: 'none',
    archivedAt: null,
    createdAt: 0,
    lastWrittenAt: 0,
    version,
  }
}

/** One entry of a thread, as the engine writes and pushes one. */
function entry(id: string, role: 'user' | 'agent', body: string): SessionEntry {
  return {
    id,
    sessionId: 'session-1',
    seq: 1,
    role,
    kind: 'message',
    body,
    payload: '{}',
    correlationId: null,
    turnId: null,
    state: null,
    origin: 'live',
    createdAt: 0,
  }
}

/** One option an agent announced, as the composer's menu is drawn from one. */
function option(id: string, values: readonly string[], current: string): ConfigOption {
  return {
    id,
    name: id,
    category: id,
    values: values.map((value) => ({ value, name: value })),
    current,
  }
}

/** What an agent offered, or the refusal it offered instead. */
function offer(
  options: readonly ConfigOption[],
  refusal: AgentOffer['refusal'] = null,
): AgentOffer {
  return { options, refusal }
}

/** What was asked of the bridge, in the order it was asked. */
let asked: { name: string; argument: unknown }[] = []

/** What the bridge answers, per channel: a value, or something to throw. */
let answers: Map<string, unknown>

/** What the engine would push, once the store is listening. */
let push: (event: EngineEvent) => void = () => undefined

/** Whoever is listening, so the window stops listening between two tests. */
let stop: () => void = () => undefined

beforeEach(() => {
  asked = []
  answers = new Map()
  // The one place a test reaches into the page: the preload is not there, so the bridge is.
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      hemera: {
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- stands in for the preload's bridge, whose job is to carry an argument it never reads
        invoke: async (name: string, argument: unknown) => {
          asked.push({ name, argument })
          const answer = answers.get(name)
          if (answer instanceof Error) throw answer
          return await Promise.resolve(answer)
        },
        on: (listener: (event: EngineEvent) => void) => {
          push = listener
          return () => undefined
        },
      },
    },
  })
  stop = listenToAgents()
})

afterEach(() => {
  stop()
  forgetAgentRefusal()
})

describe('Le message envoyé paraît sans relecture', () => {
  test("the user's own message is drawn from the push, and the thread is not read again", async () => {
    answers.set('agents.prompt', { stopReason: 'end_turn' })

    // The engine writes the message as part of the prompt and pushes it before the agent's first
    // word: it is in the thread the page is already drawing, in the order it arrived.
    push({ event: 'entry', sessionId: 'session-1', entry: entry('e1', 'user', 'Say it again') })
    push({ event: 'entry', sessionId: 'session-1', entry: entry('e2', 'agent', 'Said.') })
    expect(await say('session-1', 'Say it again')).toBe(null)

    const held = agentOf('session-1')
    expect(held.entries.map((one) => [one.role, one.body])).toEqual([
      ['user', 'Say it again'],
      ['agent', 'Said.'],
    ])
    // Nothing was read back: what the composer needs to show the sentence arrived on its own.
    expect(asked.map((one) => one.name)).toEqual(['agents.prompt'])
  })

  test('an entry written again with more in it takes the place it had', () => {
    push({ event: 'entry', sessionId: 'session-2', entry: entry('e1', 'agent', 'Sai') })
    push({ event: 'entry', sessionId: 'session-2', entry: entry('e1', 'agent', 'Said.') })

    expect(agentOf('session-2').entries.map((one) => one.body)).toEqual(['Said.'])
  })
})

describe("Le choix fait avant la Session s'applique sur le sondage", () => {
  test('what an agent offers a Project is asked once, and its refusal is kept as a sentence', async () => {
    answers.set(
      'agents.offer',
      offer([], { kind: 'not_signed_in', message: 'Sign in with `claude login`.' }),
    )

    await offerAgent('atlas', 'claude')

    expect(asked.map((one) => one.name)).toEqual(['agents.offer'])
    expect(offeringOf('atlas', 'claude')).toEqual({
      options: [],
      refusal: 'Sign in with `claude login`.',
      loading: false,
    })
    // Asked once per agent and Project: the engine starts the agent to be told.
    await offerAgent('atlas', 'claude')
    expect(asked).toHaveLength(1)
  })

  test('a model chosen there reveals the effort the agent only publishes after it', async () => {
    answers.set('agents.offer', offer([option('model', ['sonnet', 'opus'], '')]))
    answers.set(
      'agents.offerSet',
      offer([
        option('model', ['sonnet', 'opus'], 'opus'),
        option('thought_level', ['low', 'high'], 'low'),
      ]),
    )

    await offerAgent('atlas', 'codex')
    await setOffered('atlas', 'codex', 'model', 'opus')

    expect(asked.map((one) => one.name)).toEqual(['agents.offer', 'agents.offerSet'])
    expect(asked[1]?.argument).toEqual({
      projectId: 'atlas',
      provider: 'codex',
      optionId: 'model',
      value: 'opus',
    })
    // Replaced by what the agent announced in answer, which is where the effort comes from.
    expect(offeringOf('atlas', 'codex').options.map((one) => one.id)).toEqual([
      'model',
      'thought_level',
    ])
  })
})

describe('Ranger une Session après un message', () => {
  test('the archive carries the version the store holds, which a message does not move', async () => {
    answers.set('sessions.list', [session('session-1')])
    await openSessions('atlas')

    answers.set('sessions.append', {
      session: session('session-1'),
      entry: entry('e1', 'user', 'Written'),
    })
    expect(await writeMessage('session-1', 'Written')).toBe(null)

    const held = sessionsSnapshot().sessions[0]
    expect(held?.version).toBe(1)

    answers.set('sessions.archive', session('session-1'))
    expect(held !== undefined && (await archiveSession(held))).toBe(true)
    expect(asked.find((one) => one.name === 'sessions.archive')?.argument).toEqual({
      id: 'session-1',
      version: 1,
    })
  })
})
