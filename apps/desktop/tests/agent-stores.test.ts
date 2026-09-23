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
import {
  effortDefaultOf,
  effortStage,
  modeStage,
  modelStage,
  NO_DEFAULTS,
  openingAgentOf,
} from '#renderer/agent-options.ts'
import {
  activityOf,
  agentOf,
  carryModelDefaults,
  chooseOption,
  forgetAgentRefusal,
  listenToAgents,
  modelDefaultsOf,
  offerAgent,
  offeringOf,
  readOptions,
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
      modelDefaults: NO_DEFAULTS,
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

  test('a turn writing its answer is writing, then done in the time it took', () => {
    const said = { ...entry('e1', 'user', 'Read the recap'), createdAt: 1_000 }
    const answer = reported('e2', 'message', 'The recap says')

    // A message is never given a state by the engine: null while it is written, and still null
    // once it is — the entry being the last one written is what says it is being written.
    expect(activityOf([said, answer], 'e2')).toEqual({ state: 'streaming', thought: undefined })

    // The turn entry closes it: done, twelve seconds after the message that asked for it.
    const end = { ...reported('e3', 'turn', 'The agent finished its turn.', 'end_turn') }
    const closed = [said, answer, { ...end, createdAt: 13_400 }]
    expect(activityOf(closed, 'e3')).toEqual({ state: 'done', elapsedMs: 12_400 })

    // And it stays done until the next message, whatever the engine pushed last.
    expect(activityOf(closed, 'e2')).toEqual({ state: 'done', elapsedMs: 12_400 })
    const next = { ...entry('e4', 'user', 'And the credit notes'), createdAt: 20_000 }
    expect(activityOf([...closed, next], 'e4').state).toBe('thinking')
  })

  test('an answer folded above a call is still the answer being written', () => {
    // An agent that names none of its messages has every word of the turn written into the first
    // message entry, which stays where it was: the answer after a call lands above that call.
    const said = entry('e1', 'user', 'Read the recap')
    const answer = reported('e2', 'message', 'Reading it. The recap says')
    const call = reported('e3', 'tool_call', 'cat recap.md', 'completed')

    expect(activityOf([said, answer, call], 'e2').state).toBe('streaming')
    // The call written last and finished: the agent is between two blocks.
    expect(activityOf([said, answer, call], 'e3').state).toBe('thinking')
  })

  test('a turn the user stopped says stopped, and one whose agent died says failed', () => {
    const said = entry('e1', 'user', 'Push it')
    const call = reported('e2', 'tool_call', 'git push', 'cancelled')

    const stopped = reported('e3', 'turn', 'The turn was stopped.', 'cancelled')
    expect(activityOf([said, call, stopped])).toEqual({ state: 'stopped' })

    const died = reported('e3', 'turn', 'The agent stopped running.', 'interrupted')
    expect(activityOf([said, call, died])).toEqual({ state: 'failed' })
  })

  test('A delivery outside a turn is its own turn', () => {
    const said = entry('e1', 'user', 'Start')
    const done = reported('e2', 'turn', 'The agent finished its turn.', 'end_turn', 'turn-1')
    const delivered = reported(
      'e3',
      'context_delivery',
      'The instructions changed.',
      null,
      'turn-2',
    )
    const answer = reported('e4', 'message', 'Noted', null, 'turn-2')

    // The answer to the delivery is the turn that runs now, not the end of the one before it.
    expect(activityOf([said, done, delivered, answer]).state).toBe('streaming')
    const closed = reported('e5', 'turn', 'The agent finished its turn.', 'end_turn', 'turn-2')
    expect(activityOf([said, done, delivered, answer, closed]).state).toBe('done')
    // A delivery inside the user's turn carries no turn of its own and starts nothing.
    const inTurn = reported('e3', 'context_delivery', 'The instructions changed.', null, null)
    expect(activityOf([said, done, inTurn]).state).toBe('done')
  })

  test('A refused prompt is a failed turn, not a stopped one', () => {
    const said = entry('e1', 'user', 'Read the notes')
    const refused = reported('e2', 'turn', 'The agent could not answer.', 'failed')

    expect(activityOf([said, refused])).toEqual({ state: 'failed' })
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

  test('a prompt whose answer fails does not end a turn the engine said had begun', async () => {
    // What the main process answers once it stops waiting: a turn takes minutes, the wait for the
    // answer is a few seconds, and the turn goes on after it (trial of 22 September 2026).
    answers.set('agents.prompt', new Error('{"useCase":"agents.prompt","_tag":"EngineTimeout"}'))

    const asking = say('session-4', 'Read the recap')
    push({ event: 'turn_start', sessionId: 'session-4', entry: null })
    await asking
    expect(agentOf('session-4').running).toBe(true)

    // The engine's own end is what ends it.
    push({ event: 'turn', sessionId: 'session-4', entry: null })
    expect(agentOf('session-4').running).toBe(false)
  })

  test('a message said sets the Session running at once, which is what draws the Stop', async () => {
    // The page hands `running` to the composer as it is, and the composer draws the Stop from it
    // (`Composer > Running`): what is proved here is that it is on from the press, through the
    // engine's own start, until the turn ends and its answer arrives.
    let answer: (value: { stopReason: string }) => void = () => undefined
    Object.assign(window.hemera, {
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the same stand-in, held open
      invoke: async (name: string, argument: unknown) => {
        asked.push({ name, argument })
        return await new Promise((resolve) => {
          answer = resolve
        })
      },
    })

    const asking = say('session-6', 'Read the recap')
    expect(agentOf('session-6').running).toBe(true)
    push({ event: 'turn_start', sessionId: 'session-6', entry: null })
    push({ event: 'entry', sessionId: 'session-6', entry: entry('e1', 'user', 'Read the recap') })
    expect(agentOf('session-6').running).toBe(true)

    push({ event: 'turn', sessionId: 'session-6', entry: null })
    answer({ stopReason: 'end_turn' })
    await asking
    expect(agentOf('session-6').running).toBe(false)
    expect(agentOf('session-6').stopReason).toBe('end_turn')
  })

  test('a prompt refused before any turn began leaves nothing running', async () => {
    answers.set('agents.prompt', new Error('the engine is not running'))

    await say('session-5', 'Again')
    expect(agentOf('session-5').running).toBe(false)
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

describe('Ce que l’agent dit de ses valeurs arrive jusqu’au menu', () => {
  test('a choice carries the sentence the agent wrote and the value it advises', () => {
    const announced: ConfigOption[] = [
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        values: [
          { value: 'opus-4-5', name: 'Opus 4.5', description: '1M context', recommended: true },
          { value: 'sonnet-4-5', name: 'OpenCode Zen/Sonnet 4.5' },
        ],
        current: 'opus-4-5',
      },
      {
        id: 'effort',
        name: 'Effort',
        category: 'thought_level',
        values: [
          { value: 'low', name: 'Low' },
          { value: 'medium', name: 'Medium', description: 'What it starts on', recommended: true },
        ],
        current: 'medium',
      },
    ]

    const models = modelStage(announced)
    expect(models?.choices[0]).toEqual({
      id: 'opus-4-5',
      label: 'Opus 4.5',
      description: '1M context',
      recommended: true,
    })
    // The provider is still read off the label, and the two words travel with the group.
    expect(models?.choices[1]).toEqual({
      id: 'sonnet-4-5',
      group: 'OpenCode Zen',
      label: 'Sonnet 4.5',
      description: undefined,
      recommended: undefined,
    })

    const efforts = effortStage(announced)
    expect(efforts?.choices.map((choice) => choice.recommended)).toEqual([undefined, true])
    expect(efforts?.choices[1]?.description).toBe('What it starts on')
  })

  test('an agent that said nothing about its values hands over nothing invented', () => {
    const efforts = effortStage([option('effort', ['low', 'high'], 'high')])
    expect(efforts?.choices).toEqual([
      { id: 'low', label: 'low', description: undefined, recommended: undefined },
      { id: 'high', label: 'high', description: undefined, recommended: undefined },
    ])
  })
})

/** What Claude announces on a model, with the effort it is on: none at all for Haiku. */
function claudeOn(model: string, effort: string | null): ConfigOption[] {
  const models = option('model', ['fable', 'opus', 'sonnet', 'haiku'], model)
  if (effort === null) return [models]
  return [models, option('effort', ['low', 'medium', 'high', 'xhigh', 'max'], effort)]
}

/** The default a Home's composer learned for a model, or null where it learned none. */
function homeDefault(projectId: string, model: string): string | null {
  return effortDefaultOf(offeringOf(projectId, 'claude').modelDefaults, model)
}

/** And the one a Session learned. */
function sessionDefault(sessionId: string, model: string): string | null {
  return effortDefaultOf(modelDefaultsOf(sessionId), model)
}

describe('La règle du curseur marque le défaut du modèle', () => {
  test("The model's own default effort is the one the agent lands on when the model changes", async () => {
    // The Home: the first offer is what the agent started on, Fable at High (probe of
    // 22 September 2026), and a model set is answered with the effort the new model lands on.
    answers.set('agents.offer', offer(claudeOn('fable', 'high')))
    await offerAgent('vega', 'claude')
    expect(homeDefault('vega', 'fable')).toBe('high')

    answers.set('agents.offerSet', offer(claudeOn('opus', 'xhigh')))
    await setOffered('vega', 'claude', 'model', 'opus')
    expect(homeDefault('vega', 'opus')).toBe('xhigh')
    expect(homeDefault('vega', 'fable')).toBe('high')

    // A model that announces no effort has no default to mark.
    answers.set('agents.offerSet', offer(claudeOn('haiku', null)))
    await setOffered('vega', 'claude', 'model', 'haiku')
    expect(homeDefault('vega', 'haiku')).toBeNull()

    // The Session: the same reading, off the list read back after the option is set.
    answers.set('agents.options', { options: claudeOn('fable', 'high') })
    await readOptions('session-9')
    expect(sessionDefault('session-9', 'fable')).toBe('high')

    answers.set('agents.setOption', {})
    answers.set('agents.options', { options: claudeOn('sonnet', 'xhigh') })
    await chooseOption('session-9', 'model', 'sonnet')
    expect(sessionDefault('session-9', 'sonnet')).toBe('xhigh')
  })

  test("Moving the effort does not move the model's default", async () => {
    answers.set('agents.offer', offer(claudeOn('fable', 'high')))
    await offerAgent('orion', 'claude')
    answers.set('agents.offerSet', offer(claudeOn('fable', 'max')))
    await setOffered('orion', 'claude', 'effort', 'max')
    expect(homeDefault('orion', 'fable')).toBe('high')

    answers.set('agents.options', { options: claudeOn('opus', 'xhigh') })
    await readOptions('session-10')
    answers.set('agents.setOption', {})
    answers.set('agents.options', { options: claudeOn('opus', 'low') })
    await chooseOption('session-10', 'effort', 'low')
    expect(sessionDefault('session-10', 'opus')).toBe('xhigh')
    // And a list read again for no choice at all leaves it where it was.
    await readOptions('session-10')
    expect(sessionDefault('session-10', 'opus')).toBe('xhigh')
  })

  test("A pinned effort does not become a model's default", async () => {
    // Claude Code keeps an effort the user chose across model changes (its `effortPinnedLevel`):
    // Opus, first visited after Low was pinned, is announced on Low — which is the pin, not Opus.
    answers.set('agents.offer', offer(claudeOn('fable', 'high')))
    await offerAgent('lyra', 'claude')
    answers.set('agents.offerSet', offer(claudeOn('fable', 'low')))
    await setOffered('lyra', 'claude', 'effort', 'low')
    answers.set('agents.offerSet', offer(claudeOn('opus', 'low')))
    await setOffered('lyra', 'claude', 'model', 'opus')
    expect(homeDefault('lyra', 'opus')).toBeNull()

    // A Session made from that Home starts pinned: its first announcement is the pin the engine
    // carried over, and it teaches nothing either.
    carryModelDefaults('lyra', 'claude', 'session-11')
    answers.set('agents.options', { options: claudeOn('sonnet', 'low') })
    await readOptions('session-11')
    expect(sessionDefault('session-11', 'sonnet')).toBeNull()
    expect(sessionDefault('session-11', 'fable')).toBe('high')
  })

  test('A model visited before pinning keeps its default after pinning', async () => {
    answers.set('agents.options', { options: claudeOn('fable', 'high') })
    await readOptions('session-12')
    answers.set('agents.setOption', {})
    answers.set('agents.options', { options: claudeOn('opus', 'xhigh') })
    await chooseOption('session-12', 'model', 'opus')

    // Max is pinned on Opus, and Fable is announced on Max when it comes back: Fable keeps High.
    answers.set('agents.options', { options: claudeOn('opus', 'max') })
    await chooseOption('session-12', 'effort', 'max')
    answers.set('agents.options', { options: claudeOn('fable', 'max') })
    await chooseOption('session-12', 'model', 'fable')
    expect(sessionDefault('session-12', 'fable')).toBe('high')
    expect(sessionDefault('session-12', 'opus')).toBe('xhigh')
  })

  test('an option of a category the menu does not know is skipped', () => {
    // Claude's `fast` switch on Opus: an on/off option, announced first, under a word of its own.
    const fast: ConfigOption = {
      id: 'fast',
      name: 'Fast mode',
      category: 'fast',
      values: [],
      current: 'false',
    }
    const announced = [fast, ...claudeOn('opus', 'xhigh'), option('mode', ['plan'], 'plan')]

    expect(modelStage(announced)?.optionId).toBe('model')
    expect(effortStage(announced)?.optionId).toBe('effort')
    expect(modeStage(announced)?.optionId).toBe('mode')
    // Alone, it is none of the three: no stage, so no row in the menu.
    expect([modelStage([fast]), effortStage([fast]), modeStage([fast])]).toEqual([null, null, null])
  })
})

describe('The agent starts the app and the user opens it', () => {
  /** A run of a command, as the thread holds its entry. */
  function aRun(id: string, name: string, kind: 'app' | 'check', state: string): SessionEntry {
    return {
      ...reported(id, 'command_run', name, state, null),
      role: 'hemera',
      payload: JSON.stringify({
        runId: `run-${id}`,
        name,
        line: `pnpm ${name}`,
        kind,
        state,
        cwd: '/home/ana/atlas',
        url: null,
        exitCode: null,
        oneOff: false,
      }),
    }
  }

  test('a check Hemera is running for the turn is what the row names', () => {
    const said = entry('e1', 'user', 'Check it')
    const call = reported('e2', 'tool_call', 'mcp__hemera__commands_run', 'in_progress')
    const check = aRun('e3', 'check', 'check', 'running')

    expect(activityOf([said, call, check])).toEqual({ state: 'running', detail: 'Running check' })
    // Once it has ended, the row goes back to what the turn is doing.
    const ended = aRun('e3', 'check', 'check', 'exited')
    expect(activityOf([said, call, ended])).toEqual({
      state: 'running',
      detail: 'mcp__hemera__commands_run',
    })
  })

  test('an app left running is not what the turn is doing', () => {
    const said = entry('e1', 'user', 'Start the app')
    const app = aRun('e2', 'dev', 'app', 'running')
    const answer = reported('e3', 'message', 'It is up.')

    expect(activityOf([said, app, answer], 'e3').state).toBe('streaming')
  })
})
