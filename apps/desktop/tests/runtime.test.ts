/**
 * One turn of a Session, from the prompt to the stop reason (design D5-05, D5-09, D5-12).
 *
 * The agent is the fake provider behind the supervisor's port, so a turn really happens — a
 * process is started, the protocol is spoken, entries are written — with no model, no account and
 * no binary on this machine. Each suite is named after the scenario of `Spec · agent-runtime` it
 * covers, and each `application()` call is one run of the application over one data folder.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Fiber, Layer, Result } from 'effect'
import * as TestClock from 'effect/testing/TestClock'

import type { SessionEntry } from '@hemera/core'

import { MachineEnvironment } from '#engine/agents/discovery.ts'
import { fakeAgent, fakeSupervisorOf } from '#engine/agents/fake.ts'
import { IDLE_AFTER_MS } from '#engine/agents/pool.ts'
import { AgentRuntime, CANCEL_GRACE, TEXT_LIMIT } from '#engine/agents/runtime.ts'
import { Preferences } from '#engine/preferences.ts'
import { Projects } from '#engine/projects.ts'
import {
  ASKED,
  application,
  aSession,
  entryOf,
  gated,
  held as heldGate,
  heldInThread,
  machine,
  optionsOf,
  pause,
  threadOf,
  waiting,
  watching,
} from './application.ts'

let dataFolder: string
let workingDirectory: string
let opened: ReturnType<typeof application>

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-runtime-'))
  workingDirectory = mkdtempSync(join(tmpdir(), 'hemera-workspace-'))
  opened = application(dataFolder)
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workingDirectory, { recursive: true, force: true })
})

describe('A permission request blocks the turn', () => {
  test('the options are the agent’s', async () => {
    const agent = fakeAgent({ steps: [{ does: 'asks', call: ASKED }] })

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        const running = yield* Effect.forkScoped(runtime.prompt(session.id, 'touch the config'))

        const entries = yield* heldInThread(session.id, (held) => waiting(held) === 1)
        const asked = entryOf(entries, 'permission_request')

        // What the agent sent, in its own order, and nothing added to it: the buttons of the
        // block are the agent's options and there is no fourth one Hemera invented.
        expect(optionsOf(asked).map((option) => option.id)).toEqual([
          'allow-once',
          'allow-always',
          'reject-once',
        ])
        expect(asked.state).toBe('pending')

        yield* runtime.decide(session.id, 'allow-once')
        const report = yield* Fiber.join(running)

        expect(report.stopReason).toBe('end_turn')
        expect(agent.answers.optionIds).toEqual(['allow-once'])
      }),
    )
  })

  test('the decision is recorded', async () => {
    const agent = fakeAgent({ steps: [{ does: 'asks', call: ASKED }] })

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        const running = yield* Effect.forkScoped(runtime.prompt(session.id, 'touch the config'))

        yield* heldInThread(session.id, (held) => waiting(held) === 1)
        yield* runtime.decide(session.id, 'allow-once')
        yield* Fiber.join(running)

        const entries = yield* heldInThread(session.id, (held) =>
          held.some((entry) => entry.kind === 'permission_decision'),
        )
        const decision = entryOf(entries, 'permission_decision')

        expect(decision.role).toBe('user')
        expect(decision.body).toBe('Allow once')
        expect(decision.state).toBe('decided')
        expect(decision.correlationId).toBe('decision:call-1')
        // The request folds into one line: the entry the block was drawn from is the one the
        // decision leaves behind, and the thread does not grow a second one.
        expect(entryOf(entries, 'permission_request').state).toBe('decided')
      }),
    )
  })

  test('nothing is memorised', async () => {
    const agent = fakeAgent({
      steps: [
        { does: 'asks', call: ASKED },
        { does: 'asks', call: { ...ASKED, id: 'call-2' } },
      ],
    })

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        const running = yield* Effect.forkScoped(runtime.prompt(session.id, 'touch the config'))

        yield* heldInThread(session.id, (held) => waiting(held) === 1)
        // The turn is held by the question: nothing goes on until it is answered, and no turn
        // entry has been written yet.
        expect((yield* threadOf(session.id)).some((entry) => entry.kind === 'turn')).toBe(false)
        yield* runtime.decide(session.id, 'allow-once')

        // The same tool asks again, and it blocks the turn again: allowing once is not a
        // permission remembered anywhere.
        yield* heldInThread(session.id, (held) => waiting(held) === 1)
        expect((yield* threadOf(session.id)).some((entry) => entry.kind === 'turn')).toBe(false)
        yield* runtime.decide(session.id, 'allow-once')

        const report = yield* Fiber.join(running)
        expect(report.stopReason).toBe('end_turn')
        expect(agent.answers.optionIds).toEqual(['allow-once', 'allow-once'])

        const entries = yield* threadOf(session.id)
        const asked = entries.filter((entry) => entry.kind === 'permission_request')
        expect(asked.map((entry) => entry.correlationId)).toEqual(['perm:call-1', 'perm:call-2'])
        expect(asked.map((entry) => entry.state)).toEqual(['decided', 'decided'])
      }),
    )
  })
})

describe('Stop ends the turn cleanly', () => {
  test('stop during a long turn', async () => {
    const gate = gated(1)
    const agent = fakeAgent({
      steps: [
        { does: 'says', text: 'starting on it' },
        { does: 'says', text: 'and carrying on' },
      ],
      between: gate.between,
    })

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        const running = yield* Effect.forkScoped(runtime.prompt(session.id, 'refactor the reader'))

        yield* heldInThread(session.id, (held) =>
          held.some((entry) => entry.kind === 'message' && (entry.body ?? '').includes('starting')),
        )
        yield* runtime.stop(session.id)
        gate.carryOn()

        const report = yield* Fiber.join(running)
        expect(report.stopReason).toBe('cancelled')

        // The cancel is a notification on the wire rather than a return value: it lands in the
        // agent's own time, so the suite waits for it instead of reading it the instant the turn
        // ends. Everything that arrived before the stop is still there, and the turn says how it
        // ended.
        const entries = yield* heldInThread(
          session.id,
          (held) => agent.answers.cancels === 1 && held.some((entry) => entry.kind === 'turn'),
        )
        expect(
          entries.some(
            (entry) => entry.kind === 'message' && (entry.body ?? '').includes('starting'),
          ),
        ).toBe(true)
        expect(entryOf(entries, 'turn').state).toBe('cancelled')
      }),
    )
  })

  test('stop during a permission', async () => {
    const agent = fakeAgent({ steps: [{ does: 'asks', call: ASKED }] })

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        const running = yield* Effect.forkScoped(runtime.prompt(session.id, 'touch the config'))

        yield* heldInThread(session.id, (held) => waiting(held) === 1)
        yield* runtime.stop(session.id)

        const report = yield* Fiber.join(running)
        expect(report.stopReason).toBe('cancelled')
        // The question was answered rather than dropped: the agent is told the request is over.
        expect(agent.answers.cancelled).toBe(1)
        expect(agent.answers.optionIds).toEqual([])

        const entries = yield* heldInThread(session.id, (held) =>
          held.some((entry) => entry.kind === 'permission_decision'),
        )
        expect(entryOf(entries, 'permission_request').state).toBe('cancelled')
        expect(entryOf(entries, 'permission_decision').state).toBe('cancelled')
        expect(entryOf(entries, 'permission_decision').body).toBe('Stopped')
      }),
    )
  })

  test('an agent that does not cancel is stopped', async () => {
    const gate = gated(1)
    const agent = fakeAgent({
      steps: [
        { does: 'says', text: 'working on it' },
        { does: 'says', text: 'still working on it' },
      ],
      between: gate.between,
      ignoresCancel: true,
    })
    let ended = false
    void agent.exited.then(() => {
      ended = true
    })

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        const running = yield* Effect.forkScoped(runtime.prompt(session.id, 'rebuild the index'))

        yield* heldInThread(session.id, (held) =>
          held.some((entry) => entry.kind === 'message' && (entry.body ?? '').includes('working')),
        )
        yield* runtime.stop(session.id)

        // The agent ignores the cancel, so the grace is what ends the turn — and the grace runs
        // on the test's clock: the suite decides when it has passed.
        const noted = yield* Effect.gen(function* () {
          for (let turn = 0; turn < 20; turn++) {
            yield* pause(10)
            yield* TestClock.adjust(CANCEL_GRACE)
            const entries = yield* threadOf(session.id)
            if (entries.some((entry) => entry.kind === 'note')) return entries
          }
          return yield* Effect.die('the grace never ended the turn')
        })

        expect(agent.answers.cancels).toBe(1)
        const report = yield* Fiber.join(running)
        expect(report.stopReason).toBe('cancelled')
        expect(ended).toBe(true)
        expect(entryOf(noted, 'note').body).toContain('process was stopped')
        expect(entryOf(noted, 'turn').state).toBe('cancelled')
      }),
    )
  })
})

/**
 * The context window, as the one thing that ever announces one (design D5-20).
 *
 * `usage_update` is the protocol's only word on the subject — nothing in `initialize` and nothing
 * among the models a session publishes — and an agent is free never to say it. What the thread
 * keeps then is the announcement itself, beside what the turn used, and a reader that has neither
 * is told the window was not provided rather than being handed a size Hemera invented.
 */
describe('The context window of a turn', () => {
  test('what the agent announced is written beside what the turn used', async () => {
    const agent = fakeAgent({
      steps: [
        { does: 'spends', used: 12400, size: 200000, cost: { amount: 0.42, currency: 'USD' } },
        { does: 'says', text: 'the reader is where the project is opened' },
      ],
      usage: { inputTokens: 7361, outputTokens: 3, totalTokens: 7364 },
    })

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        const report = yield* runtime.prompt(session.id, 'what does this project do')

        expect(report.usage?.totalTokens).toBe(7364)

        const spent = entryOf(yield* threadOf(session.id), 'usage')
        // What the turn used is the line the entry is read by, and it is the agent's accounting.
        expect(spent.body).toBe('7364 tokens')

        // SAFETY: the payload of a usage entry is what the runtime wrote for it, and what is read
        // here are the fields it wrote there — a payload of another shape is a failure of this
        // suite that made it rather than of this reader.
        const payload = JSON.parse(spent.payload ?? '{}') as {
          used?: number | null
          size?: number | null
          cost?: { amount: number; currency: string } | null
        }
        expect(payload.used).toBe(12400)
        expect(payload.size).toBe(200000)
        expect(payload.cost).toEqual({ amount: 0.42, currency: 'USD' })
      }),
    )
  })

  test('a window nobody announced is written as missing, never as a size', async () => {
    const agent = fakeAgent({
      steps: [{ does: 'says', text: 'done' }],
      usage: { inputTokens: 7358, outputTokens: 3, totalTokens: 7361 },
    })

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        yield* runtime.prompt(session.id, 'say something')

        const spent = entryOf(yield* threadOf(session.id), 'usage')
        expect(spent.body).toBe('7361 tokens')

        // SAFETY: as above — the payload of this kind of entry is the runtime's own writing.
        const payload = JSON.parse(spent.payload ?? '{}') as {
          totalTokens?: number | null
          used?: number | null
          size?: number | null
          cost?: unknown
        }
        expect(payload.totalTokens).toBe(7361)
        expect(payload.used).toBeNull()
        expect(payload.size).toBeNull()
        expect(payload.cost).toBeNull()
      }),
    )
  })
})

/**
 * What the window is told while a turn runs (design D5-12).
 *
 * The page draws the thread from what the engine pushes, so every entry a turn writes has to be
 * announced — the user's own message first of all, because it is the one the composer just sent
 * and the one the thread shows above everything the agent answers.
 */
describe('What the window is told of a turn', () => {
  test('A user message reaches the window as an entry', async () => {
    const agent = fakeAgent({ steps: [{ does: 'says', text: 'reading it now' }] })
    const window = watching()

    await application(dataFolder, window.layer)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        yield* runtime.prompt(session.id, 'read the reader')

        const said = window.pushed.filter(
          (push) => push.entry?.role === 'user' && push.entry.kind === 'message',
        )
        // The same event and the same shape as an agent's entry: one entry, of this Session,
        // carrying what was typed.
        expect(said.map((push) => push.entry?.body)).toEqual(['read the reader'])
        expect(said.every((push) => push.sessionId === session.id)).toBe(true)

        // And it arrives before the agent's first word, which is the order the thread reads in.
        const message = window.pushed.findIndex((push) => push.entry?.role === 'user')
        const answer = window.pushed.findIndex((push) => push.entry?.role === 'agent')
        expect(message).toBeGreaterThanOrEqual(0)
        expect(message).toBeLessThan(answer)
      }),
    )
  })
})

/**
 * A thought and an answer, when the agent names both with one identifier (design D5-08, D5-11).
 *
 * ACP lets a chunk name the message it belongs to, and OpenCode gives the thinking and the answer
 * of one turn the same `messageId`: what they are accumulated under has to carry the kind as
 * well, or the thread holds one entry that starts as reasoning and ends as the answer.
 */
describe('One message id over two kinds', () => {
  test('A thought and an answer with one message id are two entries', async () => {
    const agent = fakeAgent({
      steps: [
        { does: 'thinks', text: 'the reader opens the project', messageId: 'msg-1' },
        { does: 'says', text: 'it opens the project', messageId: 'msg-1' },
      ],
    })

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        yield* runtime.prompt(session.id, 'what does the reader do')

        // The agent's own words: the thread also holds the message the user sent, which is the
        // same kind written by somebody else.
        const said = (yield* threadOf(session.id)).filter((entry) => entry.role === 'agent')
        const thought = entryOf(said, 'thought')
        const answer = entryOf(said, 'message')

        // Two rows, each with what it was told, and neither holding the other's words.
        expect(thought.body).toBe('the reader opens the project')
        expect(answer.body).toBe('it opens the project')
        // And two keys: one entry per kind of what the agent named once, so an update of either
        // finds its own row.
        expect(thought.correlationId).toBe('msg-1:thought')
        expect(answer.correlationId).toBe('msg-1:message')
      }),
    )
  })
})

/**
 * What an agent offers a Project's Home, before any Session holds it (design D5-17, D5-21).
 *
 * The composer of a Home chooses an agent and what that agent offers before there is a Session
 * to ask, so the engine starts the agent, opens a session on the Project and keeps it: an option
 * an agent only publishes once another one has been chosen is announced by the session where the
 * choice was made, and by nothing else. An agent that cannot be asked is a refusal with a
 * sentence, never an empty list — and never a process either.
 */
describe('What an agent offers a Home', () => {
  /** The two options of an agent whose effort only exists once a model has been chosen. */
  const MODEL = {
    id: 'model',
    type: 'select' as const,
    name: 'Model',
    category: 'model' as const,
    currentValue: 'sonnet',
    options: [
      { value: 'sonnet', name: 'Sonnet' },
      { value: 'opus', name: 'Opus' },
    ],
  }
  const EFFORT = {
    id: 'effort',
    type: 'select' as const,
    name: 'Effort',
    category: 'thought_level' as const,
    currentValue: 'medium',
    options: [
      { value: 'medium', name: 'Medium' },
      { value: 'high', name: 'High' },
    ],
  }

  test('Choosing a model on Home reveals the effort the agent announces', async () => {
    const agent = fakeAgent({
      configOptions: [MODEL],
      // The agent publishes the effort of the model that was picked, which is the only place
      // that option ever appears: it is not in the list the session opened with.
      onChoice: (choice) => (choice.id === 'model' ? [MODEL, EFFORT] : [MODEL]),
    })

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const projects = yield* Projects
        const project = yield* projects.create({
          name: 'Atlas',
          tone: 'primary',
          mainPath: workingDirectory,
        })

        const first = yield* runtime.offer(project.id, 'claude')
        expect(first.refusal).toBeNull()
        expect(first.options.map((option) => option.id)).toEqual(['model'])

        const after = yield* runtime.offerSet(project.id, 'claude', 'model', 'opus')

        // The effort the agent announced in answer to the choice, which no second start was
        // needed to hear: the probe session is the one the choice was made in.
        expect(after.refusal).toBeNull()
        expect(after.options.map((option) => option.id)).toEqual(['model', 'effort'])
        expect(agent.answers.choices).toEqual(['model=opus'])
        expect(agent.starts).toHaveLength(1)

        // And asking again answers what the agent announced last, not the list it opened with.
        const again = yield* runtime.offer(project.id, 'claude')
        expect(again.options.map((option) => option.id)).toEqual(['model', 'effort'])
        expect(agent.starts).toHaveLength(1)
      }),
    )
  })

  test('A probe closes after the pool’s idle time', async () => {
    const agent = fakeAgent({ configOptions: [MODEL] })
    let ended = false
    void agent.exited.then(() => {
      ended = true
    })

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const projects = yield* Projects
        const project = yield* projects.create({
          name: 'Atlas',
          tone: 'primary',
          mainPath: workingDirectory,
        })

        yield* runtime.offer(project.id, 'claude')
        expect(agent.starts).toHaveLength(1)
        expect(ended).toBe(false)

        // The pool's clock is the engine's, and the engine's is the suite's: five idle minutes
        // pass here rather than being waited out.
        yield* Effect.gen(function* () {
          for (let look = 0; look < 20; look++) {
            yield* pause(10)
            yield* TestClock.adjust(IDLE_AFTER_MS)
            if (ended) return
          }
        })

        // The process is gone, and it went because it had been idle: nothing asked for it to be
        // stopped, and nothing was left holding the Project's folder open.
        expect(ended).toBe(true)
        expect(agent.starts).toHaveLength(1)
      }),
    )
  })

  test('A probe started again is put back on what was chosen in that composer', async () => {
    /** An agent whose effort exists only once a model has been picked, as a fresh one starts. */
    const scripted = () => {
      let picked = false
      return fakeAgent({
        configOptions: [MODEL],
        onChoice: (choice) => {
          if (choice.id === 'model') picked = true
          return picked ? [MODEL, EFFORT] : [MODEL]
        },
      })
    }

    const first = scripted()
    const second = scripted()
    const queue = [first, second]
    let ended = false
    void first.exited.then(() => {
      ended = true
    })

    await application(
      dataFolder,
      undefined,
      machine,
      // A stopped fake is a dead one, so the second start answers with a second agent — which
      // is what a probe the pool let go of and a composer still being written in amount to.
      fakeSupervisorOf(() => queue.shift() ?? second),
    )(first)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const projects = yield* Projects
        const project = yield* projects.create({
          name: 'Atlas',
          tone: 'primary',
          mainPath: workingDirectory,
        })

        yield* runtime.offer(project.id, 'claude')
        yield* runtime.offerSet(project.id, 'claude', 'model', 'opus')

        // Nobody touches that composer for five minutes, and the pool closes its agent.
        yield* Effect.gen(function* () {
          for (let look = 0; look < 20; look++) {
            yield* pause(10)
            yield* TestClock.adjust(IDLE_AFTER_MS)
            if (ended) return
          }
        })
        expect(ended).toBe(true)

        // The next choice made in the same composer opens a second agent, and the model that was
        // picked before is put back on it first: an agent on its defaults would announce no
        // effort at all, and the effort just chosen would be a choice made on nothing.
        const after = yield* runtime.offerSet(project.id, 'claude', 'effort', 'high')

        expect(second.starts).toHaveLength(1)
        expect(second.answers.choices).toEqual(['model=opus', 'effort=high'])
        expect(after.refusal).toBeNull()
        expect(after.options.map((option) => option.id)).toEqual(['model', 'effort'])
      }),
    )
  })
})

/**
 * An agent that cannot be asked at all (design D5-17, D5-21).
 *
 * Both are read off the machine before anything is started: the command the reader installed, and
 * the login their agent wrote. Neither is a process, and neither is another agent put in its
 * place.
 */
describe('An agent that cannot be asked', () => {
  /** A machine that has every command and has signed none of them in. */
  const signedOut = Layer.succeed(MachineEnvironment, {
    home: '/home/ana',
    env: {},
    locate: (command: string) => Effect.succeed(join('/usr/local/bin', command)),
    bundled: (packageName: string) => Effect.succeed(join('/opt/hemera', packageName, 'index.js')),
    readVersion: () => Effect.succeed('1.0.0'),
    holds: () => Effect.succeed(false),
  })

  test('An agent not signed in is refused before any process starts', async () => {
    const agent = fakeAgent({ configOptions: [] })

    await application(dataFolder, undefined, signedOut)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const projects = yield* Projects
        const project = yield* projects.create({
          name: 'Atlas',
          tone: 'primary',
          mainPath: workingDirectory,
        })

        const offered = yield* runtime.offer(project.id, 'claude')

        expect(offered.options).toEqual([])
        expect(offered.refusal?.kind).toBe('not_signed_in')
        // Nothing was started: the login file said so, and a process would have been a folder
        // opened to be told the same thing.
        expect(agent.starts).toEqual([])
      }),
    )
  })

  test('The refusal of an offer is a sentence', async () => {
    const agent = fakeAgent({ configOptions: [] })

    await application(dataFolder, undefined, signedOut)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const projects = yield* Projects
        const project = yield* projects.create({
          name: 'Atlas',
          tone: 'primary',
          mainPath: workingDirectory,
        })

        const offered = yield* runtime.offer(project.id, 'codex')

        // The agent's own name and what to do about it, and no JSON of any refusal's fields.
        expect(offered.refusal?.message).toBe('Codex is installed but not signed in.')
        expect(offered.refusal?.message).not.toContain('{')
      }),
    )
  })
})

/**
 * What the thread shows while the agent is still being started (design D5-05, D5-12).
 *
 * A cold start is a process to spawn, a handshake and a `session/new`, and a thread that waited
 * for the three would be empty for as long as they take — showing nothing of the message that was
 * just sent. The message is written and announced first, and the start happens under it.
 */
describe('The user’s message is in the thread before the agent has started', () => {
  test('it is written and announced while the start is still happening', async () => {
    const agent = fakeAgent({ steps: [{ does: 'says', text: 'reading it now' }] })
    const gate = heldGate()
    const window = watching()
    const run = application(
      dataFolder,
      window.layer,
      machine,
      fakeSupervisorOf(
        () => agent,
        () => gate.promise,
      ),
    )

    await run(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        const running = yield* Effect.forkScoped(runtime.prompt(session.id, 'read the reader'))

        // The supervisor is still behind the gate, so nothing has been started — and the thread
        // already holds what was typed, and the window has already been told about it.
        const thread = yield* heldInThread(session.id, (entries) => entries.length > 0)
        expect(thread.map((entry) => [entry.role, entry.kind, entry.body])).toEqual([
          ['user', 'message', 'read the reader'],
        ])
        expect(agent.starts).toEqual([])
        expect(window.pushed[0]?.entry?.body).toBe('read the reader')

        gate.carryOn()
        const report = yield* Fiber.join(running)

        expect(report.stopReason).toBe('end_turn')
      }),
    )
  })
})

/** A text the thread kept of a call, and whether all of it is there. */
interface WrittenText {
  readonly text: string
  readonly truncated: boolean
  readonly length: number
}

/** One block of what a call produced, as the runtime wrote it under `tool_call`. */
interface WrittenBlock {
  readonly type: string
  readonly text?: WrittenText
  readonly mime?: string | null
  readonly path?: string
  readonly newText?: WrittenText
}

/** The call a `tool_call` entry carries, as the window reads it back. */
interface WrittenCall {
  readonly title: string
  readonly status: string | null
  readonly locations: readonly { readonly path: string; readonly line: number | null }[]
  readonly content: readonly WrittenBlock[]
  readonly rawInput: WrittenText | null
  readonly rawOutput: WrittenText | null
}

const callOf = (entry: SessionEntry): WrittenCall => {
  // SAFETY: the payload of a `tool_call` is what the runtime wrote for it, and this is the one
  // shape it writes — a payload of another shape would be a defect of the runtime, which is what
  // the suite is here to catch.
  const payload = JSON.parse(entry.payload ?? '{}') as { call: WrittenCall }
  return payload.call
}

/**
 * What a call was given and what it answered, kept where the thread can show it (design D5-11).
 *
 * A call the thread holds as a title and a status is a call nobody can read afterwards: what
 * the tool was asked, what it answered and what it printed are what the reader opens a finished
 * call for, and none of them can be asked for again once the agent has moved on.
 */
describe('A tool call keeps what it was given and what it returned', () => {
  test('its input, its output, its content and the line it named are in the thread', async () => {
    const agent = fakeAgent({
      steps: [
        {
          does: 'calls',
          call: {
            id: 'call-1',
            title: 'Read parser.ts',
            kind: 'read',
            status: 'in_progress',
            path: '/tmp/atlas/parser.ts',
            line: 42,
            rawInput: { path: '/tmp/atlas/parser.ts' },
          },
        },
        {
          does: 'updates',
          call: {
            id: 'call-1',
            status: 'completed',
            content: [
              { type: 'content', content: { type: 'text', text: 'export const parse = () => {}' } },
            ],
            rawOutput: { bytes: '512' },
          },
        },
      ],
    })

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        yield* runtime.prompt(session.id, 'read the parser')

        const entries = yield* heldInThread(session.id, (thread) =>
          thread.some((entry) => entry.kind === 'tool_call' && entry.state === 'completed'),
        )
        const call = callOf(entryOf(entries, 'tool_call'))

        // The line the agent pointed at, and not the file alone.
        expect(call.locations).toEqual([{ path: '/tmp/atlas/parser.ts', line: 42 }])
        // What the tool was asked and what it answered, as the agent published them — kept
        // through the update that only carried the answer.
        expect(call.rawInput?.text).toBe(JSON.stringify({ path: '/tmp/atlas/parser.ts' }))
        expect(call.rawOutput?.text).toBe(JSON.stringify({ bytes: '512' }))
        expect(call.content).toEqual([
          {
            type: 'content',
            text: { text: 'export const parse = () => {}', truncated: false, length: 29 },
            mime: null,
          },
        ])
      }),
    )
  })

  test('a text longer than the thread holds is cut, and says how long it was', async () => {
    const printed = 'x'.repeat(TEXT_LIMIT + 1_000)
    const agent = fakeAgent({
      steps: [
        {
          does: 'calls',
          call: {
            id: 'call-1',
            title: 'Run the build',
            kind: 'execute',
            status: 'completed',
            content: [{ type: 'content', content: { type: 'text', text: printed } }],
          },
        },
      ],
    })

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        yield* runtime.prompt(session.id, 'build it')

        const entries = yield* heldInThread(session.id, (thread) =>
          thread.some((entry) => entry.kind === 'tool_call'),
        )
        const block = callOf(entryOf(entries, 'tool_call')).content[0]

        // What is kept is a row of a thread rather than a build log, and what was cut is said:
        // a reader shown the beginning of a file has to know it is the beginning.
        expect(block?.text?.text.length).toBe(TEXT_LIMIT)
        expect(block?.text?.truncated).toBe(true)
        expect(block?.text?.length).toBe(printed.length)
      }),
    )
  })

  test('A cancelled tool call is recorded as cancelled', async () => {
    const gate = gated(1)
    const agent = fakeAgent({
      steps: [
        {
          does: 'calls',
          call: {
            id: 'call-1',
            title: 'Search the repository',
            kind: 'search',
            status: 'in_progress',
          },
        },
        { does: 'updates', call: { id: 'call-1', status: 'completed' } },
      ],
      between: gate.between,
    })

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        const running = yield* Effect.forkScoped(runtime.prompt(session.id, 'find the reader'))

        yield* heldInThread(session.id, (thread) =>
          thread.some((entry) => entry.kind === 'tool_call' && entry.state === 'in_progress'),
        )
        yield* runtime.stop(session.id)
        gate.carryOn()
        yield* Fiber.join(running)

        const entries = yield* heldInThread(session.id, (thread) =>
          thread.some((entry) => entry.kind === 'turn'),
        )
        const call = entryOf(entries, 'tool_call')

        // The call the stop caught in the middle of itself is not left running: ACP has no word
        // for it, and a call that stays `in_progress` is a spinner that never stops.
        expect(call.state).toBe('cancelled')
        expect(callOf(call).status).toBe('cancelled')
        expect(entryOf(entries, 'turn').state).toBe('cancelled')
      }),
    )
  })
})

/**
 * What the window has to show between the message and the first word (design D5-12).
 *
 * A turn is announced when it begins and not only when it ends: the agent's first chunk is
 * seconds away at best, and a page told nothing until then has nothing to show but the message
 * that was just sent. The end follows every turn, however it ended.
 */
describe('A turn announces its start before its first chunk', () => {
  test('the start is pushed after the message and before anything the agent says', async () => {
    const agent = fakeAgent({ steps: [{ does: 'says', text: 'reading it now' }] })
    const window = watching()

    await application(dataFolder, window.layer)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        yield* runtime.prompt(session.id, 'read the reader')

        const order = window.pushed.map(
          (push) => push.what ?? `${push.entry?.role}:${push.entry?.kind}`,
        )

        // The message, then the start, and the agent's first word after both of them.
        expect(order[0]).toBe('user:message')
        expect(order[1]).toBe('turn_started')
        expect(order.indexOf('turn_started')).toBeLessThan(order.indexOf('agent:message'))
        // And the end follows, once.
        expect(order.filter((what) => what === 'turn_ended')).toEqual(['turn_ended'])
      }),
    )
  })

  test('a turn the agent never started still announces its end', async () => {
    /** A machine whose agents are all there and none of them signed in. */
    const signedOut = Layer.succeed(MachineEnvironment, {
      home: '/home/ana',
      env: {},
      locate: (command: string) => Effect.succeed(join('/usr/local/bin', command)),
      bundled: (packageName: string) =>
        Effect.succeed(join('/opt/hemera', packageName, 'index.js')),
      readVersion: () => Effect.succeed('1.0.0'),
      holds: () => Effect.succeed(false),
    })
    const agent = fakeAgent({})
    const window = watching()

    await application(dataFolder, window.layer, signedOut)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        const refused = yield* Effect.result(runtime.prompt(session.id, 'read the reader'))

        // Nobody signed this agent in, so the turn never started — and the window, which was
        // told a turn had begun, is told it is over rather than left waiting for it.
        expect(Result.isFailure(refused)).toBe(true)
        expect(window.pushed.map((push) => push.what).filter((what) => what !== null)).toEqual([
          'turn_started',
          'turn_ended',
        ])
      }),
    )
  })
})

/**
 * What a Home opens on, after the application was closed (design D5-17).
 *
 * The agent a Project is worked with, and the model, the effort and the mode chosen on it, lived
 * in the engine's memory and died with it: the next start put the composer back on whatever the
 * agent's defaults were, and the reader chose them again. They are a preference of the data
 * folder now — one per Project, because a Project is what they are about.
 */
describe('The composer’s choices are kept per Project', () => {
  const MODEL = {
    id: 'model',
    type: 'select' as const,
    name: 'Model',
    category: 'model' as const,
    currentValue: 'sonnet',
    options: [
      { value: 'sonnet', name: 'Sonnet' },
      { value: 'opus', name: 'Opus' },
    ],
  }

  test('The Home’s last agent and choices survive a restart', async () => {
    const first = fakeAgent({ configOptions: [MODEL] })

    const projectId = await application(dataFolder)(first)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const projects = yield* Projects
        const preferences = yield* Preferences
        const project = yield* projects.create({
          name: 'Atlas',
          tone: 'primary',
          mainPath: workingDirectory,
        })

        yield* runtime.offer(project.id, 'claude')
        yield* runtime.offerSet(project.id, 'claude', 'model', 'opus')

        // Written where a restart reads it: the agent this Project was worked with, and what was
        // chosen on it, under the agent's own identifiers.
        const held = yield* preferences.read
        expect(held.composers[project.id]).toEqual({
          provider: 'claude',
          options: { model: 'opus' },
        })
        return project.id
      }),
    )

    // A second run of the application over the same data folder: new layers, a new database
    // handle and an agent that has never been told anything.
    const second = fakeAgent({ configOptions: [MODEL] })

    await application(dataFolder)(second)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const offered = yield* runtime.offer(projectId, 'claude')

        // The Home is drawn from an agent that was put back on the model chosen last time,
        // rather than from one on its defaults.
        expect(offered.refusal).toBeNull()
        expect(second.answers.choices).toEqual(['model=opus'])
      }),
    )
  })

  test('A Project’s choices do not leak into another Project', async () => {
    const atlasAgent = fakeAgent({ configOptions: [MODEL] })
    const borealAgent = fakeAgent({ configOptions: [MODEL] })
    const queue = [atlasAgent, borealAgent]

    await application(
      dataFolder,
      undefined,
      machine,
      // One probe per Project and per agent: each start answers with its own fake, which is what
      // the two composers of two Projects really are.
      fakeSupervisorOf(() => queue.shift() ?? borealAgent),
    )(atlasAgent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const projects = yield* Projects
        const preferences = yield* Preferences
        const atlas = yield* projects.create({
          name: 'Atlas',
          tone: 'primary',
          mainPath: workingDirectory,
        })
        const boreal = yield* projects.create({
          name: 'Boreal',
          tone: 'info',
          mainPath: workingDirectory,
        })

        yield* runtime.offer(atlas.id, 'claude')
        yield* runtime.offerSet(atlas.id, 'claude', 'model', 'opus')
        yield* runtime.offer(boreal.id, 'claude')

        // The second Project's agent was told nothing: a model chosen in one Home is that Home's
        // choice, and the other opens on what its own agent announces.
        expect(borealAgent.answers.choices).toEqual([])

        const held = yield* preferences.read
        expect(held.composers[atlas.id]).toEqual({
          provider: 'claude',
          options: { model: 'opus' },
        })
        expect(held.composers[boreal.id]).toEqual({ provider: 'claude', options: {} })
      }),
    )
  })
})
