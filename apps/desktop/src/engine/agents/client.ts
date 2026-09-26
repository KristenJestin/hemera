/**
 * The engine's side of one ACP connection (design D5-03).
 *
 * Hemera is the client of this protocol: it starts one agent process, asks it to open a session
 * or to continue the one it handed back last time, sends one prompt per turn, and receives what
 * the agent reports while it works. This file is the only place in the application that speaks
 * ACP, and everything above it — the turn, the thread, the window — sees Hemera's own vocabulary:
 * an update as an `AgentEvent`, and a permission request as a question someone can answer.
 *
 * The protocol is spoken through `@agentclientprotocol/sdk`, by the design's decision and not by
 * hand: the framing, the request ids and the capability negotiation are the SDK's, and what is
 * Hemera's here is only the two handlers and the reading of what comes back. The connection is
 * built with `ClientSideConnection`'s constructor, which owns its own lifetime, rather than with
 * the successor `client().connectWith(stream, op)`: that one runs the whole conversation inside
 * a callback and closes the socket with it, and a Session's agent outlives a turn by design.
 *
 * Nothing here starts a process. The supervisor starts one and this connection is built over the
 * two pipes it owns, which is also what makes it testable: a peer that speaks the protocol over
 * an in-memory stream is a real agent to this file, not a stub of one.
 */

import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client as AcpClient,
  type ContentBlock,
  type ToolCallContent,
  type Cost,
  type McpServer,
  type SessionNotification,
  type StopReason,
  type Usage,
  type SessionConfigOption,
  type SessionConfigSelectOptions,
} from '@agentclientprotocol/sdk'
import { Data, Effect } from 'effect'
import { DELIVERY_MARKER } from '@hemera/core'
import { z } from 'zod'

import { type AgentAdapter } from './adapter.ts'
import type { ClaudeCodeMeta, CodexMeta } from './bare.ts'

/**
 * What a session is opened with on `_meta`, beside the servers: the options of the agents that
 * read their bare mode there (D6-02). Carried by the three ways into a session alike.
 */
export type SessionMeta = ClaudeCodeMeta | CodexMeta

/** Where Claude Code names the tool a permission is about, beside a title made for reading. */
const CLAUDE_TOOL = z.object({ claudeCode: z.object({ toolName: z.string() }) })

/** What went wrong while speaking the protocol, and at which step. */
export class AgentProtocolError extends Data.TaggedError('AgentProtocolError')<{
  readonly what: string
  readonly cause: string
}> {
  /**
   * What the agent said about it, rather than the name of the error.
   *
   * The message is what ends up in the thread — "the agent refuses to resume a session" tells the
   * user something, and `AgentProtocolError` tells them nothing — so the tag names the kind and
   * this says which one it was.
   */
  override get message(): string {
    return `${this.what}: ${this.cause}`
  }
}

/** One file a call is about, and where in it, as the agent named them. */
export interface ToolCallLocation {
  readonly path: string
  /** The line the agent pointed at, or null when it named the file alone. */
  readonly line: number | null
}

/**
 * One thing a call carries, in Hemera's words (ACP's `ToolCallContent`).
 *
 * Three shapes and not one string of JSON: what a call produced is what the thread draws — the
 * text it printed, the change it proposes, the terminal it opened — and a reader that had to
 * parse the protocol's own JSON to find out would be a second implementation of it.
 */
export type ToolCallContentBlock =
  | {
      readonly type: 'content'
      /** What the block says, as text; empty for a block that carries bytes rather than words. */
      readonly text: string
      /** The media type the agent gave it, and null for plain text, which names none. */
      readonly mime: string | null
    }
  | {
      readonly type: 'diff'
      readonly path: string
      /** What the file held before, and null when the change creates it. */
      readonly oldText: string | null
      readonly newText: string
    }
  | { readonly type: 'terminal'; readonly terminalId: string }

/** A tool call, as the thread draws it: one report, updated as the agent goes. */
export interface ToolCallReport {
  readonly id: string
  readonly title: string
  /** `read`, `edit`, `execute`, `think`, `fetch`, `other` — or null when the agent did not say. */
  readonly kind: string | null
  /** `pending`, `in_progress`, `completed` or `failed`. */
  readonly status: string | null
  /** The files this call is about, as the agent named them. */
  readonly locations: readonly ToolCallLocation[]
  /**
   * What the agent attached to the call: its content blocks, the change it proposes, the
   * terminal it opened, in the order it sent them.
   *
   * Empty is read as "unchanged" by the runtime, which is the only reader of these reports: an
   * update carries what changed, and a call that sends no content again is one whose content is
   * what it already was.
   */
  readonly content: readonly ToolCallContentBlock[]
  /**
   * What the tool was called with, as the JSON the agent sent; null when it said nothing.
   *
   * Kept as the text it arrived as rather than as fields: the arguments of a tool are the
   * tool's own shape, and Hemera is not the program that knows what `rg`'s are. Without it a
   * finished call says what it was about and never what it was asked to do.
   */
  readonly rawInput: string | null
  /** What the tool answered, the same way; null when the agent has not answered yet. */
  readonly rawOutput: string | null
}

/** One line of the plan the agent is keeping, as it reports it. */
export interface PlanLine {
  readonly content: string
  readonly status: string
}

/** What a finished turn used, as the agent accounts for it. */
export interface UsageReport {
  readonly totalTokens: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly thoughtTokens: number | null
}

/**
 * The context window, as the agent announced it (design D5-20).
 *
 * `usage_update` is the only place the protocol ever names a window: `initialize` says nothing
 * about it and neither do the models a session publishes, so an agent that announces a window
 * announces it here and an agent that does not has none to read. What arrives is what it said —
 * how much of the window is in use, how big the window is, and the session's cost when it
 * accounts for one.
 */
export interface WindowReport {
  readonly used: number
  readonly size: number
  readonly cost: Cost | null
}

/**
 * What a turn reports while it runs, in Hemera's words.
 *
 * The kinds are the thread's own (design D5-11): a message, a thought, a tool call and a plan
 * are what a turn can be said to be doing at any moment, and the window it is filling is what
 * the agent announced it against; everything else the protocol publishes — the commands it
 * offers, the mode it is in, a compaction — is an update this lot does not draw and so does not
 * carry.
 *
 * `replay` is true for what the agent sends back while a session is being continued: ACP asks it
 * to stream the whole history again, and those turns are already in Hemera's thread. A replay is
 * reported rather than dropped, so the banner over a resumed thread can say what arrived.
 */
export type AgentEvent =
  | {
      readonly type: 'message'
      readonly text: string
      readonly replay: boolean
      /** The message this chunk belongs to, when the agent named one (D5-08). */
      readonly messageId: string | null
    }
  | {
      readonly type: 'thought'
      readonly text: string
      readonly replay: boolean
      readonly messageId: string | null
    }
  | { readonly type: 'tool_call'; readonly call: ToolCallReport; readonly replay: boolean }
  | { readonly type: 'plan'; readonly entries: readonly PlanLine[]; readonly replay: boolean }
  | { readonly type: 'usage'; readonly window: WindowReport; readonly replay: boolean }

/** What the agent published about itself at `initialize`. */
export interface AgentHandshake {
  readonly protocolVersion: number
  /** The methods the user still has to go through, as the agent named them. */
  readonly authMethods: readonly { readonly id: string; readonly name: string }[]
  /**
   * Whether what it announced leaves it usable, read by its own adapter (design D5-02).
   *
   * An agent that is not signed in is not started, and is not replaced by another one (D5-17).
   */
  readonly authenticated: boolean
  /** Whether this agent can be asked to continue a session it handed back (D5-06). */
  readonly continues: boolean
  /**
   * Whether it can carry that session on without streaming it back first (D5-07).
   *
   * `session/resume` hands the conversation over as it stands, where `session/load` sends the
   * whole history again. Which one was used is what tells the thread whether what arrives is a
   * replay to be matched against what it already holds, or new work.
   */
  readonly resumes: boolean
}

/**
 * One thing the agent lets this Session choose, as the composer offers it (design D5-13).
 *
 * The list is the agent's own: Hemera draws a selector per option the agent announced and
 * invents none, so an agent offering a model and an effort gets two and one offering nothing
 * gets none. A `select` carries the values it accepts; a `boolean` is a switch and carries
 * none, its `value` being `true` or `false` as text.
 */
export interface AgentOption {
  readonly id: string
  readonly name: string
  /** `model`, `mode`, `thought_level` — or null when the agent did not say. */
  readonly category: string | null
  readonly kind: 'select' | 'boolean'
  readonly value: string
  readonly values: readonly AgentOptionValue[]
}

/**
 * One value an option accepts, in the agent's own words (decision of 22 September 2026).
 *
 * `description` is the sentence the agent wrote about that value and nothing Hemera composed;
 * `recommended` is the value the agent itself named as the one it advises, read out of the
 * announcement's `_meta` here so that nothing above this file has to know an extension
 * namespace exists.
 */
export interface AgentOptionValue {
  readonly id: string
  readonly name: string
  readonly description?: string | undefined
  readonly recommended?: boolean | undefined
}

/** A permission the agent is waiting for, as a question with the answers it offers. */
export interface PermissionQuestion {
  readonly toolCallId: string
  readonly title: string
  /**
   * The tool the question is about, as the agent names it: Claude Code says it under
   * `_meta.claudeCode.toolName`, and its title is only a title; the other agents' title is it.
   */
  readonly tool: string
  readonly options: readonly {
    readonly id: string
    readonly name: string
    readonly kind: string
  }[]
}

/**
 * What the user answered.
 *
 * `cancelled` is not a refusal by the user of what was asked but the end of the question — the
 * turn was stopped while the question stood, and the protocol has an outcome for exactly that.
 */
export type PermissionAnswer = { readonly optionId: string } | { readonly cancelled: true }

/** How a turn ended, and what it cost. */
export interface PromptOutcome {
  readonly stopReason: StopReason
  readonly usage: UsageReport | null
}

/**
 * One connection to one agent, from Hemera's side.
 *
 * The native session id is the connection's own after `open` or `continue`, because every call
 * the client may make after that names it: a turn belongs to the session it was sent to, and the
 * caller that holds a connection is a caller that is talking to one agent about one Session.
 */
export interface AgentConnection {
  readonly handshake: AgentHandshake
  /** What the agent lets this Session choose, as it announced it when the session opened. */
  readonly options: () => readonly AgentOption[]
  /** Asks the agent for one of them, and answers what it says the options are now. */
  readonly setOption: (
    optionId: string,
    value: string,
  ) => Effect.Effect<readonly AgentOption[], AgentProtocolError>
  /**
   * Opens a session in that directory and answers the handle the agent gave it.
   *
   * The MCP servers are the caller's: Hemera hands over one, its own tools on a loopback address
   * with the token of this Session in it, and the three ways into a session all carry it (D6-01).
   * So does `meta`, for the agent that takes its bare mode from `_meta`.
   */
  readonly open: (
    workingDirectory: string,
    mcpServers: readonly McpServer[],
    meta?: SessionMeta,
  ) => Effect.Effect<string, AgentProtocolError>
  /**
   * Asks the agent to carry the session on as it stands, without sending its history back.
   *
   * `session/resume`, and the one the design prefers (D5-07): a conversation the agent still
   * holds does not have to be told again, and nothing arrives to be matched against the thread.
   */
  readonly resume: (
    nativeSessionId: string,
    workingDirectory: string,
    mcpServers: readonly McpServer[],
    meta?: SessionMeta,
  ) => Effect.Effect<void, AgentProtocolError>
  /**
   * Asks the agent to stream the session's history back, so the thread can be matched to it.
   *
   * `session/load`: what it sends is a replay, which is what tells the thread to update the
   * entries it already has rather than write them a second time (D5-08).
   */
  readonly load: (
    nativeSessionId: string,
    workingDirectory: string,
    mcpServers: readonly McpServer[],
    meta?: SessionMeta,
  ) => Effect.Effect<void, AgentProtocolError>
  /**
   * Sends one turn and waits for the agent to be done with it.
   *
   * What Hemera provides goes in front of the text, as embedded resources behind its marker
   * (D6-07, D6-08): the base on an agent with no system prompt to hand it through, a change of
   * the instructions between two turns. A prompt of provisions alone, with an empty text, is a
   * delivery — no word of the user's is in it.
   */
  readonly prompt: (
    text: string,
    provided?: readonly Provision[],
  ) => Effect.Effect<PromptOutcome, AgentProtocolError>
  /** Asks the agent to stop what it is doing; its answer to the turn is `cancelled`. */
  readonly cancel: () => Effect.Effect<void, AgentProtocolError>
}

/** What `connect` needs: the agent's two pipes, its adapter, and the two questions it may ask. */
export interface ConnectionOptions {
  /** What the agent writes: its standard output. */
  readonly input: ReadableStream<Uint8Array>
  /** What the agent reads: its standard input. */
  readonly output: WritableStream<Uint8Array>
  readonly adapter: AgentAdapter
  readonly onEvent: (event: AgentEvent) => void
  readonly onPermission: (question: PermissionQuestion) => Promise<PermissionAnswer>
}

/** One text Hemera provides an agent, named by the address it is known by (D6-07). */
export interface Provision {
  readonly uri: string
  readonly text: string
  readonly mimeType: string
}

/**
 * The blocks of one prompt: Hemera's marker and what it provides, then the user's text.
 *
 * A provision is an embedded resource on an agent that advertised `embeddedContext`, which the
 * three do; on one that did not, it is the same text in a text block under its address, because
 * a resource the agent said it cannot read is a provision that never arrived. The marker comes
 * first either way, so what Hemera provided is never read as the user's words (D6-08).
 */
function blocksOf(text: string, provided: readonly Provision[], embeds: boolean): ContentBlock[] {
  const blocks: ContentBlock[] = []
  if (provided.length > 0) blocks.push({ type: 'text', text: DELIVERY_MARKER })
  for (const one of provided) {
    blocks.push(
      embeds
        ? { type: 'resource', resource: { uri: one.uri, mimeType: one.mimeType, text: one.text } }
        : { type: 'text', text: `${one.uri}\n${one.text}` },
    )
  }
  if (text !== '') blocks.push({ type: 'text', text })
  return blocks
}

/**
 * A request of the three ways into a session, with `_meta` when there is one to carry.
 *
 * Left out rather than sent empty: an agent that reads nothing there is not told anything.
 */
function withMeta<T extends object>(
  request: T,
  meta: SessionMeta | undefined,
): T & { _meta?: SessionMeta } {
  if (meta === undefined) return request
  return { ...request, _meta: meta }
}

/** The text of a content block, or null when it carries something other than text. */
function textOf(content: ContentBlock): string | null {
  return content.type === 'text' ? content.text : null
}

/**
 * One content block of a call, as words and the media type they came under.
 *
 * Text is what the thread draws, and what is not text is named rather than carried: an image
 * and an audio block are megabytes of base64, and a thread is not where they belong — the media
 * type says what arrived, and the call's raw output holds what the tool actually answered.
 */
function saidOf(content: ContentBlock) {
  switch (content.type) {
    case 'text':
      return { text: content.text, mime: null }
    case 'image':
    case 'audio':
      return { text: '', mime: content.mimeType }
    case 'resource_link':
      return { text: content.uri, mime: content.mimeType ?? null }
    case 'resource':
      return {
        text: 'text' in content.resource ? content.resource.text : '',
        mime: content.resource.mimeType ?? null,
      }
    default:
      return { text: '', mime: null }
  }
}

/** What a call attached to itself, in Hemera's three shapes. */
function contentOf(blocks: readonly ToolCallContent[]): readonly ToolCallContentBlock[] {
  return blocks.map((block) => {
    if (block.type === 'diff') {
      return {
        type: 'diff' as const,
        path: block.path,
        oldText: block.oldText ?? null,
        newText: block.newText,
      }
    }
    if (block.type === 'terminal') {
      return { type: 'terminal' as const, terminalId: block.terminalId }
    }
    return { type: 'content' as const, ...saidOf(block.content) }
  })
}

/**
 * What the agent sent as the raw input or output of a call, as the JSON it sent.
 *
 * `undefined` is the agent saying nothing about it — an update carries what changed — and null
 * is what that becomes here, so a call that says nothing keeps what it already had.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the arguments of a tool are the tool's own shape and the protocol says so: this is the boundary where they arrive
function rawOf(raw: unknown): string | null {
  return raw === undefined ? null : (JSON.stringify(raw) ?? null)
}

/** A notification, as an event of the thread — or null for what this lot does not draw. */
function eventOf(notification: SessionNotification, replay: boolean): AgentEvent | null {
  const update = notification.update
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const text = textOf(update.content)
      return text === null
        ? null
        : { type: 'message', text, replay, messageId: update.messageId ?? null }
    }
    case 'agent_thought_chunk': {
      const text = textOf(update.content)
      return text === null
        ? null
        : { type: 'thought', text, replay, messageId: update.messageId ?? null }
    }
    case 'tool_call':
    case 'tool_call_update': {
      return {
        type: 'tool_call',
        replay,
        call: {
          id: update.toolCallId,
          // An update carries only what changed, so a title it does not repeat is one the
          // thread already has: the empty string here is read as "unchanged" by the runtime,
          // which is the only reader of these reports.
          title: 'title' in update ? (update.title ?? '') : '',
          kind: 'kind' in update ? (update.kind ?? null) : null,
          status: 'status' in update ? (update.status ?? null) : null,
          locations: ('locations' in update ? (update.locations ?? []) : []).map((location) => ({
            path: location.path,
            line: location.line ?? null,
          })),
          content: contentOf('content' in update ? (update.content ?? []) : []),
          rawInput: rawOf('rawInput' in update ? update.rawInput : undefined),
          rawOutput: rawOf('rawOutput' in update ? update.rawOutput : undefined),
        },
      }
    }
    case 'plan':
      return {
        type: 'plan',
        replay,
        entries: update.entries.map((entry) => ({
          content: entry.content,
          status: entry.status,
        })),
      }
    case 'usage_update':
      return {
        type: 'usage',
        replay,
        window: { used: update.used, size: update.size, cost: update.cost ?? null },
      }
    default:
      return null
  }
}

/**
 * The values one announced option accepts, flattened.
 *
 * ACP lets an agent group its values; the composer draws one flat list per option, so a group
 * is a heading the window does not need and its values are what it has.
 */
function choicesOf(
  options: SessionConfigSelectOptions,
  recommended: string | null,
): readonly AgentOptionValue[] {
  const flat = options.flatMap((choice) => ('value' in choice ? [choice] : choice.options))
  return flat.map((choice) => ({
    id: choice.value,
    name: choice.name,
    // The agent's own sentence about the value, and nothing where it wrote none: `Default`
    // is announced as a value like any other and this is the only thing that says what it is.
    description: choice.description ?? undefined,
    // Marked on the value the agent named, so that nothing above reads an extension namespace.
    recommended: choice.value === recommended ? true : undefined,
  }))
}

/**
 * The value an agent named as the one it recommends, or null when it named none.
 *
 * It travels under the AIR extension of ACP — `_meta.jetbrains.air.recommendedValue`, at
 * version 1 of that extension — which is what both the Claude adapter and the Codex one write
 * it with. Read with a parser rather than by hand because this is wire data: an agent that
 * writes something else there is an agent that named nothing, not one that breaks the read.
 */
function recommendedOf(meta: SessionConfigOption['_meta']): string | null {
  const read = airRecommendation.safeParse(meta)
  return read.success ? read.data.jetbrains.air.recommendedValue : null
}

/** The version of that extension the adapters write, and the one this file agrees to read. */
const AIR_EXTENSION_VERSION = 1

/** The capability of that extension Hemera draws: a value the agent says it recommends. */
const AIR_RECOMMENDED_VALUE = 'recommendedValue'

/**
 * What Hemera says about itself at `initialize`, beside the protocol's own capabilities.
 *
 * Advertising this is what asks an agent to resolve its own `Default` rather than announce one
 * (decision of 22 September 2026). It is read at `initialize` and not at `session/new`: the
 * adapters decide how to present an option from the capabilities the client sent when the
 * connection opened, and every session of that connection is announced the same way after it.
 *
 * On the Claude adapter it is exactly the `useRecommendedValue` presentation flag: the `Default`
 * rows of the effort and of the model are left out of the announcement, the resolved model and
 * the recommended effort are what the session is on, and the value each of them stands for
 * arrives named in `_meta`. Codex names a recommendation whether or not this is sent, and
 * announces no `Default` either way. An agent that has never heard of the extension ignores an
 * unknown `_meta` key, which is what the protocol reserves it for.
 */
const CLIENT_META = {
  jetbrains: {
    air: { version: AIR_EXTENSION_VERSION, capabilities: [AIR_RECOMMENDED_VALUE] },
  },
}

/** The one shape of `_meta` this file knows how to read, and the whole of what it takes from it. */
const airRecommendation = z.object({
  jetbrains: z.object({
    air: z.object({ version: z.literal(AIR_EXTENSION_VERSION), recommendedValue: z.string() }),
  }),
})

/** The value an agent announces as its own stand-in, whose meaning it may or may not give. */
const DEFAULT_VALUE = 'default'

/**
 * The value a `Default` entry stands for, where the agent said which one it is.
 *
 * Two ways of saying it, and neither of them is a guess. The agent may name a recommended value
 * in its `_meta`, which is the one it falls back to; or it may write the name of that value in
 * `Default`'s own description — "Opus 4.5 · 1M context", which is the resolved model spelled
 * out. A value whose name is written there is that value; a longer name wins over a shorter one
 * it contains, so `Opus 4.5` is not read as `Opus 4`.
 */
function namedByDefault(values: readonly AgentOptionValue[]): AgentOptionValue | null {
  const others = values.filter((value) => value.id !== DEFAULT_VALUE)
  const recommended = others.find((value) => value.recommended === true)
  if (recommended !== undefined) return recommended

  const said = values.find((value) => value.id === DEFAULT_VALUE)?.description?.trim() ?? ''
  if (said === '') return null
  const spelled = said.toLowerCase()
  const exact = others.find(
    (value) => value.name.toLowerCase() === spelled || value.id.toLowerCase() === spelled,
  )
  if (exact !== undefined) return exact
  const written = others.filter((value) => spelled.includes(value.name.toLowerCase()))
  return written.reduce<AgentOptionValue | null>(
    (longest, value) =>
      longest === null || value.name.length > longest.name.length ? value : longest,
    null,
  )
}

/**
 * The `Default` entry, resolved into the value it stands for — or left exactly as it came.
 *
 * The maintainer's rule of 22 September 2026, and the whole of it: when the agent says which
 * value `Default` stands for, the entry disappears and the value it names is marked as the
 * recommended one and becomes what the Session is on; when the agent does not say, `Default`
 * stays as its own entry and nothing is guessed. Never both — a list holding a `Default` beside
 * the value it names offers the same thing twice under two names.
 *
 * This is the fallback and not the first line: the client advertises that it draws a
 * recommendation, so the Claude adapter stops announcing the entry at all. An agent that
 * announces one anyway is one this has to answer for.
 */
function resolvedDefault(values: readonly AgentOptionValue[], current: string) {
  if (!values.some((value) => value.id === DEFAULT_VALUE)) return { values, current }
  const named = namedByDefault(values)
  if (named === null) return { values, current }

  const kept: AgentOptionValue[] = []
  for (const value of values) {
    if (value.id === DEFAULT_VALUE) continue
    if (value.id !== named.id) kept.push(value)
    else {
      kept.push({
        id: value.id,
        name: value.name,
        description: value.description,
        recommended: true,
      })
    }
  }
  return { values: kept, current: current === DEFAULT_VALUE ? named.id : current }
}

/** What the protocol calls the option of an agent's modes, as a category and as an id. */
const MODE = 'mode'

/** Whether an option is the agent's mode. */
function isMode(option: AgentOption | undefined): boolean {
  return option !== undefined && (option.category === MODE || option.id === MODE)
}

/**
 * What an agent lets a Session choose, once what is not the user's to choose is left out.
 *
 * An agent left no mode of its own by its bare means offers none (issue #128): what it announces
 * as its modes is either what a bare session refuses or Hemera's own agent.
 */
function offered(adapter: AgentAdapter, announced: readonly AgentOption[]): readonly AgentOption[] {
  if (adapter.modeless !== true) return announced
  return announced.filter((option) => !isMode(option))
}

/** What an agent lets a Session choose, in Hemera's words. */
function optionsOf(
  announced: readonly SessionConfigOption[] | null | undefined,
): readonly AgentOption[] {
  return (announced ?? []).map((option) => {
    const category = option.category ?? null
    if (option.type === 'boolean') {
      return {
        id: option.id,
        name: option.name,
        category,
        kind: 'boolean' as const,
        value: String(option.currentValue),
        values: [],
      }
    }
    const resolved = resolvedDefault(
      // oxlint-disable-next-line eslint/no-underscore-dangle -- `_meta` is the protocol's own name for its extension slot
      choicesOf(option.options, recommendedOf(option._meta)),
      option.currentValue,
    )
    return {
      id: option.id,
      name: option.name,
      category,
      kind: 'select' as const,
      value: resolved.current,
      values: resolved.values,
    }
  })
}

/** What a finished turn used, or null when the agent accounted for nothing. */
function usageOf(usage: Usage | null | undefined): UsageReport | null {
  return usage == null
    ? null
    : {
        totalTokens: usage.totalTokens,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        thoughtTokens: usage.thoughtTokens ?? null,
      }
}

/**
 * Builds the connection and shakes hands with the agent.
 *
 * The handshake is done here rather than left to the caller because nothing can be asked of an
 * agent before it: what comes back is what says whether this agent can be talked to at all, and
 * what the Agents page shows about it.
 */
export function connect(
  options: ConnectionOptions,
): Effect.Effect<AgentConnection, AgentProtocolError> {
  return Effect.gen(function* () {
    const adapter = options.adapter
    /**
     * Whether what arrives now is the agent replaying history rather than working.
     *
     * ACP asks the agent to stream the whole conversation back when a session is continued, and
     * those turns are already in Hemera's thread: what is replayed is reported as such so that
     * nothing writes a second copy of what the user already has.
     */
    let replaying = false
    let sessionId: string | null = null
    /**
     * What the agent said it lets this Session choose, as it last said it.
     *
     * Held here rather than in the caller because every answer that changes an option carries
     * the whole set back: the composer is drawn from the agent's own words, and this is the one
     * place that keeps them.
     */
    let announced: readonly AgentOption[] = []

    const client: AcpClient = {
      // ACP's own contract: whatever the user answered, in the shape the protocol takes it in.
      requestPermission: async (request) => {
        // oxlint-disable-next-line eslint/no-underscore-dangle -- `_meta` is the protocol's own name for its extension slot
        const named = CLAUDE_TOOL.safeParse(request.toolCall._meta)
        const answer = await options.onPermission({
          toolCallId: request.toolCall.toolCallId,
          title: request.toolCall.title ?? '',
          tool: named.success ? named.data.claudeCode.toolName : (request.toolCall.title ?? ''),
          options: request.options.map((option) => ({
            id: option.optionId,
            name: option.name,
            kind: option.kind,
          })),
        })
        return 'cancelled' in answer
          ? { outcome: { outcome: 'cancelled' as const } }
          : { outcome: { outcome: 'selected' as const, optionId: answer.optionId } }
      },
      sessionUpdate: (notification) => {
        const event = eventOf(notification, replaying)
        if (event !== null) options.onEvent(event)
      },
    }

    const connection = new ClientSideConnection(
      () => client,
      ndJsonStream(options.output, options.input),
    )

    const handshake = yield* Effect.tryPromise({
      try: () =>
        connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          // Hemera advertises no capability of the protocol proper in this lot: the agent does
          // its own reading, writing and running, and none of it is routed back through this
          // window. What it does advertise is the one extension it draws — see CLIENT_META.
          clientCapabilities: { _meta: CLIENT_META },
          clientInfo: { name: 'Hemera', version: '0.0.0' },
        }),
      catch: (cause) => new AgentProtocolError({ what: 'initialize', cause: String(cause) }),
    })

    const methods = (handshake.authMethods ?? []).map((method) => ({
      id: method.id,
      name: method.name,
    }))

    // Whether a provision can be handed over as a resource, as the agent said at `initialize`.
    const embeds = handshake.agentCapabilities?.promptCapabilities?.embeddedContext === true

    const named = (value: string, what: string): Effect.Effect<string, AgentProtocolError> =>
      sessionId === null
        ? Effect.fail(new AgentProtocolError({ what, cause: 'no session has been opened' }))
        : Effect.succeed(value)

    return {
      handshake: {
        protocolVersion: handshake.protocolVersion,
        authMethods: methods,
        authenticated: adapter.isAuthenticated(methods),
        continues: handshake.agentCapabilities?.loadSession === true,
        resumes: handshake.agentCapabilities?.sessionCapabilities?.resume != null,
      },

      options: () => offered(adapter, announced),

      setOption: (optionId, value) =>
        Effect.gen(function* () {
          const open = yield* named(sessionId ?? '', 'setSessionConfigOption')
          const chosen = announced.find((option) => option.id === optionId)
          // A mode is never sent to an agent left none by its bare means, whatever asked for it:
          // a choice remembered from before, or a session opened without Hemera's configuration
          // that announced modes the bare one refuses (issue #128).
          if (adapter.modeless === true && (optionId === MODE || isMode(chosen))) {
            return yield* Effect.fail(
              new AgentProtocolError({
                what: 'setSessionConfigOption',
                cause: `${adapter.label} has no mode to choose when it runs bare`,
              }),
            )
          }
          const answered = yield* Effect.tryPromise({
            try: () =>
              connection.setSessionConfigOption(
                chosen?.kind === 'boolean'
                  ? {
                      sessionId: open,
                      configId: optionId,
                      type: 'boolean',
                      value: value === 'true',
                    }
                  : { sessionId: open, configId: optionId, value },
              ),
            catch: (cause) =>
              new AgentProtocolError({ what: 'setSessionConfigOption', cause: String(cause) }),
          })
          announced = optionsOf(answered.configOptions)
          return offered(adapter, announced)
        }),

      open: (workingDirectory, mcpServers, meta) =>
        Effect.gen(function* () {
          const opened = yield* Effect.tryPromise({
            try: () =>
              connection.newSession(
                withMeta({ cwd: workingDirectory, mcpServers: [...mcpServers] }, meta),
              ),
            catch: (cause) => new AgentProtocolError({ what: 'newSession', cause: String(cause) }),
          })
          sessionId = opened.sessionId
          announced = optionsOf(opened.configOptions)
          return opened.sessionId
        }),

      resume: (nativeSessionId, workingDirectory, mcpServers, meta) =>
        Effect.gen(function* () {
          const answered = yield* Effect.tryPromise({
            try: () =>
              connection.resumeSession(
                withMeta(
                  {
                    sessionId: nativeSessionId,
                    cwd: workingDirectory,
                    mcpServers: [...mcpServers],
                  },
                  meta,
                ),
              ),
            catch: (cause) =>
              new AgentProtocolError({ what: 'resumeSession', cause: String(cause) }),
          })
          sessionId = nativeSessionId
          announced = optionsOf(answered.configOptions)
        }),

      load: (nativeSessionId, workingDirectory, mcpServers, meta) =>
        Effect.gen(function* () {
          // Every chunk a load sends back is a replay: the flag is set for the whole call, so a
          // notification that arrives while the history is streaming is marked as what it is.
          replaying = true
          const answered = yield* Effect.tryPromise({
            try: () =>
              connection.loadSession(
                withMeta(
                  {
                    sessionId: nativeSessionId,
                    cwd: workingDirectory,
                    mcpServers: [...mcpServers],
                  },
                  meta,
                ),
              ),
            catch: (cause) => new AgentProtocolError({ what: 'loadSession', cause: String(cause) }),
          }).pipe(Effect.ensuring(Effect.sync(() => (replaying = false))))
          sessionId = nativeSessionId
          announced = optionsOf(answered.configOptions)
        }),

      prompt: (text, provided = []) =>
        Effect.gen(function* () {
          const open = sessionId
          if (open === null) {
            return yield* Effect.fail(
              new AgentProtocolError({ what: 'prompt', cause: 'no session has been opened' }),
            )
          }
          const answered = yield* Effect.tryPromise({
            try: () =>
              connection.prompt({
                sessionId: open,
                prompt: blocksOf(text, provided, embeds),
              }),
            // The agent's own sentence, without the name of the error class in front of it: a
            // provider's refusal is what the thread shows of a turn that failed.
            catch: (cause) =>
              new AgentProtocolError({
                what: 'prompt',
                cause: cause instanceof Error ? cause.message : String(cause),
              }),
          })
          return { stopReason: answered.stopReason, usage: usageOf(answered.usage) }
        }),

      cancel: () =>
        Effect.gen(function* () {
          const open = yield* named(sessionId ?? '', 'cancel')
          yield* Effect.tryPromise({
            try: () => connection.cancel({ sessionId: open }),
            catch: (cause) => new AgentProtocolError({ what: 'cancel', cause: String(cause) }),
          })
        }),
    } satisfies AgentConnection
  })
}
