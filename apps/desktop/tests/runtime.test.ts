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
import { Effect, Fiber } from 'effect'
import * as TestClock from 'effect/testing/TestClock'

import { fakeAgent } from '#engine/agents/fake.ts'
import { AgentRuntime, CANCEL_GRACE } from '#engine/agents/runtime.ts'
import {
  ASKED,
  application,
  aSession,
  entryOf,
  gated,
  heldInThread,
  optionsOf,
  pause,
  threadOf,
  waiting,
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
          entries.some((entry) => entry.kind === 'message' && (entry.body ?? '').includes('starting')),
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
