/**
 * What the window holds about a Session's agent (design D5-12, D5-13, D5-17).
 *
 * The bridge is replaced by one that answers from a script and pushes what the engine would
 * push, because what is under test is the store: which use case it asks, what it keeps of an
 * answer, and what it does with an entry that arrives on its own. The channels themselves are
 * tested where they are declared.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type {
  AgentOffer,
  ComposerChoice,
  ConfigOption,
  EngineEvent,
  Session,
  SessionEntry,
} from '@hemera/ipc'
import { openingAgentOf } from '#renderer/agent-options.ts'
import {
  activityOf,
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
  readSessions,
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

/** One entry of a thread the agent wrote, of the kind and the standing the engine gave it. */
function reported(
  id: string,
  kind: SessionEntry['kind'],
  body: string,
  state: string | null = null,
  turnId: string | null = 'turn-1',
): SessionEntry {
  return { ...entry(id, 'agent', body), kind, state, turnId }
}

describe('La ligne au bout du fil dit ce que le tour fait', () => {
  test('a turn is thinking, then running the call it names, then writing its answer', () => {
    const said = entry('e1', 'user', 'Read the recap')
    const thought = reported('e2', 'thought', 'The file is probably at the root.')

    // Nothing but the question and what the agent is thinking: there is no call and no answer,
    // which is the state the row falls back to.
    expect(activityOf([said, thought])).toEqual({
      state: 'thinking',
      thought: 'The file is probably at the root.',
    })

    // A call that has not finished is what the turn is doing, and its title is what it says.
    const running = reported('e3', 'tool_call', 'cat recap.md', 'in_progress')
    expect(activityOf([said, thought, running])).toEqual({
      state: 'running',
      detail: 'cat recap.md',
      thought: 'The file is probably at the root.',
    })

    // The call is done and the agent is answering: the last entry is a message of its own, still
    // being written — the engine writes it again with more in it rather than as a second entry.
    const done = { ...running, state: 'completed' }
    const answer = reported('e4', 'message', 'The recap says')
    expect(activityOf([said, thought, done, answer])).toEqual({
      state: 'streaming',
      thought: 'The file is probably at the root.',
    })
  })

  test('a permission the agent is waiting on is what the row says, whatever else is running', () => {
    const thread = [
      entry('e1', 'user', 'Push it'),
      reported('e2', 'tool_call', 'git push', 'in_progress'),
      reported('e3', 'permission_request', 'git push origin main'),
    ]

    expect(activityOf(thread).state).toBe('waiting')

    // Answered, and the call it was about is what is running again.
    const decided = reported('e4', 'permission_decision', 'Allowed once', 'decided')
    expect(activityOf([...thread, decided])).toEqual({ state: 'running', detail: 'git push' })
  })

  test('the thought the row opens on is this turn’s and never the one before it', () => {
    const before = reported('e1', 'thought', 'That was the last question.', null, 'turn-1')
    const now = reported('e2', 'message', 'Starting.', null, 'turn-2')

    expect(activityOf([before, now]).thought).toBe(undefined)
  })

  test('what a turn that died left unfinished is not what the next turn is doing', () => {
    // The agent died under the first turn: nothing closed its call and nothing answered its
    // question, so the thread keeps both exactly as they were left, for ever.
    const dead = [
      entry('e1', 'user', 'Push it'),
      reported('e2', 'tool_call', 'git push', 'in_progress'),
      reported('e3', 'permission_request', 'git push origin main', 'pending'),
      reported('e4', 'turn', 'The agent stopped running.', 'interrupted'),
    ]

    // A second turn asked in the same Session reads its own half of the thread and no further
    // back: it is thinking, and not waiting on a question nobody can answer any more.
    const again: SessionEntry = { ...entry('e5', 'user', 'Try again'), turnId: null }
    expect(activityOf([...dead, again])).toEqual({ state: 'thinking', thought: undefined })
  })
})

describe('Le tour tourne dès que la question est écrite', () => {
  test('turn_start sets the Session running, and the turn that ends clears it', () => {
    expect(agentOf('session-3').running).toBe(false)

    // Pushed the moment the user's message is written, before the agent has been given anything
    // to do: the row and the stop stand from then (design D5-12).
    push({ event: 'turn_start', sessionId: 'session-3', entry: null })
    expect(agentOf('session-3').running).toBe(true)

    push({ event: 'turn', sessionId: 'session-3', entry: null })
    expect(agentOf('session-3').running).toBe(false)
  })
})

describe("Le composer d'un Projet rouvre sur l'agent qu'il a quitté", () => {
  test('the Home opens on the agent the Project was left on, and a pick wins over it', () => {
    const left: ComposerChoice = { provider: 'codex', options: { model: 'gpt-5', mode: 'ask' } }

    // Nothing picked yet: what the data folder remembers for this Project is what it opens on.
    expect(openingAgentOf(left, null)).toBe('codex')
    // A Project nothing was ever chosen in opens on nothing at all.
    expect(openingAgentOf(null, null)).toBe(null)
    // A preference that arrives after the reader has chosen does not move the menu under them.
    expect(openingAgentOf(left, 'claude')).toBe('claude')
  })
})

describe('Le titre proposé paraît sans rechargement', () => {
  test('the list is read again on a Session first entry, and the thread is left alone', async () => {
    answers.set('sessions.list', [session('session-1')])
    await openSessions('atlas')

    // The engine proposes the title from the first message and writes it in the same transaction
    // (D4b-05, D5-11), then pushes that entry: the list the sidebar draws is read again on it, so
    // the name is there without a reload.
    answers.set('sessions.list', [session('session-2'), session('session-1')])
    push({
      event: 'entry',
      sessionId: 'session-2',
      entry: entry('e1', 'user', 'The export drops the invoice date'),
    })
    await readSessions('atlas')

    expect(asked.map((one) => one.name)).toEqual(['sessions.list', 'sessions.list'])
    expect(sessionsSnapshot().sessions.map((one) => one.id)).toEqual(['session-2', 'session-1'])
    // The list alone: a read that dropped the thread would close a page nobody asked to close.
    expect(sessionsSnapshot().thread).toEqual([])
    expect(sessionsSnapshot().open).toBe(null)
  })

  test('a list read for a Project the window has left is not applied', async () => {
    answers.set('sessions.list', [session('session-1')])
    await openSessions('atlas')

    answers.set('sessions.list', [session('session-2')])
    await readSessions('lyra')

    expect(sessionsSnapshot().sessions.map((one) => one.id)).toEqual(['session-1'])
  })
})
