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
import { Effect, Fiber, Layer } from 'effect'
import * as TestClock from 'effect/testing/TestClock'

import { MachineEnvironment } from '#engine/agents/discovery.ts'
import { fakeAgent, fakeSupervisorOf } from '#engine/agents/fake.ts'
import { IDLE_AFTER_MS } from '#engine/agents/pool.ts'
import { AgentRuntime, CANCEL_GRACE } from '#engine/agents/runtime.ts'
import { Projects } from '#engine/projects.ts'
import {
  ASKED,
  application,
  aSession,
  entryOf,
  gated,
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
