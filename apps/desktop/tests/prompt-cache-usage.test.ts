/**
 * What the prompt-cache probe reads of a session's stream: one request per provider message, the
 * lifetime its cache writes got, and what it cost in units of the plain input price.
 */

import { Option, type Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  type Request,
  costOf,
  distinctRequests,
  lifetimeOf,
  readRequest,
  renderTable,
} from '../scripts/prompt-cache/usage.ts'

const assistant = (id: string, usage: Schema.Json) => ({
  type: 'assistant',
  message: {
    id,
    model: 'claude-haiku-5-5',
    content: [{ type: 'text' }],
    usage,
  },
})

const request = (parts: Partial<Request>): Request => ({
  label: 'turn 1',
  id: 'msg_1',
  model: 'claude-haiku-5-5',
  blocks: 'text',
  input: 0,
  output: 0,
  read: 0,
  write5m: 0,
  write1h: 0,
  ...parts,
})

describe('A request is read off the assistant message the provider sent', () => {
  test('its cache writes are split into five minutes and one hour', () => {
    const read = readRequest(
      'turn 1',
      assistant('msg_1', {
        input_tokens: 3,
        output_tokens: 7,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 5100,
        cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 5000 },
      }),
    )
    expect(Option.getOrNull(read)).toEqual(
      request({ id: 'msg_1', input: 3, output: 7, write5m: 100, write1h: 5000 }),
    )
  })

  test('a provider that does not split its writes counts them all as five minutes', () => {
    const read = readRequest(
      'turn 1',
      assistant('msg_1', {
        input_tokens: 3,
        output_tokens: 7,
        cache_read_input_tokens: 40,
        cache_creation_input_tokens: 900,
      }),
    )
    expect(Option.getOrNull(read)).toEqual(
      request({ id: 'msg_1', input: 3, output: 7, read: 40, write5m: 900 }),
    )
  })

  test('a message that is not an assistant message reads as nothing', () => {
    expect(Option.isNone(readRequest('turn 1', { type: 'result' }))).toBe(true)
  })
})

describe('One request is counted once however many blocks it streamed', () => {
  test('the messages sharing an id are one request, the last reading winning', () => {
    const first = request({ id: 'msg_1', output: 1 })
    const last = request({ id: 'msg_1', output: 9 })
    const next = request({ id: 'msg_2', output: 4 })
    expect(distinctRequests([first, next, last])).toEqual([last, next])
  })
})

describe('A request is named by the lifetime its cache writes got', () => {
  test.each([
    [request({ write1h: 10 }), '1h'],
    [request({ write5m: 10 }), '5m'],
    [request({ write5m: 10, write1h: 10 }), 'mixed'],
    [request({ read: 10 }), 'none'],
  ] as const)('%#', (one, lifetime) => {
    expect(lifetimeOf(one)).toBe(lifetime)
  })
})

describe('A request costs what its input tokens weigh at the plain input price', () => {
  test('a read is a tenth, a five-minute write 1.25, a one-hour write 2, the output nothing', () => {
    const one = request({ input: 10, output: 10, read: 1000, write5m: 100, write1h: 100 })
    expect(costOf(one)).toBeCloseTo(10 + 100 + 125 + 200)
  })
})

describe('The requests are shown as a table', () => {
  test('one row per request, with its lifetime and its cost', () => {
    const table = renderTable([request({ read: 1000, input: 5 })])
    expect(table).toContain('| turn 1 | claude-haiku-5-5 |')
    expect(table).toContain('| none |')
  })
})
