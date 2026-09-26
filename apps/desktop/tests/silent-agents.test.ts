/**
 * An agent that goes quiet, and what Hemera can see and say of it (issue #131).
 *
 * The fake agent is a real peer of the protocol behind the supervisor's port: what it says over
 * ACP, what it writes on its standard error and what it asks of Hemera cross the same wire and the
 * same runtime as a real agent's. Each suite is named after the point of the issue it covers.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Fiber } from 'effect'
import * as TestClock from 'effect/testing/TestClock'

import type { AnyMessage } from '@agentclientprotocol/sdk'
import type { SessionEntry } from '@hemera/core'

import { fakeAgent } from '#engine/agents/fake.ts'
import { AgentRuntime, REPORT_GAP } from '#engine/agents/runtime.ts'
import { AcpTraces, TRACE_LIMIT, acpTracesLayer, elided } from '#engine/agents/trace.ts'
import { Preferences } from '#engine/preferences.ts'
import { traceFileOf } from '#main/diagnostic.ts'
import { application, aSession, gated, heldInThread, pause, threadOf } from './application.ts'

let dataFolder: string
let workingDirectory: string
let opened: ReturnType<typeof application>

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-silent-'))
  workingDirectory = mkdtempSync(join(tmpdir(), 'hemera-workspace-'))
  opened = application(dataFolder)
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workingDirectory, { recursive: true, force: true })
})

/** The trace of a Session, as the file beside the diagnostic holds it. */
const traceOf = (sessionId: string): string => {
  const file = traceFileOf(dataFolder, sessionId)
  if (file === null || !existsSync(file)) return ''
  return readFileSync(file, 'utf8')
}

/** The notes of a thread that say one thing, by the reason their payload carries. */
const notesOf = (entries: readonly SessionEntry[], reason: string) =>
  entries.filter((entry) => entry.kind === 'note' && (entry.payload ?? '').includes(reason))

/** What a note carries beyond its sentence. */
const payloadOf = (entry: SessionEntry | undefined): { method?: string; line?: string } => {
  // SAFETY: the payload of a note is the JSON the runtime wrote for it, and the two fields read
  // here are optional: a note that carries neither answers undefined for both.
  return JSON.parse(entry?.payload ?? '{}') as { method?: string; line?: string }
}

describe('An ACP trace per Session, on demand', () => {
  test('nothing is written while the preference is off, which it is by default', async () => {
    const agent = fakeAgent({ steps: [{ does: 'says', text: 'hello' }] })

    await opened(agent)(
      Effect.gen(function* () {
        const preferences = yield* Preferences
        expect((yield* preferences.read).acpTrace).toBe(false)
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        yield* runtime.prompt(session.id, 'say hello')

        expect(existsSync(join(dataFolder, 'traces'))).toBe(false)
      }),
    )
  })

  test('once on, every message of the Session is written both ways, with its method and id', async () => {
    const agent = fakeAgent({ steps: [{ does: 'says', text: 'hello' }] })

    await opened(agent)(
      Effect.gen(function* () {
        const preferences = yield* Preferences
        yield* preferences.write({ acpTrace: true })
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        yield* runtime.prompt(session.id, 'say hello')

        const lines = traceOf(session.id).trim().split('\n')
        const said = (way: string, what: string) =>
          lines.some((line) => line.includes(way) && line.includes(what))
        expect(said('hemera → agent', 'request initialize #')).toBe(true)
        expect(said('agent → hemera', 'response initialize #')).toBe(true)
        expect(said('hemera → agent', 'request session/new #')).toBe(true)
        expect(said('hemera → agent', 'request session/prompt #')).toBe(true)
        expect(said('agent → hemera', 'notification session/update')).toBe(true)
        expect(said('agent → hemera', '"stopReason":"end_turn"')).toBe(true)
        // Every line starts with its time.
        for (const line of lines) expect(line).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z /)
      }),
    )
  })

  test('a prompt, a file the agent read and the token it was handed are written as their size', async () => {
    const agent = fakeAgent({
      steps: [
        {
          does: 'calls',
          call: {
            id: 'read-1',
            title: 'cat secrets.env',
            kind: 'read',
            status: 'completed',
            content: [
              { type: 'content', content: { type: 'text', text: 'API_KEY=sk-live-do-not-leak' } },
            ],
          },
        },
        { does: 'says', text: 'the answer is in the file' },
      ],
    })

    await opened(agent)(
      Effect.gen(function* () {
        const preferences = yield* Preferences
        yield* preferences.write({ acpTrace: true })
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        yield* runtime.prompt(session.id, 'my private plan for the launch')

        const trace = traceOf(session.id)
        const header = agent.answers.mcpServers[0]?.[0]
        const token = header !== undefined && 'headers' in header ? header.headers[0]?.value : ''
        expect(token).toMatch(/^Bearer /)
        expect(trace).not.toContain(token)
        expect(trace).not.toContain('my private plan')
        expect(trace).not.toContain('sk-live-do-not-leak')
        expect(trace).not.toContain('cat secrets.env')
        expect(trace).not.toContain('the answer is in the file')
        // What is kept is the protocol's own words, and the size of the rest.
        expect(trace).toContain('"toolCallId":"read-1"')
        expect(trace).toContain('‹30 chars›')
      }),
    )
  })

  test('an error an agent answers is written in its own words, as a 429 is', () => {
    const refusal: AnyMessage = {
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32_603, message: 'Provider returned 429: rate limited' },
    }
    expect(elided(refusal)).toContain('Provider returned 429: rate limited')
  })

  test('a trace past its limit is rotated, and one previous file is kept', async () => {
    const sessionId = 'rotated-session'
    await Effect.runPromise(
      Effect.gen(function* () {
        const traces = yield* AcpTraces
        traces.writing(true)
        const line = 'x'.repeat(1024 * 1024)
        for (let written = 0; written < 5; written++) traces.write(sessionId, line)
      }).pipe(Effect.provide(acpTracesLayer(dataFolder))),
    )

    const file = traceFileOf(dataFolder, sessionId) ?? ''
    expect(existsSync(file.replace(/\.log$/, '.1.log'))).toBe(true)
    expect(readFileSync(file).length).toBeLessThanOrEqual(TRACE_LIMIT)
  })

  test('an identifier that could not name a file safely names none', () => {
    expect(traceFileOf(dataFolder, '../elsewhere')).toBeNull()
  })
})

describe('What the agent writes to stderr while a turn runs', () => {
  test('an error line shows as a quiet row with the line', async () => {
    const agent = fakeAgent({
      steps: [
        { does: 'complains', line: 'ERROR service=llm status=429 Too Many Requests' },
        { does: 'says', text: 'still here' },
      ],
    })

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        yield* runtime.prompt(session.id, 'go')

        const entries = yield* heldInThread(
          session.id,
          (held) => notesOf(held, 'agent_stderr').length === 1,
        )
        const [row] = notesOf(entries, 'agent_stderr')
        expect(row?.body).toBe('The agent reported an error')
        expect(row?.role).toBe('hemera')
        expect(payloadOf(row).line).toBe('ERROR service=llm status=429 Too Many Requests')
      }),
    )
  })

  test('the same complaint said again is one row, and rows are rate-limited', async () => {
    const gate = gated(3)
    const agent = fakeAgent({
      steps: [
        { does: 'complains', line: 'ERROR retry 1: rate limited' },
        { does: 'complains', line: 'ERROR retry 2: rate limited' },
        { does: 'complains', line: 'error: connection reset' },
        { does: 'complains', line: 'fatal: the provider refused the request' },
        { does: 'says', text: 'done' },
      ],
      between: gate.between,
    })

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        const running = yield* Effect.forkScoped(runtime.prompt(session.id, 'go'))

        // Three lines said in the same instant: the retry is the first said again, and the
        // third comes inside the gap, so one row stands.
        yield* heldInThread(session.id, (held) => notesOf(held, 'agent_stderr').length === 1)
        yield* pause(20)
        expect(notesOf(yield* threadOf(session.id), 'agent_stderr')).toHaveLength(1)

        // Past the gap, the next complaint is a row of its own.
        yield* TestClock.adjust(REPORT_GAP)
        gate.carryOn()
        yield* Fiber.join(running)
        const entries = yield* heldInThread(
          session.id,
          (held) => notesOf(held, 'agent_stderr').length === 2,
        )
        expect(payloadOf(notesOf(entries, 'agent_stderr')[1]).line).toBe(
          'fatal: the provider refused the request',
        )
      }),
    )
  })

  test('a line that names no error is not shown, nor one written while no turn runs', async () => {
    const agent = fakeAgent({
      steps: [
        { does: 'complains', line: 'loading the model list' },
        { does: 'says', text: 'done' },
      ],
    })

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        yield* runtime.prompt(session.id, 'go')
        yield* pause(20)

        expect(notesOf(yield* threadOf(session.id), 'agent_stderr')).toHaveLength(0)
      }),
    )
  })
})
