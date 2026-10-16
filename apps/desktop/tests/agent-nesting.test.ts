/**
 * An agent's value nested deeper than a call stack reaches: the client turns a tool's raw input
 * and output into text, and the trace writes every message, and neither may fail on it. A failure
 * there is a lost update or a failed session, never a leak. The agent is the fake one: its updates
 * are written as text, since no serializer of this process could write a value that deep.
 */

import { existsSync, readFileSync } from 'node:fs'

import { MASK, NESTING_LIMIT } from '@hemera/core/domain'
import type { AgentsProcessGone } from '@hemera/ipc'
import { Effect, Fiber, Layer, Predicate, Queue, Stream } from 'effect'
import type { Scope } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import {
  type AgentEvent,
  type AgentPermissionAnswer,
  type LineTransport,
  TextBlock,
  connect,
  defaultPermissionAnswerLayer,
  processTransport,
} from '../src/engine/agents/client.ts'
import { fakeAgent } from '../src/engine/agents/fake.ts'
import { type AcpTrace, AcpTraces, acpTracesLayer } from '../src/engine/agents/trace.ts'
import { Secrets, secretsRegistry } from '../src/engine/secrets.ts'
import { traceFileOf } from '../src/main/diagnostic.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

afterEach(removeFolders)

const DEPTH = 100_000
const SHAPES = ['lists', 'records', 'both'] as const
type Shape = (typeof SHAPES)[number]

/** A value `DEPTH` containers deep, as the JSON text an agent writes; a marker at its heart. */
const deepText = (shape: Shape): string => {
  const open = (level: number): string =>
    shape === 'lists' || (shape === 'both' && level % 2 === 0) ? '[' : '{"k":'
  const close = (level: number): string =>
    shape === 'lists' || (shape === 'both' && level % 2 === 0) ? ']' : '}'
  let before = ''
  let after = ''
  for (let level = 0; level < DEPTH; level += 1) {
    before += open(level)
    after = close(level) + after
  }
  return `${before}"at the heart"${after}`
}

/** A `tool_call` then a `tool_call_update` of the native session, the deep values written whole. */
const updateLines = (shape: Shape): ReadonlyArray<string> => {
  const deep = deepText(shape)
  const note = (update: string) =>
    `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"native-session","update":${update}}}`
  return [
    note(
      `{"sessionUpdate":"tool_call","toolCallId":"deep","title":"Deep","status":"pending","rawInput":{"command":"ls","nested":${deep}}}`,
    ),
    note(
      `{"sessionUpdate":"tool_call_update","toolCallId":"deep","status":"completed","rawOutput":${deep}}`,
    ),
  ]
}

/** How deep a JSON text nests, read without recursion. */
const depthOf = (text: string): number => {
  let depth = 0
  let deepest = 0
  let inString = false
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]
    if (inString) {
      if (char === '\\') at += 1
      else if (char === '"') inString = false
    } else if (char === '"') inString = true
    else if (char === '[' || char === '{') {
      depth += 1
      deepest = Math.max(deepest, depth)
    } else if (char === ']' || char === '}') depth -= 1
  }
  return deepest
}

/** The transport of a fake agent, with a way to write to the client a line the SDK could not. */
const injectable = (fake: ReturnType<typeof fakeAgent>) =>
  Effect.gen(function* () {
    const extra = yield* Queue.unbounded<string>()
    const real = processTransport(fake.process, () => {})
    const transport: LineTransport<AgentsProcessGone> = {
      lines: Stream.merge(real.lines, Stream.fromQueue(extra)),
      write: real.write,
    }
    return { transport, inject: (line: string) => Queue.offerUnsafe(extra, line) }
  })

/**
 * The two updates, then a turn of the agent: the events the client gave, up to what the agent said
 * after them. A client that failed on the updates ends its events before that.
 */
const lived = (shape: Shape, trace: AcpTrace | undefined) =>
  Effect.gen(function* () {
    const fake = fakeAgent({ steps: [{ does: 'says', text: 'still here' }] })
    const { transport, inject } = yield* injectable(fake)
    const connection = yield* connect({ transport, trace })
    const session = yield* connection.newSession({ cwd: '/tmp/atlas', mcpServers: [] })
    const heard = yield* Effect.forkScoped(
      Stream.runCollect(
        connection.events.pipe(
          Stream.takeUntil((event) => Predicate.isTagged(event, 'MessageChunk')),
        ),
      ),
    )
    for (const line of updateLines(shape)) inject(line)
    // Each update is read before the turn starts, so the agent's words come after them.
    yield* Effect.sleep('200 millis')
    yield* session.prompt([TextBlock.make({ text: 'go' })])
    return [...(yield* Fiber.join(heard))]
  })

/** The raw input of the first call update and the raw output of the second, from `lived`. */
const rawsOf = (events: ReadonlyArray<AgentEvent>) => {
  const [first, second] = events
  return {
    input:
      first !== undefined && Predicate.isTagged(first, 'ToolCall') ? first.call.rawInput : null,
    output:
      second !== undefined && Predicate.isTagged(second, 'ToolCall') ? second.call.rawOutput : null,
  }
}

const kindOf = (event: AgentEvent): string =>
  ['ToolCall', 'MessageChunk'].find((tag) => Predicate.isTagged(event, tag)) ?? 'other'

const expectCut = (events: ReadonlyArray<AgentEvent>) => {
  expect(events.map(kindOf)).toEqual(['ToolCall', 'ToolCall', 'MessageChunk'])
  const { input, output } = rawsOf(events)
  expect(input).not.toBeNull()
  expect(output).not.toBeNull()
  for (const text of [input ?? '', output ?? '']) {
    expect(text).toContain(MASK)
    expect(text).not.toContain('at the heart')
    expect(depthOf(text)).toBeLessThanOrEqual(NESTING_LIMIT)
    // What is kept is JSON, readable by code that recurses.
    expect(() => JSON.parse(text)).not.toThrow()
  }
  expect(input).toContain('"command":"ls"')
}

const withTraces = <A, E>(
  data: string,
  program: (trace: AcpTrace) => Effect.Effect<A, E, Scope.Scope | AgentPermissionAnswer>,
  on: boolean,
) => {
  const registry = secretsRegistry()
  return Effect.runPromise(
    Effect.gen(function* () {
      const traces = yield* AcpTraces
      traces.writing(on)
      return yield* program(yield* traces.open('deep-session'))
    }).pipe(
      Effect.scoped,
      Effect.provide(acpTracesLayer(data).pipe(Layer.provide(Layer.succeed(Secrets, registry)))),
      Effect.provide(defaultPermissionAnswerLayer),
    ),
  )
}

describe('An agent update whose raw input and output nest 100,000 levels deep', () => {
  for (const shape of SHAPES) {
    test(`the client records it with the deep part cut, and the session goes on (${shape}, no trace)`, async () => {
      const events = await Effect.runPromise(
        Effect.scoped(lived(shape, undefined)).pipe(Effect.provide(defaultPermissionAnswerLayer)),
      )
      expectCut(events)
    })

    test(`the client records it and the session goes on with the traces off (${shape})`, async () => {
      const data = temporaryFolder('nesting')
      const events = await withTraces(data, (trace) => lived(shape, trace), false)
      expectCut(events)
      expect(existsSync(traceFileOf(data, 'deep-session') ?? '')).toBe(false)
    })

    test(`the client records it and the session goes on with the traces on, the trace being written (${shape})`, async () => {
      const data = temporaryFolder('nesting')
      const events = await withTraces(data, (trace) => lived(shape, trace), true)
      expectCut(events)
      const file = traceFileOf(data, 'deep-session') ?? ''
      // The trace is written in the background of the diagnostic sink.
      await expect
        .poll(() => existsSync(file) && readFileSync(file, 'utf8'))
        .toContain('session/update')
      const lines = readFileSync(file, 'utf8').split('\n')
      // The two updates, each written with its deep part cut.
      const deep = lines.filter((line) => line.includes(MASK))
      expect(deep).toHaveLength(2)
      for (const line of deep) expect(depthOf(line)).toBeLessThanOrEqual(NESTING_LIMIT)
    })
  }
})
