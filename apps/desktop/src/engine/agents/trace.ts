/**
 * The ACP trace: what an agent and Hemera said to each other, one line per message, written
 * while the trace preference is on.
 *
 * A session that shows "Thinking…" for minutes is either an agent that ended its turn without
 * Hemera noticing, or an agent waiting on something Hemera never showed; the thread cannot tell
 * them apart, because it is what Hemera understood and not what was said. The trace is what was
 * said: each message with its time, its direction, its kind, its method and its id.
 *
 * Never a secret or a file's content in clear: a string is kept only under the protocol's own
 * keys, and every other string is written as its size. The lines go through the diagnostic sink,
 * which masks the known secrets before every write and rotates the file at 4 MB.
 */

import type { AnyMessage } from '@agentclientprotocol/sdk'
import { MASK } from '@hemera/core/domain'
import { Context, Effect, Layer, Option, Predicate, Schema } from 'effect'

import { openTraceLog, traceFileOf } from '../../main/diagnostic.ts'
import { Secrets } from '../secrets.ts'
import type { Direction } from './client.ts'
import { agentText } from './text.ts'

/** A session id that cannot name a trace file, which is never opened. */
export class TraceNameRefused extends Schema.TaggedError<TraceNameRefused>()('TraceNameRefused', {
  sessionId: Schema.String,
}) {
  override get message(): string {
    return `The session id ${JSON.stringify(this.sessionId)} cannot name a trace file.`
  }
}

/** The keys under which a string is the protocol's own word, kept as it is, up to 200 characters. */
const KEPT = new Set(['method', 'id', 'stopReason', 'modeId', 'modelId'])
const WORD_LIMIT = 200
/** The sentence of an error, kept up to 500 characters: it is what a trace is read for. */
const SENTENCE = 'message'
const SENTENCE_LIMIT = 500
const LIST_LIMIT = 20
/**
 * What stands for the items an array lost. The walk reaches it as one more string of the array:
 * it is let through, and a string of the agent's that reads exactly so says nothing more.
 */
const MORE = /^‹\d+ more›$/

const cut = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit)}‹+${String(text.length - limit)} chars›`

/** What the trace keeps of one value: the protocol's words, the size of any other string. */
const elide = (key: string, held: Schema.Json): Schema.Json => {
  if (Predicate.isString(held)) {
    if (KEPT.has(key)) return cut(held, WORD_LIMIT)
    if (key === SENTENCE) return cut(held, SENTENCE_LIMIT)
    if (MORE.test(held)) return held
    return `‹${String(held.length)} chars›`
  }
  if (Array.isArray(held) && held.length > LIST_LIMIT) {
    return [...held.slice(0, LIST_LIMIT), `‹${String(held.length - LIST_LIMIT)} more›`]
  }
  return held
}

const readJson = Schema.decodeUnknownOption(Schema.Json)

/**
 * A message as JSON. What came off the wire is JSON already; what the SDK built to send may hold
 * a field left undefined, which JSON leaves out: it goes through `JSON.stringify` once, a message
 * that small to write. One that cannot be read is none.
 */
const jsonOf = (message: AnyMessage): Option.Option<Schema.Json> =>
  Option.orElse(readJson(message), () => {
    try {
      return readJson(JSON.parse(JSON.stringify(message)))
    } catch {
      return Option.none()
    }
  })

/**
 * One message as the trace writes it: the JSON that crossed, with the protocol's words kept,
 * every other string replaced by its size, every array cut at 20 items, and what nests deeper than
 * a call's arguments ever do cut where it begins (`agentText`). A message that cannot be read is
 * `"•••"`.
 */
export const elided = (message: AnyMessage): string =>
  Option.match(jsonOf(message), {
    onNone: () => agentText(MASK),
    onSome: (json) => agentText(json, elide),
  })

/** The id of a message, as text, or null for a notification. */
const idOf = (message: AnyMessage): string | null =>
  'id' in message && message.id !== null ? String(message.id) : null

/**
 * Names the messages of one connection: a response carries no method, so the method of the
 * request it answers is remembered, per direction, until it is answered.
 */
const namer = () => {
  const asked = { in: new Map<string, string>(), out: new Map<string, string>() }
  return (direction: Direction, message: AnyMessage): string => {
    const id = idOf(message)
    if ('method' in message) {
      if (id === null) return `notification ${message.method}`
      asked[direction].set(id, message.method)
      return `request ${message.method} #${id}`
    }
    // A response answers a request that went the other way.
    const book = asked[direction === 'in' ? 'out' : 'in']
    const method = (id === null ? undefined : book.get(id)) ?? 'unknown'
    if (id !== null) book.delete(id)
    return `response ${method} #${id ?? '?'}`
  }
}

/** Hears one message of a connection, for its trace. */
export type AcpTrace = (direction: Direction, message: AnyMessage) => void

export class AcpTraces extends Context.Service<
  AcpTraces,
  {
    /** Turns the writing on or off, as the trace preference says. */
    readonly writing: (on: boolean) => void
    /**
     * The trace of one agent session, which writes only while the preference is on. A session id
     * that is not file-safe is refused.
     */
    readonly open: (sessionId: string) => Effect.Effect<AcpTrace, TraceNameRefused>
  }
>()('AcpTraces') {}

/** The traces of a data folder, off until the preference turns them on. */
export const acpTracesLayer = (dataFolder: string) =>
  Layer.effect(
    AcpTraces,
    Effect.gen(function* () {
      const secrets = yield* Secrets
      let on = false
      return {
        writing: (next: boolean) => {
          on = next
        },
        open: (sessionId: string) =>
          Effect.gen(function* () {
            const file = traceFileOf(dataFolder, sessionId)
            if (file === null) return yield* new TraceNameRefused({ sessionId })
            const name = namer()
            const write = openTraceLog(file, secrets.mask)
            const trace: AcpTrace = (direction, message) => {
              const named = name(direction, message)
              if (!on) return
              const way = direction === 'in' ? 'agent → hemera' : 'hemera → agent'
              write(`${new Date().toISOString()} ${way} ${named} ${elided(message)}`)
            }
            return trace
          }),
      }
    }),
  )
