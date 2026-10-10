/**
 * What the prompt-cache probe reads of a session's stream: one request per provider message, the
 * lifetime its cache writes got, and what it cost.
 *
 * The provider reports each request's usage on the assistant message, with the cache writes split
 * by lifetime (`cache_creation`). The ACP adapter sums them per turn and drops the split, which is
 * why the probe reads the stream of the Agent SDK instead.
 */

import { Option, Schema } from 'effect'

const Creation = Schema.Struct({
  ephemeral_5m_input_tokens: Schema.Number,
  ephemeral_1h_input_tokens: Schema.Number,
})

const AssistantMessage = Schema.Struct({
  type: Schema.Literal('assistant'),
  message: Schema.Struct({
    id: Schema.String,
    model: Schema.String,
    content: Schema.Array(Schema.Struct({ type: Schema.String })),
    usage: Schema.Struct({
      input_tokens: Schema.Number,
      output_tokens: Schema.Number,
      cache_read_input_tokens: Schema.Number,
      cache_creation_input_tokens: Schema.Number,
      cache_creation: Schema.optional(Schema.NullOr(Creation)),
    }),
  }),
})

const decodeAssistant = Schema.decodeUnknownOption(AssistantMessage)

/** One request to the provider, as the usage it reported. */
export interface Request {
  /** The turn it belongs to, as the scenario names it. */
  readonly label: string
  readonly id: string
  readonly model: string
  /** The kinds of block it answered with: a `tool_use` request is followed by another. */
  readonly blocks: string
  /** Input tokens that were neither read from nor written to the cache. */
  readonly input: number
  readonly output: number
  readonly read: number
  readonly write5m: number
  readonly write1h: number
}

/** The request an assistant message of the stream reports; nothing for any other message. */
export const readRequest = (label: string, message: Schema.Json): Option.Option<Request> =>
  Option.map(decodeAssistant(message), ({ message: sent }) => {
    const { usage } = sent
    // A provider that does not split its writes has written them for the default lifetime.
    const split = usage.cache_creation ?? {
      ephemeral_5m_input_tokens: usage.cache_creation_input_tokens,
      ephemeral_1h_input_tokens: 0,
    }
    return {
      label,
      id: sent.id,
      model: sent.model,
      blocks: sent.content.map((block) => block.type).join('+'),
      input: usage.input_tokens,
      output: usage.output_tokens,
      read: usage.cache_read_input_tokens,
      write5m: split.ephemeral_5m_input_tokens,
      write1h: split.ephemeral_1h_input_tokens,
    }
  })

/** A request streams one message per content block, each with the usage so far: the last wins, at the
 * place of the first. */
export const distinctRequests = (requests: ReadonlyArray<Request>): ReadonlyArray<Request> => {
  const last = new Map<string, Request>()
  for (const one of requests) last.set(one.id, one)
  return [...last.values()]
}

export type Lifetime = '5m' | '1h' | 'mixed' | 'none'

/** The lifetime a request's cache writes got, or none when it wrote nothing. */
export const lifetimeOf = (one: Request): Lifetime => {
  if (one.write5m > 0 && one.write1h > 0) return 'mixed'
  if (one.write1h > 0) return '1h'
  if (one.write5m > 0) return '5m'
  return 'none'
}

/**
 * What a request's input costs in tokens at the plain input price: a read is a tenth of it, a
 * five-minute write 1.25 times, a one-hour write twice. The output is left out: the cache does not
 * touch it, and the stream reports it before the request has finished.
 */
export const costOf = (one: Request): number =>
  one.input + one.read * 0.1 + one.write5m * 1.25 + one.write1h * 2

/** The requests as a Markdown table. */
export const renderTable = (requests: ReadonlyArray<Request>): string =>
  [
    '| turn | model | blocks | input | output | cache read | write 5m | write 1h | writes | input cost |',
    '|---|---|---|---:|---:|---:|---:|---:|---|---:|',
    ...requests.map(
      (one) =>
        `| ${one.label} | ${one.model} | ${one.blocks} | ${one.input} | ${one.output} | ${one.read} | ${one.write5m} | ${one.write1h} | ${lifetimeOf(one)} | ${costOf(one).toFixed(0)} |`,
    ),
  ].join('\n')
