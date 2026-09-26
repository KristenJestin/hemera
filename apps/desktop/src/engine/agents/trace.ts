/**
 * What an agent and Hemera said to each other, written down on demand (issue #131).
 *
 * A Session that shows "Thinking…" for minutes is one of two things: an agent that ended its turn
 * without Hemera noticing, or an agent waiting on something Hemera never showed. Nothing in the
 * thread can tell them apart, because the thread is what Hemera understood and not what was said.
 * The trace is what was said: every ACP message of a Session, in the order it crossed, with its
 * direction, its method, its identifier and its time, in a file beside the diagnostic.
 *
 * It is written only while the reader asked for it in the settings, and never with anything a
 * reader of the file should not have: the text of a string is kept only under the protocol's own
 * names — a method, a stop reason, an identifier, the sentence of an error — and every other string
 * is written as its size. A prompt, a file the agent read, a token in a header, a command line: all
 * of them are `‹n chars›` here, so the trace says what happened and never what was in it.
 *
 * The same reading of the wire is what knows which of the agent's requests are still unanswered,
 * which is what lets the thread say an agent is waiting on Hemera (`requestBook`).
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AnyMessage } from '@agentclientprotocol/sdk'
import { Context, Effect, Layer } from 'effect'

import { traceFileOf } from '../../main/diagnostic.ts'

/** Which way a message went: `in` is the agent speaking to Hemera, `out` Hemera to the agent. */
export type Direction = 'in' | 'out'

/** One message of the wire, as a reader of the conversation names it. */
export interface Heard {
  readonly kind: 'request' | 'response' | 'notification'
  /** The method, or the method of the request a response answers when that one was seen. */
  readonly method: string
  /** The identifier of a request or of the response to it; null for a notification. */
  readonly id: string | null
  /** The sentence of an error a response carried; null for anything else. */
  readonly error: string | null
  /** Who asked, for a request and for the response to it; null for a notification. */
  readonly askedBy: 'agent' | 'hemera' | null
}

/**
 * The requests of one connection that have not been answered yet, both ways.
 *
 * Read off the wire rather than off the SDK's handlers: a request the SDK refused on its own — a
 * method Hemera does not implement — and a request a handler is still holding are both seen here
 * the same way, as a request and, or not yet, its response.
 */
export interface RequestBook {
  /** What one message was, and the book kept up to date with it. */
  readonly heard: (direction: Direction, message: AnyMessage) => Heard
  /** Whether a request the agent made is still waiting for Hemera's answer. */
  readonly waiting: (id: string) => boolean
}

/** The identifier of a message, as text, or null when it carries none. */
function idOf(message: AnyMessage): string | null {
  if (!('id' in message) || message.id === null) return null
  return String(message.id)
}

export function requestBook(): RequestBook {
  const askedByHemera = new Map<string, string>()
  const askedByAgent = new Map<string, string>()
  return {
    heard: (direction, message) => {
      const id = idOf(message)
      if ('method' in message) {
        if (id === null) {
          return { kind: 'notification', method: message.method, id, error: null, askedBy: null }
        }
        const askedBy = direction === 'in' ? 'agent' : 'hemera'
        const book = askedBy === 'agent' ? askedByAgent : askedByHemera
        book.set(id, message.method)
        return { kind: 'request', method: message.method, id, error: null, askedBy }
      }
      // A response answers a request that went the other way.
      const askedBy = direction === 'in' ? 'hemera' : 'agent'
      const book = askedBy === 'agent' ? askedByAgent : askedByHemera
      const method = (id === null ? undefined : book.get(id)) ?? 'unknown'
      if (id !== null) book.delete(id)
      const error = 'error' in message ? message.error.message : null
      return { kind: 'response', method, id, error, askedBy }
    },
    waiting: (id) => askedByAgent.has(id),
  }
}

/**
 * The names under which a string is the protocol's own word and is kept as it is.
 *
 * Everything else is somebody's text — a prompt, a file, a title made of a command line, a header —
 * and is written as its size. `value` is not here on purpose: it is where a header carries a token.
 */
const KEPT = new Set([
  'jsonrpc',
  'method',
  'id',
  'sessionId',
  'sessionUpdate',
  'stopReason',
  'toolCallId',
  'messageId',
  'kind',
  'status',
  'type',
  'optionId',
  'configId',
  'category',
  'outcome',
  'modeId',
  'currentModeId',
  'modelId',
  'currentModelId',
  'name',
  'mimeType',
])

/** How much of a kept word is written: an identifier is short, and a long one is not one. */
const WORD_LIMIT = 200

/**
 * How much of an error's sentence is written.
 *
 * The one text kept whatever it says: it is what a trace is read for — "429 Too Many Requests"
 * says itself there and nowhere else — and it is the agent's own sentence about a failure.
 */
const SENTENCE_LIMIT = 500

/** How many items of a list are written before the rest is counted. */
const LIST_LIMIT = 20

/** A text cut to a length, and saying that it was. */
function cut(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}‹+${text.length - limit} chars›`
}

/**
 * One message as the trace writes it: its shape, its protocol words, and the size of the rest.
 *
 * The walk is `JSON.stringify`'s own, so what is written is exactly the JSON that crossed, with
 * strings replaced where they stood.
 */
export function elided(message: AnyMessage): string {
  return JSON.stringify(message, (key: string, held) => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the trace writes the wire's own JSON back out and decodes nothing from it: what a string is does not matter here, only whether it is one
    if (typeof held === 'string') {
      if (KEPT.has(key)) return cut(held, WORD_LIMIT)
      if (key === 'message') return cut(held, SENTENCE_LIMIT)
      return `‹${String(held.length)} chars›`
    }
    if (Array.isArray(held) && held.length > LIST_LIMIT) {
      return [...held.slice(0, LIST_LIMIT), `‹${String(held.length - LIST_LIMIT)} more›`]
    }
    return held
  })
}

/** One line of the trace: when, which way, what, and the message elided. */
export function traceLine(
  direction: Direction,
  heard: Heard,
  message: AnyMessage,
  at: Date,
): string {
  const way = direction === 'in' ? 'agent → hemera' : 'hemera → agent'
  const id = heard.id === null ? '' : ` #${heard.id}`
  return `${at.toISOString()} ${way} ${heard.kind} ${heard.method}${id} ${elided(message)}`
}

/**
 * How big one trace file grows before it is rotated, in bytes.
 *
 * One previous file is kept beside it, so a Session's trace holds at most twice this: enough for
 * the turn that went quiet and the ones before it, and never a disk filled by a chatty agent.
 */
export const TRACE_LIMIT = 4 * 1024 * 1024

export interface AcpTracesService {
  /** Turns the writing on or off, as the preference says it is. */
  readonly writing: (on: boolean) => void
  /** Whether lines are being written, so a caller spends nothing on a line nobody keeps. */
  readonly on: () => boolean
  /** Writes one line to the trace of a Session, when the writing is on. */
  readonly write: (sessionId: string, line: string) => void
}

export class AcpTraces extends Context.Service<AcpTraces, AcpTracesService>()('AcpTraces') {}

/**
 * The traces of the data folder the engine opened, off until the preference turns them on.
 *
 * Written synchronously and a short line at a time, as the diagnostic is: a line is written in the
 * order its message crossed, and a trace that lost the last lines before a crash would be a trace
 * of everything but the moment it was kept for. A file that cannot be written is not a failure of
 * the conversation it is about: the line is dropped and the agent goes on.
 */
export function acpTracesLayer(directory: string): Layer.Layer<AcpTraces> {
  return Layer.effect(
    AcpTraces,
    Effect.sync(() => {
      let on = false
      const sizes = new Map<string, number>()

      /** How much the file holds already, read once per Session and counted after that. */
      const sizeOf = (file: string, sessionId: string): number => {
        const known = sizes.get(sessionId)
        if (known !== undefined) return known
        mkdirSync(dirname(file), { recursive: true })
        try {
          return statSync(file).size
        } catch {
          return 0
        }
      }

      return {
        writing: (next) => {
          on = next
        },
        on: () => on,
        write: (sessionId, line) => {
          if (!on) return
          const file = traceFileOf(directory, sessionId)
          if (file === null) return
          try {
            const written = `${line}\n`
            const bytes = Buffer.byteLength(written)
            let size = sizeOf(file, sessionId)
            if (size + bytes > TRACE_LIMIT && size > 0) {
              renameSync(file, file.replace(/\.log$/, '.1.log'))
              size = 0
            }
            appendFileSync(file, written)
            sizes.set(sessionId, size + bytes)
          } catch {
            // A trace is a help and never a condition: a full disk loses the line, not the turn.
          }
        },
      }
    }),
  )
}
