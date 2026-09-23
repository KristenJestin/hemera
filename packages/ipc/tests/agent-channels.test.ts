/**
 * The agent channels and what the engine pushes while a Session is worked on (D5-12, D5-13).
 *
 * A declaration is what is under test: what the window may ask about an agent, what it is
 * answered, and what reaches it without being asked. The suites are named after the scenarios
 * they cover — the Agents page, the agent's own options, the end of a turn, a stop during a
 * permission, a resume that replays nothing, and the stream a turn arrives as.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  CHANNELS,
  ENGINE_EVENTS,
  ENGINE_EVENT_CHANNEL,
  ENGINE_REQUESTS,
  agentAvailabilitySchema,
  agentProviderSchema,
  bareModeSchema,
  configOptionSchema,
  resumeStateSchema,
  sessionEntrySchema,
  stopReasonSchema,
  type SessionEntry,
} from '#index.ts'

/** One entry of a thread, as the interface is handed one: a message the agent wrote. */
const ENTRY: SessionEntry = {
  id: 'entry-1',
  sessionId: 'session-1',
  seq: 1,
  role: 'agent',
  kind: 'message',
  body: 'The file is read.',
  payload: '{}',
  correlationId: null,
  turnId: 'turn-1',
  state: null,
  origin: 'live',
  createdAt: 1,
}

describe('The agent channels are declared once', () => {
  test('every use case of the agents is a channel of the same name', () => {
    const relayed = Object.keys(ENGINE_REQUESTS).filter((name) => name.startsWith('agents.'))
    const channels = Object.keys(CHANNELS).filter((name) => name.startsWith('agents.'))

    expect(channels.toSorted()).toEqual(relayed.toSorted())
    expect(relayed.toSorted()).toEqual([
      'agents.check',
      'agents.decide',
      'agents.list',
      'agents.offer',
      'agents.offerSet',
      'agents.options',
      'agents.prompt',
      'agents.resume',
      'agents.setOption',
      'agents.stop',
      'agents.update',
    ])
  })
})

describe('The Agents page tells what is available', () => {
  test('an agent that is on the machine and one that is not are told apart', () => {
    expect(
      agentAvailabilitySchema.safeParse({
        id: 'claude',
        label: 'Claude Code',
        found: true,
        version: '2.1.0',
        authenticated: true,
        installHint: 'npm install -g @anthropic-ai/claude-code',
        loginHint: 'claude auth login',
        installer: 'pnpm',
        latest: '2.2.0',
        bareMode: {
          means: 'its own means',
          qualified: true,
          reason: null,
          private: 'its own sources',
        },
      }).success,
    ).toBe(true)

    expect(
      agentAvailabilitySchema.safeParse({
        id: 'codex',
        label: 'Codex',
        found: false,
        version: null,
        authenticated: false,
        installHint: 'npm install -g @openai/codex',
        loginHint: 'codex login',
        installer: 'unknown',
        latest: null,
        bareMode: {
          means: 'its own means',
          qualified: true,
          reason: null,
          private: 'its own sources',
        },
      }).success,
    ).toBe(true)
  })

  test('a version nothing answered is null and not a field that went missing', () => {
    expect(
      agentAvailabilitySchema.safeParse({
        id: 'opencode',
        label: 'OpenCode',
        found: true,
        version: null,
        authenticated: false,
        installHint: 'npm install -g opencode-ai',
        loginHint: 'opencode auth login',
        installer: 'npm',
        latest: null,
        bareMode: {
          means: 'its own means',
          qualified: true,
          reason: null,
          private: 'its own sources',
        },
      }).success,
    ).toBe(true)

    // The two ways of saying nothing are the same thing to a page, so only one of them is read.
    expect(
      agentAvailabilitySchema.safeParse({
        id: 'opencode',
        label: 'OpenCode',
        found: true,
        authenticated: false,
        installHint: 'npm install -g opencode-ai',
        loginHint: 'opencode auth login',
        installer: 'npm',
        latest: null,
        bareMode: {
          means: 'its own means',
          qualified: true,
          reason: null,
          private: 'its own sources',
        },
      }).success,
    ).toBe(false)
  })

  test('an agent Hemera does not know how to start cannot be asked for', () => {
    expect(agentProviderSchema.safeParse('claude').success).toBe(true)
    expect(agentProviderSchema.safeParse('gemini').success).toBe(false)
  })
})

describe('The options are the agent’s', () => {
  test('the values a Session can be put in are the ones the agent announced', () => {
    expect(
      configOptionSchema.safeParse({
        id: 'model',
        name: 'Model',
        category: 'model',
        values: [
          { value: 'claude-sonnet-4-5', name: 'Sonnet 4.5' },
          { value: 'claude-opus-4-1', name: 'Opus 4.1' },
        ],
        current: 'claude-sonnet-4-5',
      }).success,
    ).toBe(true)
  })

  test('an option the agent put in no category is read', () => {
    expect(
      configOptionSchema.safeParse({
        id: 'effort',
        name: 'Effort',
        category: null,
        values: [{ value: 'high', name: 'High' }],
        current: 'high',
      }).success,
    ).toBe(true)
  })

  test('a value the agent did not name is refused', () => {
    expect(
      configOptionSchema.safeParse({
        id: 'effort',
        name: 'Effort',
        category: null,
        values: [{ value: 'high' }],
        current: 'high',
      }).success,
    ).toBe(false)
  })

  test('An option value keeps the description the agent gave', () => {
    const read = configOptionSchema.safeParse({
      id: 'model',
      name: 'Model',
      category: 'model',
      values: [
        { value: 'default', name: 'Default', description: 'Opus 4.5 · 1M context' },
        { value: 'claude-opus-4-5', name: 'Opus 4.5' },
      ],
      current: 'default',
    })

    expect(read.success).toBe(true)
    // The agent's own sentence about the value, and nothing at all where it wrote none.
    expect(read.data?.values[0]?.description).toBe('Opus 4.5 · 1M context')
    expect(read.data?.values[1]?.description).toBeUndefined()
  })

  test("The recommended value is marked from the agent's meta", () => {
    const read = configOptionSchema.safeParse({
      id: 'effort',
      name: 'Effort',
      category: 'thought_level',
      values: [
        { value: 'low', name: 'Low' },
        { value: 'medium', name: 'Medium', recommended: true },
      ],
      current: 'medium',
    })

    expect(read.success).toBe(true)
    // A derived word and never the agent's raw metadata: what crosses is `recommended`, on the
    // one value the agent named, and nothing of the extension namespace it named it in.
    expect(read.data?.values[1]?.recommended).toBe(true)
    expect(read.data?.values[0]?.recommended).toBeUndefined()
    // And it is a word about a value, not a value of its own: nothing else came with it.
    expect(Object.keys(read.data?.values[1] ?? {})).toEqual(['value', 'name', 'recommended'])
  })

  test('an option is set with the value the agent offered', () => {
    const setOption = ENGINE_REQUESTS['agents.setOption'].arguments

    expect(
      setOption.safeParse({ sessionId: 'session-1', optionId: 'model', value: 'claude-opus-4-1' })
        .success,
    ).toBe(true)
    expect(setOption.safeParse({ sessionId: 'session-1', optionId: 'model' }).success).toBe(false)
  })
})

describe('The turn ends with its reason', () => {
  test('a turn that ended says why, in the words of the protocol', () => {
    expect(stopReasonSchema.safeParse('end_turn').success).toBe(true)
    expect(stopReasonSchema.safeParse('cancelled').success).toBe(true)
  })

  test('a reason the protocol does not name is refused', () => {
    expect(stopReasonSchema.safeParse('finished').success).toBe(false)
  })

  test('a prompt is answered with the reason it ended and nothing else', () => {
    const answer = ENGINE_REQUESTS['agents.prompt'].response

    expect(answer.safeParse({ stopReason: 'max_tokens' }).success).toBe(true)
    expect(answer.safeParse({ stopReason: 'finished' }).success).toBe(false)
    expect(answer.safeParse({}).success).toBe(false)
  })
})

describe('Stop during a permission', () => {
  test('a decision with no option is the user closing the request', () => {
    const decision = ENGINE_REQUESTS['agents.decide'].arguments

    const asked = { sessionId: 'session-1', toolCallId: 'call-1' }

    expect(decision.safeParse({ ...asked, optionId: 'allow-once' }).success).toBe(true)
    expect(decision.safeParse({ ...asked, optionId: null }).success).toBe(true)
  })

  test('a decision that names no option at all is refused', () => {
    expect(
      ENGINE_REQUESTS['agents.decide'].arguments.safeParse({
        sessionId: 'session-1',
        toolCallId: 'call-1',
      }).success,
    ).toBe(false)
  })

  test('a decision that names no question is refused: a Session can wait on several', () => {
    expect(
      ENGINE_REQUESTS['agents.decide'].arguments.safeParse({
        sessionId: 'session-1',
        optionId: 'allowed',
      }).success,
    ).toBe(false)
  })

  test('stopping is asked for by the Session alone', () => {
    const stop = ENGINE_REQUESTS['agents.stop'].arguments

    expect(stop.safeParse({ sessionId: 'session-1' }).success).toBe(true)
    expect(stop.safeParse({}).success).toBe(false)
  })
})

describe('No tool is replayed on resume', () => {
  test('an entry says whether it was written as it happened or from what the agent replayed', () => {
    expect(sessionEntrySchema.safeParse(ENTRY).success).toBe(true)
    expect(sessionEntrySchema.safeParse({ ...ENTRY, origin: 'replay' }).success).toBe(true)
  })

  test('an entry that does not say where it came from is refused', () => {
    expect(
      sessionEntrySchema.safeParse({
        id: 'entry-2',
        sessionId: 'session-1',
        seq: 2,
        role: 'agent',
        kind: 'message',
        body: 'No one knows where this one came from.',
        payload: '{}',
        correlationId: null,
        turnId: null,
        state: null,
        createdAt: 2,
      }).success,
    ).toBe(false)
  })

  test('a resume answers how far the native session came back', () => {
    const answer = ENGINE_REQUESTS['agents.resume'].response

    expect(answer.safeParse({ state: 'attached', reason: null }).success).toBe(true)
    expect(
      answer.safeParse({ state: 'fallback', reason: 'the agent lost its own session' }).success,
    ).toBe(true)
  })

  test('a resume cannot answer that there was nothing to resume', () => {
    expect(resumeStateSchema.safeParse('lost').success).toBe(true)
    expect(resumeStateSchema.safeParse('none').success).toBe(false)
    expect(
      ENGINE_REQUESTS['agents.resume'].response.safeParse({ state: 'none', reason: null }).success,
    ).toBe(false)
  })
})

describe('Text arrives as a stream', () => {
  test('the seven things the engine pushes are the ones declared', () => {
    expect(Object.keys(ENGINE_EVENTS).toSorted()).toEqual([
      'agent',
      'delivery',
      'entry',
      'permission',
      'run',
      'turn',
      'turn_start',
    ])
  })

  test('an entry is pushed with the Session it belongs to', () => {
    expect(
      ENGINE_EVENTS.entry.safeParse({ event: 'entry', sessionId: 'session-1', entry: ENTRY })
        .success,
    ).toBe(true)
  })

  test('a turn that ended is pushed about its Session and no entry', () => {
    expect(
      ENGINE_EVENTS.turn.safeParse({ event: 'turn', sessionId: 'session-1', entry: null }).success,
    ).toBe(true)
  })

  test('a turn that began is pushed under a name of its own', () => {
    // Two names and not one: the page shows a turn as running from the first of them and stops
    // at the second, and a single name would leave it guessing which it had just received.
    expect(
      ENGINE_EVENTS.turn_start.safeParse({
        event: 'turn_start',
        sessionId: 'session-1',
        entry: null,
      }).success,
    ).toBe(true)
    expect(
      ENGINE_EVENTS.turn.safeParse({ event: 'turn_start', sessionId: 'session-1', entry: null })
        .success,
    ).toBe(false)
  })

  test('a message that names an event the engine does not push is refused', () => {
    expect(
      ENGINE_EVENTS.entry.safeParse({ event: 'progress', sessionId: 'session-1', entry: null })
        .success,
    ).toBe(false)
    expect(
      ENGINE_EVENTS.permission.safeParse({ event: 'turn', sessionId: 'session-1', entry: null })
        .success,
    ).toBe(false)
  })

  test('every pushed message travels under one name, declared once', () => {
    expect(ENGINE_EVENT_CHANNEL).toBe('agents.event')
  })
})

describe('The agent starts the app and the user opens it', () => {
  test('every use case of the commands and the context is a channel of the same name', () => {
    const relayed = Object.keys(ENGINE_REQUESTS).filter(
      (name) => name.startsWith('commands.') || name.startsWith('context.'),
    )
    const channels = Object.keys(CHANNELS).filter(
      (name) => name.startsWith('commands.') || name.startsWith('context.'),
    )

    expect(channels.toSorted()).toEqual(relayed.toSorted())
    expect(relayed.toSorted()).toEqual([
      'commands.create',
      'commands.list',
      'commands.output',
      'commands.remove',
      'commands.run',
      'commands.runs',
      'commands.stop',
      'commands.update',
      'context.read',
    ])
  })

  test('a run is pushed whole, with its address, and no entry', () => {
    const run = {
      id: 'run-1',
      projectId: 'atlas',
      sessionId: 'session-1',
      commandId: 'command-1',
      name: 'dev',
      line: 'pnpm dev',
      type: 'serve',
      cwd: '/home/ana/atlas',
      workspaceId: null,
      environment: {},
      state: 'running',
      pid: 4242,
      url: 'http://localhost:5173',
      readyAt: null,
      portConflict: null,
      exitCode: null,
      output: 'ready in 300 ms',
      dropped: 0,
      startedAt: '2026-09-23T08:00:00.000Z',
      endedAt: null,
      joined: false,
    }
    expect(ENGINE_EVENTS.run.safeParse({ event: 'run', sessionId: 'session-1', run }).success).toBe(
      true,
    )
    expect(
      ENGINE_EVENTS.run.safeParse({
        event: 'run',
        sessionId: 'session-1',
        run: { ...run, state: 'up' },
      }).success,
    ).toBe(false)
  })
})

describe('A change during a turn leaves at the next safe point', () => {
  test('a delivery is pushed about its Session, beside the entry it wrote', () => {
    expect(
      ENGINE_EVENTS.delivery.safeParse({ event: 'delivery', sessionId: 'session-1', entry: null })
        .success,
    ).toBe(true)
  })
})

describe('An unqualified combination is refused with its reason', () => {
  test('an agent says whether it runs bare here, and why not when it does not', () => {
    const codex = {
      id: 'codex',
      label: 'Codex',
      found: true,
      version: '1.12.0',
      authenticated: true,
      installHint: 'npm install -g @openai/codex',
      loginHint: 'codex login',
      installer: 'npm',
      latest: null,
      bareMode: {
        means: "a config.toml in a directory of Hemera's",
        qualified: false,
        reason: 'apply_patch has no configuration key',
        private: "the project's own .codex/config.toml still layers in",
      },
    }
    expect(agentAvailabilitySchema.safeParse(codex).success).toBe(true)
    // Nothing optional over this wire: an agent that said nothing about bare mode is refused.
    const { bareMode: _dropped, ...silent } = codex
    expect(agentAvailabilitySchema.safeParse(silent).success).toBe(false)
  })
})

describe('What Hemera does not control is said under the agent', () => {
  test('an agent says what its bare means leaves out of Hemera’s sight', () => {
    const bareMode = {
      means: 'session/new _meta',
      qualified: true,
      reason: null,
      private: '~/.claude.json still loads; Hemera does not read it.',
    }
    expect(bareModeSchema.safeParse(bareMode).success).toBe(true)
    const { private: _dropped, ...silent } = bareMode
    expect(bareModeSchema.safeParse(silent).success).toBe(false)
  })
})
