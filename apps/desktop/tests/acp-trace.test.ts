/**
 * The ACP trace: one line per message of an agent session, in `<data>/traces/<session id>.log`,
 * written through the diagnostic sink, masked, elided, and rotated at 4 MB.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { AnyMessage } from '@agentclientprotocol/sdk'
import { Effect, Layer } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import {
  TextBlock,
  connect,
  defaultPermissionAnswerLayer,
  processTransport,
} from '../src/engine/agents/client.ts'
import { fakeAgent } from '../src/engine/agents/fake.ts'
import { AcpTraces, TraceNameRefused, acpTracesLayer, elided } from '../src/engine/agents/trace.ts'
import { Secrets, secretsRegistry } from '../src/engine/secrets.ts'
import {
  TRACES_FOLDER,
  TRACE_TURNOVER_BYTES,
  openTraceLog,
  traceFileOf,
} from '../src/main/diagnostic.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

afterEach(removeFolders)

/** Runs a program with the traces of a data folder, the given secrets known. */
const withTraces = <A, E>(
  data: string,
  program: Effect.Effect<A, E, AcpTraces>,
  secrets: ReadonlyArray<string> = [],
) => {
  const registry = secretsRegistry()
  registry.register('test', secrets)
  return Effect.runPromise(
    program.pipe(
      Effect.provide(acpTracesLayer(data).pipe(Layer.provide(Layer.succeed(Secrets, registry)))),
    ),
  )
}

/** One turn of a fake agent, traced under a session id. */
const tracedTurn = (sessionId: string, on: boolean, prompt: string) =>
  Effect.gen(function* () {
    const traces = yield* AcpTraces
    traces.writing(on)
    const trace = yield* traces.open(sessionId)
    const fake = fakeAgent({ steps: [{ does: 'says', text: 'the answer is in src/secret.ts' }] })
    const connection = yield* connect({
      transport: processTransport(fake.process, () => {}),
      trace,
    })
    const session = yield* connection.newSession({ cwd: '/tmp/atlas', mcpServers: [] })
    yield* session.prompt([TextBlock.make({ text: prompt })])
  }).pipe(Effect.scoped, Effect.provide(defaultPermissionAnswerLayer))

describe('The ACP trace of an agent session', () => {
  test('the trace elides every string outside the protocol keys', () => {
    const message: AnyMessage = {
      jsonrpc: '2.0',
      id: 7,
      method: 'session/prompt',
      params: {
        sessionId: 'native-1',
        prompt: [{ type: 'text', text: 'my private plan' }],
        modeId: 'plan',
        modelId: 'opus',
        stopReason: 'end_turn',
        headers: [{ name: 'Authorization', value: 'Bearer sk-live-token' }],
        many: Array.from({ length: 25 }, (_, index) => index),
        longMethod: { method: 'm'.repeat(300) },
      },
    }
    const line = elided(message)
    for (const hidden of ['my private plan', 'sk-live-token', 'native-1', 'Authorization']) {
      expect(line).not.toContain(hidden)
    }
    expect(line).toContain('"method":"session/prompt"')
    expect(line).toContain('"id":7')
    expect(line).toContain('"modeId":"plan"')
    expect(line).toContain('"modelId":"opus"')
    expect(line).toContain('"stopReason":"end_turn"')
    expect(line).toContain('"jsonrpc":"‹3 chars›"')
    expect(line).toContain('"sessionId":"‹8 chars›"')
    expect(line).toContain('"text":"‹15 chars›"')
    // A protocol word is cut at 200 characters, an array at 20 items.
    expect(line).toContain(`"method":"${'m'.repeat(200)}‹+100 chars›"`)
    expect(line).toContain('19,"‹5 more›"]')

    const refusal: AnyMessage = {
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32_603, message: `Provider returned 429: ${'x'.repeat(600)}` },
    }
    // The sentence of an error is what a trace is read for: it keeps 500 characters.
    expect(elided(refusal)).toContain('Provider returned 429: ')
    expect(elided(refusal)).toContain('‹+123 chars›')
  })

  test('every message is one line, both ways, with its time, direction, kind, method and id', async () => {
    const data = temporaryFolder('trace')
    await withTraces(data, tracedTurn('session-1', true, 'my private plan'))
    const lines = readFileSync(join(data, TRACES_FOLDER, 'session-1.log'), 'utf8')
      .trimEnd()
      .split('\n')
    const said = (start: string) => lines.some((line) => line.includes(start))
    expect(said('hemera → agent request initialize #0 ')).toBe(true)
    expect(said('agent → hemera response initialize #0 ')).toBe(true)
    expect(said('hemera → agent request session/new #1 ')).toBe(true)
    expect(said('hemera → agent request session/prompt #2 ')).toBe(true)
    expect(said('agent → hemera notification session/update ')).toBe(true)
    expect(said('agent → hemera response session/prompt #2 ')).toBe(true)
    for (const line of lines) {
      expect(line).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z (agent → hemera|hemera → agent) /)
    }
    const trace = lines.join('\n')
    expect(trace).not.toContain('my private plan')
    expect(trace).not.toContain('src/secret.ts')
    expect(trace).toContain('"stopReason":"end_turn"')
  })

  test('nothing is written while the trace is off', async () => {
    const data = temporaryFolder('trace')
    await withTraces(data, tracedTurn('session-1', false, 'hello'))
    expect(existsSync(join(data, TRACES_FOLDER))).toBe(false)
  })

  test('a known secret is masked before a trace line is written', async () => {
    const data = temporaryFolder('trace')
    await withTraces(
      data,
      Effect.gen(function* () {
        const traces = yield* AcpTraces
        traces.writing(true)
        const trace = yield* traces.open('session-1')
        trace('in', {
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32_603, message: 'refused key hunter2-very-secret' },
        })
      }),
      ['hunter2-very-secret'],
    )
    const trace = readFileSync(join(data, TRACES_FOLDER, 'session-1.log'), 'utf8')
    expect(trace).toContain('refused key')
    expect(trace).not.toContain('hunter2-very-secret')
  })

  test('the trace rotates at 4 MB to a single .1.log generation', () => {
    const data = temporaryFolder('trace')
    const file = traceFileOf(data, 'rotated') ?? ''
    const write = openTraceLog(file, (line) => line)
    const line = 'x'.repeat(1024 * 1024)
    for (let written = 0; written < 9; written += 1) write(line)
    expect(TRACE_TURNOVER_BYTES).toBe(4 * 1024 * 1024)
    expect(readdirSync(join(data, TRACES_FOLDER)).toSorted()).toEqual([
      'rotated.1.log',
      'rotated.log',
    ])
    expect(readFileSync(file).length).toBeLessThanOrEqual(TRACE_TURNOVER_BYTES)
    expect(readFileSync(file.replace(/\.log$/, '.1.log')).length).toBeLessThanOrEqual(
      TRACE_TURNOVER_BYTES,
    )
  })

  test('a session id that is not file-safe is refused', async () => {
    const data = temporaryFolder('trace')
    const refused = await withTraces(
      data,
      Effect.flip(
        Effect.gen(function* () {
          const traces = yield* AcpTraces
          return yield* traces.open('../elsewhere')
        }),
      ),
    )
    expect(refused).toBeInstanceOf(TraceNameRefused)
    expect(traceFileOf(data, 'a/b')).toBeNull()
    expect(traceFileOf(data, '')).toBeNull()
    expect(traceFileOf(data, 'session-1_A')).toBe(join(data, TRACES_FOLDER, 'session-1_A.log'))
  })
})
